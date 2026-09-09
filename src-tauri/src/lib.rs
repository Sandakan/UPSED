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

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("voltwatch"));

            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("voltwatch.db");

            let db = Database::init(db_path)
                .expect("Failed to initialize VoltWatch SQLite database");

            let app_state = AppState {
                gate: Arc::new(Mutex::new(CommandGate::new())),
                manager: Arc::new(MultiPortManager::new()),
                db: Arc::new(db),
                bridge: Arc::new(Mutex::new(BatteryBridge::new())),
            };

            app.manage(app_state);
            Ok(())
        })
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
