use crate::protocol::{parse_device_id, parse_protocol_id, DeviceCapabilities};
use crate::serial::adapter::{PhysicalSerialPort, SerialTransport};
use crate::serial::hid_adapter::HidTransport;
use hidapi::{DeviceInfo, HidApi};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub port_name: String,
    pub protocol_id: String,
    pub serial_number: Option<String>,
    pub capabilities: DeviceCapabilities,
}

/// Known UPS vendor IDs and USB-to-serial bridge controllers used in the UPS industry.
const KNOWN_UPS_VENDOR_IDS: &[u16] = &[
    0x0665, // Cypress / Voltronic Power / Mecer / Mustek / Apollo
    0x06da, // Phoenixtec Power / Eaton / Powerware / Centralion
    0x05b8, // Sysgration
    0x0483, // STMicroelectronics
    0x0925, // Lakeview Research / Richcomm / Armac
    0x0f03, // Unitek UPS Systems
    0x14f0, // General Electric (GE)
    0x1a86, // QinHeng Electronics (CH340/CH341 / WinChipHead)
    0x1cb0, // Legrand
    0x04b4, // Cypress Semiconductor generic
    0x050d, // Belkin
    0x0001, // Generic / Unregistered OEM
    0xffff, // Generic / Unregistered OEM
];

/// Checks if a USB HID device is a candidate UPS device.
/// Evaluates standard USB HID Power Device usage pages, known vendor IDs, and descriptive device strings.
pub fn is_candidate_ups_hid(dev: &DeviceInfo) -> bool {
    let vid = dev.vendor_id();
    if KNOWN_UPS_VENDOR_IDS.contains(&vid) {
        return true;
    }

    // Standard USB HID Power Device & Battery System usage pages
    let usage_page = dev.usage_page();
    if usage_page == 0x0084 || usage_page == 0x0085 {
        return true;
    }

    // Vendor-defined usage pages (0xFF00..=0xFFFF) often used by proprietary UPS bridges
    if (0xff00..=0xffff).contains(&usage_page) {
        let prod = dev.product_string().unwrap_or("").to_lowercase();
        let mfr = dev.manufacturer_string().unwrap_or("").to_lowercase();
        if prod.contains("ups")
            || prod.contains("power")
            || prod.contains("inverter")
            || mfr.contains("ups")
            || mfr.contains("power")
            || mfr.contains("voltronic")
        {
            return true;
        }
    }

    // Check product and manufacturer strings for UPS keywords
    let prod = dev.product_string().unwrap_or("").to_lowercase();
    let mfr = dev.manufacturer_string().unwrap_or("").to_lowercase();
    const KEYWORDS: &[&str] = &[
        "ups",
        "inverter",
        "voltronic",
        "mustek",
        "mecer",
        "axpert",
        "powercom",
    ];

    for kw in KEYWORDS {
        if prod.contains(kw) || mfr.contains(kw) {
            return true;
        }
    }

    false
}

/// Extracts a clean identifier token from a HID device path or serial.
fn extract_hid_id(dev: &DeviceInfo) -> String {
    if let Some(sn) = dev.serial_number() {
        if !sn.trim().is_empty() {
            return sn.trim().to_uppercase();
        }
    }

    let path_str = dev.path().to_string_lossy();
    // Windows paths look like: "\\\\?\\HID#VID_0665&PID_5161#7&1d9528fa&0&0000#{guid}"
    let parts: Vec<&str> = path_str.split('#').collect();
    if parts.len() >= 3 {
        let instance_part = parts[2];
        let subparts: Vec<&str> = instance_part.split('&').collect();
        if subparts.len() >= 2 && !subparts[1].is_empty() {
            return subparts[1].to_uppercase(); // e.g. "1D9528FA"
        }
        return instance_part.replace('&', "_").to_uppercase();
    }

    format!("{:04X}", dev.product_id())
}

