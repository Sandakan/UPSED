use crate::protocol::ProtocolError;
use crate::serial::adapter::SerialTransport;
use crate::serial::hid_actor::{self, HidOpenTarget};
use std::time::Duration;

/// Cross-platform USB HID transport for UPS devices (Voltronic, Cypress, Phoenixtec, Megatec, etc.).
/// Encapsulates HID communication by delegating to the dedicated upsed-hid-actor thread,
/// guaranteeing single-thread affinity for IOKit / CFRunLoop and preventing PAC signature traps.
pub struct HidTransport {
    port_name: String,
    device_id: u64,
    timeout: Duration,
}

impl Drop for HidTransport {
    fn drop(&mut self) {
        hid_actor::close_device(self.device_id);
    }
}

impl HidTransport {
    /// Opens a HID device by vendor and product ID via the dedicated actor thread.
    pub fn open(vendor_id: u16, product_id: u16, port_name: &str) -> Result<Self, ProtocolError> {
        let device_id = hid_actor::open_device(HidOpenTarget::VidPid(vendor_id, product_id), port_name)?;
        Ok(Self {
            port_name: port_name.to_string(),
            device_id,
            timeout: Duration::from_millis(1500),
        })
    }

    /// Opens a HID device by its system device path via the dedicated actor thread.
    pub fn open_path(path: &std::ffi::CStr, port_name: &str) -> Result<Self, ProtocolError> {
        let device_id = hid_actor::open_device(HidOpenTarget::Path(path.to_owned()), port_name)?;
        Ok(Self {
            port_name: port_name.to_string(),
            device_id,
            timeout: Duration::from_millis(1500),
        })
    }

    /// Opens a device given a port identifier, such as "USB:0665:5161:..." or "USB:0665:5161",
    /// via the dedicated actor thread.
    pub fn open_by_port_name(port_name: &str) -> Result<Self, ProtocolError> {
        let device_id = hid_actor::open_device(HidOpenTarget::PortName(port_name.to_string()), port_name)?;
        Ok(Self {
            port_name: port_name.to_string(),
            device_id,
            timeout: Duration::from_millis(1500),
        })
    }
}

impl SerialTransport for HidTransport {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError> {
        hid_actor::send_command(self.device_id, &self.port_name, cmd_str, self.timeout)
    }

    fn port_name(&self) -> &str {
        &self.port_name
    }
}
