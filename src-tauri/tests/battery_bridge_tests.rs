use voltwatch_lib::battery_bridge::BatteryBridge;
use voltwatch_lib::protocol::Q1Status;

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
        raw_status_bits: "00000000".into(),
    };

    // Calling update on a disabled bridge is a safe no-op
    bridge.update(&status);
}

#[test]
fn bridge_004_icon_generator_sanity() {
    use voltwatch_lib::battery_bridge::{compute_battery_pct, generate_battery_icon_rgba};
    let rgba = generate_battery_icon_rgba(96, false, false);
    assert_eq!(rgba.len(), 32 * 32 * 4);

    let pct = compute_battery_pct(27.1);
    assert_eq!(pct, 96);
}
