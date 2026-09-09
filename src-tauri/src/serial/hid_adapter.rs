use crate::protocol::{decode_response, encode_command, ProtocolError};
use crate::serial::adapter::SerialTransport;
use hidapi::{HidApi, HidDevice};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Cross-platform USB HID transport for UPS devices (Voltronic, Cypress, Phoenixtec, Megatec, etc.).
/// Encapsulates HID communication over output and interrupt reports.
pub struct HidTransport {
    port_name: String,
    device: Arc<Mutex<HidDevice>>,
    timeout: Duration,
}

// Ensure HidTransport is Send
unsafe impl Send for HidTransport {}

impl HidTransport {
    /// Opens a HID device by vendor and product ID.
    pub fn open(vendor_id: u16, product_id: u16, port_name: &str) -> Result<Self, ProtocolError> {
        let api = HidApi::new().map_err(|e| {
            ProtocolError::IoError(format!("Failed to initialize HID API: {}", e))
        })?;

        let device = api.open(vendor_id, product_id).map_err(|e| {
            ProtocolError::IoError(format!(
                "Failed to open HID device {:04x}:{:04x} ({}): {}",
                vendor_id, product_id, port_name, e
            ))
        })?;

        Ok(Self {
            port_name: port_name.to_string(),
            device: Arc::new(Mutex::new(device)),
            timeout: Duration::from_millis(1500),
        })
    }

    /// Opens a HID device by its system device path.
    pub fn open_path(path: &std::ffi::CStr, port_name: &str) -> Result<Self, ProtocolError> {
        let api = HidApi::new().map_err(|e| {
            ProtocolError::IoError(format!("Failed to initialize HID API: {}", e))
        })?;

        let device = api.open_path(path).map_err(|e| {
            ProtocolError::IoError(format!(
                "Failed to open HID device path {:?} ({}): {}",
                path, port_name, e
            ))
        })?;

        Ok(Self {
            port_name: port_name.to_string(),
            device: Arc::new(Mutex::new(device)),
            timeout: Duration::from_millis(1500),
        })
    }

    /// Opens a device given a port identifier, such as "USB:0665:5161:..." or "USB:0665:5161".
    pub fn open_by_port_name(port_name: &str) -> Result<Self, ProtocolError> {
        let api = HidApi::new().map_err(|e| {
            ProtocolError::IoError(format!("Failed to initialize HID API: {}", e))
        })?;

        // Format is typically USB:VID:PID:... or USB:VID:PID:PATH_HEX
        let parts: Vec<&str> = port_name.split(':').collect();
        if parts.len() >= 3 && parts[0] == "USB" {
            let vid = u16::from_str_radix(parts[1], 16).map_err(|_| {
                ProtocolError::InvalidParameter(format!("Invalid Vendor ID in port: {}", port_name))
            })?;
            let pid = u16::from_str_radix(parts[2], 16).map_err(|_| {
                ProtocolError::InvalidParameter(format!("Invalid Product ID in port: {}", port_name))
            })?;

            // If a specific device path or serial match is available in device_list, prefer it
            for dev in api.device_list() {
                if dev.vendor_id() == vid && dev.product_id() == pid {
                    if parts.len() >= 4 {
                        let id_filter = parts[3].to_lowercase();
                        let dev_path = dev.path().to_string_lossy().to_lowercase();
                        let serial = dev
                            .serial_number()
                            .unwrap_or("")
                            .to_lowercase();
                        if !dev_path.contains(&id_filter) && !serial.contains(&id_filter) {
                            continue;
                        }
                    }

                    return Self::open_path(dev.path(), port_name);
                }
            }

            // Fallback: open first matching VID:PID
            return Self::open(vid, pid, port_name);
        }

        Err(ProtocolError::InvalidParameter(format!(
            "Unrecognized USB port name format: {}",
            port_name
        )))
    }
}

impl SerialTransport for HidTransport {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError> {
        let raw_cmd = encode_command(cmd_str);
        let dev = self.device.lock().unwrap();

        // Drain any stale input reports in buffer before sending new command
        let mut drain_buf = [0u8; 64];
        while dev.read_timeout(&mut drain_buf, 20).unwrap_or(0) > 0 {}

        // Send command in 8-byte chunks (standard Megatec/Voltronic USB HID chunk size)
        // With hidapi on Windows, prepending report ID 0x00 creates a 9-byte packet.
        for chunk in raw_cmd.chunks(8) {
            let mut report = [0u8; 9];
            report[0] = 0x00; // Report ID
            report[1..1 + chunk.len()].copy_from_slice(chunk);

            if let Err(e) = dev.write(&report) {
                // Fallback: attempt raw write if report ID 0 write failed
                dev.write(chunk).map_err(|e2| {
                    ProtocolError::IoError(format!(
                        "HID write error: {} (fallback error: {})",
                        e, e2
                    ))
                })?;
            }
        }

        // Read response chunks until '\r' or timeout
        let mut buffer = [0u8; 128];
        let mut total_read = 0;
        let start = std::time::Instant::now();
        let timeout_ms = self.timeout.as_millis() as i32;

        while start.elapsed() < self.timeout && total_read < buffer.len() {
            let mut chunk = [0u8; 64];
            let n = dev.read_timeout(&mut chunk, timeout_ms).map_err(|e| {
                ProtocolError::IoError(format!("HID read error: {}", e))
            })?;

            if n == 0 {
                // Read timed out
                break;
            }

            // Find if '\r' is present in the received bytes
            let mut end_found = false;
            let mut end_index = n;

            for (idx, &b) in chunk[..n].iter().enumerate() {
                if b == b'\r' {
                    end_found = true;
                    end_index = idx + 1; // Include '\r' for decode_response
                    break;
                }
            }

            let slice_to_add = &chunk[..end_index];
            let available_space = buffer.len() - total_read;
            let bytes_to_copy = slice_to_add.len().min(available_space);

            buffer[total_read..total_read + bytes_to_copy]
                .copy_from_slice(&slice_to_add[..bytes_to_copy]);
            total_read += bytes_to_copy;

            if end_found {
                break;
            }
        }

        if total_read == 0 {
            return Err(ProtocolError::Timeout);
        }

        // Trim any trailing null bytes that may exist in HID packets before decoding
        let mut clean_end = total_read;
        while clean_end > 0 && buffer[clean_end - 1] == 0 {
            clean_end -= 1;
        }

        decode_response(&buffer[..clean_end])
    }

    fn port_name(&self) -> &str {
        &self.port_name
    }
}

