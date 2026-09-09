mod mock_serial;
use mock_serial::MockSerialPort;
use voltwatch_lib::gate::{CommandGate, GateError};
use voltwatch_lib::protocol::{UnlockStage, VoltronicCommand};
use voltwatch_lib::serial::SerialTransport;

#[test]
fn t2_001_buzzer_toggle_encodes_and_executes_in_t2() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let cmd = VoltronicCommand::BuzzerToggle;
    assert!(gate.check_command(&cmd).is_ok());

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "BUZZER");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command(&cmd_str).unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t2_001b_buzzer_blocked_in_t1() {
    let gate = CommandGate::new(); // Starts at T1
    let cmd = VoltronicCommand::BuzzerToggle;
    let result = gate.check_command(&cmd);
    assert_eq!(
        result,
        Err(GateError::StageLocked {
            required: UnlockStage::T2NonDestructive,
            current: UnlockStage::T1ReadOnly,
        })
    );
}

#[test]
fn t2_002_ten_second_test_encodes_and_executes() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let cmd = VoltronicCommand::TenSecondTest;
    assert!(gate.check_command(&cmd).is_ok());
    assert_eq!(cmd.as_cmd_str().unwrap(), "T");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("T").unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t2_002b_test_cancel_executes() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let cmd = VoltronicCommand::CancelTest;
    assert!(gate.check_command(&cmd).is_ok());
    assert_eq!(cmd.as_cmd_str().unwrap(), "CT");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("CT").unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t2_003_t2_cannot_execute_t3_config_writes() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let config_cmd = VoltronicCommand::SetChargeCurrentAmps(20);
    assert!(matches!(
        gate.check_command(&config_cmd),
        Err(GateError::StageLocked {
            required: UnlockStage::T3ConfigWrite,
            current: UnlockStage::T2NonDestructive,
        })
    ));
}

#[test]
fn t2_004_t2_cannot_execute_t4_power_control() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let shutdown_cmd = VoltronicCommand::ShutdownWithDelay { minutes: 1.0 };
    assert!(matches!(
        gate.check_command(&shutdown_cmd),
        Err(GateError::StageLocked {
            required: UnlockStage::T4PowerControl,
            current: UnlockStage::T2NonDestructive,
        })
    ));
}

