pub mod auth;
pub mod battery_bridge;
pub mod commands;
pub mod db;
pub mod gate;
pub mod logging;
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

use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_dir = logging::get_log_dir();
    let daily_writer = logging::DailyRotatingFile::new(log_dir);
    let file_dispatch = tauri_plugin_log::fern::Dispatch::new()
        .chain(tauri_plugin_log::fern::Output::writer(Box::new(daily_writer), "\n"));

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Dispatch(file_dispatch)),
                    Target::new(TargetKind::Webview),
                ])
                .format(|out, message, record| {
                    let now = chrono::Local::now().format("%H:%M:%S");
                    let tag = if record.target().starts_with("webview") {
                        "RENDERER"
                    } else {
                        "MAIN"
                    };
                    out.finish(format_args!(
                        "[{}] [{}] [{}] {}",
                        now,
                        tag,
                        record.level(),
                        message
                    ))
                })
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("upsed_lib", log::LevelFilter::Trace)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            WindowStateBuilder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("upsed"));

            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("upsed.db");

            let db =
                Database::init(db_path).expect("Failed to initialize UPSED SQLite database");

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

            let db_arc = Arc::new(db);
            let auth_store = Box::new(auth::FallbackStore::new(Arc::clone(&db_arc)));
            let auth = Arc::new(auth::AuthManager::new(auth_store));
            let gate = Arc::new(Mutex::new(CommandGate::with_auth(Arc::clone(&auth))));
            let manager = Arc::new(MultiPortManager::with_auth(Arc::clone(&auth)));

            let app_state = AppState {
                gate,
                manager,
                db: db_arc,
                bridge: Arc::new(Mutex::new(bridge)),
                poll_interval_tx: Arc::new(poll_interval_tx),
                auth,
            };

            // Log application startup
            tracing::info!(
                "[LIFECYCLE] UPSED application started (v{}, pid={})",
                env!("CARGO_PKG_VERSION"),
                std::process::id()
            );
            let start_event = db::EventLogRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                ups_id: None,
                event_type: "APP_START".into(),
                severity: "info".into(),
                message: format!("UPSED application started (v{})", env!("CARGO_PKG_VERSION")),
                acknowledged: true,
            };
            let _ = app_state.db.insert_event(&start_event);

            // Determine whether to show window or start minimized in tray
            let args: Vec<String> = std::env::args().collect();
            let is_minimized_arg = args.iter().any(|arg| arg == "--minimized");
            let start_minimized_pref = app_state
                .db
                .get_setting("start_minimized")
                .ok()
                .flatten()
                .map(|v| v != "false")
                .unwrap_or(true);

            if let Some(window) = app.get_webview_window("main") {
                // Set initial native window background color to signature dark theme (#22262f) to eliminate OS-level black flash during cold boot
                let _ = window.set_background_color(Some(tauri::window::Color(34, 38, 47, 255)));

                if is_minimized_arg && start_minimized_pref {
                    let _ = window.hide();
                    let _ = window.emit("app-window-visibility", false);
                    tracing::info!("[LIFECYCLE] UPSED application started minimized in system tray");
                    let hide_event = db::EventLogRecord {
                        id: None,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        ups_id: None,
                        event_type: "APP_HIDE".into(),
                        severity: "info".into(),
                        message: "UPSED application started minimized in system tray".into(),
                        acknowledged: true,
                    };
                    let _ = app_state.db.insert_event(&hide_event);
                } else {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("app-window-visibility", true);
                    tracing::info!("[LIFECYCLE] UPSED application window displayed on screen");
                }
            }

            // Register AppHandle for bridge real-time event streaming
            serial::bridge_adapter::set_bridge_app_handle(app.handle().clone());

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
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
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
                        let _ = window.emit("app-window-visibility", false);
                        tracing::info!("[LIFECYCLE] UPSED application window hidden to system tray");
                        let hide_event = db::EventLogRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            ups_id: None,
                            event_type: "APP_HIDE".into(),
                            severity: "info".into(),
                            message: "UPSED application window hidden to system tray".into(),
                            acknowledged: true,
                        };
                        let _ = state.db.insert_event(&hide_event);
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    let is_visible = window.is_visible().unwrap_or(true);
                    let is_minimized = window.is_minimized().unwrap_or(false);
                    let visible_on_screen = is_visible && !is_minimized;
                    let _ = window.emit("app-window-visibility", visible_on_screen);

                    static WAS_MINIMIZED: std::sync::atomic::AtomicBool =
                        std::sync::atomic::AtomicBool::new(false);
                    let prev_minimized =
                        WAS_MINIMIZED.swap(is_minimized, std::sync::atomic::Ordering::Relaxed);
                    if !prev_minimized && is_minimized {
                        tracing::info!("[LIFECYCLE] UPSED application window minimized to taskbar");
                        let state = window.state::<AppState>();
                        let hide_event = db::EventLogRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            ups_id: None,
                            event_type: "APP_HIDE".into(),
                            severity: "info".into(),
                            message: "UPSED application window minimized to taskbar".into(),
                            acknowledged: true,
                        };
                        let _ = state.db.insert_event(&hide_event);
                    } else if prev_minimized && !is_minimized {
                        tracing::info!("[LIFECYCLE] UPSED application window unminimized / restored");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_ports,
            commands::connect_device,
            commands::disconnect_device,
            commands::list_connected_devices,
            commands::get_device_status,
            commands::get_outlet_states,
            commands::send_command,
            commands::auth_status,
            commands::auth_setup,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_change_password,
            commands::auth_reset,
            commands::get_safety_stage,
            commands::unlock_safety_stage,
            commands::get_recent_telemetry,
            commands::get_telemetry_range,
            commands::get_recent_events,
            commands::get_battery_bridge_status,
            commands::set_battery_bridge_status,
            commands::get_ups_metadata,
            commands::link_transport_to_profile,
            commands::get_disambiguation_candidates,
            commands::save_ups_metadata,
            commands::list_ups_metadata,
            commands::get_last_connected_device,
            commands::set_last_connected_device,
            commands::update_device_usb_uuid,
            commands::fast_probe_device,
            commands::clear_events,
            commands::acknowledge_event,
            commands::acknowledge_all_events,
            commands::get_poll_interval,
            commands::set_poll_interval,
            commands::get_close_to_minimize,
            commands::set_close_to_minimize,
            commands::get_start_minimized,
            commands::set_start_minimized,
            commands::get_theme,
            commands::set_theme,
            commands::is_dev_mode,
            commands::get_db_stats,
            commands::prune_telemetry,
            commands::clear_telemetry,
            commands::delete_ups_profile,
            commands::set_primary_ups,
            commands::vacuum_database,
            commands::get_bridge_status,
            commands::configure_bridge_wifi,
            commands::sync_bridge_backlog,
            commands::get_bridge_fallback_host,
            commands::set_bridge_fallback_host,
            commands::scan_bridge_wifi,
            commands::clear_bridge_backlog,
            commands::test_bridge_websocket,
            commands::discover_bridge_on_lan,
            commands::get_bridge_log_history,
            commands::check_bridge_firmware_update,
            commands::flash_bridge_firmware,
            commands::get_bridge_tuya_config,
            commands::set_bridge_tuya_config,
            commands::test_bridge_tuya_publish
        ])
        .build(tauri::generate_context!())
        .expect("error while building UPSED application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                static EXIT_LOGGED: std::sync::atomic::AtomicBool =
                    std::sync::atomic::AtomicBool::new(false);
                if !EXIT_LOGGED.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    tracing::info!("[LIFECYCLE] UPSED application is exiting...");
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let exit_event = db::EventLogRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            ups_id: None,
                            event_type: "APP_EXIT".into(),
                            severity: "info".into(),
                            message: "UPSED application process exiting".into(),
                            acknowledged: true,
                        };
                        let _ = state.db.insert_event(&exit_event);
                    }
                }
            }
        });
}

