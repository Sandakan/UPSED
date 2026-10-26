use crate::protocol::{
    parse_device_id, parse_firmware_version, parse_protocol_id, DeviceCapabilities, Q1Status,
};
use crate::serial::adapter::{PhysicalSerialPort, SerialTransport};
use crate::serial::hid_adapter::HidTransport;
use hidapi::DeviceInfo;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub port_name: String,
    pub protocol_id: String,
    pub serial_number: Option<String>,
    pub unique_id: String,
    pub firmware_version: Option<String>,
    pub usb_uuid: Option<String>,
    pub bridge_mac: Option<String>,
    pub hardware_signature: Option<String>,
    pub capabilities: DeviceCapabilities,
}

pub fn compute_hardware_signature(
    protocol_id: &str,
    battery_voltage_v: Option<f32>,
    rated_va: Option<u32>,
) -> String {
    let proto = if protocol_id.is_empty() { "00" } else { protocol_id };
    let nominal_v = match battery_voltage_v {
        Some(v) if v > 0.0 => {
            if v < 16.0 {
                12
            } else if v < 32.0 {
                24
            } else if v < 44.0 {
                36
            } else if v < 64.0 {
                48
            } else if v < 120.0 {
                96
            } else {
                192
            }
        }
        _ => 24,
    };
    match rated_va {
        Some(va) if va > 0 => format!("P{}:{}V:{}VA", proto, nominal_v, va),
        _ => format!("P{}:{}V", proto, nominal_v),
    }
}

