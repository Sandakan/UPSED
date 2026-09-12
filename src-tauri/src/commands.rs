use crate::battery_bridge::BatteryBridge;
use crate::db::{Database, EventLogRecord, TelemetryRecord, UpsMetadata};
use crate::gate::CommandGate;
use crate::multi_port::MultiPortManager;
use crate::protocol::{self, Q1Status, UnlockStage, VoltronicCommand};
use crate::serial::{
    probe_port, scan_available_ports, DiscoveredDevice, HidTransport, PhysicalSerialPort,
    SerialTransport,
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[derive(Clone)]
pub struct AppState {
    pub gate: Arc<Mutex<CommandGate>>,
    pub manager: Arc<MultiPortManager>,
    pub db: Arc<Database>,
    pub bridge: Arc<Mutex<BatteryBridge>>,
    pub poll_interval_tx: Arc<tokio::sync::watch::Sender<u64>>,
}

#[tauri::command]
pub async fn scan_ports() -> Result<Vec<DiscoveredDevice>, String> {
    tokio::task::spawn_blocking(scan_available_ports)
        .await
        .map_err(|e| e.to_string())
}

pub fn connect_device_internal(
    state: &AppState,
    port_name: &str,
    baud_rate: Option<u32>,
) -> Result<DiscoveredDevice, String> {
    let info = probe_port(port_name).unwrap_or_else(|| DiscoveredDevice {
        port_name: port_name.to_string(),
        protocol_id: "00".into(),
        serial_number: None,
        unique_id: format!("MANUAL-{}", port_name),
        firmware_version: None,
        usb_uuid: None,
        capabilities: protocol::DeviceCapabilities::for_protocol("00"),
    });

    let transport: Box<dyn SerialTransport> = if port_name.starts_with("USB:") {
        Box::new(HidTransport::open_by_port_name(port_name).map_err(|e| e.to_string())?)
    } else {
        let baud = baud_rate.unwrap_or(2400);
        Box::new(PhysicalSerialPort::open(port_name, baud).map_err(|e| e.to_string())?)
    };

    state.manager.register_device(info.clone(), transport);
    let _ = state.db.set_setting("last_connected_port", port_name);

    let _ = state.db.insert_event(&EventLogRecord {
        id: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        port_name: port_name.to_string(),
        event_type: "CONNECT".into(),
        severity: "info".into(),
        message: format!("Connected to UPS on {}", port_name),
        acknowledged: true,
    });

    Ok(info)
}

#[tauri::command]
pub async fn connect_device(
    state: State<'_, AppState>,
    port_name: String,
    baud_rate: Option<u32>,
) -> Result<DiscoveredDevice, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        connect_device_internal(&state_clone, &port_name, baud_rate)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn disconnect_device(
    state: State<'_, AppState>,
    port_name: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone.manager.unregister_device(&port_name);
        let _ = state_clone.db.insert_event(&EventLogRecord {
            id: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            port_name: port_name.clone(),
            event_type: "DISCONNECT".into(),
            severity: "warning".into(),
            message: format!("Disconnected from UPS on {}", port_name),
            acknowledged: true,
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_connected_devices(state: State<AppState>) -> Vec<DiscoveredDevice> {
    state.manager.list_devices()
}

#[tauri::command]
pub async fn get_device_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: String,
) -> Result<Q1Status, String> {
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        if !state_clone.manager.is_connected(&port_name) {
            tracing::info!(
                "get_device_status: {} not connected, attempting connect",
                port_name
            );
            if let Err(e) = connect_device_internal(&state_clone, &port_name, None) {
                tracing::error!("Failed to connect to {}: {}", port_name, e);
                let _ = state_clone.db.insert_event(&EventLogRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    event_type: "CONNECT_ERROR".into(),
                    severity: "critical".into(),
                    message: format!("Connection failed: {}", e),
                    acknowledged: false,
                });
                return Err(e);
            }
        }

        let prev_status = state_clone.manager.get_last_status(&port_name);
        match state_clone.manager.poll_device(&port_name) {
            Ok(status) => {
                let _ = state_clone.db.insert_telemetry(&TelemetryRecord {
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

                // Detect state transitions and alarm events
                let detected_events =
                    detect_status_events(prev_status.as_ref(), &status, &port_name);
                for ev in &detected_events {
                    let _ = state_clone.db.insert_event(ev);
                    let _ = app_clone.emit("ups-event", ev);
                }

                let mut bridge = state_clone.bridge.lock().unwrap();
                bridge.update(&status);
                let is_enabled = bridge.is_enabled();
                drop(bridge);

                if is_enabled {
                    crate::tray::update_tray_state(&app_clone, true, Some(&status));
                }

                Ok(status)
            }
            Err(err) => {
                let err_str = err.to_string();
                tracing::error!("get_device_status failed for {}: {}", port_name, err_str);
                let _ = state_clone.db.insert_event(&EventLogRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    event_type: "POLL_ERROR".into(),
                    severity: "warning".into(),
                    message: format!("Polling failed: {}", err_str),
                    acknowledged: false,
                });
                Err(err_str)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn send_command(
    state: State<'_, AppState>,
    port_name: String,
    command: VoltronicCommand,
) -> Result<String, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        if !state_clone.manager.is_connected(&port_name) {
            let _ = connect_device_internal(&state_clone, &port_name, None);
        }

        let gate = state_clone.gate.lock().unwrap();
        state_clone
            .manager
            .execute_gated_command(&port_name, &command, &gate)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_safety_stage(state: State<AppState>) -> UnlockStage {
    let gate = state.gate.lock().unwrap();
    gate.current_stage()
}

#[tauri::command]
pub fn unlock_safety_stage(
    state: State<AppState>,
    target_stage: UnlockStage,
) -> Result<(), String> {
    let mut gate = state.gate.lock().unwrap();
    gate.unlock_stage(target_stage).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recent_telemetry(
    state: State<'_, AppState>,
    port_name: String,
    limit: Option<u32>,
) -> Result<Vec<TelemetryRecord>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .query_recent_telemetry(&port_name, limit.unwrap_or(50))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_recent_events(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<EventLogRecord>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .query_recent_events(limit.unwrap_or(50))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_battery_bridge_status(state: State<AppState>) -> bool {
    let bridge = state.bridge.lock().unwrap();
    bridge.is_enabled()
}

#[tauri::command]
pub fn set_battery_bridge_status(
    app: tauri::AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    let mut bridge = state.bridge.lock().unwrap();
    bridge.set_enabled(enabled);
    let last = bridge.last_status().cloned();
    drop(bridge);

    crate::tray::update_tray_state(&app, enabled, last.as_ref());
    Ok(())
}

#[tauri::command]
pub async fn get_ups_metadata(
    state: State<'_, AppState>,
    unique_id: String,
) -> Result<Option<UpsMetadata>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .get_ups_metadata(&unique_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_ups_metadata(
    state: State<'_, AppState>,
    metadata: UpsMetadata,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .save_ups_metadata(&metadata)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_ups_metadata(state: State<'_, AppState>) -> Result<Vec<UpsMetadata>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .list_all_ups_metadata()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_last_connected_device(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .get_setting("last_connected_device")
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_last_connected_device(
    state: State<'_, AppState>,
    unique_id: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .set_setting("last_connected_device", &unique_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_device_usb_uuid(
    state: State<'_, AppState>,
    unique_id: String,
    new_usb_uuid: String,
    updated_at: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .update_device_usb_uuid(&unique_id, &new_usb_uuid, &updated_at)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fast_probe_device(port_name: String) -> Result<Option<DiscoveredDevice>, String> {
    tokio::task::spawn_blocking(move || probe_port(&port_name))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_events(state: State<'_, AppState>) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || state_clone.db.clear_events().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn acknowledge_event(state: State<'_, AppState>, event_id: i64) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .acknowledge_event(event_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_poll_interval(state: State<AppState>) -> u64 {
    *state.poll_interval_tx.subscribe().borrow()
}

#[tauri::command]
pub fn set_poll_interval(state: State<AppState>, secs: u64) -> Result<(), String> {
    let secs = secs.clamp(1, 3600);
    let _ = state.poll_interval_tx.send(secs);
    state
        .db
        .set_setting("poll_interval_secs", &secs.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_close_to_minimize(state: State<AppState>) -> Result<bool, String> {
    let val = state
        .db
        .get_setting("close_to_minimize")
        .map_err(|e| e.to_string())?;
    Ok(val.map(|v| v != "false").unwrap_or(true))
}

#[tauri::command]
pub fn set_close_to_minimize(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state
        .db
        .set_setting("close_to_minimize", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_start_minimized(state: State<AppState>) -> Result<bool, String> {
    let val = state
        .db
        .get_setting("start_minimized")
        .map_err(|e| e.to_string())?;
    Ok(val.map(|v| v != "false").unwrap_or(true))
}

#[tauri::command]
pub fn set_start_minimized(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state
        .db
        .set_setting("start_minimized", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_theme(state: State<AppState>) -> Result<String, String> {
    let val = state
        .db
        .get_setting("theme")
        .map_err(|e| e.to_string())?;
    Ok(val.unwrap_or_else(|| "system".to_string()))
}

#[tauri::command]
pub fn set_theme(state: State<AppState>, theme: String) -> Result<(), String> {
    state
        .db
        .set_setting("theme", &theme)
        .map_err(|e| e.to_string())
}

/// Detects hardware state transitions and alarms by diffing status between consecutive poll cycles.
pub fn detect_status_events(
    prev: Option<&Q1Status>,
    curr: &Q1Status,
    port: &str,
) -> Vec<EventLogRecord> {
    let mut events = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    let Some(prev) = prev else {
        return events;
    };

    // 1. AC Utility Failure (Blackout) - Rising Edge
    if !prev.utility_fail && curr.utility_fail {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UTILITY_FAIL".into(),
            severity: "critical".into(),
            message:
                "AC Utility Failure: Mains grid power lost. Inverter operating on battery mode."
                    .into(),
            acknowledged: false,
        });
    } else if prev.utility_fail && !curr.utility_fail {
        // Falling edge - Grid Power Restored
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UTILITY_RESTORE".into(),
            severity: "success".into(),
            message: "AC Utility Restored: Mains grid power restored. Resumed normal line mode."
                .into(),
            acknowledged: false,
        });
    }

    // 2. Battery Low Warning (Critical)
    if !prev.battery_low && curr.battery_low {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_LOW".into(),
            severity: "critical".into(),
            message: "Low Battery: Battery capacity critically depleted. Prepare connected loads for shutdown.".into(),
            acknowledged: false,
        });
    } else if prev.battery_low && !curr.battery_low {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_NORMAL".into(),
            severity: "success".into(),
            message: "Battery Normal: Battery voltage recovered above low threshold.".into(),
            acknowledged: false,
        });
    }

    // 3. Bypass Active Alarm
    if !prev.bypass_active && curr.bypass_active {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BYPASS_ACTIVE".into(),
            severity: "warning".into(),
            message:
                "Bypass Mode Active: Load switched to static bypass line directly from utility."
                    .into(),
            acknowledged: false,
        });
    } else if prev.bypass_active && !curr.bypass_active {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BYPASS_CLEARED".into(),
            severity: "info".into(),
            message: "Inverter Output Restored: UPS switched back from bypass to conditioned inverter mode.".into(),
            acknowledged: false,
        });
    }

    // 4. UPS Hardware Failure
    if !prev.ups_failed && curr.ups_failed {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UPS_FAULT".into(),
            severity: "critical".into(),
            message: "UPS Hardware Fault: Internal inverter or component failure detected.".into(),
            acknowledged: false,
        });
    }

    // 5. Output Overload (> 100%)
    if prev.output_load_pct <= 100 && curr.output_load_pct > 100 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVERLOAD".into(),
            severity: "critical".into(),
            message: format!("Overload: Output load reached {}% (exceeds 100% rated capacity). Reduce connected load immediately.", curr.output_load_pct),
            acknowledged: false,
        });
    } else if prev.output_load_pct > 100 && curr.output_load_pct <= 100 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVERLOAD_CLEARED".into(),
            severity: "info".into(),
            message: format!(
                "Overload Cleared: Output load normalized to {}%.",
                curr.output_load_pct
            ),
            acknowledged: false,
        });
    }

    // 6. Over-temperature (threshold: >= 55°C)
    if prev.temperature_c < 55 && curr.temperature_c >= 55 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVER_TEMP".into(),
            severity: "warning".into(),
            message: format!("Over Temperature: Internal heatsink reached {}°C. Check ventilation and ambient airflow.", curr.temperature_c),
            acknowledged: false,
        });
    } else if prev.temperature_c >= 55 && curr.temperature_c < 50 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now,
            port_name: port.to_string(),
            event_type: "TEMP_NORMAL".into(),
            severity: "info".into(),
            message: format!(
                "Temperature Normal: Internal temperature decreased to {}°C.",
                curr.temperature_c
            ),
            acknowledged: false,
        });
    }

    events
}
