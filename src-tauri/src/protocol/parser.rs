use super::codec::ProtocolError;
use serde::{Deserialize, Serialize};

/// Parsed telemetry from the `Q1` command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Q1Status {
    pub grid_voltage_v: f32,
    pub grid_frequency_hz: f32,
    pub output_voltage_v: f32,
    pub output_frequency_hz: f32,
    pub output_load_pct: u32,
    pub output_watts: u32,
    pub battery_voltage_v: f32,
    pub temperature_c: i32,
    pub utility_fail: bool,
    pub battery_low: bool,
    pub bypass_active: bool,
    pub ups_failed: bool,
    pub raw_status_bits: String,
}

impl Q1Status {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let content = response.strip_prefix('(').ok_or_else(|| {
            ProtocolError::ParseError("Q1 response must start with '('".into())
        })?;

        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() < 8 {
            return Err(ProtocolError::ParseError(format!(
                "Q1 response has too few tokens: expected at least 8, got {}",
                parts.len()
            )));
        }

        let grid_v: f32 = parts[0]
            .parse()
            .map_err(|e| ProtocolError::ParseError(format!("Invalid grid voltage: {}", e)))?;
        let grid_f: f32 = parts[1]
            .parse()
            .map_err(|e| ProtocolError::ParseError(format!("Invalid grid frequency: {}", e)))?;
        let out_v: f32 = parts[2]
            .parse()
            .map_err(|e| ProtocolError::ParseError(format!("Invalid output voltage: {}", e)))?;
        let out_f: f32 = parts[3]
            .parse()
            .map_err(|e| ProtocolError::ParseError(format!("Invalid output frequency: {}", e)))?;
        let out_load: u32 = parts[4]
            .parse()
            .map_err(|e| ProtocolError::ParseError(format!("Invalid output load: {}", e)))?;

        // Format variation: some models output watts then bat_v, or bat_v directly
        let (out_watts, bat_v, temp_c, bits_idx) = if parts.len() >= 9 {
            let watts = parts[5].parse().unwrap_or(0);
            let bat = parts[6]
                .parse()
                .map_err(|e| ProtocolError::ParseError(format!("Invalid battery voltage: {}", e)))?;
            let temp = parts[7].parse().unwrap_or(25);
            (watts, bat, temp, 8)
        } else {
            let bat = parts[5]
                .parse()
                .map_err(|e| ProtocolError::ParseError(format!("Invalid battery voltage: {}", e)))?;
            let temp = parts[6].parse().unwrap_or(25);
            (0, bat, temp, 7)
        };

        let status_bits = if bits_idx < parts.len() {
            parts[bits_idx].to_string()
        } else {
            "00000000".to_string()
        };

        // Parse status bits (bit 7: utility fail, bit 6: battery low, bit 5: bypass, bit 4: failed)
        let bytes = status_bits.as_bytes();
        let utility_fail = bytes.first().copied().unwrap_or(b'0') == b'1';
        let battery_low = bytes.get(1).copied().unwrap_or(b'0') == b'1';
        let bypass_active = bytes.get(2).copied().unwrap_or(b'0') == b'1';
        let ups_failed = bytes.get(3).copied().unwrap_or(b'0') == b'1';

        Ok(Self {
            grid_voltage_v: grid_v,
            grid_frequency_hz: grid_f,
            output_voltage_v: out_v,
            output_frequency_hz: out_f,
            output_load_pct: out_load,
            output_watts: out_watts,
            battery_voltage_v: bat_v,
            temperature_c: temp_c,
            utility_fail,
            battery_low,
            bypass_active,
            ups_failed,
            raw_status_bits: status_bits,
        })
    }
}

/// Parsed response from `QPIGS` (General Status query on newer protocol variants).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QpigsStatus {
    pub grid_voltage_v: f32,
    pub grid_frequency_hz: f32,
    pub output_voltage_v: f32,
    pub output_frequency_hz: f32,
    pub output_apparent_power_va: u32,
    pub output_active_power_w: u32,
    pub output_load_pct: u32,
    pub bus_voltage_v: u32,
    pub battery_voltage_v: f32,
    pub battery_charge_current_a: u32,
    pub battery_capacity_pct: u32,
    pub heatsink_temp_c: i32,
}

impl QpigsStatus {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let content = response.strip_prefix('(').ok_or_else(|| {
            ProtocolError::ParseError("QPIGS response must start with '('".into())
        })?;

        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() < 11 {
            return Err(ProtocolError::ParseError(format!(
                "QPIGS response expects at least 11 tokens, got {}",
                parts.len()
            )));
        }

        Ok(Self {
            grid_voltage_v: parts[0].parse().unwrap_or(0.0),
            grid_frequency_hz: parts[1].parse().unwrap_or(0.0),
            output_voltage_v: parts[2].parse().unwrap_or(0.0),
            output_frequency_hz: parts[3].parse().unwrap_or(0.0),
            output_apparent_power_va: parts[4].parse().unwrap_or(0),
            output_active_power_w: parts[5].parse().unwrap_or(0),
            output_load_pct: parts[6].parse().unwrap_or(0),
            bus_voltage_v: parts[7].parse().unwrap_or(0),
            battery_voltage_v: parts[8].parse().unwrap_or(0.0),
            battery_charge_current_a: parts[9].parse().unwrap_or(0),
            battery_capacity_pct: parts[10].parse().unwrap_or(0),
            heatsink_temp_c: parts.get(11).and_then(|p| p.parse().ok()).unwrap_or(25),
        })
    }
}

