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
use tauri::State;

#[derive(Clone)]
pub struct AppState {
    pub gate: Arc<Mutex<CommandGate>>,
    pub manager: Arc<MultiPortManager>,
    pub db: Arc<Database>,
    pub bridge: Arc<Mutex<BatteryBridge>>,
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

    let _ = state.db.insert_event(&EventLogRecord {
        id: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        port_name: port_name.to_string(),
        event_type: "CONNECT".into(),
        message: format!("Connected to UPS on {}", port_name),
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
            message: format!("Disconnected from UPS on {}", port_name),
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
                    message: format!("Connection failed: {}", e),
                });
                return Err(e);
            }
        }

        match state_clone.manager.poll_device(&port_name) {
            Ok(status) => {
                let _ = state_clone.db.insert_telemetry(&TelemetryRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    grid_voltage: status.grid_voltage_v,
                    output_voltage: status.output_voltage_v,
                    load_pct: status.output_load_pct,
                    battery_voltage: status.battery_voltage_v,
                    temperature_c: status.temperature_c,
                });

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
                    message: format!("Polling failed: {}", err_str),
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
