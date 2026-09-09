mod mock_serial;
use mock_serial::MockSerialPort;
use voltwatch_lib::gate::{CommandGate, GateError};
use voltwatch_lib::protocol::{UnlockStage, VoltronicCommand};
use voltwatch_lib::serial::SerialTransport;

#[test]
fn t3_001_set_charge_current_encodes_correctly() {
    let mut gate = CommandGate::new();
    gate.set_test_passed(UnlockStage::T1ReadOnly);
    gate.unlock_stage(UnlockStage::T2NonDestructive).unwrap();
    gate.set_test_passed(UnlockStage::T2NonDestructive);
    gate.unlock_stage(UnlockStage::T3ConfigWrite).unwrap();

    let cmd = VoltronicCommand::SetChargeCurrentAmps(20);
    assert!(gate.check_command(&cmd).is_ok());

    let cmd_str = cmd.as_cmd_str().unwrap();
    assert_eq!(cmd_str, "MCHGC0020");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command(&cmd_str).unwrap();
    assert_eq!(resp, "(OK");
}

#[test]
fn t3_001b_charge_current_out_of_range_rejected() {
    // 0A is invalid
    let zero_amps = VoltronicCommand::SetChargeCurrentAmps(0);
    assert!(zero_amps.as_cmd_str().is_err());

    // 250A exceeds maximum supported charging hardware limits (200A max)
    let excessive = VoltronicCommand::SetChargeCurrentAmps(250);
    assert!(excessive.as_cmd_str().is_err());
}

#[test]
fn t3_002_bypass_voltage_thresholds_encoded_correctly() {
    let high = VoltronicCommand::SetBypassHighVoltage(260);
    assert_eq!(high.as_cmd_str().unwrap(), "PBVH260");

    let low = VoltronicCommand::SetBypassLowVoltage(190);
    assert_eq!(low.as_cmd_str().unwrap(), "PBVL190");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("PBVH260").unwrap(), "(OK");
    assert_eq!(port.send_command("PBVL190").unwrap(), "(OK");
}

#[test]
fn t3_002b_bypass_voltage_out_of_range_rejected() {
    let high_too_low = VoltronicCommand::SetBypassHighVoltage(150); // < 180V invalid
    assert!(high_too_low.as_cmd_str().is_err());

    let low_too_high = VoltronicCommand::SetBypassLowVoltage(250); // > 240V invalid
    assert!(low_too_high.as_cmd_str().is_err());
}

#[test]
fn t3_003_battery_low_shutdown_voltage_encoded() {
    let cmd = VoltronicCommand::SetBatteryLowShutdownVoltage(20.0);
    assert_eq!(cmd.as_cmd_str().unwrap(), "PSDV20.0");

    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert_eq!(port.send_command("PSDV20.0").unwrap(), "(OK");
}

#[test]
fn t3_003b_battery_shutdown_voltage_safety_floor() {
    // Cutoff below 10V is dangerous for battery banks
    let unsafe_cutoff = VoltronicCommand::SetBatteryLowShutdownVoltage(5.0);
    assert!(unsafe_cutoff.as_cmd_str().is_err());
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

