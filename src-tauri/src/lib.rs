pub mod battery_bridge;
pub mod commands;
pub mod db;
pub mod gate;
pub mod multi_port;
pub mod protocol;
pub mod serial;

use battery_bridge::BatteryBridge;
use commands::AppState;
use db::Database;
use gate::CommandGate;
use multi_port::MultiPortManager;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let db_path = std::env::current_dir()
        .map(|d| d.join("voltwatch.db"))
        .unwrap_or_else(|_| "voltwatch.db".into());

    let db = Database::init(db_path).expect("Failed to initialize VoltWatch SQLite database");

    let app_state = AppState {
        gate: Arc::new(Mutex::new(CommandGate::new())),
        manager: Arc::new(MultiPortManager::new()),
        db: Arc::new(db),
        bridge: Arc::new(Mutex::new(BatteryBridge::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::scan_ports,
            commands::connect_device,
            commands::disconnect_device,
            commands::list_connected_devices,
            commands::get_device_status,
            commands::send_command,
            commands::get_safety_stage,
            commands::unlock_safety_stage,
            commands::get_recent_telemetry,
            commands::get_recent_events,
            commands::get_battery_bridge_status,
            commands::set_battery_bridge_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoltWatch application");
}
