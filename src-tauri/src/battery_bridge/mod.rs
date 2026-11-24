use crate::protocol::Q1Status;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryBridgeState {
    pub is_enabled: bool,
    pub platform: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpsTrayState {
    Disconnected,
    AcNormal { pct: u32 },
    OnBattery { pct: u32 },
    BatteryLow { pct: u32 },
    BypassMode { pct: u32 },
    UpsFault,
    TestInProgress { pct: u32 },
}

pub const TRAY_ICON_SIZE: u32 = 32;

/// Generates a dynamic 32x32 high-DPI RGBA pixel buffer displaying the state-aware UPS icon.
/// Designed as a sleek, wide horizontal cylinder (rounded capsule) with generous breathing space around it.
pub fn generate_tray_icon_rgba(state: UpsTrayState) -> Vec<u8> {
    let width = TRAY_ICON_SIZE as usize;
    let height = TRAY_ICON_SIZE as usize;
    let mut buf = vec![0u8; width * height * 4];

    let mut set_pixel = |x: usize, y: usize, color: [u8; 4]| {
        if x < width && y < height {
            let idx = (y * width + x) * 4;
            buf[idx..idx + 4].copy_from_slice(&color);
        }
    };

    // Capsule outer geometry on 32x32 canvas:
    // Dimensions: Width = 24px (x: 4..=27), Height = 12px (y: 10..=21).
    // Padding: 4px on left and right, 10px on top and bottom.
    // Perfectly centered, wide horizontal cylinder with smooth curved ends.
    let draw_cylinder_casing = |set_px: &mut dyn FnMut(usize, usize, [u8; 4]), border: [u8; 4]| {
        // Top and bottom horizontal edges
        for x in 7..=24 {
            set_px(x, 10, border);
            set_px(x, 21, border);
        }
        // Rounded left cap
        set_px(6, 11, border);
        set_px(5, 12, border);
        set_px(5, 13, border);
        set_px(4, 14, border);
        set_px(4, 15, border);
        set_px(4, 16, border);
        set_px(4, 17, border);
        set_px(5, 18, border);
        set_px(5, 19, border);
        set_px(6, 20, border);

        // Rounded right cap
        set_px(25, 11, border);
        set_px(26, 12, border);
        set_px(26, 13, border);
        set_px(27, 14, border);
        set_px(27, 15, border);
        set_px(27, 16, border);
        set_px(27, 17, border);
        set_px(26, 18, border);
        set_px(26, 19, border);
        set_px(25, 20, border);
    };

    // Return the interior x bounds (inclusive) for a given y row inside the capsule
    let get_row_bounds = |y: usize| -> Option<(usize, usize)> {
        match y {
            11 => Some((7, 24)),
            12..=13 => Some((6, 25)),
            14..=17 => Some((5, 26)),
            18..=19 => Some((6, 25)),
            20 => Some((7, 24)),
            _ => None,
        }
    };

    // Background fill for the empty/unfilled chamber: dark translucent slate
    let empty_bg = [15, 23, 42, 220];

    match state {
        UpsTrayState::Disconnected => {
            // Muted slate gray empty cylinder
            let border = [148, 163, 184, 255];
            draw_cylinder_casing(&mut set_pixel, border);

            // Fill empty chamber with dark glass
            for y in 11..=20 {
                if let Some((x_start, x_end)) = get_row_bounds(y) {
                    for x in x_start..=x_end {
                        set_pixel(x, y, empty_bg);
                    }
                }
            }

            // Crisp diagonal red slash (2px thick)
            let slash = [239, 68, 68, 255];
            for i in 0..12 {
                let px = 10 + i;
                let py = 19 - (i * 8 / 11);
                set_pixel(px, py, slash);
                set_pixel(px + 1, py, slash);
            }
        }
        UpsTrayState::UpsFault => {
            // High-visibility crimson casing with dark crimson fill and bold white 'X'
            let border = [239, 68, 68, 255];
            draw_cylinder_casing(&mut set_pixel, border);

            let dark_crimson = [127, 29, 29, 240];
            for y in 11..=20 {
                if let Some((x_start, x_end)) = get_row_bounds(y) {
                    for x in x_start..=x_end {
                        set_pixel(x, y, dark_crimson);
                    }
                }
            }

            // Bold white 'X'
            let white = [255, 255, 255, 255];
            for i in 0..7 {
                let x1 = 13 + i;
                let y1 = 12 + i;
                let x2 = 18 - i;
                set_pixel(x1, y1, white);
                set_pixel(x2, y1, white);
            }
        }
        UpsTrayState::AcNormal { pct }
        | UpsTrayState::OnBattery { pct }
        | UpsTrayState::BatteryLow { pct }
        | UpsTrayState::BypassMode { pct }
        | UpsTrayState::TestInProgress { pct } => {
            let (border_color, fill_color) = match state {
                UpsTrayState::BatteryLow { .. } => (
                    [239, 68, 68, 255], // Red border
                    [239, 68, 68, 255], // Red fill
                ),
                UpsTrayState::OnBattery { .. } => (
                    [255, 255, 255, 255], // Bright white border for maximum contrast
                    [245, 158, 11, 255],  // Amber fill
                ),
                UpsTrayState::BypassMode { .. } => (
                    [249, 115, 22, 255], // Orange border
                    [56, 189, 248, 255], // Sky blue fill
                ),
                UpsTrayState::TestInProgress { .. } => (
                    [6, 182, 212, 255],  // Cyan border
                    [6, 182, 212, 255],  // Cyan fill
                ),
                _ => (
                    [255, 255, 255, 255], // Bright white border for maximum visibility on all taskbars
                    [16, 185, 129, 255],  // Emerald green fill
                ),
            };

            // Draw outer cylinder casing
            draw_cylinder_casing(&mut set_pixel, border_color);

            // Proportional battery charge fill: max width = 22px (x: 5..=26)
            let clamped_pct = pct.min(100);
            let fill_width = ((clamped_pct as f32 / 100.0) * 22.0).round() as usize;
            let fill_cutoff_x = 5 + fill_width;

            for y in 11..=20 {
                if let Some((x_start, x_end)) = get_row_bounds(y) {
                    for x in x_start..=x_end {
                        if x < fill_cutoff_x {
                            set_pixel(x, y, fill_color);
                        } else {
                            set_pixel(x, y, empty_bg);
                        }
                    }
                }
            }

            // State-specific overlays
            match state {
                UpsTrayState::AcNormal { .. } => {
                    // Crisp white charging lightning bolt centered vertically
                    let bolt = [255, 255, 255, 255];
                    for (bx, by) in &[
                        (16, 12),
                        (15, 13), (16, 13),
                        (14, 14), (15, 14), (16, 14), (17, 14),
                        (15, 15), (16, 15),
                        (15, 16),
                        (16, 17),
                        (16, 18),
                    ] {
                        set_pixel(*bx, *by, bolt);
                    }
                }
                UpsTrayState::BatteryLow { .. } => {
                    // White exclamation mark '!'
                    let white = [255, 255, 255, 255];
                    for y in 12..=16 {
                        set_pixel(15, y, white);
                        set_pixel(16, y, white);
                    }
                    for y in 18..=19 {
                        set_pixel(15, y, white);
                        set_pixel(16, y, white);
                    }
                }
                UpsTrayState::BypassMode { .. } => {
                    // White bypass arrow '→'
                    let white = [255, 255, 255, 255];
                    for x in 12..=19 {
                        set_pixel(x, 15, white);
                        set_pixel(x, 16, white);
                    }
                    set_pixel(18, 13, white);
                    set_pixel(19, 14, white);
                    set_pixel(19, 17, white);
                    set_pixel(18, 18, white);
                }
                UpsTrayState::TestInProgress { .. } => {
                    // Diagnostic cross '+'
                    let white = [255, 255, 255, 255];
                    for x in 12..=19 {
                        set_pixel(x, 15, white);
                        set_pixel(x, 16, white);
                    }
                    for y in 12..=19 {
                        set_pixel(15, y, white);
                        set_pixel(16, y, white);
                    }
                }
                _ => {}
            }
        }
    }
    buf
}

/// Backwards-compatible wrapper delegating to `generate_tray_icon_rgba`.
pub fn generate_battery_icon_rgba(pct: u32, on_battery: bool, battery_low: bool) -> Vec<u8> {
    let state = if battery_low {
        UpsTrayState::BatteryLow { pct }
    } else if on_battery {
        UpsTrayState::OnBattery { pct }
    } else {
        UpsTrayState::AcNormal { pct }
    };
    generate_tray_icon_rgba(state)
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