/// Parsed warning bits from `QPIWS`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct QpiwsWarnings {
    pub inverter_fault: bool,
    pub bus_over_fault: bool,
    pub bus_under_fault: bool,
    pub bus_soft_fail: bool,
    pub line_fail: bool,
    pub opvshort: bool,
    pub inverter_voltage_too_low: bool,
    pub inverter_voltage_too_high: bool,
    pub over_temperature: bool,
    pub fan_locked: bool,
    pub battery_voltage_high: bool,
    pub battery_low: bool,
    pub battery_under: bool,
    pub overload: bool,
    pub eeprom_fault: bool,
    pub raw_bits: String,
}

impl QpiwsWarnings {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let content = response.strip_prefix('(').ok_or_else(|| {
            ProtocolError::ParseError("QPIWS response must start with '('".into())
        })?;

        let chars: Vec<char> = content.trim().chars().collect();
        let get_bit = |idx: usize| chars.get(idx).copied().unwrap_or('0') == '1';

        Ok(Self {
            inverter_fault: get_bit(0),
            bus_over_fault: get_bit(1),
            bus_under_fault: get_bit(2),
            bus_soft_fail: get_bit(3),
            line_fail: get_bit(4),
            opvshort: get_bit(5),
            inverter_voltage_too_low: get_bit(6),
            inverter_voltage_too_high: get_bit(7),
            over_temperature: get_bit(8),
            fan_locked: get_bit(9),
            battery_voltage_high: get_bit(10),
            battery_low: get_bit(11),
            battery_under: get_bit(12),
            overload: get_bit(13),
            eeprom_fault: get_bit(14),
            raw_bits: content.trim().to_string(),
        })
    }
}

/// Parsed rating parameters from `QPIRI`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QpiriRatings {
    pub rated_grid_voltage_v: f32,
    pub rated_grid_current_a: f32,
    pub rated_output_voltage_v: f32,
    pub rated_output_frequency_hz: f32,
    pub rated_output_current_a: f32,
    pub rated_output_apparent_power_va: u32,
    pub rated_output_active_power_w: u32,
    pub rated_battery_voltage_v: f32,
    pub max_charge_current_a: u32,
}

impl QpiriRatings {
    pub fn parse(response: &str) -> Result<Self, ProtocolError> {
        let content = response.strip_prefix('(').ok_or_else(|| {
            ProtocolError::ParseError("QPIRI response must start with '('".into())
        })?;

        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() < 7 {
            return Err(ProtocolError::ParseError(format!(
                "QPIRI response requires at least 7 fields, got {}",
                parts.len()
            )));
        }

        Ok(Self {
            rated_grid_voltage_v: parts[0].parse().unwrap_or(230.0),
            rated_grid_current_a: parts[1].parse().unwrap_or(21.7),
            rated_output_voltage_v: parts[2].parse().unwrap_or(230.0),
            rated_output_frequency_hz: parts[3].parse().unwrap_or(50.0),
            rated_output_current_a: parts[4].parse().unwrap_or(21.7),
            rated_output_apparent_power_va: parts[5].parse().unwrap_or(5000),
            rated_output_active_power_w: parts[6].parse().unwrap_or(5000),
            rated_battery_voltage_v: parts.get(7).and_then(|p| p.parse().ok()).unwrap_or(48.0),
            max_charge_current_a: parts.get(9).and_then(|p| p.parse().ok()).unwrap_or(60),
        })
    }
}

/// Parses the Protocol ID from `QPI`.
pub fn parse_protocol_id(response: &str) -> Result<String, ProtocolError> {
    let content = response.strip_prefix('(').ok_or_else(|| {
        ProtocolError::ParseError("QPI response must start with '('".into())
    })?;

    if let Some(id) = content.strip_prefix("PI") {
        Ok(id.trim().to_string())
    } else {
        Ok(content.trim().to_string())
    }
}

/// Parses the Device Serial Number from `QID`.
pub fn parse_device_id(response: &str) -> Result<String, ProtocolError> {
    let content = response.strip_prefix('(').ok_or_else(|| {
        ProtocolError::ParseError("QID response must start with '('".into())
    })?;
    Ok(content.trim().to_string())
}

/// Parses Firmware Version from `QVFW`.
pub fn parse_firmware_version(response: &str) -> Result<String, ProtocolError> {
    let content = response.strip_prefix('(').ok_or_else(|| {
        ProtocolError::ParseError("QVFW response must start with '('".into())
    })?;

    if let Some(fw) = content.strip_prefix("VERFW:") {
        Ok(fw.trim().to_string())
    } else {
        Ok(content.trim().to_string())
    }
}
