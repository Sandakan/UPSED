mod mock_serial;
use mock_serial::MockSerialPort;
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};
use upsed_lib::serial::SerialTransport;

use UnlockStage::{T1ReadOnly, T2NonDestructive, T3ConfigWrite, T4PowerControl};
use VoltronicCommand as C;

/// (command, expected wire string, expected stage, P-series only)
fn catalog() -> Vec<(VoltronicCommand, &'static str, UnlockStage, bool)> {
    vec![
        // T1 legacy Megatec / Axpert queries
        (C::QueryProtocolId, "QPI", T1ReadOnly, false),
        (C::QuickStatus, "Q1", T1ReadOnly, false),
        (C::QueryStatusQs, "QS", T1ReadOnly, false),
        (C::QueryGeneralStatus, "QPIGS", T1ReadOnly, false),
        (C::QueryWarningStatus, "QPIWS", T1ReadOnly, false),
        (C::QueryRatingInfo, "QPIRI", T1ReadOnly, false),
        (C::QueryWorkingMode, "QMOD", T1ReadOnly, false),
        (C::QueryFlags, "QFLAG", T1ReadOnly, false),
        (C::QueryDeviceId, "QID", T1ReadOnly, false),
        (C::QueryFirmwareVersion, "QVFW", T1ReadOnly, false),
        (C::QueryBatteryVoltage, "QBV", T1ReadOnly, false),
        // T1 P-series queries
        (C::QueryPStatus, "QGS", T1ReadOnly, true),
        (C::QueryPWarning, "QWS", T1ReadOnly, true),
        (C::QueryPRating, "QRI", T1ReadOnly, true),
        (C::QueryModel, "QMD", T1ReadOnly, true),
        (C::QueryFaultStatus, "QFS", T1ReadOnly, true),
        (C::QueryEcoWindow, "QHE", T1ReadOnly, true),
        (C::QueryBypassVoltage, "QBYV", T1ReadOnly, true),
        (C::QueryBypassFrequency, "QBYF", T1ReadOnly, true),
        (C::QueryBatteryCapacity, "QBTAH", T1ReadOnly, true),
        (C::QueryOutletState { group: 1 }, "QSK1", T1ReadOnly, true),
        (C::QueryOutletState { group: 2 }, "QSK2", T1ReadOnly, true),
        // T2
        (C::BuzzerOn, "BZON", T2NonDestructive, false),
        (C::BuzzerOff, "BZOFF", T2NonDestructive, false),
        (C::BuzzerToggle, "BZOFF", T2NonDestructive, false),
        (C::TenSecondTest, "T", T2NonDestructive, false),
        (C::TestForMinutes(5), "T05", T2NonDestructive, false),
        (C::TestUntilLow, "TL", T2NonDestructive, true),
        (C::CancelTest, "CT", T2NonDestructive, false),
        // T3
        (C::SetBypassHighVoltage(260), "PHV260", T3ConfigWrite, true),
        (C::SetBypassLowVoltage(190), "PLV190", T3ConfigWrite, true),
        (C::SetBypassHighFrequency(53.0), "PGF53.0", T3ConfigWrite, true),
        (C::SetBypassLowFrequency(47.0), "PSF47.0", T3ConfigWrite, true),
        (C::SetEcoHigh(253), "HEH253", T3ConfigWrite, true),
        (C::SetEcoLow(190), "HEL190", T3ConfigWrite, true),
        (C::SetMaxBackupMinutes(30), "MD0030", T3ConfigWrite, true),
        (C::SetAlarmEnabled(true), "PEA", T3ConfigWrite, true),
        (C::SetAlarmEnabled(false), "PDA", T3ConfigWrite, true),
        // T4
        (C::ShutdownWithDelay { minutes: 0.3 }, "S.3", T4PowerControl, false),
        (C::ShutdownAndRestore { minutes: 0.3, restore_minutes: 2 }, "S.3R0002", T4PowerControl, true),
        (C::CancelShutdown, "CS", T4PowerControl, false),
        (C::OutputOn, "SON", T4PowerControl, true),
        (C::OutputOff, "SOFF", T4PowerControl, true),
        (C::OutletOn { group: 1 }, "SKON1", T4PowerControl, true),
        (C::OutletOff { group: 1 }, "SKOFF1", T4PowerControl, true),
    ]
}

