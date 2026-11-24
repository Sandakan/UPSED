use crate::gate::CommandGate;
use crate::protocol::{ProtocolError, Q1Status, QpigsStatus, UnlockStage, VoltronicCommand};
use crate::serial::{DiscoveredDevice, SerialTransport};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct TelemetryBucket {
    pub window_started_at: Instant,
    pub sample_count: u32,
    pub sum_grid_voltage: f64,
    pub sum_output_voltage: f64,
    pub sum_grid_freq: f64,
    pub sum_output_freq: f64,
    pub sum_load_pct: u64,
    pub sum_output_watts: u64,
    pub sum_battery_voltage: f64,
    pub sum_temp_c: i64,
    pub min_battery_voltage: f32,
    pub max_output_load_pct: u32,
    pub max_output_watts: u32,
    pub had_urgent_condition: bool,
}

impl TelemetryBucket {
    pub fn new(status: &Q1Status) -> Self {
        Self {
            window_started_at: Instant::now(),
            sample_count: 1,
            sum_grid_voltage: status.grid_voltage_v as f64,
            sum_output_voltage: status.output_voltage_v as f64,
            sum_grid_freq: status.grid_frequency_hz as f64,
            sum_output_freq: status.output_frequency_hz as f64,
            sum_load_pct: status.output_load_pct as u64,
            sum_output_watts: status.output_watts as u64,
            sum_battery_voltage: status.battery_voltage_v as f64,
            sum_temp_c: status.temperature_c as i64,
            min_battery_voltage: status.battery_voltage_v,
            max_output_load_pct: status.output_load_pct,
            max_output_watts: status.output_watts,
            had_urgent_condition: status.test_in_progress || status.shutdown_active || status.utility_fail || status.battery_low,
        }
    }

    pub fn update(&mut self, status: &Q1Status) {
        self.sample_count += 1;
        self.sum_grid_voltage += status.grid_voltage_v as f64;
        self.sum_output_voltage += status.output_voltage_v as f64;
        self.sum_grid_freq += status.grid_frequency_hz as f64;
        self.sum_output_freq += status.output_frequency_hz as f64;
        self.sum_load_pct += status.output_load_pct as u64;
        self.sum_output_watts += status.output_watts as u64;
        self.sum_battery_voltage += status.battery_voltage_v as f64;
        self.sum_temp_c += status.temperature_c as i64;

        if status.battery_voltage_v < self.min_battery_voltage {
            self.min_battery_voltage = status.battery_voltage_v;
        }
        if status.output_load_pct > self.max_output_load_pct {
            self.max_output_load_pct = status.output_load_pct;
        }
        if status.output_watts > self.max_output_watts {
            self.max_output_watts = status.output_watts;
        }
        if status.test_in_progress || status.shutdown_active || status.utility_fail || status.battery_low {
            self.had_urgent_condition = true;
        }
    }

    pub fn to_smoothed_record(&self, ups_id: &str) -> crate::db::TelemetryRecord {
        let n = self.sample_count.max(1) as f64;
        let avg_grid_v = (self.sum_grid_voltage / n) as f32;
        let avg_out_v = (self.sum_output_voltage / n) as f32;
        let avg_grid_f = (self.sum_grid_freq / n) as f32;
        let avg_out_f = (self.sum_output_freq / n) as f32;
        let avg_load = (self.sum_load_pct as f64 / n).round() as u32;
        let avg_watts = (self.sum_output_watts as f64 / n).round() as u32;
        let effective_bat_v = if self.had_urgent_condition {
            self.min_battery_voltage
        } else {
            (self.sum_battery_voltage / n) as f32
        };
        let avg_temp = (self.sum_temp_c as f64 / n).round() as i32;

        crate::db::TelemetryRecord {
            id: None,
            timestamp: chrono::Local::now().to_rfc3339(),
            ups_id: ups_id.to_string(),
            grid_voltage: avg_grid_v,
            output_voltage: avg_out_v,
            grid_frequency: avg_grid_f,
            output_frequency: avg_out_f,
            load_pct: self.max_output_load_pct.max(avg_load),
            output_watts: self.max_output_watts.max(avg_watts),
            battery_voltage: effective_bat_v,
            temperature_c: avg_temp,
        }
    }
}

