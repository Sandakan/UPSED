mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::gate::{CommandGate, GateError};
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};
use upsed_lib::serial::SerialTransport;

fn t4_gate() -> CommandGate {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();
    gate.set_test_passed(UnlockStage::T3ConfigWrite);
    gate.unlock_stage(UnlockStage::T4PowerControl).unwrap();
    gate
}

#[test]
fn t4_001_shutdown_with_delay_encodes_and_executes_in_t4() {
    let gate = t4_gate();
    let cmd = VoltronicCommand::ShutdownWithDelay { minutes: 0.3 };
    assert!(gate.check_command(&cmd).is_ok());

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "S.3");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command(&cmd_str).unwrap(), "(ACK");
}

#[test]
fn t4_001b_shutdown_delay_layout_and_bounds() {
    let enc = |m: f32| VoltronicCommand::ShutdownWithDelay { minutes: m }.as_cmd_str();
    // Below one minute: tenths with a leading dot.
    assert_eq!(enc(0.1).unwrap(), "S.1");
    assert_eq!(enc(0.9).unwrap(), "S.9");
    // One minute and above: two-digit whole minutes.
    assert_eq!(enc(1.0).unwrap(), "S01");
    assert_eq!(enc(5.0).unwrap(), "S05");
    assert_eq!(enc(99.0).unwrap(), "S99");
    // Rejected: zero, negative, too large, fractional above one minute, NaN.
    assert!(enc(0.0).is_err());
    assert!(enc(-1.0).is_err());
    assert!(enc(99.5).is_err());
    assert!(enc(100.0).is_err());
    assert!(enc(1.5).is_err());
    assert!(enc(f32::NAN).is_err());
}

#[test]
fn t4_001c_shutdown_and_restore_layout_and_bounds() {
    let cmd = VoltronicCommand::ShutdownAndRestore { minutes: 0.3, restore_minutes: 2 };
    assert_eq!(cmd.as_cmd_str().unwrap(), "S.3R0002");
    let long = VoltronicCommand::ShutdownAndRestore { minutes: 5.0, restore_minutes: 9999 };
    assert_eq!(long.as_cmd_str().unwrap(), "S05R9999");
    assert!(VoltronicCommand::ShutdownAndRestore { minutes: 0.3, restore_minutes: 0 }.as_cmd_str().is_err());
    assert!(VoltronicCommand::ShutdownAndRestore { minutes: 0.3, restore_minutes: 10000 }.as_cmd_str().is_err());
    assert!(VoltronicCommand::ShutdownAndRestore { minutes: 0.0, restore_minutes: 2 }.as_cmd_str().is_err());

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("S.3R0002").unwrap(), "(ACK");
}

#[test]
fn t4_002_cancel_shutdown_executes() {
    let cmd = VoltronicCommand::CancelShutdown;
    assert_eq!(cmd.as_cmd_str().unwrap(), "CS");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("CS").unwrap(), "(OK");
}

#[test]
fn t4_003_output_and_outlet_commands_encoded_and_executed() {
    assert_eq!(VoltronicCommand::OutputOn.as_cmd_str().unwrap(), "SON");
    assert_eq!(VoltronicCommand::OutputOff.as_cmd_str().unwrap(), "SOFF");
    assert_eq!(VoltronicCommand::OutletOn { group: 1 }.as_cmd_str().unwrap(), "SKON1");
    assert_eq!(VoltronicCommand::OutletOff { group: 1 }.as_cmd_str().unwrap(), "SKOFF1");
    assert_eq!(VoltronicCommand::OutletOn { group: 2 }.as_cmd_str().unwrap(), "SKON2");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    for wire in ["SON", "SOFF", "SKON1", "SKOFF1"] {
        assert_eq!(port.send_command(wire).unwrap(), "(ACK", "{}", wire);
    }
}

#[test]
fn t4_003b_invalid_outlet_group_rejected() {
    // Only groups 1 and 2 have state registers (QSK1/QSK2).
    for g in [0u8, 3, 4, 255] {
        assert!(VoltronicCommand::OutletOn { group: g }.as_cmd_str().is_err(), "{}", g);
        assert!(VoltronicCommand::OutletOff { group: g }.as_cmd_str().is_err(), "{}", g);
    }
}

#[test]
fn t4_003c_all_power_commands_require_t4() {
    let power = [
        VoltronicCommand::ShutdownWithDelay { minutes: 1.0 },
        VoltronicCommand::ShutdownAndRestore { minutes: 1.0, restore_minutes: 1 },
        VoltronicCommand::CancelShutdown,
        VoltronicCommand::OutputOn,
        VoltronicCommand::OutputOff,
        VoltronicCommand::OutletOn { group: 1 },
        VoltronicCommand::OutletOff { group: 1 },
    ];
    let mut t3 = CommandGate::new();
    t3.set_test_passed(UnlockStage::T1ReadOnly);
    t3.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    t3.set_test_passed(UnlockStage::T2NonDestructive);
    t3.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();
    let t4 = t4_gate();
    for c in &power {
        assert_eq!(c.required_stage(), UnlockStage::T4PowerControl, "{:?}", c);
        assert!(t3.check_command(c).is_err(), "{:?}", c);
        assert!(t4.check_command(c).is_ok(), "{:?}", c);
    }
}

#[test]
fn t4_004_gate_blocks_t4_if_t3_not_passed() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();
    // NOT marking t3_tests_passed

    let result = gate.unlock_stage(UnlockStage::T4PowerControl);
    assert!(matches!(result, Err(GateError::PrerequisiteNotMet(_))));
}

