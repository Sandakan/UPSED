use crate::protocol::Q1Status;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryBridgeState {
    pub is_enabled: bool,
    pub platform: &'static str,
}

pub struct BatteryBridge {
    is_enabled: bool,
}

impl Default for BatteryBridge {
    fn default() -> Self {
        // Explicitly disabled by default per user requirement
        Self { is_enabled: false }
    }
}

impl BatteryBridge {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_enabled(&self) -> bool {
        self.is_enabled
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.is_enabled = enabled;
        tracing::info!("OS Battery Bridge enabled status changed to: {}", enabled);
    }

    pub fn update(&self, status: &Q1Status) {
        if !self.is_enabled {
            return;
        }

        // When enabled, bridge updates OS power manager:
        // - On Linux: write virtual HID reports to /dev/uhid -> UPower
        // - On macOS: update IOPSSetPowerSourceDetails
        // - On Windows: update Tray icon fill and tooltip
        tracing::debug!(
            "Battery bridge active: battery={}V, load={}%",
            status.battery_voltage_v,
            status.output_load_pct
        );
    }
}