#[test]
fn cat_001_wire_strings_stage_and_protocol_support_match_spec() {
    for (cmd, wire, stage, p_only) in catalog() {
        assert_eq!(cmd.as_cmd_str().unwrap(), wire, "{:?}", cmd);
        assert_eq!(cmd.required_stage(), stage, "{:?}", cmd);
        assert_eq!(cmd.is_p_series_only(), p_only, "{:?}", cmd);
        assert_eq!(cmd.is_read_only(), stage == T1ReadOnly, "{:?}", cmd);
    }
}

#[test]
fn cat_002_protocol_aware_encoding_refuses_before_transmission() {
    for (cmd, wire, _, p_only) in catalog() {
        for proto in ["01", "P01", "09", "99"] {
            assert_eq!(cmd.as_cmd_str_for(proto).unwrap(), wire, "{:?}/{}", cmd, proto);
        }
        for proto in ["17", "30", "", "garbage"] {
            assert_eq!(cmd.as_cmd_str_for(proto).is_err(), p_only, "{:?}/{}", cmd, proto);
        }
    }
}

#[test]
fn cat_003_wire_strings_are_clean_ascii_without_framing_or_whitespace() {
    for (cmd, wire, _, _) in catalog() {
        assert!(wire.is_ascii(), "{:?}", cmd);
        assert!(!wire.contains(|c: char| c.is_whitespace() || c.is_control()), "{:?}", cmd);
        assert!(wire.len() <= 12, "{:?}", cmd);
    }
}

#[test]
fn cat_004_every_cataloged_wire_string_is_answered_by_mock() {
    let mut port = MockSerialPort::with_axpert_golden_responses("COM1");
    for (cmd, wire, _, _) in catalog() {
        // Legacy-only queries exercised elsewhere may not be in the mock; only
        // commands the mock claims to answer must not error.
        if port.send_command(wire).is_err() {
            panic!("mock has no golden response for {:?} ({})", cmd, wire);
        }
    }
}

#[test]
fn cat_005_t2_and_t1_commands_never_carry_arguments_that_modify_config() {
    // Read-only and diagnostic commands must not look like setters or power control.
    for (cmd, wire, stage, _) in catalog() {
        if stage <= T2NonDestructive {
            for forbidden in ["PHV", "PLV", "PGF", "PSF", "HEH", "HEL", "MD", "SON", "SOFF", "SKON", "SKOFF", "PF", "PE", "PD"] {
                assert!(!wire.starts_with(forbidden), "{:?} looks like a setter: {}", cmd, wire);
            }
        }
    }
}

#[test]
fn cat_006_only_t1_queries_start_with_q_and_none_carry_arguments_other_than_group() {
    for (cmd, wire, stage, _) in catalog() {
        if stage == T1ReadOnly {
            assert!(wire.starts_with('Q'), "{:?}", cmd);
        } else {
            assert!(!wire.starts_with('Q'), "{:?} non-query begins with Q", cmd);
        }
    }
}

#[test]
fn cat_007_outlet_state_queries_reject_unknown_groups() {
    for g in [0u8, 3, 255] {
        assert!(C::QueryOutletState { group: g }.as_cmd_str().is_err());
    }
}

#[test]
fn cat_008_catalog_covers_every_stage() {
    let stages: Vec<_> = catalog().iter().map(|(_, _, s, _)| *s).collect();
    for s in [T1ReadOnly, T2NonDestructive, T3ConfigWrite, T4PowerControl] {
        assert!(stages.contains(&s), "{:?} missing from catalog", s);
    }
}
