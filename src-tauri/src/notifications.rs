use crate::commands::AppState;
use crate::db::EventLogRecord;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Maps UPSED event types and ViewPower warning codes (`warning.a0`-`warning.a69`)
/// to `(title, default_description)` pairs.
pub fn event_details(event_type: &str) -> Option<(&'static str, &'static str)> {
    match event_type {
        "UTILITY_FAIL" => Some((
            "AC Utility Power Failure",
            "Mains utility grid electricity lost. Inverter has automatically transferred to battery backup mode.",
        )),
        "UTILITY_RESTORE" => Some((
            "AC Utility Power Restored",
            "Grid electricity returned to nominal range. UPS transferred back to normal line mode and resumed battery charging.",
        )),
        "BATTERY_LOW" => Some((
            "Low Battery Warning",
            "Battery reserve capacity is critically low. Connected computers and devices should be shut down safely immediately.",
        )),
        "BATTERY_NORMAL" => Some((
            "Battery Reserve Normal",
            "Battery voltage recovered above the critical low-voltage cutoff threshold.",
        )),
        "OVERLOAD" => Some((
            "UPS Output Overload Alarm",
            "Connected power consumption exceeds 100% rated capacity. Disconnect non-critical loads to prevent immediate shutdown.",
        )),
        "OVERLOAD_CLEARED" => Some((
            "Output Load Normalized",
            "Operating power demand returned within rated capacity boundaries.",
        )),
        "OVER_TEMP" => Some((
            "High Heatsink Temperature Warning",
            "Internal inverter heatsink reached thermal warning limits. Verify cooling fan operation and ventilation airflow.",
        )),
        "TEMP_NORMAL" => Some((
            "Operating Temperature Normal",
            "Internal unit temperatures returned to standard operating limits.",
        )),
        "BYPASS_ACTIVE" => Some((
            "Static Bypass Active",
            "Load is running directly off unconditioned utility bypass line. Inverter protection is bypassed.",
        )),
        "BYPASS_CLEARED" => Some((
            "Conditioned Inverter Restored",
            "Output safely transferred from static bypass back to conditioned PWM inverter power.",
        )),
        "UPS_FAULT" => Some((
            "UPS Hardware Fault Alarm",
            "Internal hardware failure or power bus abnormality detected by inverter processor.",
        )),
        "CONNECT" => Some((
            "UPS Communication Established",
            "Hardware communication link established with local controller.",
        )),
        "DISCONNECT" => Some((
            "UPS Communication Disconnected",
            "Communication link to the UPS port closed or disconnected.",
        )),
        "CONNECT_ERROR" => Some((
            "UPS Connection Failure",
            "Failed to open serial or USB HID transport to the designated port.",
        )),
        "POLL_ERROR" => Some((
            "Telemetry Polling Error",
            "Hardware telemetry query timed out or returned corrupted response packet.",
        )),
        "BATTERY_TEST_STARTED" => Some((
            "Battery Self-Test Active",
            "UPS is performing an active battery discharge self-test under load.",
        )),
        "BATTERY_TEST_COMPLETED" => Some((
            "Battery Self-Test Completed",
            "Battery self-test finished successfully; normal AC line mode restored.",
        )),
        "SHUTDOWN_ACTIVE" => Some((
            "UPS Output Shutdown Active",
            "Delayed output shutdown sequence is in progress. Save all open work and prepare for power cutoff.",
        )),
        "SHUTDOWN_CANCELLED" => Some((
            "UPS Output Shutdown Cancelled",
            "Pending shutdown sequence was cancelled or completed; output power preserved.",
        )),
        "USER_ACTION" => Some((
            "User Action Audit Log",
            "Manual command or state modification performed by user.",
        )),
        "APP_START" => Some((
            "UPSED Application Started",
            "UPSED background monitor and system services started.",
        )),
        "APP_HIDE" => Some((
            "UPSED Window Hidden",
            "Application window minimized or hidden to system tray.",
        )),
        "APP_EXIT" => Some((
            "UPSED Application Shut Down",
            "UPSED application process terminated.",
        )),
        "warning.a0" => Some((
            "Battery Disconnected",
            "Battery circuit breaker is open or battery terminals are disconnected. Check battery cabling.",
        )),
        "warning.a1" => Some((
            "Neutral Line Disconnected",
            "Neutral wire is not detected at input terminals. Check AC wiring polarity.",
        )),
        "warning.a2" => Some((
            "Site Wiring Fault",
            "Ground wire or neutral line reverse phase detected at building outlet.",
        )),
        "warning.a3" => Some((
            "Phase Sequence Incorrect",
            "Input AC supply three-phase rotation direction is reversed.",
        )),
        "warning.a4" => Some((
            "Bypass Phase Sequence Incorrect",
            "Bypass line input phase rotation does not match primary input.",
        )),
        "warning.a5" => Some((
            "Input Frequency Unstable in Bypass",
            "Grid frequency fluctuation exceeds synchronized tracking limits.",
        )),
        "warning.a6" => Some((
            "Battery Overcharged",
            "Battery float voltage exceeds permissible high threshold. Charger halted.",
        )),
        "warning.a7" => Some((
            "Low Battery",
            "Battery energy level low. Operating time is limited.",
        )),
        "warning.a8" => Some((
            "Output Overload",
            "Total appliance power draw exceeds continuous rating of inverter.",
        )),
        "warning.a9" => Some((
            "Cooling Fan Alarm",
            "Cooling fan speed is abnormal or fan is locked by foreign object.",
        )),
        "warning.a10" => Some((
            "Emergency Power Off (EPO) Activated",
            "Hardware emergency power cut switch engaged. Inverter output disabled.",
        )),
        "warning.a11" => Some((
            "Abnormal Power Turn On",
            "Inverter power-up sequence failed to establish stable bus voltage.",
        )),
        "warning.a12" => Some((
            "Over Temperature Alarm",
            "Thermal sensors report dangerous heatsink or ambient temperatures.",
        )),
        "warning.a13" => Some((
            "Battery Charger Alarm",
            "Internal charging circuit malfunctioned. Batteries cannot recharge.",
        )),
        "warning.a14" => Some((
            "Remote Auto Shutdown Initiated",
            "Remote command or automated shutdown countdown triggered on UPS.",
        )),
        "warning.a55" => Some((
            "Battery Replacement Required",
            "Battery internal resistance test failed. Battery pack aged and needs replacement.",
        )),
        "warning.a60" => Some((
            "Bypass Unstable",
            "Static bypass line AC voltage or frequency outside safe bypass transfer window.",
        )),
        "warning.a69" => Some((
            "Battery Self-Test Failed",
            "10-second battery discharge test failed to sustain load voltage.",
        )),
        _ => None,
    }
}

