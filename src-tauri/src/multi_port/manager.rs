use crate::gate::CommandGate;
use crate::protocol::{ProtocolError, Q1Status, QpigsStatus, VoltronicCommand};
use crate::serial::{DiscoveredDevice, SerialTransport};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ConnectedUps {
    pub info: DiscoveredDevice,
    pub transport: Arc<Mutex<Box<dyn SerialTransport>>>,
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
                transport: Arc::new(Mutex::new(transport)),
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

    pub fn get_last_status(&self, port_name: &str) -> Option<Q1Status> {
        let devs = self.devices.lock().unwrap();
        devs.get(port_name).and_then(|d| d.last_status.clone())
    }

    pub fn poll_device(&self, port_name: &str) -> Result<Q1Status, ProtocolError> {
        let (proto, transport_arc) = {
            let devs = self.devices.lock().unwrap();
            let device = devs.get(port_name).ok_or_else(|| {
                tracing::error!(
                    "Device on {} not found in active manager registry",
                    port_name
                );
                ProtocolError::DeviceError(format!("Device on {} not found", port_name))
            })?;
            (device.info.protocol_id.clone(), Arc::clone(&device.transport))
        };

        tracing::info!(
            "Polling telemetry for device {} (protocol: {})",
            port_name,
            proto
        );

        // Protocol-aware command priority:
        // Universal Megatec / Voltronic Online P01 units support "Q1" directly
        // Axpert / InfiniSolar P30/P31 units use "QPIGS"
        // Legacy Megatec P00 units use "Q1"
        let query_order: Vec<VoltronicCommand> = if proto == "01" || proto == "P01" || proto == "00" {
            vec![VoltronicCommand::QuickStatus]
        } else if proto == "30" || proto == "31" || proto == "P30" || proto == "P31" {
            vec![
                VoltronicCommand::QueryGeneralStatus,
                VoltronicCommand::QuickStatus,
                VoltronicCommand::QueryStatusQs,
            ]
        } else {
            vec![
                VoltronicCommand::QuickStatus,
                VoltronicCommand::QueryStatusQs,
                VoltronicCommand::QueryGeneralStatus,
            ]
        };

        let mut transport = transport_arc.lock().map_err(|_| {
            ProtocolError::DeviceError("Transport lock poisoned".into())
        })?;

        for cmd in query_order {
            let cmd_str = cmd.as_cmd_str().map_err(ProtocolError::EncodingError)?;
            match transport.send_command(&cmd_str) {
                Ok(raw_resp) => {
                    tracing::debug!(
                        "Query {:?} raw response for {}: {:?}",
                        cmd_str,
                        port_name,
                        raw_resp
                    );
                    let parsed = match cmd {
                        VoltronicCommand::QueryStatusQs => Q1Status::parse_qs(&raw_resp),
                        VoltronicCommand::QuickStatus => Q1Status::parse(&raw_resp),
                        VoltronicCommand::QueryGeneralStatus => {
                            QpigsStatus::parse(&raw_resp).map(|qpigs| Q1Status {
                                grid_voltage_v: qpigs.grid_voltage_v,
                                grid_frequency_hz: qpigs.grid_frequency_hz,
                                output_voltage_v: qpigs.output_voltage_v,
                                output_frequency_hz: qpigs.output_frequency_hz,
                                output_load_pct: qpigs.output_load_pct,
                                output_watts: qpigs.output_active_power_w,
                                battery_voltage_v: qpigs.battery_voltage_v,
                                temperature_c: qpigs.heatsink_temp_c,
                                utility_fail: false,
                                battery_low: false,
                                bypass_active: false,
                                ups_failed: false,
                                test_in_progress: false,
                                beeper_on: false,
                                raw_status_bits: "00000000".into(),
                            })
                        }
                        _ => unreachable!(),
                    };

                    match parsed {
                        Ok(status) => {
                            tracing::info!(
                                "Telemetry updated via {:?} for {} (Grid={:.1}V, Out={:.1}V, Load={}% Bat={:.1}V)",
                                cmd_str,
                                port_name,
                                status.grid_voltage_v,
                                status.output_voltage_v,
                                status.output_load_pct,
                                status.battery_voltage_v
                            );
                            if let Ok(mut devs) = self.devices.lock() {
                                if let Some(device) = devs.get_mut(port_name) {
                                    device.last_status = Some(status.clone());
                                }
                            }
                            return Ok(status);
                        }
                        Err(parse_err) => {
                            tracing::warn!(
                                "Failed to parse response for {:?}: {:?}. Raw: {:?}. Trying next query...",
                                cmd_str,
                                parse_err,
                                raw_resp
                            );
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        "Query {:?} rejected or failed on {}: {:?}. Trying next query...",
                        cmd_str,
                        port_name,
                        err
                    );
                }
            }
        }

        tracing::error!(
            "All telemetry queries (QS, Q1, QPIGS) failed on {}",
            port_name
        );
        Err(ProtocolError::CommandNak)
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

        // Step 2: Determine effective command string and acquire transport Arc
        let (cmd_str, transport_arc) = {
            let devs = self.devices.lock().unwrap();
            let device = devs.get(port_name).ok_or_else(|| {
                ProtocolError::DeviceError(format!("Device on {} not found", port_name))
            })?;

            // Determine effective command string (with smart buzzer toggle if applicable)
            let cmd_str = match cmd {
                VoltronicCommand::BuzzerToggle => {
                    let is_beeper_on = device.last_status.as_ref().map(|s| s.beeper_on).unwrap_or(true);
                    if is_beeper_on {
                        "BZOFF".to_string()
                    } else {
                        "BZON".to_string()
                    }
                }
                _ => cmd
                    .as_cmd_str_for(&device.info.protocol_id)
                    .map_err(ProtocolError::EncodingError)?,
            };

            (cmd_str, Arc::clone(&device.transport))
        };

        let mut transport = transport_arc.lock().map_err(|_| {
            ProtocolError::DeviceError("Transport lock poisoned".into())
        })?;

        let res = transport.send_command(&cmd_str);
        if let Err(ProtocolError::CommandNak) = &res {
            // If BZOFF/BZON is rejected with NAK on a legacy 1994 Megatec unit, fallback to Q
            if cmd_str == "BZOFF" || cmd_str == "BZON" {
                tracing::info!(
                    "Hardware rejected {:?}, attempting legacy fallback 'Q' on {}",
                    cmd_str,
                    port_name
                );
                return transport.send_command("Q");
            }
        }
        res
    }

    /// Access an active `BridgeTransport` instance (or the first active bridge if `port_name` is empty).
    pub fn with_bridge_transport<F, R>(
        &self,
        port_name: Option<&str>,
        f: F,
    ) -> Result<R, ProtocolError>
    where
        F: FnOnce(&mut crate::serial::BridgeTransport, String) -> Result<R, ProtocolError>,
    {
        let (key, transport_arc) = {
            let devs = self.devices.lock().unwrap();
            let target_key = if let Some(p) = port_name.filter(|s| !s.is_empty()) {
                Some(p.to_string())
            } else {
                devs.keys()
                    .find(|k| k.starts_with("BRIDGE:"))
                    .cloned()
            };

            let key = target_key.ok_or_else(|| {
                ProtocolError::DeviceError("No active ESP32 Bridge connected".into())
            })?;

            let device = devs.get(&key).ok_or_else(|| {
                ProtocolError::DeviceError(format!("Bridge device on {} not found", key))
            })?;

            (key, Arc::clone(&device.transport))
        };

        let mut transport = transport_arc.lock().map_err(|_| {
            ProtocolError::DeviceError("Transport lock poisoned".into())
        })?;

        let bridge = transport
            .as_any_mut()
            .and_then(|any| any.downcast_mut::<crate::serial::BridgeTransport>())
            .ok_or_else(|| {
                ProtocolError::DeviceError(format!(
                    "Port {} is not an ESP32 Bridge transport",
                    key
                ))
            })?;

        f(bridge, key)
    }
}
