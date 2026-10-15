mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::protocol::{
    parse_qfs, parse_qsk, PBatteryInfo, PFlags, PFrequencyWindow, PGeneralStatus, PModel,
    PRating, PVoltageWindow, PWarnings, PWorkMode, ProtocolError,
};
use upsed_lib::serial::SerialTransport;

// Responses captured from a live Protocol 01 unit (USB 0665:5161).
const QGS: &str = "(230.2 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 100000000001\r";
const QBV: &str = "(027.1 02 01 095 037\r";
const QBYV: &str = "(264 180\r";
const QBYF: &str = "(53.0 47.0\r";
const QHE: &str = "(242 218\r";
const QRI: &str = "(230.0 004 024.0 50.0\r";
const QMD: &str = "(#######WPHVT1K0 ###1000 90 1/1 230 230 02 12.0\r";
const QFLAG: &str = "(EpbrsghczDoavefm\r";
const QMOD: &str = "(L\r";
const QWS: &str = "(0000000000000000000000000000000000000000000000000000000000000000\r";

#[test]
fn ps_001_qgs_parses_live_sample() {
    let s = PGeneralStatus::parse(QGS).unwrap();
    assert_eq!(s.input_voltage_v, 230.2);
    assert_eq!(s.input_frequency_hz, 49.9);
    assert_eq!(s.output_voltage_v, 229.5);
    assert_eq!(s.output_frequency_hz, 49.9);
    assert_eq!(s.output_current_a, 0.8);
    assert_eq!(s.output_load_pct, 20);
    assert_eq!(s.bus_positive_v, Some(370.4));
    assert_eq!(s.bus_negative_v, Some(373.5));
    assert_eq!(s.battery_voltage_v, Some(27.1));
    assert_eq!(s.reserved_9, None); // "---.-"
    assert_eq!(s.temperature_c, Some(31.8));
    assert_eq!(s.status_bits, "100000000001");
}

#[test]
fn ps_002_qgs_rejects_malformed() {
    assert!(PGeneralStatus::parse("(230.2 49.9").is_err()); // too few tokens
    assert!(PGeneralStatus::parse("230.2 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 100000000001").is_err()); // no '('
    assert!(PGeneralStatus::parse("(230.2 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 10002").is_err()); // non-binary
    assert!(PGeneralStatus::parse("(230.2 49.9 229.5 49.9 000.8 999 370.4 373.5 027.1 ---.- 031.8 1").is_err()); // load > 255
    assert!(PGeneralStatus::parse("(abc 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 1").is_err());
    assert!(matches!(PGeneralStatus::parse("(NAK\r"), Err(ProtocolError::CommandNak)));
}

#[test]
fn ps_003_qbv_battery_block_and_cross_check_with_qgs() {
    let b = PBatteryInfo::parse(QBV).unwrap();
    assert_eq!(b.voltage_v, 27.1);
    assert_eq!(b.batteries_in_series, 2);
    assert_eq!(b.parallel_groups, 1);
    assert_eq!(b.capacity_pct, 95);
    assert_eq!(b.remaining_minutes, 37);
    // Independent consistency check: QGS token 8 is the same battery voltage.
    assert_eq!(PGeneralStatus::parse(QGS).unwrap().battery_voltage_v, Some(b.voltage_v));
    assert!(PBatteryInfo::parse("(027.1 02 01 150 037").is_err()); // capacity > 100
}

#[test]
fn ps_004_windows_parse_and_validate_order() {
    assert_eq!(PVoltageWindow::parse_qbyv(QBYV).unwrap(), PVoltageWindow { high_v: 264, low_v: 180 });
    assert_eq!(PVoltageWindow::parse_qhe(QHE).unwrap(), PVoltageWindow { high_v: 242, low_v: 218 });
    let f = PFrequencyWindow::parse(QBYF).unwrap();
    assert_eq!((f.high_hz, f.low_hz), (53.0, 47.0));
    assert!(PVoltageWindow::parse_qbyv("(180 264").is_err()); // low above high
    assert!(PFrequencyWindow::parse("(47.0 53.0").is_err());
    assert!(PVoltageWindow::parse_qhe("(242").is_err());
}

#[test]
fn ps_005_qri_and_qmd_parse_live_samples() {
    let r = PRating::parse(QRI).unwrap();
    assert_eq!(r.rated_output_voltage_v, 230.0);
    assert_eq!(r.rated_output_current_a, 4);
    assert_eq!(r.battery_nominal_voltage_v, 24.0);
    assert_eq!(r.rated_frequency_hz, 50.0);

    let m = PModel::parse(QMD).unwrap();
    assert_eq!(m.model_name, "WPHVT1K0");
    assert_eq!(m.va_rating, 1000);
    assert_eq!(m.power_factor_pct, 90);
    assert_eq!(m.phases, "1/1");
    assert_eq!((m.input_voltage_v, m.output_voltage_v), (230.0, 230.0));
    assert_eq!(m.batteries_in_series, 2);
    assert_eq!(m.battery_voltage_v, 12.0);
    // Independent consistency check: series count x per-battery voltage == QRI nominal.
    assert_eq!(m.batteries_in_series as f32 * m.battery_voltage_v, r.battery_nominal_voltage_v);
    assert!(PModel::parse("(#### ###1000 90 1/1 230 230 02 12.0").is_err()); // empty name
    assert!(PModel::parse("(NAME ###1000 90").is_err());
}

