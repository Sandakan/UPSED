use crate::protocol::{parse_device_id, parse_protocol_id, DeviceCapabilities};
use crate::serial::adapter::{PhysicalSerialPort, SerialTransport};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub port_name: String,
    pub protocol_id: String,
    pub serial_number: Option<String>,
    pub capabilities: DeviceCapabilities,
}

/// Safely probes a serial port using ONLY Stage T1 read-only queries (QPI and QID).
/// Guaranteed to never send write or configuration commands during discovery.
pub fn probe_port(port_name: &str) -> Option<DiscoveredDevice> {
    let baud_rates = [2400, 9600];

    for baud in baud_rates {
        let mut transport = match PhysicalSerialPort::open(port_name, baud) {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Step 1: Send ONLY QPI (Query Protocol ID)
        let qpi_resp = match transport.send_command("QPI") {
            Ok(r) => r,
            Err(_) => continue,
        };

        let protocol_id = match parse_protocol_id(&qpi_resp) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // Step 2: Optionally query device serial number with QID (Read-only)
        let serial_number = transport
            .send_command("QID")
            .ok()
            .and_then(|r| parse_device_id(&r).ok());

        let capabilities = DeviceCapabilities::for_protocol(&protocol_id);

        return Some(DiscoveredDevice {
            port_name: port_name.to_string(),
            protocol_id,
            serial_number,
            capabilities,
        });
    }

    None
}

/// Scans all system serial ports for connected Voltronic UPS devices.
pub fn scan_available_ports() -> Vec<DiscoveredDevice> {
    let mut discovered = Vec::new();
    let ports = match serialport::available_ports() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Failed to enumerate serial ports: {}", e);
            return discovered;
        }
    };

    for port_info in ports {
        if let Some(dev) = probe_port(&port_info.port_name) {
            tracing::info!(
                "Discovered Voltronic UPS on {} with protocol ID: {}",
                dev.port_name,
                dev.protocol_id
            );
            discovered.push(dev);
        }
    }

    discovered
}
