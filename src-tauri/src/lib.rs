pub mod battery_bridge;
pub mod commands;
pub mod db;
pub mod gate;
pub mod monitor;
pub mod multi_port;
pub mod protocol;
pub mod serial;
pub mod tray;

use battery_bridge::BatteryBridge;
use commands::AppState;
use db::Database;
use gate::CommandGate;
use multi_port::MultiPortManager;
use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("voltwatch".into()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .level(log::LevelFilter::Debug)
                .level_for("voltwatch_lib", log::LevelFilter::Trace)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("voltwatch"));

            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("voltwatch.db");

            let db =
                Database::init(db_path).expect("Failed to initialize VoltWatch SQLite database");

            let initial_interval = db
                .get_setting("poll_interval_secs")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(10);

            let (poll_interval_tx, poll_interval_rx) =
                tokio::sync::watch::channel(initial_interval);

            // Initialize OS Native Battery Bridge (enabled by default per user specification)
            let mut bridge = BatteryBridge::new();
            let bridge_enabled = db
                .get_setting("battery_bridge_enabled")
                .ok()
                .flatten()
                .map(|v| v != "false")
                .unwrap_or(true);
            bridge.set_enabled(bridge_enabled);

            // Initialize Windows / Desktop system tray icon (enabled and visible by default)
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("Failed to initialize battery tray icon: {}", e);
            }

            let app_state = AppState {
                gate: Arc::new(Mutex::new(CommandGate::new())),
                manager: Arc::new(MultiPortManager::new()),
                db: Arc::new(db),
                bridge: Arc::new(Mutex::new(bridge)),
                poll_interval_tx: Arc::new(poll_interval_tx),
            };

            // If started with --minimized, start with window hidden in tray
            let args: Vec<String> = std::env::args().collect();
            if args.iter().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // Spawn background UPS monitor task
            let app_handle = app.handle().clone();
            let state_clone = app_state.clone();
            tauri::async_runtime::spawn(async move {
                monitor::run_background_monitor(app_handle, state_clone, poll_interval_rx).await;
            });

            app.manage(app_state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let close_to_minimize = state
                    .db
                    .get_setting("close_to_minimize")
                    .ok()
                    .flatten()
                    .map(|v| v != "false")
                    .unwrap_or(true);

                if close_to_minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            commands::set_battery_bridge_status,
            commands::get_ups_metadata,
            commands::save_ups_metadata,
            commands::list_ups_metadata,
            commands::get_last_connected_device,
            commands::set_last_connected_device,
            commands::update_device_usb_uuid,
            commands::fast_probe_device,
            commands::clear_events,
            commands::acknowledge_event,
            commands::get_poll_interval,
            commands::set_poll_interval,
            commands::get_close_to_minimize,
            commands::set_close_to_minimize,
            commands::get_start_minimized,
            commands::set_start_minimized,
            commands::get_theme,
            commands::set_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoltWatch application");
}
