mod mock_serial;
use mock_serial::MockSerialPort;
use voltwatch_lib::gate::{CommandGate, GateError};
use voltwatch_lib::protocol::{
    decode_response, encode_command, parse_device_id, parse_firmware_version, parse_protocol_id,
    ProtocolError, Q1Status, QpigsStatus, QpiriRatings, QpiwsWarnings, UnlockStage,
    VoltronicCommand,
};
use voltwatch_lib::serial::SerialTransport;

#[test]
fn t1_001_qpi_identifies_protocol() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QPI").unwrap();
    let proto_id = parse_protocol_id(&resp).unwrap();
    assert_eq!(proto_id, "17");
}

#[test]
fn t1_001b_qpi_timeout_handled_gracefully() {
    let mut port = MockSerialPort::new("COM1").inject_timeout();
    let result = port.send_command("QPI");
    assert!(matches!(result, Err(ProtocolError::Timeout)));
}

#[test]
fn t1_001c_qpi_corrupt_response_rejected() {
    let raw = b"CORRUPT_WITHOUT_PARENTHESIS\r";
    let result = decode_response(raw);
    assert!(matches!(result, Err(ProtocolError::InvalidResponsePrefix(_))));
}

#[test]
fn t1_002_q1_parses_all_fields() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("Q1").unwrap();
    let status = Q1Status::parse(&resp).unwrap();

    assert_eq!(status.grid_voltage_v, 238.0);
    assert_eq!(status.grid_frequency_hz, 50.0);
    assert_eq!(status.output_voltage_v, 238.0);
    assert_eq!(status.output_frequency_hz, 50.0);
    assert_eq!(status.output_load_pct, 23);
    assert_eq!(status.output_watts, 230);
    assert_eq!(status.battery_voltage_v, 25.4);
    assert_eq!(status.temperature_c, 45);
    assert!(!status.utility_fail);
    assert!(!status.battery_low);
    assert!(status.bypass_active);
    assert!(status.ups_failed);
}

#[test]
fn t1_002b_q1_field_count_mismatch_rejected() {
    let malformed = "(238.0 50.0";
    let result = Q1Status::parse(malformed);
    assert!(matches!(result, Err(ProtocolError::ParseError(_))));
}

#[test]
fn t1_002c_q1_physical_range_sanity_checks() {
    let normal = "(238.0 50.0 238.0 50.0 023 0230 025.4 45 00110000";
    let status = Q1Status::parse(normal).unwrap();

    // Sanity range bounds for standard UPS hardware
    assert!(status.grid_voltage_v > 0.0 && status.grid_voltage_v < 400.0);
    assert!(status.grid_frequency_hz >= 40.0 && status.grid_frequency_hz <= 70.0);
    assert!(status.output_load_pct <= 150);
    assert!(status.battery_voltage_v > 5.0 && status.battery_voltage_v < 80.0);
    assert!(status.temperature_c >= -20 && status.temperature_c <= 100);
}

#[test]
fn t1_003_qpigs_parses_extended_status() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QPIGS").unwrap();
    let status = QpigsStatus::parse(&resp).unwrap();

    assert_eq!(status.grid_voltage_v, 238.0);
    assert_eq!(status.output_voltage_v, 238.0);
    assert_eq!(status.output_load_pct, 23);
    assert_eq!(status.bus_voltage_v, 380);
    assert_eq!(status.battery_voltage_v, 25.4);
    assert_eq!(status.battery_charge_current_a, 10);
    assert_eq!(status.battery_capacity_pct, 85);
    assert_eq!(status.heatsink_temp_c, 45);
}

#[test]
fn t1_003b_qpigs_unsupported_nak_handled() {
    let mut port = MockSerialPort::new("COM1"); // Empty port returns NAK
    let resp = port.send_command("QPIGS").unwrap();
    assert_eq!(resp, "(NAK");
}

#[test]
fn t1_004_qpiws_parses_warning_bitmask() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QPIWS").unwrap();
    let warnings = QpiwsWarnings::parse(&resp).unwrap();

    assert!(!warnings.inverter_fault);
    assert!(!warnings.bus_over_fault);
    assert!(!warnings.battery_low);
}

#[test]
fn t1_004b_qpiws_battery_low_bit_detected() {
    // Bit 11 is battery low
    let mut bits = vec!['0'; 40];
    bits[11] = '1';
    let warning_str = format!("({}", bits.into_iter().collect::<String>());

    let warnings = QpiwsWarnings::parse(&warning_str).unwrap();
    assert!(warnings.battery_low, "Battery low flag must be detected");
}

#[test]
fn t1_005a_qid_returns_serial_number() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QID").unwrap();
    let sn = parse_device_id(&resp).unwrap();
    assert_eq!(sn, "9293311030000");
}

#[test]
fn t1_005b_qvfw_returns_firmware_version() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QVFW").unwrap();
    let fw = parse_firmware_version(&resp).unwrap();
    assert_eq!(fw, "00072.10");
}

#[test]
fn t1_005c_qpiri_parses_rating_info() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    let resp = port.send_command("QPIRI").unwrap();
    let ratings = QpiriRatings::parse(&resp).unwrap();

    assert_eq!(ratings.rated_grid_voltage_v, 230.0);
    assert_eq!(ratings.rated_output_apparent_power_va, 5000);
    assert_eq!(ratings.max_charge_current_a, 60);
}

#[test]
fn t1_006_codec_ensures_trailing_cr() {
    let encoded = encode_command("Q1");
    assert_eq!(encoded, b"Q1\r");
    assert_eq!(encoded.last(), Some(&b'\r'));
}

#[test]
fn t1_007_no_write_commands_executed_in_t1() {
    let gate = CommandGate::new();
    assert_eq!(gate.current_stage(), UnlockStage::T1ReadOnly);

    // T1 allows read commands
    assert!(gate.check_command(&VoltronicCommand::QuickStatus).is_ok());
    assert!(gate.check_command(&VoltronicCommand::QueryProtocolId).is_ok());

    // T1 strictly BLOCKS all non-read commands
    assert!(matches!(
        gate.check_command(&VoltronicCommand::BuzzerToggle),
        Err(GateError::StageLocked { .. })
    ));
    assert!(matches!(
        gate.check_command(&VoltronicCommand::SetChargeCurrentAmps(20)),
        Err(GateError::StageLocked { .. })
    ));
    assert!(matches!(
        gate.check_command(&VoltronicCommand::ShutdownWithDelay { minutes: 1.0 }),
        Err(GateError::StageLocked { .. })
    ));
}
