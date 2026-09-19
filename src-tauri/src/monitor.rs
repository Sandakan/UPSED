use crate::commands::{connect_device_internal, detect_status_events, AppState, ProbeStatusEvent};
use crate::db::TelemetryRecord;
use crate::serial::scan_available_ports;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub async fn run_background_monitor(
    app: AppHandle,
    state: AppState,
    mut interval_rx: tokio::sync::watch::Receiver<u64>,
) {
    tracing::info!("Starting VoltWatch background UPS monitor task");

    // Allow initial application startup to settle before first probe
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut is_initial = true;
    loop {
        if !is_initial {
            let interval_secs = (*interval_rx.borrow()).max(1);

            // Immediate responsive sleep: if interval changes, reset timer instantly
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval_secs)) => {},
                changed = interval_rx.changed() => {
                    if changed.is_ok() {
                        let new_sec = *interval_rx.borrow();
                        tracing::info!("Background monitor: interval updated to {}s, restarting cycle", new_sec);
                        continue;
                    }
                }
            }
        }
        is_initial = false;

        // Execute one polling cycle on blocking worker thread
        let state_clone = state.clone();
        let app_clone = app.clone();

        let _ = tokio::task::spawn_blocking(move || {
            poll_cycle_step(&app_clone, &state_clone);
        })
        .await;
    }
}

fn poll_cycle_step(app: &AppHandle, state: &AppState) {
    // 1. Determine active port to poll
    let connected_devices = state.manager.list_devices();
    let port_to_poll = if let Some(first) = connected_devices.first() {
        Some((first.port_name.clone(), first.serial_number.clone()))
    } else {
        // Try last connected port from settings
        let last_port = state.db.get_setting("last_connected_port").unwrap_or(None);
        let last_device_id = state.db.get_setting("last_connected_device").unwrap_or(None);

        if let Some(port) = last_port {
            let _ = app.emit(
                "ups-probe-status",
                ProbeStatusEvent {
                    phase: "connecting".into(),
                    message: format!("Reconnecting to UPS on {}...", port),
                    port_name: Some(port.clone()),
                    device_name: None,
                },
            );
            if let Ok(dev) = connect_device_internal(state, &port, None) {
                Some((port, dev.serial_number))
            } else {
                None
            }
        } else {
            let _ = app.emit(
                "ups-probe-status",
                ProbeStatusEvent {
                    phase: "scanning".into(),
                    message: "Auto-discovering connected Voltronic UPS...".into(),
                    port_name: None,
                    device_name: None,
                },
            );
            // Auto-discover available ports using Stage T1 Read-Only commands
            let discovered = scan_available_ports();
            if let Some(dev) = discovered.iter().find(|d| {
                last_device_id.as_ref() == Some(&d.unique_id)
            }).or_else(|| discovered.first()) {
                let _ = app.emit(
                    "ups-probe-status",
                    ProbeStatusEvent {
                        phase: "connecting".into(),
                        message: format!("Connecting to discovered UPS on {}...", dev.port_name),
                        port_name: Some(dev.port_name.clone()),
                        device_name: dev.serial_number.clone(),
                    },
                );
                if connect_device_internal(state, &dev.port_name, None).is_ok() {
                    let _ = state.db.set_setting("last_connected_port", &dev.port_name);
                    let _ = state.db.set_setting("last_connected_device", &dev.unique_id);
                    Some((dev.port_name.clone(), dev.serial_number.clone()))
                } else {
                    None
                }
            } else {
                let _ = app.emit(
                    "ups-probe-status",
                    ProbeStatusEvent {
                        phase: "no_device".into(),
                        message: "No connected UPS detected on serial or USB HID ports".into(),
                        port_name: None,
                        device_name: None,
                    },
                );
                None
            }
        }
    };

    let Some((port_name, serial_number)) = port_to_poll else {
        return;
    };

    let _ = app.emit(
        "ups-probe-status",
        ProbeStatusEvent {
            phase: "fetching".into(),
            message: format!("Reading live telemetry from {}...", port_name),
            port_name: Some(port_name.clone()),
            device_name: serial_number.clone(),
        },
    );

    let prev_status = state.manager.get_last_status(&port_name);
    match state.manager.poll_device(&port_name) {
        Ok(status) => {
            // Save telemetry record
            let _ = state.db.insert_telemetry(&TelemetryRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                port_name: port_name.clone(),
                grid_voltage: status.grid_voltage_v,
                output_voltage: status.output_voltage_v,
                grid_frequency: status.grid_frequency_hz,
                output_frequency: status.output_frequency_hz,
                load_pct: status.output_load_pct,
                output_watts: status.output_watts,
                battery_voltage: status.battery_voltage_v,
                temperature_c: status.temperature_c,
            });

            // Detect rising-edge hardware alarms & state changes
            let detected_events = detect_status_events(prev_status.as_ref(), &status, &port_name);
            for ev in &detected_events {
                let _ = state.db.insert_event(ev);
                let _ = app.emit("ups-event", ev);
            }

            // Always emit live telemetry push event to frontend
            let _ = app.emit("ups-telemetry", &status);

            let _ = app.emit(
                "ups-probe-status",
                ProbeStatusEvent {
                    phase: "idle".into(),
                    message: "Live telemetry active".into(),
                    port_name: Some(port_name.clone()),
                    device_name: serial_number,
                },
            );

            // Update OS battery bridge and system tray icon
            let mut bridge = state.bridge.lock().unwrap();
            bridge.update(&status);
            let is_bridge_enabled = bridge.is_enabled();
            drop(bridge);

            // Update tray state (visible and active by default)
            crate::tray::update_tray_state(app, is_bridge_enabled, Some(&status));
        }
        Err(err) => {
            tracing::warn!("Background poll failed for {}: {}", port_name, err);
            let _ = app.emit(
                "ups-probe-status",
                ProbeStatusEvent {
                    phase: "error".into(),
                    message: format!("Communication error: {}", err),
                    port_name: Some(port_name.clone()),
                    device_name: serial_number,
                },
            );
        }
    }
}

