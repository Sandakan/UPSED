use upsed_lib::battery_bridge::BatteryBridge;
use upsed_lib::protocol::Q1Status;

#[test]
fn bridge_001_disabled_by_default() {
    let bridge = BatteryBridge::new();
    assert!(
        !bridge.is_enabled(),
        "OS Battery Bridge MUST be disabled by default per safety requirement"
    );
}

#[test]
fn bridge_002_explicit_activation_required() {
    let mut bridge = BatteryBridge::new();
    assert!(!bridge.is_enabled());

    bridge.set_enabled(true);
    assert!(bridge.is_enabled());

    bridge.set_enabled(false);
    assert!(!bridge.is_enabled());
}

#[test]
fn bridge_003_when_disabled_no_os_interaction() {
    let mut bridge = BatteryBridge::new();
    let status = Q1Status {
        grid_voltage_v: 230.0,
        grid_frequency_hz: 50.0,
        output_voltage_v: 230.0,
        output_frequency_hz: 50.0,
        output_load_pct: 20,
        output_watts: 200,
        battery_voltage_v: 25.4,
        temperature_c: 30,
        utility_fail: false,
        battery_low: false,
        bypass_active: false,
        ups_failed: false,
        test_in_progress: false,
        beeper_on: false,
        raw_status_bits: "00000000".into(),
    };

    // Calling update on a disabled bridge is a safe no-op
    bridge.update(&status);
}

#[test]
fn bridge_004_icon_generator_sanity() {
    use upsed_lib::battery_bridge::{compute_battery_pct, generate_battery_icon_rgba, TRAY_ICON_SIZE};
    let rgba = generate_battery_icon_rgba(96, false, false);
    assert_eq!(rgba.len(), (TRAY_ICON_SIZE as usize) * (TRAY_ICON_SIZE as usize) * 4);

    let pct = compute_battery_pct(27.1);
    assert_eq!(pct, 96);
}

#[test]
fn bridge_005_all_7_tray_states_generate_valid_rgba() {
    use upsed_lib::battery_bridge::{generate_tray_icon_rgba, UpsTrayState, TRAY_ICON_SIZE};

    let states = [
        UpsTrayState::Disconnected,
        UpsTrayState::AcNormal { pct: 100 },
        UpsTrayState::OnBattery { pct: 75 },
        UpsTrayState::BatteryLow { pct: 15 },
        UpsTrayState::BypassMode { pct: 100 },
        UpsTrayState::UpsFault,
        UpsTrayState::TestInProgress { pct: 90 },
    ];

    for state in states {
        let rgba = generate_tray_icon_rgba(state);
        assert_eq!(
            rgba.len(),
            (TRAY_ICON_SIZE as usize) * (TRAY_ICON_SIZE as usize) * 4,
            "Tray icon for state {:?} must match TRAY_ICON_SIZE RGBA buffer size",
            state
        );
        // Ensure not completely blank
        assert!(
            rgba.iter().any(|&b| b > 0),
            "Tray icon for state {:?} must contain non-zero pixel data",
            state
        );
    }
}

