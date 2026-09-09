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

