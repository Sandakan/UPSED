mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::gate::{CommandGate, GateError};
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};
use upsed_lib::serial::SerialTransport;

#[test]
fn t2_001_buzzer_toggle_encodes_and_executes_in_t2() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();

    let cmd = VoltronicCommand::BuzzerToggle;
    assert!(gate.check_command(&cmd).is_ok());

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "Q");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command(&cmd_str).unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t2_001b_buzzer_blocked_in_t1() {
    let mut gate = CommandGate::new();
    gate.unlock_stage(UnlockStage::T1ReadOnly).unwrap(); // Relocked to T1
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

#[test]
fn t2_005_timed_test_encodes_and_executes() {
    let gate = CommandGate::new(); // Defaults to T2
    let cmd = VoltronicCommand::TestForMinutes(5);
    assert!(gate.check_command(&cmd).is_ok());
    assert_eq!(cmd.as_cmd_str().unwrap(), "T05");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("T05").unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t2_006_timed_test_range_validation() {
    assert!(VoltronicCommand::TestForMinutes(0).as_cmd_str().is_err());
    assert!(VoltronicCommand::TestForMinutes(100).as_cmd_str().is_err());
    assert_eq!(VoltronicCommand::TestForMinutes(1).as_cmd_str().unwrap(), "T01");
    assert_eq!(VoltronicCommand::TestForMinutes(99).as_cmd_str().unwrap(), "T99");
}

#[test]
fn t2_007_timed_test_blocked_in_t1() {
    let mut gate = CommandGate::new();
    gate.unlock_stage(UnlockStage::T1ReadOnly).unwrap();
    let cmd = VoltronicCommand::TestForMinutes(10);
    assert!(matches!(
        gate.check_command(&cmd),
        Err(GateError::StageLocked {
            required: UnlockStage::T2NonDestructive,
            current: UnlockStage::T1ReadOnly,
        })
    ));
}

#[test]
fn t2_008_q1_parses_test_in_progress_and_beeper_bits() {
    use upsed_lib::protocol::Q1Status;
    // Status bits: 00000101 -> bit 5 (index 5) is '1' (test in progress), bit 7 (index 7) is '1' (beeper on)
    let resp = "(238.0 50.0 238.0 50.0 023 0230 025.4 45 00000101";
    let status = Q1Status::parse(resp).unwrap();
    assert!(status.test_in_progress);
    assert!(status.beeper_on);

    // Status bits: 00000000 -> both false
    let resp_idle = "(238.0 50.0 238.0 50.0 023 0230 025.4 45 00000000";
    let status_idle = Q1Status::parse(resp_idle).unwrap();
    assert!(!status_idle.test_in_progress);
    assert!(!status_idle.beeper_on);
}

