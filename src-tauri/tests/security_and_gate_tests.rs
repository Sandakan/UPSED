use voltwatch_lib::db::{Database, TelemetryRecord};
use voltwatch_lib::gate::{CommandGate, GateError};
use voltwatch_lib::protocol::{UnlockStage, VoltronicCommand};

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
    // VoltWatch only accepts discrete, strongly typed enum commands.
    let cmd = VoltronicCommand::QueryProtocolId;
    assert!(cmd.is_read_only());

    let write_cmd = VoltronicCommand::SetChargeCurrentAmps(30);
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
    // In-memory SQLite for testing
    let db = Database::init(":memory:").unwrap();

    let record = TelemetryRecord {
        id: None,
        timestamp: "2026-09-09T20:00:00Z".into(),
        port_name: "COM1".into(),
        grid_voltage: 230.5,
        output_voltage: 230.0,
        load_pct: 25,
        battery_voltage: 26.8,
        temperature_c: 35,
    };

    db.insert_telemetry(&record).unwrap();

    let results = db.query_recent_telemetry("COM1", 10).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].grid_voltage, 230.5);

    // Querying a different port yields empty result (isolation)
    let results_other = db.query_recent_telemetry("COM2", 10).unwrap();
    assert!(results_other.is_empty());
}

#[test]
fn sec_005_ups_metadata_persistence() {
    use voltwatch_lib::db::{Database, UpsMetadata};

    let db = Database::init(":memory:").unwrap();

    let meta = UpsMetadata {
        unique_id: "QID-TESTSERIAL123".into(),
        name: "Office Test UPS".into(),
        usb_uuid: Some("USB#VID_0665&PID_5161#PORT_1".into()),
        rated_va: 1500,
        power_factor: 0.6,
        rated_watts: 900,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
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
    use voltwatch_lib::db::{Database, UpsMetadata};

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
        rated_va: 6000,
        power_factor: 0.9,
        rated_watts: 5400,
        battery_voltage: 192,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "Online".into(),
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
