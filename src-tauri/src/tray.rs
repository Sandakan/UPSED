use crate::battery_bridge::{compute_battery_pct, generate_tray_icon_rgba, UpsTrayState, TRAY_ICON_SIZE};
use crate::protocol::Q1Status;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_ID: &str = "battery-tray";

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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("app-window-visibility", true);
                    tracing::info!(
                        "[LIFECYCLE] UPSED application window opened from system tray menu"
                    );
                }
            }
            "quit" => {
                tracing::info!("[LIFECYCLE] Quit action triggered from system tray menu");
                app.exit(0);
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("app-window-visibility", true);
                    tracing::info!(
                        "[LIFECYCLE] UPSED application window restored via system tray click"
                    );
                }
            }
        })
        .build(app)?;

    // Enabled and visible by default per user configuration
    let _ = tray.set_visible(true);

    Ok(())
}

pub fn update_tray_state(app: &AppHandle, _is_enabled: bool, status: Option<&Q1Status>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(true);

        let (state, tooltip) = match status {
            Some(status) => {
                let pct = compute_battery_pct(status.battery_voltage_v);
                if status.ups_failed {
                    (
                        UpsTrayState::UpsFault,
                        format!(
                            "UPSED: HARDWARE FAULT\nInverter Alarm Active!\nLoad: {}%",
                            status.output_load_pct
                        ),
                    )
                } else if status.test_in_progress {
                    (
                        UpsTrayState::TestInProgress { pct },
                        format!(
                            "UPSED: Battery Self-Test in Progress...\n{}% ({:.1}V) | Load: {}%",
                            pct, status.battery_voltage_v, status.output_load_pct
                        ),
                    )
                } else if status.utility_fail && status.battery_low {
                    (
                        UpsTrayState::BatteryLow { pct },
                        format!(
                            "UPSED: CRITICAL — Battery Low!\n{}% ({:.1}V) | Load: {}%",
                            pct, status.battery_voltage_v, status.output_load_pct
                        ),
                    )
                } else if status.utility_fail {
                    (
                        UpsTrayState::OnBattery { pct },
                        format!(
                            "UPSED: ON BATTERY (AC Outage)\n{}% ({:.1}V) | Load: {}%",
                            pct, status.battery_voltage_v, status.output_load_pct
                        ),
                    )
                } else if status.bypass_active {
                    (
                        UpsTrayState::BypassMode { pct },
                        format!(
                            "UPSED: Bypass Mode (Unprotected Grid)\n{}% ({:.1}V) | Load: {}%",
                            pct, status.battery_voltage_v, status.output_load_pct
                        ),
                    )
                } else {
                    (
                        UpsTrayState::AcNormal { pct },
                        format!(
                            "UPSED: Online (AC Normal)\n{}% ({:.1}V) | Load: {}%",
                            pct, status.battery_voltage_v, status.output_load_pct
                        ),
                    )
                }
            }
            None => (
                UpsTrayState::Disconnected,
                "UPSED: Disconnected\n(No device connected)".to_string(),
            ),
        };

        let _ = tray.set_tooltip(Some(tooltip));
        let icon_bytes = generate_tray_icon_rgba(state);
        let img = Image::new_owned(icon_bytes, TRAY_ICON_SIZE, TRAY_ICON_SIZE);
        if let Err(e) = tray.set_icon(Some(img)) {
            tracing::error!("[TRAY] Failed to set tray icon: {:?}", e);
        }
    }
}
