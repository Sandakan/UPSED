use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub protocol_id: String,
    pub supports_qpigs: bool,
    pub supports_qpiws: bool,
    pub supports_outlets: bool,
    pub supports_bypass_control: bool,
    pub supports_deep_battery_test: bool,
    pub supports_modbus: bool,
}

impl DeviceCapabilities {
    pub fn for_protocol(protocol_id: &str) -> Self {
        match protocol_id {
            "00" => Self {
                protocol_id: "P00".into(),
                supports_qpigs: false,
                supports_qpiws: true,
                supports_outlets: false,
                supports_bypass_control: false,
                supports_deep_battery_test: false,
                supports_modbus: false,
            },
            "02" => Self {
                protocol_id: "P02".into(),
                supports_qpigs: true,
                supports_qpiws: true,
                supports_outlets: true,
                supports_bypass_control: true,
                supports_deep_battery_test: true,
                supports_modbus: false,
            },
            "30" | "31" => Self {
                protocol_id: "P31".into(),
                supports_qpigs: true,
                supports_qpiws: true,
                supports_outlets: true,
                supports_bypass_control: true,
                supports_deep_battery_test: true,
                supports_modbus: true,
            },
            "TAURUS" => Self {
                protocol_id: "TAURUS".into(),
                supports_qpigs: true,
                supports_qpiws: true,
                supports_outlets: true,
                supports_bypass_control: true,
                supports_deep_battery_test: true,
                supports_modbus: true,
            },
            other => Self {
                protocol_id: format!("P{}", other),
                supports_qpigs: true,
                supports_qpiws: true,
                supports_outlets: false,
                supports_bypass_control: false,
                supports_deep_battery_test: false,
                supports_modbus: false,
            },
        }
    }
}