/// Derives a deterministic unique identifier for a UPS unit.
/// Primary: Hardware serial number returned from Stage T1 `QID\r`.
/// Fallback: Hardware port / USB instance ID combined with firmware version from `QVFW\r`.
pub fn generate_unique_id(
    serial_number: Option<&str>,
    port_or_instance_id: &str,
    firmware_version: Option<&str>,
) -> String {
    if let Some(sn) = serial_number {
        let clean = sn.trim();
        if clean.len() >= 4 && clean.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return format!("QID-{}", clean.to_uppercase());
        }
    }

    let fw_part = firmware_version
        .map(|f| f.trim().replace(|c: char| !c.is_alphanumeric(), "_"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "GENERIC".to_string());

    let clean_inst = port_or_instance_id
        .trim()
        .replace(|c: char| !c.is_alphanumeric() && c != ':', "_");
    format!("{}-FW-{}", clean_inst, fw_part)
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
pub fn extract_hid_id(dev: &DeviceInfo) -> String {
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

/// Resolves the physical USB UUID / instance ID for a port (HID path or Serial USB PNP/Serial).
pub fn get_port_usb_uuid(port_name: &str) -> Option<String> {
    if port_name.starts_with("USB:") {
        super::hid_actor::resolve_usb_uuid(port_name)
    } else if let Ok(ports) = serialport::available_ports() {
        for p in ports {
            if p.port_name == port_name {
                if let serialport::SerialPortType::UsbPort(usb) = p.port_type {
                    return usb
                        .serial_number
                        .or_else(|| Some(format!("USB\\VID_{:04X}&PID_{:04X}", usb.vid, usb.pid)));
                }
            }
        }
        None
    } else {
        None
    }
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

    let path_str = dev.path().to_string_lossy().to_string();
    let usb_uuid = if !path_str.is_empty() {
        Some(path_str)
    } else {
        dev.serial_number().map(|s| s.to_string())
    };

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

    // Step 2: Query device serial number with QID (Read-only)
    let serial_number = transport
        .send_command("QID")
        .ok()
        .and_then(|r| parse_device_id(&r).ok());

    // Step 3: Query firmware version with QVFW (Read-only)
    let firmware_version = transport
        .send_command("QVFW")
        .ok()
        .and_then(|r| parse_firmware_version(&r).ok());

    let unique_id = generate_unique_id(
        serial_number.as_deref(),
        &port_name,
        firmware_version.as_deref(),
    );

    let battery_v = transport
        .send_command("Q1")
        .ok()
        .and_then(|r| Q1Status::parse(&r).ok())
        .map(|s| s.battery_voltage_v);
    let hardware_signature = Some(compute_hardware_signature(&protocol_id, battery_v, None));

    let capabilities = DeviceCapabilities::for_protocol(&protocol_id);

    Some(DiscoveredDevice {
        port_name,
        protocol_id,
        serial_number,
        unique_id,
        firmware_version,
        usb_uuid,
        bridge_mac: None,
        hardware_signature,
        capabilities,
    })
}

/// Safely probes an ESP32 Hardware Bridge (`BRIDGE:COMx` or `BRIDGE:WS:...`) using Stage T1 read-only queries.
fn probe_via_bridge(bridge_port_id: &str, fallback_ws_host: Option<&str>) -> Option<DiscoveredDevice> {
    let mut transport = super::bridge_adapter::BridgeTransport::open(bridge_port_id, fallback_ws_host.map(|s| s.to_string())).ok()?;

    let protocol_id = match transport.send_command("QPI") {
        Ok(qpi_resp) => parse_protocol_id(&qpi_resp).unwrap_or_else(|_| "00".to_string()),
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

    let firmware_version = transport
        .send_command("QVFW")
        .ok()
        .and_then(|r| parse_firmware_version(&r).ok());

    let bridge_mac = transport.bridge_mac();
    let unique_id = if let Some(sn) = serial_number.as_deref() {
        generate_unique_id(Some(sn), bridge_port_id, firmware_version.as_deref())
    } else if let Some(mac) = bridge_mac.as_deref() {
        let clean_mac = mac.replace(|c: char| !c.is_alphanumeric(), "").to_uppercase();
        format!("BRIDGE-MAC-{}", clean_mac)
    } else {
        generate_unique_id(
            None,
            bridge_port_id,
            firmware_version.as_deref(),
        )
    };

    let battery_v = transport
        .send_command("Q1")
        .ok()
        .and_then(|r| Q1Status::parse(&r).ok())
        .map(|s| s.battery_voltage_v);
    let hardware_signature = Some(compute_hardware_signature(&protocol_id, battery_v, None));

    let capabilities = DeviceCapabilities::for_protocol(&protocol_id);
    let raw_com = bridge_port_id.strip_prefix("BRIDGE:").unwrap_or(bridge_port_id);
    let usb_uuid = get_port_usb_uuid(raw_com);

    Some(DiscoveredDevice {
        port_name: bridge_port_id.to_string(),
        protocol_id,
        serial_number,
        unique_id,
        firmware_version,
        usb_uuid,
        bridge_mac,
        hardware_signature,
        capabilities,
    })
}

/// Safely probes a port (ESP32 Bridge, COM serial, or USB HID) using ONLY Stage T1 read-only queries.
pub fn probe_port(port_name: &str) -> Option<DiscoveredDevice> {
    probe_port_internal(port_name, None)
}

pub fn probe_port_internal(port_name: &str, fallback_ws_host: Option<&str>) -> Option<DiscoveredDevice> {
    if port_name.starts_with("BRIDGE:") {
        return probe_via_bridge(port_name, fallback_ws_host);
    }

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

        let firmware_version = transport
            .send_command("QVFW")
            .ok()
            .and_then(|r| parse_firmware_version(&r).ok());

        let unique_id = generate_unique_id(
            serial_number.as_deref(),
            port_name,
            firmware_version.as_deref(),
        );

        let battery_v = transport
            .send_command("Q1")
            .ok()
            .and_then(|r| Q1Status::parse(&r).ok())
            .map(|s| s.battery_voltage_v);
        let hardware_signature = Some(compute_hardware_signature(&protocol_id, battery_v, None));

        let capabilities = DeviceCapabilities::for_protocol(&protocol_id);
        let usb_uuid = get_port_usb_uuid(port_name);

        return Some(DiscoveredDevice {
            port_name: port_name.to_string(),
            protocol_id,
            serial_number,
            unique_id,
            firmware_version,
            usb_uuid,
            bridge_mac: None,
            hardware_signature,
            capabilities,
        });
    }

    // Check if this COM port is an ESP32 UPSED Bridge at 115200 baud
    if super::bridge_adapter::probe_serial_bridge(port_name).is_some() {
        let bridge_id = format!("BRIDGE:{}", port_name);
        if let Some(dev) = probe_via_bridge(&bridge_id, fallback_ws_host) {
            return Some(dev);
        }
    }

    let baud_rates = [2400, 9600];

    for baud in baud_rates {
        let mut transport = match PhysicalSerialPort::open(port_name, baud) {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Step 1: Send Stage T1 QPI, with fallback to Stage T1 Q1 for Megatec/P01 RS-232 UPS units
        let protocol_id = match transport.send_command("QPI") {
            Ok(qpi_resp) => match parse_protocol_id(&qpi_resp) {
                Ok(id) => id,
                Err(_) => continue,
            },
            Err(_) => {
                if let Ok(q1_resp) = transport.send_command("Q1") {
                    if q1_resp.starts_with('(') {
                        "00".to_string()
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }
        };

        // Step 2: Query device serial number with QID (Read-only)
        let serial_number = transport
            .send_command("QID")
            .ok()
            .and_then(|r| parse_device_id(&r).ok());

        // Step 3: Query firmware version with QVFW (Read-only)
        let firmware_version = transport
            .send_command("QVFW")
            .ok()
            .and_then(|r| parse_firmware_version(&r).ok());

        let unique_id = generate_unique_id(
            serial_number.as_deref(),
            port_name,
            firmware_version.as_deref(),
        );

        let battery_v = transport
            .send_command("Q1")
            .ok()
            .and_then(|r| Q1Status::parse(&r).ok())
            .map(|s| s.battery_voltage_v);
        let hardware_signature = Some(compute_hardware_signature(&protocol_id, battery_v, None));

        let capabilities = DeviceCapabilities::for_protocol(&protocol_id);
        let usb_uuid = get_port_usb_uuid(port_name);

        return Some(DiscoveredDevice {
            port_name: port_name.to_string(),
            protocol_id,
            serial_number,
            unique_id,
            firmware_version,
            usb_uuid,
            bridge_mac: None,
            hardware_signature,
            capabilities,
        });
    }

    None
}

/// Scans all system serial ports, USB HID interfaces, and mDNS WebSocket bridges for connected UPS devices.
/// Takes active manager devices to prevent port contention ("Access is denied" os error 5) and avoids probing busy ports.
pub fn scan_available_ports_with_context(
    active_devices: &[DiscoveredDevice],
    fallback_ws_host: Option<&str>,
) -> Vec<DiscoveredDevice> {
    static SCAN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _scan_guard = SCAN_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let mut discovered = Vec::new();
    let mut found_usb_bridge = false;

    // 1. Re-use already active connected devices
    for dev in active_devices {
        if dev.port_name.starts_with("BRIDGE:") {
            found_usb_bridge = true;
        }
        discovered.push(dev.clone());
    }

    // 2. Scan serial COM ports (including USB-connected ESP32 Bridges)
    if let Ok(ports) = serialport::available_ports() {
        for port_info in ports {
            let port_uuid = get_port_usb_uuid(&port_info.port_name);
            let is_already_active = active_devices.iter().any(|d| {
                d.port_name == port_info.port_name
                    || d.port_name == format!("BRIDGE:{}", port_info.port_name)
                    || (port_uuid.is_some() && d.usb_uuid.is_some() && d.usb_uuid == port_uuid)
            });
            if is_already_active {
                continue;
            }

            if let Some(dev) = probe_port_internal(&port_info.port_name, fallback_ws_host) {
                let is_duplicate = active_devices.iter().any(|d| {
                    (d.bridge_mac.is_some() && d.bridge_mac == dev.bridge_mac)
                        || d.unique_id == dev.unique_id
                }) || discovered.iter().any(|d| {
                    (d.bridge_mac.is_some() && d.bridge_mac == dev.bridge_mac)
                        || d.unique_id == dev.unique_id
                });

                if is_duplicate {
                    tracing::debug!(
                        "Skipping duplicate bridge device on {} (already active via another transport)",
                        dev.port_name
                    );
                    continue;
                }

                if dev.port_name.starts_with("BRIDGE:") {
                    found_usb_bridge = true;
                }
                tracing::info!(
                    "Discovered Voltronic UPS on {} with protocol ID: {}",
                    dev.port_name,
                    dev.protocol_id
                );
                discovered.push(dev);
            }
        }
    } else {
        tracing::warn!("Failed to enumerate serial ports");
    }

    // 3. Scan USB HID devices via dedicated actor thread
    let active_ports: Vec<String> = active_devices.iter().map(|d| d.port_name.clone()).collect();
    for dev in super::hid_actor::scan_hid_devices(&active_ports) {
        if !discovered.iter().any(|d| d.port_name == dev.port_name) {
            discovered.push(dev);
        }
    }

    // 4. If no USB-tethered ESP32 Bridge was found, probe WebSocket bridges (fallback IP then mDNS)
    if !found_usb_bridge {
        let mut candidate_hosts = Vec::new();
        if let Some(fb) = fallback_ws_host {
            let clean = fb.trim();
            if !clean.is_empty() && clean != super::bridge_adapter::BRIDGE_DEFAULT_MDNS_HOST {
                candidate_hosts.push(clean);
            }
        }
        candidate_hosts.push(super::bridge_adapter::BRIDGE_DEFAULT_MDNS_HOST);

        let mut found_ws = false;
        for host in candidate_hosts {
            let is_already_active = active_devices.iter().any(|d| d.port_name.contains(host));
            if is_already_active {
                found_ws = true;
                break;
            }

            if let Some((ws_port_id, _status)) = super::bridge_adapter::probe_ws_bridge(host) {
                if let Some(dev) = probe_via_bridge(&ws_port_id, fallback_ws_host) {
                    tracing::info!(
                        "Discovered Wi-Fi WebSocket ESP32 Bridge on {} with protocol ID: {}",
                        dev.port_name,
                        dev.protocol_id
                    );
                    discovered.push(dev);
                    found_ws = true;
                    break;
                }
            }
        }

        // Tier 3: If candidate hosts failed, do parallel LAN subnet sweep
        if !found_ws {
            for (ws_port_id, _status) in super::bridge_adapter::scan_lan_for_bridge() {
                let is_already_active = active_devices.iter().any(|d| d.port_name == ws_port_id);
                if !is_already_active {
                    if let Some(dev) = probe_via_bridge(&ws_port_id, fallback_ws_host) {
                        tracing::info!(
                            "Discovered Wi-Fi WebSocket ESP32 Bridge via LAN sweep on {} with protocol ID: {}",
                            dev.port_name,
                            dev.protocol_id
                        );
                        discovered.push(dev);
                        break;
                    }
                }
            }
        }
    }

    discovered
}

/// Scans all system serial ports, USB HID interfaces, and mDNS WebSocket bridges for connected UPS devices.
pub fn scan_available_ports() -> Vec<DiscoveredDevice> {
    scan_available_ports_with_context(&[], None)
}