pub struct ConnectedUps {
    pub info: DiscoveredDevice,
    pub transport: Arc<Mutex<Box<dyn SerialTransport>>>,
    pub gate: Arc<Mutex<CommandGate>>,
    pub last_status: Option<Q1Status>,
    pub ups_id: Option<String>,
    pub last_polled_at: Option<Instant>,
}

pub struct MultiPortManager {
    devices: Arc<Mutex<HashMap<String, ConnectedUps>>>,
    auth: Arc<crate::auth::AuthManager>,
    buckets: Arc<Mutex<HashMap<String, TelemetryBucket>>>,
    fast_watch_until: Arc<Mutex<HashMap<String, Instant>>>,
    completion_probes: Arc<Mutex<HashMap<String, Instant>>>,
    consecutive_poll_failures: Arc<Mutex<HashMap<String, u32>>>,
}

impl Default for MultiPortManager {
    fn default() -> Self {
        Self {
            devices: Arc::new(Mutex::new(HashMap::new())),
            auth: Arc::new(crate::auth::AuthManager::new_in_memory()),
            buckets: Arc::new(Mutex::new(HashMap::new())),
            fast_watch_until: Arc::new(Mutex::new(HashMap::new())),
            completion_probes: Arc::new(Mutex::new(HashMap::new())),
            consecutive_poll_failures: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl MultiPortManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_auth(auth: Arc<crate::auth::AuthManager>) -> Self {
        Self {
            devices: Arc::new(Mutex::new(HashMap::new())),
            auth,
            buckets: Arc::new(Mutex::new(HashMap::new())),
            fast_watch_until: Arc::new(Mutex::new(HashMap::new())),
            completion_probes: Arc::new(Mutex::new(HashMap::new())),
            consecutive_poll_failures: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Force-resets stale sockets on all active bridge transports (used upon system resume/wake).
    pub fn reset_stale_transports(&self) {
        let bridge_transports: Vec<(String, Arc<Mutex<Box<dyn SerialTransport>>>)> = {
            let devs = self.devices.lock().unwrap();
            devs.iter()
                .filter(|(_, d)| {
                    d.info.bridge_mac.is_some() || d.info.port_name.starts_with("BRIDGE:")
                })
                .map(|(k, d)| (k.clone(), Arc::clone(&d.transport)))
                .collect()
        };

        for (port_name, transport_arc) in bridge_transports {
            if let Ok(mut transport) = transport_arc.lock() {
                if let Some(bridge) = transport
                    .as_any_mut()
                    .and_then(|a| a.downcast_mut::<crate::serial::BridgeTransport>())
                {
                    tracing::info!("Resetting stale bridge transport socket for {}", port_name);
                    bridge.reset_socket();
                }
            }
        }
    }

    pub fn get_consecutive_poll_failures(&self, port_name: &str) -> u32 {
        self.consecutive_poll_failures
            .lock()
            .ok()
            .and_then(|m| m.get(port_name).copied())
            .unwrap_or(0)
    }

    pub fn register_device(&self, info: DiscoveredDevice, transport: Box<dyn SerialTransport>) {
        self.register_device_with_ups_id(info, transport, None);
    }

    pub fn register_device_with_ups_id(
        &self,
        info: DiscoveredDevice,
        transport: Box<dyn SerialTransport>,
        ups_id: Option<String>,
    ) {
        let mut devs = self.devices.lock().unwrap();
        let port_name = info.port_name.clone();
        devs.insert(
            port_name,
            ConnectedUps {
                info,
                transport: Arc::new(Mutex::new(transport)),
                gate: Arc::new(Mutex::new(CommandGate::with_auth(Arc::clone(&self.auth)))),
                last_status: None,
                ups_id,
                last_polled_at: None,
            },
        );
    }

    pub fn unregister_device(&self, port_or_ups_id: &str) -> Option<ConnectedUps> {
        let mut devs = self.devices.lock().unwrap();
        if let Some(removed) = devs.remove(port_or_ups_id) {
            return Some(removed);
        }
        let found_key = devs.iter().find_map(|(k, v)| {
            if v.info.unique_id == port_or_ups_id || v.ups_id.as_deref() == Some(port_or_ups_id) {
                Some(k.clone())
            } else {
                None
            }
        });
        if let Some(key) = found_key {
            devs.remove(&key)
        } else {
            None
        }
    }

    pub fn list_devices(&self) -> Vec<DiscoveredDevice> {
        let devs = self.devices.lock().unwrap();
        devs.values().map(|d| d.info.clone()).collect()
    }

    pub fn list_connected_details(&self) -> Vec<(DiscoveredDevice, Option<String>, Option<Q1Status>)> {
        let devs = self.devices.lock().unwrap();
        devs.values()
            .map(|d| (d.info.clone(), d.ups_id.clone(), d.last_status.clone()))
            .collect()
    }

    pub fn is_connected(&self, port_or_ups_id: &str) -> bool {
        let devs = self.devices.lock().unwrap();
        devs.contains_key(port_or_ups_id)
            || devs.values().any(|d| {
                d.info.unique_id == port_or_ups_id || d.ups_id.as_deref() == Some(port_or_ups_id)
            })
    }

    pub fn get_last_status(&self, port_or_ups_id: &str) -> Option<Q1Status> {
        let devs = self.devices.lock().unwrap();
        devs.get(port_or_ups_id)
            .or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id
                        || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            })
            .and_then(|d| d.last_status.clone())
    }

    pub fn get_device_info(&self, port_or_ups_id: &str) -> Option<DiscoveredDevice> {
        let devs = self.devices.lock().unwrap();
        devs.get(port_or_ups_id)
            .or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id
                        || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            })
            .map(|d| d.info.clone())
    }

