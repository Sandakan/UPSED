mod mock_serial;
use mock_serial::MockSerialPort;
use voltwatch_lib::gate::{CommandGate, GateError};
use voltwatch_lib::protocol::{UnlockStage, VoltronicCommand};
use voltwatch_lib::serial::SerialTransport;

#[test]
fn t4_001_shutdown_with_delay_encodes_and_executes_in_t4() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();
    gate.set_test_passed(UnlockStage::T3ConfigWrite);
    gate.unlock_stage(UnlockStage::T4PowerControl).unwrap();

    let cmd = VoltronicCommand::ShutdownWithDelay { minutes: 0.3 };
    assert!(gate.check_command(&cmd).is_ok());

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "S.3");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command(&cmd_str).unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t4_001b_zero_delay_shutdown_rejected() {
    // 0 minutes delay is dangerous; minimum floor is 0.1m (~6 seconds)
    let zero_delay = VoltronicCommand::ShutdownWithDelay { minutes: 0.0 };
    assert!(zero_delay.as_cmd_str().is_err());
}

#[test]
fn t4_002_cancel_shutdown_executes() {
    let cmd = VoltronicCommand::CancelShutdown;
    assert_eq!(cmd.as_cmd_str().unwrap(), "CS");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("CS").unwrap(), "(OK");
}

#[test]
fn t4_003_outlet_on_and_off_encoded_and_executed() {
    let on = VoltronicCommand::OutletOn {
        group: 1,
        delay_minutes: 1,
    };
    assert_eq!(on.as_cmd_str().unwrap(), "OLON1,1");

    let off = VoltronicCommand::OutletOff {
        group: 1,
        delay_minutes: 1,
    };
    assert_eq!(off.as_cmd_str().unwrap(), "OLOFF1,1");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("OLON1,1").unwrap(), "(OK");
    assert_eq!(port.send_command("OLOFF1,1").unwrap(), "(OK");
}

#[test]
fn t4_003b_invalid_outlet_group_rejected() {
    // Groups must be 1, 2, or 3
    let group_zero = VoltronicCommand::OutletOn {
        group: 0,
        delay_minutes: 1,
    };
    assert!(group_zero.as_cmd_str().is_err());

    let group_four = VoltronicCommand::OutletOff {
        group: 4,
        delay_minutes: 1,
    };
    assert!(group_four.as_cmd_str().is_err());
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

