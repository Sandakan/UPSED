mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::gate::{CommandGate, GateError};
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};
use upsed_lib::serial::SerialTransport;

fn t3_gate() -> CommandGate {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();
    gate
}

#[test]
fn t3_001_bypass_voltage_encodes_and_executes_in_t3() {
    let gate = t3_gate();
    let cmd = VoltronicCommand::SetBypassHighVoltage(260);
    assert!(gate.check_command(&cmd).is_ok());
    assert_eq!(cmd.required_stage(), UnlockStage::T3ConfigWrite);

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "PHV260");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command(&cmd_str).unwrap(), "(ACK");
}

#[test]
fn t3_002_bypass_thresholds_encoded_correctly() {
    assert_eq!(VoltronicCommand::SetBypassHighVoltage(260).as_cmd_str().unwrap(), "PHV260");
    assert_eq!(VoltronicCommand::SetBypassLowVoltage(190).as_cmd_str().unwrap(), "PLV190");
    // Three-digit zero padding is part of the wire layout.
    assert_eq!(VoltronicCommand::SetBypassLowVoltage(150).as_cmd_str().unwrap(), "PLV150");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("PHV260").unwrap(), "(ACK");
    assert_eq!(port.send_command("PLV190").unwrap(), "(ACK");
}

#[test]
fn t3_002b_bypass_voltage_range_boundaries() {
    for (cmd, ok) in [
        (VoltronicCommand::SetBypassHighVoltage(179), false),
        (VoltronicCommand::SetBypassHighVoltage(180), true),
        (VoltronicCommand::SetBypassHighVoltage(280), true),
        (VoltronicCommand::SetBypassHighVoltage(281), false),
        (VoltronicCommand::SetBypassLowVoltage(149), false),
        (VoltronicCommand::SetBypassLowVoltage(150), true),
        (VoltronicCommand::SetBypassLowVoltage(240), true),
        (VoltronicCommand::SetBypassLowVoltage(241), false),
    ] {
        assert_eq!(cmd.as_cmd_str().is_ok(), ok, "{:?}", cmd);
    }
}

#[test]
fn t3_003_frequency_and_eco_and_backup_encoding() {
    assert_eq!(VoltronicCommand::SetBypassHighFrequency(53.0).as_cmd_str().unwrap(), "PGF53.0");
    assert_eq!(VoltronicCommand::SetBypassLowFrequency(47.0).as_cmd_str().unwrap(), "PSF47.0");
    assert_eq!(VoltronicCommand::SetEcoHigh(253).as_cmd_str().unwrap(), "HEH253");
    assert_eq!(VoltronicCommand::SetEcoLow(190).as_cmd_str().unwrap(), "HEL190");
    assert_eq!(VoltronicCommand::SetMaxBackupMinutes(30).as_cmd_str().unwrap(), "MD0030");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    for wire in ["PGF53.0", "PSF47.0", "HEH253", "HEL190", "MD0030"] {
        assert_eq!(port.send_command(wire).unwrap(), "(ACK", "{}", wire);
    }
}

#[test]
fn t3_003b_frequency_eco_backup_range_boundaries() {
    for (cmd, ok) in [
        (VoltronicCommand::SetBypassHighFrequency(49.9), false),
        (VoltronicCommand::SetBypassHighFrequency(50.0), true),
        (VoltronicCommand::SetBypassHighFrequency(65.0), true),
        (VoltronicCommand::SetBypassHighFrequency(65.1), false),
        (VoltronicCommand::SetBypassHighFrequency(f32::NAN), false),
        (VoltronicCommand::SetBypassLowFrequency(39.9), false),
        (VoltronicCommand::SetBypassLowFrequency(40.0), true),
        (VoltronicCommand::SetBypassLowFrequency(60.0), true),
        (VoltronicCommand::SetBypassLowFrequency(60.1), false),
        (VoltronicCommand::SetEcoHigh(199), false),
        (VoltronicCommand::SetEcoHigh(200), true),
        (VoltronicCommand::SetEcoHigh(281), false),
        (VoltronicCommand::SetEcoLow(149), false),
        (VoltronicCommand::SetEcoLow(240), true),
        (VoltronicCommand::SetEcoLow(241), false),
        (VoltronicCommand::SetMaxBackupMinutes(0), false),
        (VoltronicCommand::SetMaxBackupMinutes(1), true),
        (VoltronicCommand::SetMaxBackupMinutes(9999), true),
        (VoltronicCommand::SetMaxBackupMinutes(10000), false),
    ] {
        assert_eq!(cmd.as_cmd_str().is_ok(), ok, "{:?}", cmd);
    }
}

#[test]
fn t3_003c_all_config_writes_require_t3_and_p_series() {
    let writes = [
        VoltronicCommand::SetBypassHighVoltage(260),
        VoltronicCommand::SetBypassLowVoltage(190),
        VoltronicCommand::SetBypassHighFrequency(53.0),
        VoltronicCommand::SetBypassLowFrequency(47.0),
        VoltronicCommand::SetEcoHigh(253),
        VoltronicCommand::SetEcoLow(190),
        VoltronicCommand::SetMaxBackupMinutes(30),
        VoltronicCommand::SetAlarmEnabled(true),
        VoltronicCommand::SetAlarmEnabled(false),
    ];
    let mut t2_gate = CommandGate::new();
    t2_gate.set_test_passed(UnlockStage::T1ReadOnly);
    t2_gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    for w in &writes {
        assert_eq!(w.required_stage(), UnlockStage::T3ConfigWrite, "{:?}", w);
        assert!(w.is_p_series_only(), "{:?}", w);
        assert!(!w.supports_protocol("17"), "{:?}", w);
        assert!(w.as_cmd_str_for("17").is_err(), "{:?}", w);
        assert!(w.as_cmd_str_for("01").is_ok(), "{:?}", w);
        assert!(t2_gate.check_command(w).is_err(), "{:?}", w);
        assert!(t3_gate().check_command(w).is_ok(), "{:?}", w);
    }
}

#[test]
fn t3_004_t3_cannot_execute_t4_power_control() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();

    let shutdown = VoltronicCommand::ShutdownWithDelay { minutes: 1.0 };
    assert!(matches!(
        gate.check_command(&shutdown),
        Err(GateError::StageLocked {
            required: UnlockStage::T4PowerControl,
            current: UnlockStage::T3ConfigWrite,
        })
    ));
}

#[test]
fn t3_005_gate_blocks_t3_if_t2_tests_not_passed() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    // Intentionally NOT marking t2_tests_passed

    let result = gate.unlock_stage(UnlockStage::T3ConfigWrite);
    assert!(matches!(result, Err(GateError::PrerequisiteNotMet(_))));
}

