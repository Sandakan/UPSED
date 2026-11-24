use crate::battery_bridge::{compute_battery_pct, generate_tray_icon_rgba, UpsTrayState, TRAY_ICON_SIZE};
use crate::protocol::Q1Status;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_ID: &str = "battery-tray";

/// Shows the existing `"main"` WebView2 window, or recreates it from config if it was unloaded in tray.
pub fn show_or_create_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("app-window-visibility", true);
        return;
    }

    let Some(window_cfg) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        tracing::error!("[LIFECYCLE] Missing 'main' window configuration in tauri.conf.json");
        return;
    };

    match tauri::WebviewWindowBuilder::from_config(app, &window_cfg).and_then(|b| b.build()) {
        Ok(window) => {
            let _ = window.set_background_color(Some(tauri::window::Color(34, 38, 47, 255)));
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.emit("app-window-visibility", true);
        }
        Err(e) => {
            tracing::error!("[LIFECYCLE] Failed to recreate main WebView2 window: {}", e);
        }
    }
}

/// Initializes the Windows / Desktop system tray icon.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open UPSED", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit UPSED", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let icon_bytes = generate_tray_icon_rgba(UpsTrayState::Disconnected);
    let icon = Image::new_owned(icon_bytes, TRAY_ICON_SIZE, TRAY_ICON_SIZE);

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("UPSED: Disconnected (No device connected)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                show_or_create_main_window(app);
                tracing::info!(
                    "[LIFECYCLE] UPSED application window opened from system tray menu"
                );
            }
            "quit" => {
                tracing::info!("[LIFECYCLE] Quit action triggered from system tray menu");
                crate::request_app_exit(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_or_create_main_window(app);
                tracing::info!(
                    "[LIFECYCLE] UPSED application window restored via system tray click"
                );
            }
        })
        .build(app)?;

    // Enabled and visible by default per user configuration
    let _ = tray.set_visible(true);

    Ok(())
}

pub fn update_tray_state(app: &AppHandle, _is_enabled: bool, status: Option<&Q1Status>) {
    update_tray_state_multi(app, status, &[]);
}

pub fn update_tray_state_multi(
    app: &AppHandle,
    primary_status: Option<&Q1Status>,
    device_summaries: &[(&str, Option<&Q1Status>)],
) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(true);

        let state = match primary_status {
            Some(status) => {
                let pct = compute_battery_pct(status.battery_voltage_v);
                if status.ups_failed {
                    UpsTrayState::UpsFault
                } else if status.test_in_progress {
                    UpsTrayState::TestInProgress { pct }
                } else if status.utility_fail && status.battery_low {
                    UpsTrayState::BatteryLow { pct }
                } else if status.utility_fail {
                    UpsTrayState::OnBattery { pct }
                } else if status.bypass_active {
                    UpsTrayState::BypassMode { pct }
                } else {
                    UpsTrayState::AcNormal { pct }
                }
            }
            None => UpsTrayState::Disconnected,
        };

        let tooltip = if device_summaries.is_empty() {
            match primary_status {
                Some(status) => {
                    let pct = compute_battery_pct(status.battery_voltage_v);
                    if status.ups_failed {
                        format!("UPSED: HARDWARE FAULT\nInverter Alarm Active!\nLoad: {}%", status.output_load_pct)
                    } else if status.test_in_progress {
                        format!("UPSED: Battery Self-Test in Progress...\n{}% ({:.1}V) | Load: {}%", pct, status.battery_voltage_v, status.output_load_pct)
                    } else if status.utility_fail && status.battery_low {
                        format!("UPSED: CRITICAL — Battery Low!\n{}% ({:.1}V) | Load: {}%", pct, status.battery_voltage_v, status.output_load_pct)
                    } else if status.utility_fail {
                        format!("UPSED: ON BATTERY (AC Outage)\n{}% ({:.1}V) | Load: {}%", pct, status.battery_voltage_v, status.output_load_pct)
                    } else if status.bypass_active {
                        format!("UPSED: Bypass Mode (Unprotected Grid)\n{}% ({:.1}V) | Load: {}%", pct, status.battery_voltage_v, status.output_load_pct)
                    } else {
                        format!("UPSED: Online (AC Normal)\n{}% ({:.1}V) | Load: {}%", pct, status.battery_voltage_v, status.output_load_pct)
                    }
                }
                None => "UPSED: Disconnected\n(No device connected)".to_string(),
            }
        } else if device_summaries.len() == 1 {
            let (name, st_opt) = &device_summaries[0];
            match st_opt {
                Some(status) => {
                    let pct = compute_battery_pct(status.battery_voltage_v);
                    let mode = if status.ups_failed {
                        "FAULT"
                    } else if status.test_in_progress {
                        "Testing"
                    } else if status.utility_fail && status.battery_low {
                        "BATTERY LOW"
                    } else if status.utility_fail {
                        "ON BATTERY"
                    } else if status.bypass_active {
                        "BYPASS"
                    } else {
                        "Online (AC Normal)"
                    };
                    format!("UPSED: {}\n{} — {}% ({:.1}V)\nLoad: {}% ({}W)", name, mode, pct, status.battery_voltage_v, status.output_load_pct, status.output_watts)
                }
                None => format!("UPSED: {}\n(Offline / Disconnected)", name),
            }
        } else {
            let mut lines = Vec::new();
            lines.push(format!("UPSED ({} devices connected)", device_summaries.len()));
            for (name, st_opt) in device_summaries {
                if let Some(st) = st_opt {
                    let pct = compute_battery_pct(st.battery_voltage_v);
                    let mode = if st.ups_failed { "FAULT" } else if st.utility_fail { "BATTERY" } else if st.bypass_active { "BYPASS" } else { "ONLINE" };
                    lines.push(format!("• {}: {}% [{}]", name, pct, mode));
                } else {
                    lines.push(format!("• {}: Offline", name));
                }
            }
            lines.join("\n")
        };

        let _ = tray.set_tooltip(Some(tooltip));
        let icon_bytes = generate_tray_icon_rgba(state);
        let img = Image::new_owned(icon_bytes, TRAY_ICON_SIZE, TRAY_ICON_SIZE);
        if let Err(e) = tray.set_icon(Some(img)) {
            tracing::error!("[TRAY] Failed to set tray icon: {:?}", e);
        }
    }
}
