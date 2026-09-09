use crate::gate::CommandGate;
use crate::protocol::{Q1Status, ProtocolError, VoltronicCommand};
use crate::serial::{DiscoveredDevice, SerialTransport};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ConnectedUps {
    pub info: DiscoveredDevice,
    pub transport: Box<dyn SerialTransport>,
    pub last_status: Option<Q1Status>,
}

pub struct MultiPortManager {
    devices: Arc<Mutex<HashMap<String, ConnectedUps>>>,
}

impl Default for MultiPortManager {
    fn default() -> Self {
        Self {
            devices: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl MultiPortManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_device(&self, info: DiscoveredDevice, transport: Box<dyn SerialTransport>) {
        let mut devs = self.devices.lock().unwrap();
        let port_name = info.port_name.clone();
        devs.insert(
            port_name,
            ConnectedUps {
                info,
                transport,
                last_status: None,
            },
        );
    }

    pub fn unregister_device(&self, port_name: &str) -> Option<ConnectedUps> {
        let mut devs = self.devices.lock().unwrap();
        devs.remove(port_name)
    }

    pub fn list_devices(&self) -> Vec<DiscoveredDevice> {
        let devs = self.devices.lock().unwrap();
        devs.values().map(|d| d.info.clone()).collect()
    }

    pub fn is_connected(&self, port_name: &str) -> bool {
        let devs = self.devices.lock().unwrap();
        devs.contains_key(port_name)
    }

    pub fn poll_device(&self, port_name: &str) -> Result<Q1Status, ProtocolError> {
        let mut devs = self.devices.lock().unwrap();
        let device = devs
            .get_mut(port_name)
            .ok_or_else(|| ProtocolError::DeviceError(format!("Device on {} not found", port_name)))?;

        // Q1 is safe read-only query
        let cmd_str = VoltronicCommand::QuickStatus
            .as_cmd_str()
            .map_err(|e| ProtocolError::EncodingError(e))?;

        let raw_resp = device.transport.send_command(&cmd_str)?;
        let status = Q1Status::parse(&raw_resp)?;
        device.last_status = Some(status.clone());

        Ok(status)
    }

    pub fn execute_gated_command(
        &self,
        port_name: &str,
        cmd: &VoltronicCommand,
        gate: &CommandGate,
    ) -> Result<String, ProtocolError> {
        // Step 1: Check safety gate
        gate.check_command(cmd)
            .map_err(|e| ProtocolError::DeviceError(e.to_string()))?;

        // Step 2: Validate command payload
        let cmd_str = cmd.as_cmd_str().map_err(|e| ProtocolError::EncodingError(e))?;

        // Step 3: Dispatch to specific hardware port
        let mut devs = self.devices.lock().unwrap();
        let device = devs
            .get_mut(port_name)
            .ok_or_else(|| ProtocolError::DeviceError(format!("Device on {} not found", port_name)))?;

        device.transport.send_command(&cmd_str)
    }
}

