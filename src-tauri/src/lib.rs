pub mod auth;
pub mod battery_bridge;
pub mod commands;
pub mod db;
pub mod gate;
pub mod logging;
pub mod monitor;
pub mod multi_port;
pub mod notifications;
pub mod protocol;
pub mod serial;
pub mod tray;

use std::sync::atomic::{AtomicBool, Ordering};

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

/// Marks the application as intentionally exiting and terminates the Tauri event loop.
pub fn request_app_exit(app: &tauri::AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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

            let urg_fast = app_state
                .db
                .get_setting("urgent_fast_poll")
                .ok()
                .flatten()
                .map(|v| v != "false")
                .unwrap_or(true);
            crate::serial::bridge_adapter::set_bridge_runtime_settings(urg_fast, initial_interval);

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

            if is_minimized_arg && start_minimized_pref {
                tracing::info!("[LIFECYCLE] UPSED application started minimized in system tray (WebView2 deferred)");
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
                tray::show_or_create_main_window(app.handle());
                tracing::info!("[LIFECYCLE] UPSED application window displayed on screen");
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
                tauri::WindowEvent::CloseRequested { .. } => {
                    let state = window.state::<AppState>();
                    let close_to_minimize = state
                        .db
                        .get_setting("close_to_minimize")
                        .ok()
                        .flatten()
                        .map(|v| v != "false")
                        .unwrap_or(true);

                    if close_to_minimize {
                        // Allow the WebView2 window to close and unload completely;
                        // ExitRequested will keep the Rust backend and tray icon alive.
                        tracing::info!("[LIFECYCLE] UPSED application window unloaded to system tray");
                        let hide_event = db::EventLogRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            ups_id: None,
                            event_type: "APP_HIDE".into(),
                            severity: "info".into(),
                            message: "UPSED application window unloaded to system tray".into(),
                            acknowledged: true,
                        };
                        let _ = state.db.insert_event(&hide_event);
                    } else {
                        ALLOW_EXIT.store(true, Ordering::SeqCst);
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    let is_visible = window.is_visible().unwrap_or(true);
                    let is_minimized = window.is_minimized().unwrap_or(false);
                    let is_focused = window.is_focused().unwrap_or(true);
                    let visible_on_screen = is_visible && !is_minimized && is_focused;
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
                tauri::WindowEvent::Focused(focused) => {
                    let is_visible = window.is_visible().unwrap_or(true);
                    let is_minimized = window.is_minimized().unwrap_or(false);
                    let _ = window.emit(
                        "app-window-visibility",
                        is_visible && !is_minimized && *focused,
                    );
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
            commands::auth_verify_os,
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
            commands::get_urgent_fast_poll,
            commands::set_urgent_fast_poll,
            commands::get_close_to_minimize,
            commands::set_close_to_minimize,
            commands::get_start_minimized,
            commands::set_start_minimized,
            commands::get_os_notifications_enabled,
            commands::set_os_notifications_enabled,
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
            commands::bridge_sync_time,
            commands::bridge_clear_cache,
            commands::test_bridge_websocket,
            commands::discover_bridge_on_lan,
            commands::get_bridge_log_history,
            commands::check_bridge_firmware_update,
            commands::flash_bridge_firmware,
            commands::get_bridge_tuya_config,
            commands::set_bridge_tuya_config,
            commands::test_bridge_tuya_publish,
            commands::reconnect_bridge_tuya,
            commands::configure_bridge_illumination,
            commands::toggle_bridge_night_mode_now,
            commands::save_file_with_dialog,
            commands::notify_system_resume
        ])
        .build(tauri::generate_context!())
        .expect("error while building UPSED application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !ALLOW_EXIT.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        return;
                    }

                    static EXIT_LOGGED: AtomicBool = AtomicBool::new(false);
                    if !EXIT_LOGGED.swap(true, Ordering::SeqCst) {
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
                        serial::hid_actor::shutdown_actor();
                    }
                }
                tauri::RunEvent::Exit => {
                    tracing::info!("[LIFECYCLE] RunEvent::Exit received, exiting process immediately");
                    std::process::exit(0);
                }
                _ => {}
            }
        });
}

