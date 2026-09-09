use crate::battery_bridge::BatteryBridge;
use crate::db::{Database, EventLogRecord, TelemetryRecord};
use crate::gate::CommandGate;
use crate::multi_port::MultiPortManager;
use crate::protocol::{self, Q1Status, UnlockStage, VoltronicCommand};
use crate::serial::{
    probe_port, scan_available_ports, DiscoveredDevice, HidTransport, PhysicalSerialPort,
    SerialTransport,
};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub gate: Arc<Mutex<CommandGate>>,
    pub manager: Arc<MultiPortManager>,
    pub db: Arc<Database>,
    pub bridge: Arc<Mutex<BatteryBridge>>,
}

#[tauri::command]
pub fn scan_ports() -> Vec<DiscoveredDevice> {
    scan_available_ports()
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
pub fn connect_device(
    state: State<AppState>,
    port_name: String,
    baud_rate: Option<u32>,
) -> Result<DiscoveredDevice, String> {
    connect_device_internal(&state, &port_name, baud_rate)
}

#[tauri::command]
pub fn disconnect_device(state: State<AppState>, port_name: String) -> Result<(), String> {
    state.manager.unregister_device(&port_name);
    let _ = state.db.insert_event(&EventLogRecord {
        id: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        port_name: port_name.clone(),
        event_type: "DISCONNECT".into(),
        message: format!("Disconnected from UPS on {}", port_name),
    });
    Ok(())
}

#[tauri::command]
pub fn list_connected_devices(state: State<AppState>) -> Vec<DiscoveredDevice> {
    state.manager.list_devices()
}

#[tauri::command]
pub fn get_device_status(state: State<AppState>, port_name: String) -> Result<Q1Status, String> {
    if !state.manager.is_connected(&port_name) {
        tracing::info!(
            "get_device_status: {} not connected, attempting connect",
            port_name
        );
        if let Err(e) = connect_device_internal(&state, &port_name, None) {
            tracing::error!("Failed to connect to {}: {}", port_name, e);
            let _ = state.db.insert_event(&EventLogRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                port_name: port_name.clone(),
                event_type: "CONNECT_ERROR".into(),
                message: format!("Connection failed: {}", e),
            });
            return Err(e);
        }
    }

    match state.manager.poll_device(&port_name) {
        Ok(status) => {
            let _ = state.db.insert_telemetry(&TelemetryRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                port_name: port_name.clone(),
                grid_voltage: status.grid_voltage_v,
                output_voltage: status.output_voltage_v,
                load_pct: status.output_load_pct,
                battery_voltage: status.battery_voltage_v,
                temperature_c: status.temperature_c,
            });

            let bridge = state.bridge.lock().unwrap();
            bridge.update(&status);

            Ok(status)
        }
        Err(err) => {
            let err_str = err.to_string();
            tracing::error!("get_device_status failed for {}: {}", port_name, err_str);
            let _ = state.db.insert_event(&EventLogRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                port_name: port_name.clone(),
                event_type: "POLL_ERROR".into(),
                message: format!("Polling failed: {}", err_str),
            });
            Err(err_str)
        }
    }
}

#[tauri::command]
pub fn send_command(
    state: State<AppState>,
    port_name: String,
    command: VoltronicCommand,
) -> Result<String, String> {
    if !state.manager.is_connected(&port_name) {
        let _ = connect_device_internal(&state, &port_name, None);
    }

    let gate = state.gate.lock().unwrap();
    state
        .manager
        .execute_gated_command(&port_name, &command, &gate)
        .map_err(|e| e.to_string())
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
pub fn get_recent_telemetry(
    state: State<AppState>,
    port_name: String,
    limit: Option<u32>,
) -> Result<Vec<TelemetryRecord>, String> {
    state
        .db
        .query_recent_telemetry(&port_name, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_events(
    state: State<AppState>,
    limit: Option<u32>,
) -> Result<Vec<EventLogRecord>, String> {
    state
        .db
        .query_recent_events(limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_battery_bridge_status(state: State<AppState>) -> bool {
    let bridge = state.bridge.lock().unwrap();
    bridge.is_enabled()
}

#[tauri::command]
pub fn set_battery_bridge_status(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let mut bridge = state.bridge.lock().unwrap();
    bridge.set_enabled(enabled);
    Ok(())
}
