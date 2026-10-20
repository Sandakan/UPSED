use upsed_lib::db::{Database, TelemetryRecord};
use upsed_lib::gate::{CommandGate, GateError};
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};

#[test]
fn sec_001_cannot_skip_stages() {
    let mut gate = CommandGate::new();

    // Trying to jump directly from T1 to T3
    let result_t3 = gate.unlock_stage(UnlockStage::T3ConfigWrite);
    assert!(matches!(result_t3, Err(GateError::PrerequisiteNotMet(_))));

    // Trying to jump directly from T1 to T4
    let result_t4 = gate.unlock_stage(UnlockStage::T4PowerControl);
    assert!(matches!(result_t4, Err(GateError::PrerequisiteNotMet(_))));
}

#[test]
fn sec_002_all_commands_strictly_typed_no_arbitrary_string_passthrough() {
    // Unlike ViewPower which had controlNew(port, arbitraryString, null),
    // UPSED only accepts discrete, strongly typed enum commands.
    let cmd = VoltronicCommand::QueryProtocolId;
    assert!(cmd.is_read_only());

    let write_cmd = VoltronicCommand::SetBypassHighVoltage(260);
    assert!(!write_cmd.is_read_only());
    assert_eq!(write_cmd.required_stage(), UnlockStage::T3ConfigWrite);
}

#[test]
fn sec_003_gate_downgrade_to_t1_immediately_relocks_higher_commands() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    assert_eq!(gate.current_stage(), UnlockStage::T2NonDestructive);

    // Downgrade back to T1
    gate.unlock_stage(UnlockStage::T1ReadOnly).unwrap();
    assert_eq!(gate.current_stage(), UnlockStage::T1ReadOnly);

    // T2 command must now be rejected
    assert!(matches!(
        gate.check_command(&VoltronicCommand::BuzzerToggle),
        Err(GateError::StageLocked { .. })
    ));
}

#[test]
fn sec_004_sqlite_telemetry_isolation() {
    use upsed_lib::db::UpsMetadata;
    // In-memory SQLite for testing
    let db = Database::init(":memory:").unwrap();

    let meta = UpsMetadata {
        unique_id: "COM1".into(),
        name: "Test COM1".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: false,
        updated_at: "2026-09-09T20:00:00Z".into(),
    };
    db.save_ups_metadata(&meta).unwrap();

    let record = TelemetryRecord {
        id: None,
        timestamp: "2026-09-09T20:00:00Z".into(),
        ups_id: "COM1".into(),
        grid_voltage: 230.5,
        output_voltage: 230.0,
        grid_frequency: 50.1,
        output_frequency: 50.0,
        load_pct: 25,
        output_watts: 250,
        battery_voltage: 26.8,
        temperature_c: 35,
    };

    db.insert_telemetry(&record).unwrap();

    let results = db.query_recent_telemetry("COM1", 10).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].grid_voltage, 230.5);
    assert_eq!(results[0].grid_frequency, 50.1);
    assert_eq!(results[0].output_frequency, 50.0);
    assert_eq!(results[0].output_watts, 250);

    // Querying a different port yields empty result (isolation)
    let results_other = db.query_recent_telemetry("COM2", 10).unwrap();
    assert!(results_other.is_empty());
}

#[test]
fn sec_005_ups_metadata_persistence() {
    use upsed_lib::db::{Database, UpsMetadata};

    let db = Database::init(":memory:").unwrap();

    let meta = UpsMetadata {
        unique_id: "QID-TESTSERIAL123".into(),
        name: "Office Test UPS".into(),
        usb_uuid: Some("USB#VID_0665&PID_5161#PORT_1".into()),
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1500,
        power_factor: 0.6,
        rated_watts: 900,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: false,
        updated_at: "2026-09-10T00:00:00Z".into(),
    };

    // 1. Initial query returns None
    assert!(db.get_ups_metadata(&meta.unique_id).unwrap().is_none());

    // 2. Save metadata
    db.save_ups_metadata(&meta).unwrap();

    // 3. Query returns saved record
    let retrieved = db.get_ups_metadata(&meta.unique_id).unwrap().unwrap();
    assert_eq!(retrieved, meta);

    // 4. Update existing record (upsert)
    let mut updated_meta = meta.clone();
    updated_meta.rated_va = 2000;
    updated_meta.power_factor = 0.8;
    updated_meta.rated_watts = 1600;
    updated_meta.name = "Renamed UPS".into();
    db.save_ups_metadata(&updated_meta).unwrap();

    let retrieved_updated = db.get_ups_metadata(&meta.unique_id).unwrap().unwrap();
    assert_eq!(retrieved_updated.rated_va, 2000);
    assert_eq!(retrieved_updated.power_factor, 0.8);
    assert_eq!(retrieved_updated.rated_watts, 1600);
    assert_eq!(retrieved_updated.name, "Renamed UPS");

    // 5. List all
    let list = db.list_all_ups_metadata().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].unique_id, "QID-TESTSERIAL123");
}