#[test]
fn ps_006_qflag_splits_enabled_and_disabled() {
    let f = PFlags::parse(QFLAG).unwrap();
    assert_eq!(f.enabled, "pbrsghcz".chars().collect::<Vec<_>>());
    assert_eq!(f.disabled, "oavefm".chars().collect::<Vec<_>>());
    assert!(f.is_enabled('p') && !f.is_enabled('o'));
    assert_eq!(PFlags::parse("(Eab").unwrap().disabled, Vec::<char>::new());
    assert!(PFlags::parse("(XabDc").is_err());
    assert!(PFlags::parse("(Ea1Db").is_err());
}

#[test]
fn ps_007_qmod_covers_every_mode_letter() {
    use PWorkMode::*;
    for (l, m) in [
        ('P', PowerOn), ('S', Standby), ('Y', Bypass), ('L', Line), ('B', Battery),
        ('T', BatteryTest), ('F', Fault), ('E', Eco), ('C', Converter), ('D', Shutdown),
    ] {
        assert_eq!(PWorkMode::parse(&format!("({}\r", l)).unwrap(), m);
    }
    assert_eq!(PWorkMode::parse(QMOD).unwrap(), Line);
    assert!(PWorkMode::parse("(Z").is_err());
    assert!(PWorkMode::parse("(LB").is_err());
    assert!(PWorkMode::parse("(").is_err());
}

#[test]
fn ps_008_qws_bits_and_active_indices() {
    let w = PWarnings::parse(QWS).unwrap();
    assert_eq!(w.bits.len(), 64);
    assert!(w.active.is_empty());
    let mut bits = "0".repeat(64);
    bits.replace_range(5..6, "1");
    bits.replace_range(63..64, "1");
    let w = PWarnings::parse(&format!("({}", bits)).unwrap();
    assert_eq!(w.active, vec![5, 63]);
    assert!(PWarnings::parse("(").is_err());
    assert!(PWarnings::parse("(0102").is_err());
    assert!(PWarnings::parse(&format!("({}", "0".repeat(129))).is_err());
}

#[test]
fn ps_009_qfs_and_qsk() {
    assert_eq!(parse_qfs("(OK\r").unwrap(), None);
    assert_eq!(parse_qfs("(02 230.0 00.0").unwrap(), Some("02 230.0 00.0".into()));
    assert!(parse_qfs("(").is_err());
    // This unit has no switchable outlets and answers NAK (observed live).
    assert!(matches!(parse_qsk("(NAK\r"), Err(ProtocolError::CommandNak)));
    assert!(parse_qsk("(1").unwrap());
    assert!(!parse_qsk("(0").unwrap());
    assert!(parse_qsk("(2").is_err());
}

#[test]
fn ps_010_parsers_tolerate_hid_nul_padding_and_crlf() {
    assert_eq!(PWorkMode::parse("(L\r\0\0\0").unwrap(), PWorkMode::Line);
    assert_eq!(PWorkMode::parse(" (L\r\n").unwrap(), PWorkMode::Line);
    assert!(PBatteryInfo::parse("(027.1 02 01 095 037\r\0\0").is_ok());
}

#[test]
fn ps_011_mock_golden_responses_round_trip_through_parsers() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    assert!(PGeneralStatus::parse(&port.send_command("QGS").unwrap()).is_ok());
    assert!(PBatteryInfo::parse(&port.send_command("QBV").unwrap()).is_ok());
    assert!(PRating::parse(&port.send_command("QRI").unwrap()).is_ok());
    assert!(PModel::parse(&port.send_command("QMD").unwrap()).is_ok());
    assert!(PFlags::parse(&port.send_command("QFLAG").unwrap()).is_ok());
    assert!(PWorkMode::parse(&port.send_command("QMOD").unwrap()).is_ok());
    assert!(PWarnings::parse(&port.send_command("QWS").unwrap()).is_ok());
    assert!(PVoltageWindow::parse_qhe(&port.send_command("QHE").unwrap()).is_ok());
    assert!(PVoltageWindow::parse_qbyv(&port.send_command("QBYV").unwrap()).is_ok());
    assert!(PFrequencyWindow::parse(&port.send_command("QBYF").unwrap()).is_ok());
}
