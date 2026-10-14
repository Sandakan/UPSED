use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum UnlockStage {
    T1ReadOnly = 1,
    T2NonDestructive = 2,
    T3ConfigWrite = 3,
    T4PowerControl = 4,
}

/// Protocol families that expose the P-series vocabulary documented in
/// `docs/protocol-spec.md`. Commands tagged P-series-only are refused before
/// transmission for any other protocol id.
pub const P_SERIES_FAMILIES: &[&str] = &[
    "00", "01", "02", "03", "05", "08", "09", "10", "13", "14", "31", "33", "35", "39", "44",
    "45", "71", "73", "74", "99",
];

/// Returns true when `protocol_id` (e.g. `"01"` or `"P01"`) is a P-series family.
pub fn is_p_series(protocol_id: &str) -> bool {
    let id = protocol_id.trim().trim_start_matches(['P', 'p']);
    P_SERIES_FAMILIES.contains(&id)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum VoltronicCommand {
    // Stage T1: Read-Only Queries (Zero hardware risk)
    QueryProtocolId,
    QuickStatus,
    QueryStatusQs,
    QueryGeneralStatus,
    QueryWarningStatus,
    QueryRatingInfo,
    QueryWorkingMode,
    QueryFlags,
    QueryDeviceId,
    QueryFirmwareVersion,
    QueryBatteryVoltage,
    // P-series read-only queries
    QueryPStatus,
    QueryPWarning,
    QueryPRating,
    QueryModel,
    QueryFaultStatus,
    QueryEcoWindow,
    QueryBypassVoltage,
    QueryBypassFrequency,
    QueryBatteryCapacity,
    QueryOutletState { group: u8 },

    // Stage T2: Non-Destructive Actions (Low risk, temporary observable state)
    BuzzerToggle,
    BuzzerOn,
    BuzzerOff,
    TenSecondTest,
    CancelTest,
    TestForMinutes(u32),
    TestUntilLow,

    // Stage T3: Configuration Writes (Medium risk, alters persistent flash/EEPROM)
    SetBypassHighVoltage(u32),
    SetBypassLowVoltage(u32),
    SetBypassHighFrequency(f32),
    SetBypassLowFrequency(f32),
    SetEcoHigh(u32),
    SetEcoLow(u32),
    SetMaxBackupMinutes(u32),

    // Stage T4: Power Control (High risk, controls live load output & shutdown)
    ShutdownWithDelay { minutes: f32 },
    ShutdownAndRestore { minutes: f32, restore_minutes: u32 },
    CancelShutdown,
    OutputOn,
    OutputOff,
    OutletOn { group: u8 },
    OutletOff { group: u8 },
}

/// Formats a shutdown delay: below one minute as `.N` (tenths), otherwise as a
/// two-digit whole number of minutes.
fn format_shutdown_delay(minutes: f32) -> Result<String, String> {
    if !minutes.is_finite() || !(0.1..=99.0).contains(&minutes) {
        return Err(format!(
            "Shutdown delay {} minutes out of range (0.1-99m)",
            minutes
        ));
    }
    if minutes < 1.0 {
        let tenths = (minutes * 10.0).round() as u32;
        Ok(format!(".{}", tenths.clamp(1, 9)))
    } else {
        if (minutes - minutes.round()).abs() > f32::EPSILON {
            return Err(format!(
                "Shutdown delay {} minutes must be a whole number of minutes when >= 1",
                minutes
            ));
        }
        Ok(format!("{:02}", minutes.round() as u32))
    }
}

fn check_range_f32(label: &str, v: f32, lo: f32, hi: f32, unit: &str) -> Result<(), String> {
    if !v.is_finite() || v < lo || v > hi {
        return Err(format!("{} {}{} out of range ({}-{}{})", label, v, unit, lo, hi, unit));
    }
    Ok(())
}

impl VoltronicCommand {
    /// Returns the minimum safety unlock stage required to execute this command.
    pub fn required_stage(&self) -> UnlockStage {
        match self {
            Self::QueryProtocolId
            | Self::QuickStatus
            | Self::QueryStatusQs
            | Self::QueryGeneralStatus
            | Self::QueryWarningStatus
            | Self::QueryRatingInfo
            | Self::QueryWorkingMode
            | Self::QueryFlags
            | Self::QueryDeviceId
            | Self::QueryFirmwareVersion
            | Self::QueryBatteryVoltage
            | Self::QueryPStatus
            | Self::QueryPWarning
            | Self::QueryPRating
            | Self::QueryModel
            | Self::QueryFaultStatus
            | Self::QueryEcoWindow
            | Self::QueryBypassVoltage
            | Self::QueryBypassFrequency
            | Self::QueryBatteryCapacity
            | Self::QueryOutletState { .. } => UnlockStage::T1ReadOnly,

            Self::BuzzerToggle
            | Self::BuzzerOn
            | Self::BuzzerOff
            | Self::TenSecondTest
            | Self::CancelTest
            | Self::TestForMinutes(_)
            | Self::TestUntilLow => UnlockStage::T2NonDestructive,

            Self::SetBypassHighVoltage(_)
            | Self::SetBypassLowVoltage(_)
            | Self::SetBypassHighFrequency(_)
            | Self::SetBypassLowFrequency(_)
            | Self::SetEcoHigh(_)
            | Self::SetEcoLow(_)
            | Self::SetMaxBackupMinutes(_) => UnlockStage::T3ConfigWrite,

            Self::ShutdownWithDelay { .. }
            | Self::ShutdownAndRestore { .. }
            | Self::CancelShutdown
            | Self::OutputOn
            | Self::OutputOff
            | Self::OutletOn { .. }
            | Self::OutletOff { .. } => UnlockStage::T4PowerControl,
        }
    }

    /// Whether the command exists only in the P-series vocabulary. Commands
    /// that return `false` (legacy queries, buzzer, battery tests, cancel
    /// commands) are shared with older Megatec/Axpert units.
    pub fn is_p_series_only(&self) -> bool {
        matches!(
            self,
            Self::QueryPStatus
                | Self::QueryPWarning
                | Self::QueryPRating
                | Self::QueryModel
                | Self::QueryFaultStatus
                | Self::QueryEcoWindow
                | Self::QueryBypassVoltage
                | Self::QueryBypassFrequency
                | Self::QueryBatteryCapacity
                | Self::QueryOutletState { .. }
                | Self::TestUntilLow
                | Self::SetBypassHighVoltage(_)
                | Self::SetBypassLowVoltage(_)
                | Self::SetBypassHighFrequency(_)
                | Self::SetBypassLowFrequency(_)
                | Self::SetEcoHigh(_)
                | Self::SetEcoLow(_)
                | Self::SetMaxBackupMinutes(_)
                | Self::ShutdownAndRestore { .. }
                | Self::OutputOn
                | Self::OutputOff
                | Self::OutletOn { .. }
                | Self::OutletOff { .. }
        )
    }

    /// Whether this command may be sent to a device reporting `protocol_id`.
    pub fn supports_protocol(&self, protocol_id: &str) -> bool {
        !self.is_p_series_only() || is_p_series(protocol_id)
    }

    /// Encodes for a specific protocol, refusing unsupported combinations
    /// before any bytes are produced.
    pub fn as_cmd_str_for(&self, protocol_id: &str) -> Result<String, String> {
        if !self.supports_protocol(protocol_id) {
            return Err(format!(
                "Command {:?} is not supported on protocol '{}'",
                self, protocol_id
            ));
        }
        self.as_cmd_str()
    }

    /// Generates the raw ASCII command string (without the trailing \r).
    pub fn as_cmd_str(&self) -> Result<String, String> {
        match self {
            Self::QueryProtocolId => Ok("QPI".to_string()),
            Self::QuickStatus => Ok("Q1".to_string()),
            Self::QueryStatusQs => Ok("QS".to_string()),
            Self::QueryGeneralStatus => Ok("QPIGS".to_string()),
            Self::QueryWarningStatus => Ok("QPIWS".to_string()),
            Self::QueryRatingInfo => Ok("QPIRI".to_string()),
            Self::QueryWorkingMode => Ok("QMOD".to_string()),
            Self::QueryFlags => Ok("QFLAG".to_string()),
            Self::QueryDeviceId => Ok("QID".to_string()),
            Self::QueryFirmwareVersion => Ok("QVFW".to_string()),
            Self::QueryBatteryVoltage => Ok("QBV".to_string()),
            Self::QueryPStatus => Ok("QGS".to_string()),
            Self::QueryPWarning => Ok("QWS".to_string()),
            Self::QueryPRating => Ok("QRI".to_string()),
            Self::QueryModel => Ok("QMD".to_string()),
            Self::QueryFaultStatus => Ok("QFS".to_string()),
            Self::QueryEcoWindow => Ok("QHE".to_string()),
            Self::QueryBypassVoltage => Ok("QBYV".to_string()),
            Self::QueryBypassFrequency => Ok("QBYF".to_string()),
            Self::QueryBatteryCapacity => Ok("QBTAH".to_string()),
            Self::QueryOutletState { group } => {
                if !(1..=2).contains(group) {
                    return Err(format!("Outlet group {} must be 1 or 2", group));
                }
                Ok(format!("QSK{}", group))
            }

            Self::BuzzerToggle => Ok("BZOFF".to_string()),
            Self::BuzzerOn => Ok("BZON".to_string()),
            Self::BuzzerOff => Ok("BZOFF".to_string()),
            Self::TenSecondTest => Ok("T".to_string()),
            Self::CancelTest => Ok("CT".to_string()),
            Self::TestForMinutes(minutes) => {
                if *minutes < 1 || *minutes > 99 {
                    return Err(format!(
                        "Test duration {} minutes out of valid range (1-99m)",
                        minutes
                    ));
                }
                Ok(format!("T{:02}", minutes))
            }
            Self::TestUntilLow => Ok("TL".to_string()),

            Self::SetBypassHighVoltage(volts) => {
                if *volts < 180 || *volts > 280 {
                    return Err(format!("Bypass high voltage {}V out of range (180-280V)", volts));
                }
                Ok(format!("PHV{:03}", volts))
            }
            Self::SetBypassLowVoltage(volts) => {
                if *volts < 150 || *volts > 240 {
                    return Err(format!("Bypass low voltage {}V out of range (150-240V)", volts));
                }
                Ok(format!("PLV{:03}", volts))
            }
            Self::SetBypassHighFrequency(hz) => {
                check_range_f32("Bypass high frequency", *hz, 50.0, 65.0, "Hz")?;
                Ok(format!("PGF{:.1}", hz))
            }
            Self::SetBypassLowFrequency(hz) => {
                check_range_f32("Bypass low frequency", *hz, 40.0, 60.0, "Hz")?;
                Ok(format!("PSF{:.1}", hz))
            }
            Self::SetEcoHigh(volts) => {
                if *volts < 200 || *volts > 280 {
                    return Err(format!("ECO high threshold {}V out of range (200-280V)", volts));
                }
                Ok(format!("HEH{}", volts))
            }
            Self::SetEcoLow(volts) => {
                if *volts < 150 || *volts > 240 {
                    return Err(format!("ECO low threshold {}V out of range (150-240V)", volts));
                }
                Ok(format!("HEL{}", volts))
            }
            Self::SetMaxBackupMinutes(minutes) => {
                if *minutes < 1 || *minutes > 9999 {
                    return Err(format!(
                        "Max backup time {} minutes out of range (1-9999m)",
                        minutes
                    ));
                }
                Ok(format!("MD{:04}", minutes))
            }

            Self::ShutdownWithDelay { minutes } => {
                Ok(format!("S{}", format_shutdown_delay(*minutes)?))
            }
            Self::ShutdownAndRestore {
                minutes,
                restore_minutes,
            } => {
                if *restore_minutes < 1 || *restore_minutes > 9999 {
                    return Err(format!(
                        "Restore delay {} minutes out of range (1-9999m)",
                        restore_minutes
                    ));
                }
                Ok(format!(
                    "S{}R{:04}",
                    format_shutdown_delay(*minutes)?,
                    restore_minutes
                ))
            }
            Self::CancelShutdown => Ok("CS".to_string()),
            Self::OutputOn => Ok("SON".to_string()),
            Self::OutputOff => Ok("SOFF".to_string()),
            Self::OutletOn { group } => {
                if !(1..=2).contains(group) {
                    return Err(format!("Outlet group {} must be 1 or 2", group));
                }
                Ok(format!("SKON{}", group))
            }
            Self::OutletOff { group } => {
                if !(1..=2).contains(group) {
                    return Err(format!("Outlet group {} must be 1 or 2", group));
                }
                Ok(format!("SKOFF{}", group))
            }
        }
    }

    /// Whether this is strictly a non-modifying read command.
    pub fn is_read_only(&self) -> bool {
        self.required_stage() == UnlockStage::T1ReadOnly
    }
}