    pub fn get_device_ups_id(&self, port_or_ups_id: &str) -> Option<String> {
        let devs = self.devices.lock().unwrap();
        devs.get(port_or_ups_id)
            .or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id
                        || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            })
            .and_then(|d| d.ups_id.clone())
    }

    pub fn set_device_ups_id(&self, port_name: &str, ups_id: String) {
        if let Ok(mut devs) = self.devices.lock() {
            if let Some(dev) = devs.get_mut(port_name) {
                dev.ups_id = Some(ups_id);
            } else if let Some(dev) = devs.values_mut().find(|d| d.info.port_name == port_name || d.info.unique_id == port_name) {
                dev.ups_id = Some(ups_id);
            }
        }
    }

    pub fn update_device_status(&self, port_or_ups_id: &str, status: Q1Status) {
        if let Ok(mut devs) = self.devices.lock() {
            if let Some(device) = devs.get_mut(port_or_ups_id) {
                device.last_status = Some(status);
                device.last_polled_at = Some(Instant::now());
                return;
            }
            if let Some(device) = devs.values_mut().find(|d| {
                d.info.unique_id == port_or_ups_id || d.ups_id.as_deref() == Some(port_or_ups_id)
            }) {
                device.last_status = Some(status);
                device.last_polled_at = Some(Instant::now());
            }
        }
    }

    pub fn get_device_last_polled_at(&self, port_or_ups_id: &str) -> Option<Instant> {
        let devs = self.devices.lock().unwrap();
        devs.get(port_or_ups_id)
            .or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            })
            .and_then(|d| d.last_polled_at)
    }

    pub fn get_gate(&self, port_or_ups_id: &str) -> Option<Arc<Mutex<CommandGate>>> {
        let devs = self.devices.lock().unwrap();
        let dev = devs.get(port_or_ups_id).or_else(|| {
            devs.values().find(|d| {
                d.info.unique_id == port_or_ups_id
                    || d.ups_id.as_deref() == Some(port_or_ups_id)
            })
        })?;
        Some(Arc::clone(&dev.gate))
    }

    pub fn get_safety_stage(&self, port_or_ups_id: &str) -> Option<UnlockStage> {
        self.get_gate(port_or_ups_id)
            .map(|gate_arc| gate_arc.lock().unwrap().current_stage())
    }

    pub fn unlock_safety_stage(&self, port_or_ups_id: &str, target_stage: UnlockStage) -> Result<(), String> {
        let gate_arc = self.get_gate(port_or_ups_id).ok_or_else(|| {
            format!("Device '{}' not found in active manager registry", port_or_ups_id)
        })?;
        let mut gate = gate_arc.lock().unwrap();
        gate.unlock_stage(target_stage).map_err(|e| e.to_string())
    }

    pub fn ingest_bucket_sample(&self, ups_id: &str, status: &Q1Status) -> crate::db::TelemetryRecord {
        let mut buckets = self.buckets.lock().unwrap();
        let bucket = buckets
            .entry(ups_id.to_string())
            .and_modify(|b| b.update(status))
            .or_insert_with(|| TelemetryBucket::new(status));
        bucket.to_smoothed_record(ups_id)
    }

    pub fn take_completed_bucket(&self, ups_id: &str) -> Option<crate::db::TelemetryRecord> {
        let mut buckets = self.buckets.lock().unwrap();
        buckets.remove(ups_id).map(|b| b.to_smoothed_record(ups_id))
    }

    pub fn arm_fast_watch(&self, port_or_ups_id: &str, duration: std::time::Duration) {
        if let Ok(mut fw) = self.fast_watch_until.lock() {
            fw.insert(port_or_ups_id.to_string(), Instant::now() + duration);
        }
    }

    pub fn arm_target_completion_probe(&self, port_or_ups_id: &str, probe_at: Instant) {
        if let Ok(mut cp) = self.completion_probes.lock() {
            cp.insert(port_or_ups_id.to_string(), probe_at);
        }
    }

    pub fn is_fast_watch_active(&self, port_or_ups_id: &str) -> bool {
        if let Ok(fw) = self.fast_watch_until.lock() {
            if let Some(until) = fw.get(port_or_ups_id) {
                return Instant::now() < *until;
            }
        }
        false
    }

    pub fn take_due_completion_probe(&self, port_or_ups_id: &str) -> bool {
        if let Ok(mut cp) = self.completion_probes.lock() {
            if let Some(probe_at) = cp.get(port_or_ups_id) {
                if Instant::now() >= *probe_at {
                    cp.remove(port_or_ups_id);
                    return true;
                }
            }
        }
        false
    }

    pub fn is_bridge_device(&self, port_or_ups_id: &str) -> bool {
        let devs = self.devices.lock().unwrap();
        if let Some(dev) = devs.get(port_or_ups_id).or_else(|| {
            devs.values().find(|d| {
                d.info.unique_id == port_or_ups_id || d.ups_id.as_deref() == Some(port_or_ups_id)
            })
        }) {
            dev.info.bridge_mac.is_some() || dev.info.port_name.starts_with("BRIDGE:")
        } else {
            false
        }
    }

    pub fn drain_bridge_notifications(&self) -> Vec<(String, Option<String>, Vec<crate::serial::BridgeStateChangedEvent>)> {
        let bridge_keys: Vec<_> = {
            let devs = self.devices.lock().unwrap();
            devs.iter()
                .filter(|(_, d)| d.info.bridge_mac.is_some() || d.info.port_name.starts_with("BRIDGE:"))
                .map(|(k, d)| (k.clone(), d.ups_id.clone(), Arc::clone(&d.transport)))
                .collect()
        };

        let mut all_events = Vec::new();
        for (port_name, ups_id, transport_arc) in bridge_keys {
            if let Ok(mut transport) = transport_arc.try_lock() {
                if let Some(bridge) = transport
                    .as_any_mut()
                    .and_then(|a| a.downcast_mut::<crate::serial::BridgeTransport>())
                {
                    let events = bridge.drain_notifications();
                    if !events.is_empty() {
                        all_events.push((port_name, ups_id, events));
                    }
                }
            }
        }
        all_events
    }

    pub fn poll_device(&self, port_or_ups_id: &str) -> Result<Q1Status, ProtocolError> {
        self.poll_device_force_refresh(port_or_ups_id, false)
    }

    pub fn poll_device_force_refresh(
        &self,
        port_or_ups_id: &str,
        force_refresh: bool,
    ) -> Result<Q1Status, ProtocolError> {
        let (proto, transport_arc, port_name) = {
            let devs = self.devices.lock().unwrap();
            let device = devs.get(port_or_ups_id).or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id
                        || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            }).ok_or_else(|| {
                tracing::error!(
                    "Device on {} not found in active manager registry",
                    port_or_ups_id
                );
                ProtocolError::DeviceError(format!("Device on {} not found", port_or_ups_id))
            })?;
            (
                device.info.protocol_id.clone(),
                Arc::clone(&device.transport),
                device.info.port_name.clone(),
            )
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
            match transport.send_command_force_refresh(&cmd_str, force_refresh) {
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
                                shutdown_active: false,
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
                                if let Some(device) = devs.get_mut(&port_name) {
                                    device.last_status = Some(status.clone());
                                    device.last_polled_at = Some(Instant::now());
                                }
                            }
                            if let Ok(mut fails) = self.consecutive_poll_failures.lock() {
                                fails.insert(port_name.clone(), 0);
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

        let fail_count = if let Ok(mut fails) = self.consecutive_poll_failures.lock() {
            let count = fails.entry(port_name.clone()).or_insert(0);
            *count = count.saturating_add(1);
            *count
        } else {
            1
        };

        if fail_count >= 2 {
            if let Some(bridge) = transport
                .as_any_mut()
                .and_then(|a| a.downcast_mut::<crate::serial::BridgeTransport>())
            {
                tracing::warn!(
                    "Consecutive poll failures ({}) reached on {}; force-resetting bridge transport socket",
                    fail_count,
                    port_name
                );
                bridge.reset_socket();
            }
        }

        tracing::error!(
            "All telemetry queries (QS, Q1, QPIGS) failed on {} (consecutive failures: {})",
            port_name,
            fail_count
        );
        Err(ProtocolError::CommandNak)
    }

    pub fn execute_gated_command(
        &self,
        port_or_ups_id: &str,
        cmd: &VoltronicCommand,
        gate: &CommandGate,
    ) -> Result<String, ProtocolError> {
        // Step 1: Check safety gate
        gate.check_command(cmd)
            .map_err(|e| ProtocolError::DeviceError(e.to_string()))?;

        // Step 2: Determine effective command string and acquire transport Arc
        let (cmd_str, transport_arc, port_name) = {
            let devs = self.devices.lock().unwrap();
            let device = devs.get(port_or_ups_id).or_else(|| {
                devs.values().find(|d| {
                    d.info.unique_id == port_or_ups_id
                        || d.ups_id.as_deref() == Some(port_or_ups_id)
                })
            }).ok_or_else(|| {
                ProtocolError::DeviceError(format!("Device on {} not found", port_or_ups_id))
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

            (cmd_str, Arc::clone(&device.transport), device.info.port_name.clone())
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

    pub fn execute_device_command(
        &self,
        port_or_ups_id: &str,
        cmd: &VoltronicCommand,
    ) -> Result<String, ProtocolError> {
        let gate_arc = self.get_gate(port_or_ups_id).ok_or_else(|| {
            ProtocolError::DeviceError(format!("Device on {} not found", port_or_ups_id))
        })?;
        let gate = gate_arc.lock().unwrap();
        self.execute_gated_command(port_or_ups_id, cmd, &gate)
    }

    /// Access an active `BridgeTransport` instance (or the first active bridge if `port_or_ups_id` is empty).
    pub fn with_bridge_transport<F, R>(
        &self,
        port_or_ups_id: Option<&str>,
        f: F,
    ) -> Result<R, ProtocolError>
    where
        F: FnOnce(&mut crate::serial::BridgeTransport, String) -> Result<R, ProtocolError>,
    {
        let (key, transport_arc) = {
            let devs = self.devices.lock().unwrap();
            let target_key = if let Some(p) = port_or_ups_id.filter(|s| !s.is_empty()) {
                if devs.contains_key(p) {
                    Some(p.to_string())
                } else if let Some(d) = devs.values().find(|d| {
                    d.info.unique_id == p || d.ups_id.as_deref() == Some(p)
                }) {
                    Some(d.info.port_name.clone())
                } else {
                    Some(p.to_string())
                }
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
