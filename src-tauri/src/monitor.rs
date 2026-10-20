use crate::commands::{connect_device_internal, detect_status_events, AppState, UpsTelemetryPayload};
use crate::db::TelemetryRecord;
use crate::protocol::Q1Status;
use crate::serial::scan_available_ports_with_context;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub async fn run_background_monitor(
    app: AppHandle,
    state: AppState,
    mut interval_rx: tokio::sync::watch::Receiver<u64>,
) {
    tracing::info!("Starting UPSED background multi-UPS monitor task");

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
    let approved_profiles = state.db.list_all_ups_metadata().unwrap_or_default();

    if approved_profiles.is_empty() {
        crate::tray::update_tray_state(app, false, None);
        return;
    }

    // Auto-reconnect approved profiles that are not yet active in manager
    for profile in &approved_profiles {
        if !state.manager.is_connected(&profile.unique_id) {
            // 1. Try last known port
            let mut connected = false;
            if let Some(ref port) = profile.last_port {
                if connect_device_internal(state, port, None).is_ok() {
                    connected = true;
                }
            }

            // 2. Try configured bridge host if port failed
            if !connected {
                if let Some(ref host) = profile.bridge_ws_host {
                    let ws_port = format!("BRIDGE:{}", host);
                    if connect_device_internal(state, &ws_port, None).is_ok() {
                        connected = true;
                    }
                }
            }

            // 3. Scan available ports using Stage T1 Read-Only commands to locate device
            if !connected {
                let active = state.manager.list_devices();
                let fallback_setting = state.db.get_setting("bridge_fallback_host").ok().flatten();
                let fallback = profile.bridge_ws_host.as_deref().or(fallback_setting.as_deref());
                let discovered = scan_available_ports_with_context(&active, fallback);

                for dev in discovered {
                    let is_match = dev.unique_id == profile.unique_id
                        || (profile.usb_uuid.is_some() && profile.usb_uuid == dev.usb_uuid)
                        || (profile.bridge_mac.is_some() && profile.bridge_mac == dev.bridge_mac)
                        || (profile.hardware_signature.is_some() && profile.hardware_signature == dev.hardware_signature);

                    if is_match {
                        let _ = connect_device_internal(state, &dev.port_name, None);
                        break;
                    }
                }
            }
        }
    }

    // Poll each connected device that has an approved profile
    let connected_list = state.manager.list_connected_details();
    let mut primary_status: Option<Q1Status> = None;
    let mut device_summaries: Vec<(String, Option<Q1Status>)> = Vec::new();

    // Determine primary profile ID
    let primary_id = approved_profiles
        .iter()
        .find(|p| p.is_primary)
        .map(|p| p.unique_id.clone())
        .or_else(|| approved_profiles.first().map(|p| p.unique_id.clone()));

    for (info, ups_id_opt, last_status) in connected_list {
        let Some(ref uid) = ups_id_opt else {
            // Unapproved device connected in setup modal - skip persistent polling
            continue;
        };

        let profile_opt = approved_profiles.iter().find(|p| p.unique_id == *uid);
        let device_label = profile_opt
            .map(|p| p.name.clone())
            .unwrap_or_else(|| info.port_name.clone());

        match state.manager.poll_device(&info.port_name) {
            Ok(status) => {
                // Record telemetry in database
                let _ = state.db.insert_telemetry(&TelemetryRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    ups_id: uid.clone(),
                    grid_voltage: status.grid_voltage_v,
                    output_voltage: status.output_voltage_v,
                    grid_frequency: status.grid_frequency_hz,
                    output_frequency: status.output_frequency_hz,
                    load_pct: status.output_load_pct,
                    output_watts: status.output_watts,
                    battery_voltage: status.battery_voltage_v,
                    temperature_c: status.temperature_c,
                });

                // Detect rising-edge events
                let detected = detect_status_events(last_status.as_ref(), &status, Some(uid));
                for ev in &detected {
                    let _ = state.db.insert_event(ev);
                    let _ = app.emit("ups-event", ev);
                }

                // Push live telemetry payload
                let _ = app.emit(
                    "ups-telemetry",
                    &UpsTelemetryPayload {
                        ups_id: Some(uid.clone()),
                        port_name: info.port_name.clone(),
                        status: status.clone(),
                    },
                );

                if primary_id.as_deref() == Some(uid) || primary_status.is_none() {
                    primary_status = Some(status.clone());
                }

                device_summaries.push((device_label, Some(status)));

                // Sync active bridge transport state if ESP32 bridge
                if let Ok((medium, host, key)) = state.manager.with_bridge_transport(Some(&info.port_name), |b, k| {
                    Ok((b.active_medium().to_string(), b.ws_host(), k))
                }) {
                    crate::serial::bridge_adapter::emit_transport_status(&key, &medium, host.as_deref());
                }
            }
            Err(err) => {
                tracing::warn!("Background poll failed for UPS {} on {}: {}", uid, info.port_name, err);
                device_summaries.push((device_label, None));
            }
        }
    }

    // Update OS native battery bridge with primary UPS status
    let mut bridge = state.bridge.lock().unwrap();
    if let Some(ref st) = primary_status {
        bridge.update(st);
    }
    let is_bridge_enabled = bridge.is_enabled();
    drop(bridge);

    // Update system tray with primary icon and multi-device tooltip summary
    let summary_refs: Vec<(&str, Option<&Q1Status>)> = device_summaries
        .iter()
        .map(|(name, st)| (name.as_str(), st.as_ref()))
        .collect();

    crate::tray::update_tray_state_multi(app, primary_status.as_ref(), &summary_refs);

    // Backward compatibility for single tray status
    if primary_status.is_none() && is_bridge_enabled {
        crate::tray::update_tray_state(app, false, None);
    }
}