fn format_title_case(event_type: &str) -> String {
    event_type
        .split('_')
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Resolves a user-friendly `(title, description)` pair for an event record.
pub fn resolve_event_info(event: &EventLogRecord) -> (String, String) {
    if let Some((title, default_desc)) = event_details(&event.event_type) {
        let desc = if !event.message.is_empty() && !event.message.starts_with(title) {
            event.message.clone()
        } else {
            default_desc.to_string()
        };
        (title.to_string(), desc)
    } else {
        let title = format_title_case(&event.event_type);
        let desc = if event.message.is_empty() {
            "Hardware event reported by UPS.".to_string()
        } else {
            event.message.clone()
        };
        (title, desc)
    }
}

/// Returns true when the main UI window is absent (unloaded in tray), hidden, minimized, or unfocused.
fn is_app_in_background(app: &AppHandle) -> bool {
    match app.get_webview_window("main") {
        None => true,
        Some(window) => {
            let visible = window.is_visible().unwrap_or(false);
            let minimized = window.is_minimized().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            !visible || minimized || !focused
        }
    }
}

/// Emits `"ups-event"` to any open WebView and dispatches a native OS notification
/// when the UI is in the background/tray and `os_notifications_enabled` is true.
pub fn emit_ups_event(app: &AppHandle, event: &EventLogRecord) {
    let _ = app.emit("ups-event", event);

    if event.event_type.starts_with("APP_") || event.event_type == "USER_ACTION" {
        return;
    }

    if !is_app_in_background(app) {
        return;
    }

    let os_enabled = app
        .try_state::<AppState>()
        .and_then(|state| state.db.get_setting("os_notifications_enabled").ok().flatten())
        .map(|v| v != "false")
        .unwrap_or(true);

    if !os_enabled {
        return;
    }

    let (title, description) = resolve_event_info(event);
    let body = match &event.ups_id {
        Some(id) if !id.is_empty() => format!("{} ({})", description, id),
        _ => description,
    };

    if let Err(e) = app
        .notification()
        .builder()
        .title(format!("UPSED: {}", title))
        .body(body)
        .show()
    {
        tracing::warn!("[NOTIFY] Failed to dispatch OS notification: {}", e);
    }
}
