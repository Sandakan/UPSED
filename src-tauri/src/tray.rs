use crate::battery_bridge::{compute_battery_pct, generate_battery_icon_rgba};
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

    let icon_bytes = generate_battery_icon_rgba(100, false, false);
    let icon = Image::new_owned(icon_bytes, 32, 32);

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("UPSED UPS Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("app-window-visibility", true);
                }
            }
            "quit" => {
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
                }
            }
        })
        .build(app)?;

    // Enabled and visible by default per user configuration
    let _ = tray.set_visible(true);

    Ok(())
}

pub fn update_tray_state(app: &AppHandle, is_enabled: bool, status: Option<&Q1Status>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if !is_enabled {
            let _ = tray.set_visible(false);
            return;
        }

        let _ = tray.set_visible(true);

        if let Some(status) = status {
            let pct = compute_battery_pct(status.battery_voltage_v);
            let on_battery = status.utility_fail;
            let battery_low = status.battery_low;

            let mode_str = if status.ups_failed {
                "UPS FAULT"
            } else if status.bypass_active {
                "Bypass Mode"
            } else if on_battery {
                "ON BATTERY (AC Fail)"
            } else {
                "AC Line Mode"
            };

            let tooltip = format!(
                "UPSED: {}% ({:.1}V)\nMode: {} | Load: {}%",
                pct, status.battery_voltage_v, mode_str, status.output_load_pct
            );
            let _ = tray.set_tooltip(Some(tooltip));

            let icon_bytes = generate_battery_icon_rgba(pct, on_battery, battery_low);
            let img = Image::new_owned(icon_bytes, 32, 32);
            let _ = tray.set_icon(Some(img));
        } else {
            let _ = tray.set_tooltip(Some("UPSED: Waiting for telemetry..."));
        }
    }
}