#[test]
fn sec_006_usb_uuid_roaming_and_settings() {
    use upsed_lib::db::{Database, UpsMetadata};

    let db = Database::init(":memory:").unwrap();

    // Test 1: General settings storage
    assert!(db.get_setting("last_connected_device").unwrap().is_none());
    db.set_setting("last_connected_device", "QID-TESTSERIAL123")
        .unwrap();
    assert_eq!(
        db.get_setting("last_connected_device").unwrap(),
        Some("QID-TESTSERIAL123".to_string())
    );

    // Test 2: Dynamic USB UUID Port Roaming
    let meta = UpsMetadata {
        unique_id: "QID-TESTSERIAL123".into(),
        name: "Workstation Prolink".into(),
        usb_uuid: Some("USB#VID_0665&PID_5161#REAR_USB_PORT_1".into()),
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 6000,
        power_factor: 0.9,
        rated_watts: 5400,
        battery_voltage: 192,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "Online".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: false,
        updated_at: "2026-09-10T00:00:00Z".into(),
    };
    db.save_ups_metadata(&meta).unwrap();

    // User unplugs and plugs into a front USB port (new usb_uuid)
    let new_port_uuid = "USB#VID_0665&PID_5161#FRONT_HUB_PORT_4";
    db.update_device_usb_uuid(&meta.unique_id, new_port_uuid, "2026-09-10T01:00:00Z")
        .unwrap();

    // Verify unique_id, name, VA, chemistry remain unchanged while usb_uuid is updated
    let re_read = db.get_ups_metadata(&meta.unique_id).unwrap().unwrap();
    assert_eq!(re_read.unique_id, "QID-TESTSERIAL123");
    assert_eq!(re_read.name, "Workstation Prolink");
    assert_eq!(re_read.rated_va, 6000);
    assert_eq!(re_read.rated_watts, 5400);
    assert_eq!(re_read.usb_uuid, Some(new_port_uuid.to_string()));
    assert_eq!(re_read.updated_at, "2026-09-10T01:00:00Z");
}

#[test]
fn sec_007_hardware_event_transition_detection() {
    use upsed_lib::commands::detect_status_events;
    use upsed_lib::protocol::Q1Status;

    let base_status = Q1Status {
        grid_voltage_v: 230.0,
        grid_frequency_hz: 50.0,
        output_voltage_v: 230.0,
        output_frequency_hz: 50.0,
        output_load_pct: 35,
        output_watts: 280,
        battery_voltage_v: 27.2,
        temperature_c: 32,
        utility_fail: false,
        battery_low: false,
        bypass_active: false,
        ups_failed: false,
        test_in_progress: false,
        beeper_on: false,
        raw_status_bits: "00000000".into(),
    };

    // Test 1: Utility failure rising edge (mains blackout)
    let blackout_status = Q1Status {
        utility_fail: true,
        ..base_status.clone()
    };
    let events = detect_status_events(Some(&base_status), &blackout_status, Some("UPS-TEST-1"));
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "UTILITY_FAIL");
    assert_eq!(events[0].severity, "critical");

    // Test 2: Grid restored falling edge
    let restored_events = detect_status_events(Some(&blackout_status), &base_status, Some("UPS-TEST-1"));
    assert_eq!(restored_events.len(), 1);
    assert_eq!(restored_events[0].event_type, "UTILITY_RESTORE");
    assert_eq!(restored_events[0].severity, "success");

    // Test 3: Low battery warning rising edge
    let low_bat_status = Q1Status {
        battery_low: true,
        ..base_status.clone()
    };
    let bat_events = detect_status_events(Some(&base_status), &low_bat_status, Some("UPS-TEST-1"));
    assert_eq!(bat_events.len(), 1);
    assert_eq!(bat_events[0].event_type, "BATTERY_LOW");
    assert_eq!(bat_events[0].severity, "critical");

    // Test 4: Overload (> 100%)
    let overload_status = Q1Status {
        output_load_pct: 125,
        ..base_status.clone()
    };
    let ovld_events = detect_status_events(Some(&base_status), &overload_status, Some("UPS-TEST-1"));
    assert_eq!(ovld_events.len(), 1);
    assert_eq!(ovld_events[0].event_type, "OVERLOAD");
    assert_eq!(ovld_events[0].severity, "critical");

    // Test 5: Overload cleared
    let cleared_ovld = detect_status_events(Some(&overload_status), &base_status, Some("UPS-TEST-1"));
    assert_eq!(cleared_ovld.len(), 1);
    assert_eq!(cleared_ovld[0].event_type, "OVERLOAD_CLEARED");
    assert_eq!(cleared_ovld[0].severity, "info");

    // Test 6: Over-temperature
    let hot_status = Q1Status {
        temperature_c: 58,
        ..base_status.clone()
    };
    let temp_events = detect_status_events(Some(&base_status), &hot_status, Some("UPS-TEST-1"));
    assert_eq!(temp_events.len(), 1);
    assert_eq!(temp_events[0].event_type, "OVER_TEMP");
    assert_eq!(temp_events[0].severity, "warning");

    // Test 7: No change produces no events
    let no_events = detect_status_events(Some(&base_status), &base_status, Some("UPS-TEST-1"));
    assert!(no_events.is_empty());
}
