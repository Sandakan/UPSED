use crate::protocol::Q1Status;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryBridgeState {
    pub is_enabled: bool,
    pub platform: &'static str,
}

/// Generates a dynamic 32x32 RGBA pixel buffer displaying the battery level,
/// charging status, and critical warning colors.
pub fn generate_battery_icon_rgba(pct: u32, on_battery: bool, battery_low: bool) -> Vec<u8> {
    let width = 32usize;
    let height = 32usize;
    let mut buf = vec![0u8; width * height * 4];

    let mut set_pixel = |x: usize, y: usize, color: [u8; 4]| {
        if x < width && y < height {
            let idx = (y * width + x) * 4;
            buf[idx..idx + 4].copy_from_slice(&color);
        }
    };

    // Color palette
    let border_color = [210, 220, 235, 255]; // Crisp light slate
    let fill_color = if battery_low {
        [239, 68, 68, 255] // Red
    } else if on_battery {
        [245, 158, 11, 255] // Amber
    } else {
        [16, 185, 129, 255] // Emerald green
    };

    // Battery Body: Box from x=3 to x=25, y=9 to y=23 (Height=15, Width=23)
    // Top & Bottom border (y=9, y=23)
    for x in 4..=24 {
        set_pixel(x, 9, border_color);
        set_pixel(x, 23, border_color);
    }
    // Left & Right border (x=3, x=25)
    for y in 10..=22 {
        set_pixel(3, y, border_color);
        set_pixel(25, y, border_color);
    }

    // Battery Terminal Nub on the right: x=26..=27, y=13..=19
    for x in 26..=27 {
        for y in 13..=19 {
            set_pixel(x, y, border_color);
        }
    }

    // Inner Fill Area: x=5 to x=23 (Total 19 pixels width), y=11 to y=21
    let clamped_pct = pct.min(100);
    let fill_pixels = ((clamped_pct as f32 / 100.0) * 19.0).round() as usize;

    for x in 5..(5 + fill_pixels).min(24) {
        for y in 11..=21 {
            set_pixel(x, y, fill_color);
        }
    }

    // If AC grid is present (charging / line mode), overlay a white charging lightning bolt
    if !on_battery {
        let bolt = [255, 255, 255, 255];
        set_pixel(14, 12, bolt);
        set_pixel(13, 13, bolt);
        set_pixel(14, 14, bolt);
        set_pixel(15, 14, bolt);
        set_pixel(13, 15, bolt);
        set_pixel(14, 16, bolt);
    }

    buf
}

/// Calibrates battery voltage to SoC percentage matching ViewPower standards.
pub fn compute_battery_pct(measured_voltage: f32) -> u32 {
    if measured_voltage <= 0.0 {
        return 0;
    }

    let nominal_v: f32 = if measured_voltage < 16.0 {
        12.0
    } else if measured_voltage < 32.0 {
        24.0
    } else if measured_voltage < 44.0 {
        36.0
    } else if measured_voltage < 64.0 {
        48.0
    } else if measured_voltage < 120.0 {
        96.0
    } else if (160.0..=260.0).contains(&measured_voltage) {
        192.0
    } else {
        24.0
    };

    let cells = (nominal_v / 2.0).round().max(1.0);
    let cell_v = measured_voltage / cells;
    let v_min = 1.75f32;
    let v_max = 2.28f32;

    if cell_v <= v_min {
        0
    } else if cell_v >= v_max {
        100
    } else {
        (((cell_v - v_min) / (v_max - v_min)) * 100.0)
            .round()
            .clamp(0.0, 100.0) as u32
    }
}

#[derive(Debug, Default)]
pub struct BatteryBridge {
    pub is_enabled: bool,
    pub last_status: Option<Q1Status>,
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

    pub fn update(&mut self, status: &Q1Status) {
        self.last_status = Some(status.clone());
    }

    pub fn last_status(&self) -> Option<&Q1Status> {
        self.last_status.as_ref()
    }
}
