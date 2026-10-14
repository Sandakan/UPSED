use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum UnlockStage {
    T1ReadOnly = 1,
    T2NonDestructive = 2,
    T3ConfigWrite = 3,
    T4PowerControl = 4,
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

    // Stage T2: Non-Destructive Actions (Low risk, temporary observable state)
    BuzzerToggle,
    TenSecondTest,
    CancelTest,
    TestForMinutes(u32),

    // Stage T3: Configuration Writes (Medium risk, alters persistent flash/EEPROM)
    SetChargeCurrentAmps(u32),
    SetBypassHighVoltage(u32),
    SetBypassLowVoltage(u32),
    SetBatteryLowShutdownVoltage(f32),

    // Stage T4: Power Control (High risk, controls live load output & shutdown)
    ShutdownWithDelay { minutes: f32 },
    CancelShutdown,
    OutletOn { group: u8, delay_minutes: u32 },
    OutletOff { group: u8, delay_minutes: u32 },
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
            | Self::QueryBatteryVoltage => UnlockStage::T1ReadOnly,

            Self::BuzzerToggle
            | Self::TenSecondTest
            | Self::CancelTest
            | Self::TestForMinutes(_) => UnlockStage::T2NonDestructive,

            Self::SetChargeCurrentAmps(_)
            | Self::SetBypassHighVoltage(_)
            | Self::SetBypassLowVoltage(_)
            | Self::SetBatteryLowShutdownVoltage(_) => UnlockStage::T3ConfigWrite,

            Self::ShutdownWithDelay { .. }
            | Self::CancelShutdown
            | Self::OutletOn { .. }
            | Self::OutletOff { .. } => UnlockStage::T4PowerControl,
        }
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

            Self::BuzzerToggle => Ok("Q".to_string()),
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

            Self::SetChargeCurrentAmps(amps) => {
                if *amps == 0 || *amps > 200 {
                    return Err(format!("Charge current {}A out of valid range (1-200A)", amps));
                }
                Ok(format!("MCHGC{:04}", amps))
            }
            Self::SetBypassHighVoltage(volts) => {
                if *volts < 180 || *volts > 280 {
                    return Err(format!("Bypass high voltage {}V out of range (180-280V)", volts));
                }
                Ok(format!("PBVH{:03}", volts))
            }
            Self::SetBypassLowVoltage(volts) => {
                if *volts < 150 || *volts > 240 {
                    return Err(format!("Bypass low voltage {}V out of range (150-240V)", volts));
                }
                Ok(format!("PBVL{:03}", volts))
            }
            Self::SetBatteryLowShutdownVoltage(volts) => {
                if *volts < 10.0 || *volts > 60.0 {
                    return Err(format!("Battery shutdown voltage {}V out of range (10-60V)", volts));
                }
                Ok(format!("PSDV{:.1}", volts))
            }

            Self::ShutdownWithDelay { minutes } => {
                if *minutes < 0.1 || *minutes > 99.0 {
                    return Err(format!("Shutdown delay {} minutes out of range (0.1-99m)", minutes));
                }
                let min_str = format!("{:.1}", minutes);
                let formatted = if min_str.starts_with("0.") {
                    &min_str[1..]
                } else {
                    &min_str
                };
                Ok(format!("S{}", formatted))
            }
            Self::CancelShutdown => Ok("CS".to_string()),
            Self::OutletOn { group, delay_minutes } => {
                if *group < 1 || *group > 3 {
                    return Err(format!("Outlet group {} must be 1, 2, or 3", group));
                }
                Ok(format!("OLON{},{}", group, delay_minutes))
            }
            Self::OutletOff { group, delay_minutes } => {
                if *group < 1 || *group > 3 {
                    return Err(format!("Outlet group {} must be 1, 2, or 3", group));
                }
                Ok(format!("OLOFF{},{}", group, delay_minutes))
            }
        }
    }

    /// Whether this is strictly a non-modifying read command.
    pub fn is_read_only(&self) -> bool {
        self.required_stage() == UnlockStage::T1ReadOnly
    }
}