/// Safely probes a USB HID device using ONLY Stage T1 read-only queries (QPI, fallback Q1, and QID).
pub fn probe_hid_device(dev: &DeviceInfo) -> Option<DiscoveredDevice> {
    let id_str = extract_hid_id(dev);
    let port_name = format!(
        "USB:{:04X}:{:04X}:{}",
        dev.vendor_id(),
        dev.product_id(),
        id_str
    );

    let mut transport = HidTransport::open_path(dev.path(), &port_name).ok()?;

    // Step 1: Send ONLY QPI (Query Protocol ID)
    let protocol_id = match transport.send_command("QPI") {
        Ok(qpi_resp) => match parse_protocol_id(&qpi_resp) {
            Ok(pid) => pid,
            Err(_) => {
                // If response was not a valid protocol ID (e.g. stale telemetry in buffer), retry QPI once
                let qpi_retry = transport.send_command("QPI").ok()?;
                parse_protocol_id(&qpi_retry).ok()?
            }
        },
        Err(_) => {
            // Fallback for older Megatec P00 devices that do not implement QPI
            if let Ok(q1_resp) = transport.send_command("Q1") {
                if q1_resp.starts_with('(') {
                    "00".to_string()
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };

    // Step 2: Optionally query device serial number with QID (Read-only)
    let serial_number = transport
        .send_command("QID")
        .ok()
        .and_then(|r| parse_device_id(&r).ok());

    let capabilities = DeviceCapabilities::for_protocol(&protocol_id);

    Some(DiscoveredDevice {
        port_name,
        protocol_id,
        serial_number,
        capabilities,
    })
}

/// Scans connected USB HID devices for candidate UPS units.
pub fn scan_hid_devices() -> Vec<DiscoveredDevice> {
    let mut discovered = Vec::new();

    let api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!("Failed to initialize HID API during scan: {}", e);
            return discovered;
        }
    };

    for dev in api.device_list() {
        if is_candidate_ups_hid(dev) {
            if let Some(device) = probe_hid_device(dev) {
                // Avoid duplicates if multiple interface endpoints exist for same UPS
                if !discovered
                    .iter()
                    .any(|d: &DiscoveredDevice| d.port_name == device.port_name)
                {
                    tracing::info!(
                        "Discovered USB HID UPS on {} with protocol ID: {}",
                        device.port_name,
                        device.protocol_id
                    );
                    discovered.push(device);
                }
            }
        }
    }

    discovered
}

/// Safely probes a port (COM serial or USB HID) using ONLY Stage T1 read-only queries.
pub fn probe_port(port_name: &str) -> Option<DiscoveredDevice> {
    if port_name.starts_with("USB:") {
        let mut transport = HidTransport::open_by_port_name(port_name).ok()?;

        let protocol_id = match transport.send_command("QPI") {
            Ok(qpi_resp) => match parse_protocol_id(&qpi_resp) {
                Ok(pid) => pid,
                Err(_) => {
                    let qpi_retry = transport.send_command("QPI").ok()?;
                    parse_protocol_id(&qpi_retry).ok()?
                }
            },
            Err(_) => {
                if let Ok(q1_resp) = transport.send_command("Q1") {
                    if q1_resp.starts_with('(') {
                        "00".to_string()
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
        };

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

/// Scans all system serial ports and USB HID interfaces for connected Voltronic/Megatec UPS devices.
pub fn scan_available_ports() -> Vec<DiscoveredDevice> {
    let mut discovered = Vec::new();

    // 1. Scan serial COM ports
    if let Ok(ports) = serialport::available_ports() {
        for port_info in ports {
            if let Some(dev) = probe_port(&port_info.port_name) {
                tracing::info!(
                    "Discovered Voltronic UPS on serial {} with protocol ID: {}",
                    dev.port_name,
                    dev.protocol_id
                );
                discovered.push(dev);
            }
        }
    } else {
        tracing::warn!("Failed to enumerate serial ports");
    }

    // 2. Scan USB HID devices
    discovered.extend(scan_hid_devices());

    discovered
}
