//! Typed parsers for the P-series read-only queries documented in
//! `docs/protocol-spec.md`. Field layouts were established by disassembly of
//! the vendor monitor and cross-checked against live responses from a
//! Protocol 01 unit (e.g. `QBV` battery voltage equals `QGS` token 8).

use super::codec::ProtocolError;
use serde::{Deserialize, Serialize};

/// Strips framing (`\r`, NUL padding, whitespace) and the leading `(`.
/// A `(NAK` reply is reported as [`ProtocolError::CommandNak`].
fn payload(response: &str) -> Result<&str, ProtocolError> {
    let trimmed = response.trim_matches(|c: char| c.is_whitespace() || c == '\0');
    let body = trimmed
        .strip_prefix('(')
        .ok_or_else(|| ProtocolError::InvalidResponsePrefix(trimmed.to_string()))?;
    if body.eq_ignore_ascii_case("NAK") {
        return Err(ProtocolError::CommandNak);
    }
    Ok(body)
}

fn tokens<'a>(body: &'a str, min: usize, what: &str) -> Result<Vec<&'a str>, ProtocolError> {
    let parts: Vec<&str> = body.split_whitespace().collect();
    if parts.len() < min {
        return Err(ProtocolError::ParseError(format!(
            "{} expects at least {} tokens, got {}",
            what,
            min,
            parts.len()
        )));
    }
    Ok(parts)
}

fn num<T: std::str::FromStr>(tok: &str, what: &str) -> Result<T, ProtocolError> {
    tok.parse::<T>()
        .map_err(|_| ProtocolError::ParseError(format!("{}: invalid number '{}'", what, tok)))
}

/// Floats the unit reports as `---.-` when a sensor is absent become `None`.
fn opt_f32(tok: &str, what: &str) -> Result<Option<f32>, ProtocolError> {
    if tok.chars().all(|c| matches!(c, '-' | '.')) {
        Ok(None)
    } else {
        num(tok, what).map(Some)
    }
}

/// `QGS` general status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PGeneralStatus {
    pub input_voltage_v: f32,
    pub input_frequency_hz: f32,
    pub output_voltage_v: f32,
    pub output_frequency_hz: f32,
    pub output_current_a: f32,
    pub output_load_pct: u8,
    pub bus_positive_v: Option<f32>,
    pub bus_negative_v: Option<f32>,
    pub battery_voltage_v: Option<f32>,
    /// Token 9; meaning not identified (reports `---.-` on tested hardware).
    pub reserved_9: Option<f32>,
    pub temperature_c: Option<f32>,
    /// Raw status bit string (token 11); bit meanings not yet decoded.
    pub status_bits: String,
}

impl PGeneralStatus {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 12, "QGS")?;
        let load: u32 = num(p[5], "QGS load")?;
        if load > 255 {
            return Err(ProtocolError::ParseError(format!("QGS load {} out of range", load)));
        }
        if !p[11].chars().all(|c| c == '0' || c == '1') {
            return Err(ProtocolError::ParseError(format!(
                "QGS status bits must be binary, got '{}'",
                p[11]
            )));
        }
        Ok(Self {
            input_voltage_v: num(p[0], "QGS input voltage")?,
            input_frequency_hz: num(p[1], "QGS input frequency")?,
            output_voltage_v: num(p[2], "QGS output voltage")?,
            output_frequency_hz: num(p[3], "QGS output frequency")?,
            output_current_a: num(p[4], "QGS output current")?,
            output_load_pct: load as u8,
            bus_positive_v: opt_f32(p[6], "QGS bus+")?,
            bus_negative_v: opt_f32(p[7], "QGS bus-")?,
            battery_voltage_v: opt_f32(p[8], "QGS battery voltage")?,
            reserved_9: opt_f32(p[9], "QGS token 9")?,
            temperature_c: opt_f32(p[10], "QGS temperature")?,
            status_bits: p[11].to_string(),
        })
    }
}

/// `QBV` battery block.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PBatteryInfo {
    pub voltage_v: f32,
    pub batteries_in_series: u8,
    pub parallel_groups: u8,
    pub capacity_pct: u8,
    pub remaining_minutes: u32,
}

impl PBatteryInfo {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 5, "QBV")?;
        let capacity: u32 = num(p[3], "QBV capacity")?;
        if capacity > 100 {
            return Err(ProtocolError::ParseError(format!(
                "QBV capacity {}% out of range",
                capacity
            )));
        }
        Ok(Self {
            voltage_v: num(p[0], "QBV voltage")?,
            batteries_in_series: num(p[1], "QBV series count")?,
            parallel_groups: num(p[2], "QBV parallel groups")?,
            capacity_pct: capacity as u8,
            remaining_minutes: num(p[4], "QBV remaining minutes")?,
        })
    }
}

/// Two-value voltage window (`QBYV`, `QHE`): `(high low)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PVoltageWindow {
    pub high_v: u32,
    pub low_v: u32,
}

impl PVoltageWindow {
    pub fn parse(response: &str, what: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 2, what)?;
        let high: u32 = num(p[0], what)?;
        let low: u32 = num(p[1], what)?;
        if low > high {
            return Err(ProtocolError::ParseError(format!(
                "{}: low {} exceeds high {}",
                what, low, high
            )));
        }
        Ok(Self { high_v: high, low_v: low })
    }

    pub fn parse_qbyv(response: &str) -> Result<Self, ProtocolError> {
        Self::parse(response, "QBYV")
    }

    pub fn parse_qhe(response: &str) -> Result<Self, ProtocolError> {
        Self::parse(response, "QHE")
    }
}

/// `QBYF` bypass frequency window.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PFrequencyWindow {
    pub high_hz: f32,
    pub low_hz: f32,
}

impl PFrequencyWindow {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 2, "QBYF")?;
        let high: f32 = num(p[0], "QBYF high")?;
        let low: f32 = num(p[1], "QBYF low")?;
        if low > high {
            return Err(ProtocolError::ParseError(format!(
                "QBYF: low {} exceeds high {}",
                low, high
            )));
        }
        Ok(Self { high_hz: high, low_hz: low })
    }
}

/// `QRI` rating information.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PRating {
    pub rated_output_voltage_v: f32,
    pub rated_output_current_a: u32,
    pub battery_nominal_voltage_v: f32,
    pub rated_frequency_hz: f32,
}

impl PRating {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 4, "QRI")?;
        Ok(Self {
            rated_output_voltage_v: num(p[0], "QRI output voltage")?,
            rated_output_current_a: num(p[1], "QRI output current")?,
            battery_nominal_voltage_v: num(p[2], "QRI battery voltage")?,
            rated_frequency_hz: num(p[3], "QRI frequency")?,
        })
    }
}

/// `QMD` model descriptor. Padding `#` characters are removed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PModel {
    pub model_name: String,
    pub va_rating: u32,
    pub power_factor_pct: u32,
    pub phases: String,
    pub input_voltage_v: f32,
    pub output_voltage_v: f32,
    pub batteries_in_series: u32,
    pub battery_voltage_v: f32,
}

impl PModel {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let p = tokens(payload(response)?, 8, "QMD")?;
        let name = p[0].trim_matches('#');
        if name.is_empty() {
            return Err(ProtocolError::ParseError("QMD model name is empty".into()));
        }
        Ok(Self {
            model_name: name.to_string(),
            va_rating: num(p[1].trim_start_matches('#'), "QMD VA rating")?,
            power_factor_pct: num(p[2], "QMD power factor")?,
            phases: p[3].to_string(),
            input_voltage_v: num(p[4], "QMD input voltage")?,
            output_voltage_v: num(p[5], "QMD output voltage")?,
            batteries_in_series: num(p[6], "QMD battery count")?,
            battery_voltage_v: num(p[7], "QMD battery voltage")?,
        })
    }
}

/// `QFLAG` capability flags: letters after `E` are enabled, letters after `D`
/// are disabled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PFlags {
    pub enabled: Vec<char>,
    pub disabled: Vec<char>,
}

impl PFlags {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let body = payload(response)?;
        let rest = body
            .strip_prefix('E')
            .ok_or_else(|| ProtocolError::ParseError("QFLAG must start with 'E'".into()))?;
        let (en, dis) = match rest.find('D') {
            Some(i) => (&rest[..i], &rest[i + 1..]),
            None => (rest, ""),
        };
        let valid = |s: &str| s.chars().all(|c| c.is_ascii_alphabetic());
        if !valid(en) || !valid(dis) {
            return Err(ProtocolError::ParseError(format!("QFLAG invalid flags '{}'", body)));
        }
        Ok(Self {
            enabled: en.chars().collect(),
            disabled: dis.chars().collect(),
        })
    }

    pub fn is_enabled(&self, flag: char) -> bool {
        self.enabled.contains(&flag)
    }
}

/// `QMOD` working mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PWorkMode {
    PowerOn,
    Standby,
    Bypass,
    Line,
    Battery,
    BatteryTest,
    Fault,
    Eco,
    Converter,
    Shutdown,
}

impl PWorkMode {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let body = payload(response)?;
        let mut chars = body.chars();
        let letter = chars.next();
        if chars.next().is_some() {
            return Err(ProtocolError::ParseError(format!("QMOD expects one letter, got '{}'", body)));
        }
        match letter {
            Some('P') => Ok(Self::PowerOn),
            Some('S') => Ok(Self::Standby),
            Some('Y') => Ok(Self::Bypass),
            Some('L') => Ok(Self::Line),
            Some('B') => Ok(Self::Battery),
            Some('T') => Ok(Self::BatteryTest),
            Some('F') => Ok(Self::Fault),
            Some('E') => Ok(Self::Eco),
            Some('C') => Ok(Self::Converter),
            Some('D') => Ok(Self::Shutdown),
            other => Err(ProtocolError::ParseError(format!("QMOD unknown mode {:?}", other))),
        }
    }
}

/// `QWS` warning bit string. `active` holds the indices of set bits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PWarnings {
    pub bits: String,
    pub active: Vec<usize>,
}

impl PWarnings {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let body = payload(response)?;
        if body.is_empty() || body.len() > 128 || !body.chars().all(|c| c == '0' || c == '1') {
            return Err(ProtocolError::ParseError(format!("QWS invalid bit string '{}'", body)));
        }
        let active = body
            .chars()
            .enumerate()
            .filter(|(_, c)| *c == '1')
            .map(|(i, _)| i)
            .collect();
        Ok(Self { bits: body.to_string(), active })
    }
}

/// `QFS` fault status: `(OK` means no fault, anything else is returned raw.
pub fn parse_qfs(response: &str) -> Result<Option<String>, ProtocolError> {
    let body = payload(response)?;
    if body.eq_ignore_ascii_case("OK") {
        Ok(None)
    } else if body.is_empty() {
        Err(ProtocolError::ParseError("QFS empty payload".into()))
    } else {
        Ok(Some(body.to_string()))
    }
}

/// `QSK1`/`QSK2` outlet state. Units without switchable outlets answer
/// `(NAK`, surfaced as [`ProtocolError::CommandNak`].
pub fn parse_qsk(response: &str) -> Result<bool, ProtocolError> {
    match payload(response)? {
        "1" => Ok(true),
        "0" => Ok(false),
        other => Err(ProtocolError::ParseError(format!("QSK invalid state '{}'", other))),
    }
}
