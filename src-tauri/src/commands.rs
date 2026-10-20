use crate::battery_bridge::BatteryBridge;
use crate::db::{Database, DbStats, EventLogRecord, TelemetryRecord, UpsMetadata};
use crate::gate::CommandGate;
use crate::multi_port::MultiPortManager;
use crate::protocol::{self, Q1Status, UnlockStage, VoltronicCommand};
use crate::serial::{
    get_all_bridge_logs, probe_port, probe_serial_bridge, probe_ws_bridge,
    push_bridge_log, scan_available_ports_with_context, scan_lan_for_bridge, test_ws_connection,
    BridgeBacklogRecord, BridgeLogEntry, BridgeStatus, BridgeTransport, DiscoveredDevice,
    HidTransport, PhysicalSerialPort, SerialTransport, WifiScanNetwork, WsTestResult,
    BRIDGE_DEFAULT_MDNS_HOST,
};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ProbeStatusEvent {
    pub phase: String,
    pub message: String,
    pub port_name: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WifiProvisionStatusEvent {
    pub phase: String,
    pub ssid: String,
    pub ip: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct BridgeFirmwareCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub download_url: Option<String>,
    pub binary_size: Option<u64>,
    pub local_binary_path: Option<String>,
    pub local_binary_size: Option<u64>,
    pub local_binary_modified: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OtaProgressEvent {
    pub phase: String,
    pub percentage: u32,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Clone)]
pub struct AppState {
    pub gate: Arc<Mutex<CommandGate>>,
    pub manager: Arc<MultiPortManager>,
    pub db: Arc<Database>,
    pub bridge: Arc<Mutex<BatteryBridge>>,
    pub poll_interval_tx: Arc<tokio::sync::watch::Sender<u64>>,
}

#[tauri::command]
pub async fn scan_ports(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<DiscoveredDevice>, String> {
    let _ = app.emit(
        "ups-probe-status",
        ProbeStatusEvent {
            phase: "scanning".into(),
            message: "Scanning communication ports & USB HID interfaces...".into(),
            port_name: None,
            device_name: None,
        },
    );
    let active_devices = state.manager.list_devices();
    let fallback_ws_host = state.db.get_setting("bridge_fallback_host").ok().flatten();

    let devices = tokio::task::spawn_blocking(move || {
        scan_available_ports_with_context(&active_devices, fallback_ws_host.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;

    if devices.is_empty() {
        let _ = app.emit(
            "ups-probe-status",
            ProbeStatusEvent {
                phase: "no_device".into(),
                message: "No compatible Voltronic UPS detected on available ports".into(),
                port_name: None,
                device_name: None,
            },
        );
    }
    Ok(devices)
}

pub fn commit_bridge_backlog_to_db(
    db: &Database,
    port_name: &str,
    records: &[BridgeBacklogRecord],
    bridge_uptime_sec: u64,
) -> usize {
    let mut inserted = 0;
    let now_epoch = chrono::Utc::now().timestamp() as u64;

    for rec in records {
        if let Ok(status) = Q1Status::parse(&rec.raw) {
            let record_epoch = if rec.ts > 1_700_000_000 {
                rec.ts as i64
            } else {
                let delta = bridge_uptime_sec.saturating_sub(rec.ts);
                now_epoch.saturating_sub(delta) as i64
            };

            let ts_rfc3339 = chrono::DateTime::from_timestamp(record_epoch, 0)
                .unwrap_or_else(chrono::Utc::now)
                .to_rfc3339();

            if db
                .insert_telemetry(&TelemetryRecord {
                    id: None,
                    timestamp: ts_rfc3339,
                    port_name: port_name.to_string(),
                    grid_voltage: status.grid_voltage_v,
                    output_voltage: status.output_voltage_v,
                    grid_frequency: status.grid_frequency_hz,
                    output_frequency: status.output_frequency_hz,
                    load_pct: status.output_load_pct,
                    output_watts: status.output_watts,
                    battery_voltage: status.battery_voltage_v,
                    temperature_c: status.temperature_c,
                })
                .is_ok()
            {
                inserted += 1;
            }
        }
    }
    inserted
}

pub fn connect_device_internal(
    state: &AppState,
    port_name: &str,
    baud_rate: Option<u32>,
) -> Result<DiscoveredDevice, String> {
    // Idempotency: If this port is already registered and active in MultiPortManager, reuse it!
    let alt_bridge_name = if port_name.starts_with("BRIDGE:") {
        port_name.strip_prefix("BRIDGE:").unwrap_or(port_name).to_string()
    } else {
        format!("BRIDGE:{}", port_name)
    };

    if let Some(existing) = state.manager.list_devices().into_iter().find(|d| d.port_name == port_name || d.port_name == alt_bridge_name) {
        tracing::info!("connect_device_internal: Port {} is already connected (as {}), reusing active connection", port_name, existing.port_name);
        return Ok(existing);
    }

    let is_bridge = port_name.starts_with("BRIDGE:")
        || (port_name.starts_with("COM") && probe_serial_bridge(port_name).is_some());
    let normalized_bridge_port = if is_bridge && !port_name.starts_with("BRIDGE:") {
        format!("BRIDGE:{}", port_name)
    } else {
        port_name.to_string()
    };

    let (info, transport): (DiscoveredDevice, Box<dyn SerialTransport>) = if is_bridge {
        let fallback_host = state
            .db
            .get_setting("bridge_fallback_host")
            .ok()
            .flatten();
        let mut bridge_transport =
            BridgeTransport::open(&normalized_bridge_port, fallback_host).map_err(|e| e.to_string())?;

        if let Ok(st) = bridge_transport.ping() {
            if st.wifi_connected && !st.ip.is_empty() {
                let _ = state.db.set_setting("bridge_fallback_host", &st.ip);
            }
            if st.backlog_records > 0 {
                if let Ok(backlog) = bridge_transport.drain_backlog() {
                    let count = commit_bridge_backlog_to_db(
                        &state.db,
                        &normalized_bridge_port,
                        &backlog,
                        st.uptime_sec,
                    );
                    if count > 0 {
                        let _ = state.db.insert_event(&EventLogRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            port_name: normalized_bridge_port.clone(),
                            event_type: "BRIDGE_SYNC".into(),
                            severity: "info".into(),
                            message: format!(
                                "ESP32 Bridge Backlog Synced: Imported {} offline MessagePack telemetry samples recorded while desktop was offline.",
                                count
                            ),
                            acknowledged: true,
                        });
                    }
                }
            }
        }

        let proto = match bridge_transport.send_command("QPI") {
            Ok(resp) => protocol::parse_protocol_id(&resp).unwrap_or_else(|_| "00".to_string()),
            Err(_) => {
                if let Ok(q1) = bridge_transport.send_command("Q1") {
                    if q1.starts_with('(') { "00".to_string() } else { "UNKNOWN".to_string() }
                } else {
                    "00".to_string()
                }
            }
        };

        let serial_number = bridge_transport
            .send_command("QID")
            .ok()
            .and_then(|r| protocol::parse_device_id(&r).ok());
        let firmware_version = bridge_transport
            .send_command("QVFW")
            .ok()
            .and_then(|r| protocol::parse_firmware_version(&r).ok());
        let bridge_mac = bridge_transport.bridge_mac();
        let unique_id = if let Some(sn) = serial_number.as_deref() {
            crate::serial::generate_unique_id(Some(sn), &normalized_bridge_port, firmware_version.as_deref())
        } else if let Some(mac) = bridge_mac.as_deref() {
            let clean_mac = mac.replace(|c: char| !c.is_alphanumeric(), "").to_uppercase();
            format!("BRIDGE-MAC-{}", clean_mac)
        } else {
            crate::serial::generate_unique_id(
                None,
                &normalized_bridge_port,
                firmware_version.as_deref(),
            )
        };
        let capabilities = protocol::DeviceCapabilities::for_protocol(&proto);
        let raw_com = normalized_bridge_port.strip_prefix("BRIDGE:").unwrap_or(&normalized_bridge_port);
        let usb_uuid = crate::serial::get_port_usb_uuid(raw_com);

        let battery_v = bridge_transport
            .send_command("Q1")
            .ok()
            .and_then(|r| protocol::Q1Status::parse(&r).ok())
            .map(|s| s.battery_voltage_v);
        let hardware_signature = Some(crate::serial::scanner::compute_hardware_signature(
            &proto,
            battery_v,
            None,
        ));

        let dev_info = DiscoveredDevice {
            port_name: normalized_bridge_port.clone(),
            protocol_id: proto,
            serial_number,
            unique_id,
            firmware_version,
            usb_uuid,
            bridge_mac,
            hardware_signature,
            capabilities,
        };

        (dev_info, Box::new(bridge_transport))
    } else {
        let info = probe_port(port_name).unwrap_or_else(|| DiscoveredDevice {
            port_name: port_name.to_string(),
            protocol_id: "00".into(),
            serial_number: None,
            unique_id: format!("MANUAL-{}", port_name),
            firmware_version: None,
            usb_uuid: None,
            bridge_mac: None,
            hardware_signature: None,
            capabilities: protocol::DeviceCapabilities::for_protocol("00"),
        });

        let local_port = info.port_name.clone();
        let transport: Box<dyn SerialTransport> = if local_port.starts_with("USB:") {
            Box::new(HidTransport::open_by_port_name(&local_port).map_err(|e| e.to_string())?)
        } else {
            let baud = baud_rate.unwrap_or(2400);
            Box::new(PhysicalSerialPort::open(&local_port, baud).map_err(|e| e.to_string())?)
        };

        (info, transport)
    };

    let effective_port = info.port_name.clone();
    state.manager.register_device(info.clone(), transport);
    let _ = state.db.set_setting("last_connected_port", &effective_port);

    // Sync real-time transport status if registered device is an ESP32 Bridge
    if let Ok((medium, host, key)) = state.manager.with_bridge_transport(Some(&effective_port), |b, k| {
        Ok((b.active_medium().to_string(), b.ws_host(), k))
    }) {
        crate::serial::bridge_adapter::emit_transport_status(&key, &medium, host.as_deref());
    }

    let _ = state.db.insert_event(&EventLogRecord {
        id: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        port_name: effective_port.clone(),
        event_type: "CONNECT".into(),
        severity: "info".into(),
        message: format!("Connected to UPS on {}", effective_port),
        acknowledged: true,
    });

    Ok(info)
}


#[tauri::command]
pub async fn connect_device(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: String,
    baud_rate: Option<u32>,
) -> Result<DiscoveredDevice, String> {
    let _ = app.emit(
        "ups-probe-status",
        ProbeStatusEvent {
            phase: "connecting".into(),
            message: format!("Connecting to UPS on {}...", port_name),
            port_name: Some(port_name.clone()),
            device_name: None,
        },
    );
    let state_clone = state.inner().clone();
    let port = port_name.clone();
    let res = tokio::task::spawn_blocking(move || {
        connect_device_internal(&state_clone, &port, baud_rate)
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = app.emit(
        "ups-probe-status",
        ProbeStatusEvent {
            phase: "fetching".into(),
            message: format!("Reading live telemetry from {}...", res.port_name),
            port_name: Some(res.port_name.clone()),
            device_name: res.serial_number.clone(),
        },
    );

    Ok(res)
}

#[tauri::command]
pub async fn disconnect_device(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        state_clone.manager.unregister_device(&port_name);
        crate::tray::update_tray_state(&app_clone, false, None);
        let _ = state_clone.db.insert_event(&EventLogRecord {
            id: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            port_name: port_name.clone(),
            event_type: "DISCONNECT".into(),
            severity: "warning".into(),
            message: format!("Disconnected from UPS on {}", port_name),
            acknowledged: true,
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_connected_devices(state: State<AppState>) -> Vec<DiscoveredDevice> {
    state.manager.list_devices()
}

#[tauri::command]
pub async fn get_device_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: String,
) -> Result<Q1Status, String> {
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        if !state_clone.manager.is_connected(&port_name) {
            tracing::info!(
                "get_device_status: {} not connected, attempting connect",
                port_name
            );
            if let Err(e) = connect_device_internal(&state_clone, &port_name, None) {
                tracing::error!("Failed to connect to {}: {}", port_name, e);
                let _ = state_clone.db.insert_event(&EventLogRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    event_type: "CONNECT_ERROR".into(),
                    severity: "critical".into(),
                    message: format!("Connection failed: {}", e),
                    acknowledged: false,
                });
                return Err(e);
            }
        }

        let prev_status = state_clone.manager.get_last_status(&port_name);
        match state_clone.manager.poll_device(&port_name) {
            Ok(status) => {
                let _ = state_clone.db.insert_telemetry(&TelemetryRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    grid_voltage: status.grid_voltage_v,
                    output_voltage: status.output_voltage_v,
                    grid_frequency: status.grid_frequency_hz,
                    output_frequency: status.output_frequency_hz,
                    load_pct: status.output_load_pct,
                    output_watts: status.output_watts,
                    battery_voltage: status.battery_voltage_v,
                    temperature_c: status.temperature_c,
                });

                // Detect state transitions and alarm events
                let detected_events =
                    detect_status_events(prev_status.as_ref(), &status, &port_name);
                for ev in &detected_events {
                    let _ = state_clone.db.insert_event(ev);
                    let _ = app_clone.emit("ups-event", ev);
                }

                let mut bridge = state_clone.bridge.lock().unwrap();
                bridge.update(&status);
                let is_enabled = bridge.is_enabled();
                drop(bridge);

                if is_enabled {
                    crate::tray::update_tray_state(&app_clone, true, Some(&status));
                }

                // Sync real-time transport status if target is an ESP32 Bridge
                if let Ok((medium, host, key)) = state_clone.manager.with_bridge_transport(Some(&port_name), |b, k| {
                    Ok((b.active_medium().to_string(), b.ws_host(), k))
                }) {
                    crate::serial::bridge_adapter::emit_transport_status(&key, &medium, host.as_deref());
                }

                Ok(status)
            }
            Err(err) => {
                let err_str = err.to_string();
                tracing::error!("get_device_status failed for {}: {}", port_name, err_str);
                let _ = state_clone.db.insert_event(&EventLogRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    port_name: port_name.clone(),
                    event_type: "POLL_ERROR".into(),
                    severity: "warning".into(),
                    message: format!("Polling failed: {}", err_str),
                    acknowledged: false,
                });
                Err(err_str)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn format_command_audit_msg(cmd: &VoltronicCommand, resp: Option<&str>) -> String {
    let base = match cmd {
        VoltronicCommand::BuzzerToggle => "User toggled hardware alarm buzzer".to_string(),
        VoltronicCommand::BuzzerOn => "User enabled hardware alarm buzzer (BZON)".to_string(),
        VoltronicCommand::BuzzerOff => "User muted hardware alarm buzzer (BZOFF)".to_string(),
        VoltronicCommand::TenSecondTest => "User initiated 10-second battery self-test (T)".to_string(),
        VoltronicCommand::TestForMinutes(m) => format!("User initiated {}-minute battery self-test (T{:02})", m, m),
        VoltronicCommand::CancelTest => "User canceled active battery self-test (CT)".to_string(),
        VoltronicCommand::TestUntilLow => "User initiated battery self-test until low battery (TL)".to_string(),
        VoltronicCommand::SetBypassHighVoltage(v) => format!("User set bypass high voltage to {}V (PHV)", v),
        VoltronicCommand::SetBypassLowVoltage(v) => format!("User set bypass low voltage to {}V (PLV)", v),
        VoltronicCommand::SetBypassHighFrequency(f) => format!("User set bypass high frequency to {:.1}Hz (PGF)", f),
        VoltronicCommand::SetBypassLowFrequency(f) => format!("User set bypass low frequency to {:.1}Hz (PSF)", f),
        VoltronicCommand::SetEcoHigh(v) => format!("User set ECO high threshold to {}V (HEH)", v),
        VoltronicCommand::SetEcoLow(v) => format!("User set ECO low threshold to {}V (HEL)", v),
        VoltronicCommand::SetMaxBackupMinutes(m) => format!("User set maximum backup time to {} min (MD)", m),
        VoltronicCommand::SetAlarmEnabled(on) => if *on { "User enabled the audible alarm setting (PEA)".to_string() } else { "User disabled the audible alarm setting (PDA)".to_string() },
        VoltronicCommand::ShutdownWithDelay { minutes } => format!("User initiated delayed shutdown ({:.1} min)", minutes),
        VoltronicCommand::ShutdownAndRestore { minutes, restore_minutes } => format!("User initiated delayed shutdown ({:.1} min) with restore after {} min", minutes, restore_minutes),
        VoltronicCommand::CancelShutdown => "User canceled delayed shutdown".to_string(),
        VoltronicCommand::OutputOn => "User turned UPS output ON (SON)".to_string(),
        VoltronicCommand::OutputOff => "User turned UPS output OFF (SOFF)".to_string(),
        VoltronicCommand::OutletOn { group } => format!("User turned outlet group {} ON (SKON)", group),
        VoltronicCommand::OutletOff { group } => format!("User turned outlet group {} OFF (SKOFF)", group),
        VoltronicCommand::QueryPStatus => "User queried P-series status (QGS)".to_string(),
        VoltronicCommand::QueryPWarning => "User queried P-series warnings (QWS)".to_string(),
        VoltronicCommand::QueryPRating => "User queried P-series rating (QRI)".to_string(),
        VoltronicCommand::QueryModel => "User queried model (QMD)".to_string(),
        VoltronicCommand::QueryFaultStatus => "User queried fault status (QFS)".to_string(),
        VoltronicCommand::QueryEcoWindow => "User queried ECO window (QHE)".to_string(),
        VoltronicCommand::QueryBypassVoltage => "User queried bypass voltage limits (QBYV)".to_string(),
        VoltronicCommand::QueryBypassFrequency => "User queried bypass frequency limits (QBYF)".to_string(),
        VoltronicCommand::QueryBatteryCapacity => "User queried battery capacity (QBTAH)".to_string(),
        VoltronicCommand::QueryOutletState { group } => format!("User queried outlet group {} state (QSK{})", group, group),
        VoltronicCommand::QueryProtocolId => "User queried Protocol ID (QPI)".to_string(),
        VoltronicCommand::QuickStatus => "User queried Quick Status (Q1)".to_string(),
        VoltronicCommand::QueryStatusQs => "User queried Status (QS)".to_string(),
        VoltronicCommand::QueryGeneralStatus => "User queried General Status (QPIGS)".to_string(),
        VoltronicCommand::QueryWarningStatus => "User queried Warning Status (QPIWS)".to_string(),
        VoltronicCommand::QueryRatingInfo => "User queried Rating Info (QPIRI)".to_string(),
        VoltronicCommand::QueryWorkingMode => "User queried Working Mode (QMOD)".to_string(),
        VoltronicCommand::QueryFlags => "User queried Flags (QFLAG)".to_string(),
        VoltronicCommand::QueryDeviceId => "User queried Device ID (QID)".to_string(),
        VoltronicCommand::QueryFirmwareVersion => "User queried Firmware Version (QVFW)".to_string(),
        VoltronicCommand::QueryBatteryVoltage => "User queried Battery Voltage (QBV)".to_string(),
    };

    if let Some(r) = resp {
        format!("{}: received response '{}'", base, r)
    } else {
        base
    }
}

#[tauri::command]
pub async fn send_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: String,
    command: VoltronicCommand,
) -> Result<String, String> {
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    let port = port_name.clone();
    let cmd_clone = command.clone();
    tokio::task::spawn_blocking(move || {
        if !state_clone.manager.is_connected(&port) {
            let _ = connect_device_internal(&state_clone, &port, None);
        }

        let gate = state_clone.gate.lock().unwrap();
        let result = state_clone
            .manager
            .execute_gated_command(&port, &cmd_clone, &gate)
            .map_err(|e| e.to_string());
        drop(gate);

        // Record audit log for user action
        let now = chrono::Utc::now().to_rfc3339();
        let (action_desc, is_success) = match &result {
            Ok(resp) => (format_command_audit_msg(&cmd_clone, Some(resp)), true),
            Err(err) => (
                format!("{} (Blocked/Failed: {})", format_command_audit_msg(&cmd_clone, None), err),
                false,
            ),
        };

        let audit_event = EventLogRecord {
            id: None,
            timestamp: now,
            port_name: port.clone(),
            event_type: "USER_ACTION".into(),
            severity: if is_success { "info".into() } else { "warning".into() },
            message: action_desc,
            acknowledged: true,
        };

        let _ = state_clone.db.insert_event(&audit_event);
        let _ = app_clone.emit("ups-event", &audit_event);

        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_safety_stage(state: State<AppState>) -> UnlockStage {
    let gate = state.gate.lock().unwrap();
    gate.current_stage()
}

#[tauri::command]
pub fn unlock_safety_stage(
    app: tauri::AppHandle,
    state: State<AppState>,
    target_stage: UnlockStage,
) -> Result<(), String> {
    let mut gate = state.gate.lock().unwrap();
    let prev_stage = gate.current_stage();
    gate.unlock_stage(target_stage).map_err(|e| e.to_string())?;
    drop(gate);

    let audit_event = EventLogRecord {
        id: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        port_name: "SYSTEM".into(),
        event_type: "USER_ACTION".into(),
        severity: "info".into(),
        message: format!(
            "User Action: Changed firmware safety gate from {:?} to {:?}.",
            prev_stage, target_stage
        ),
        acknowledged: true,
    };

    let _ = state.db.insert_event(&audit_event);
    let _ = app.emit("ups-event", &audit_event);

    Ok(())
}

#[tauri::command]
pub async fn get_recent_telemetry(
    state: State<'_, AppState>,
    port_name: String,
    limit: Option<u32>,
) -> Result<Vec<TelemetryRecord>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .query_recent_telemetry(&port_name, limit.unwrap_or(50))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_telemetry_range(
    state: State<'_, AppState>,
    port_name: String,
    start_time: String,
    end_time: String,
    max_points: Option<u32>,
) -> Result<Vec<TelemetryRecord>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .query_telemetry_range(&port_name, &start_time, &end_time, max_points)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_recent_events(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<EventLogRecord>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .query_recent_events(limit.unwrap_or(50))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_battery_bridge_status(state: State<AppState>) -> bool {
    let bridge = state.bridge.lock().unwrap();
    bridge.is_enabled()
}

#[tauri::command]
pub fn set_battery_bridge_status(
    app: tauri::AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    let mut bridge = state.bridge.lock().unwrap();
    bridge.set_enabled(enabled);
    let last = bridge.last_status().cloned();
    drop(bridge);

    crate::tray::update_tray_state(&app, enabled, last.as_ref());
    Ok(())
}

#[tauri::command]
pub async fn get_ups_metadata(
    state: State<'_, AppState>,
    unique_id: String,
    bridge_mac: Option<String>,
    usb_uuid: Option<String>,
    hardware_signature: Option<String>,
) -> Result<Option<UpsMetadata>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .resolve_ups_metadata(
                &unique_id,
                bridge_mac.as_deref(),
                usb_uuid.as_deref(),
                hardware_signature.as_deref(),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn link_transport_to_profile(
    state: State<'_, AppState>,
    unique_id: String,
    bridge_mac: Option<String>,
    usb_uuid: Option<String>,
    hardware_signature: Option<String>,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .link_transport_to_profile(
                &unique_id,
                bridge_mac.as_deref(),
                usb_uuid.as_deref(),
                hardware_signature.as_deref(),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_disambiguation_candidates(
    state: State<'_, AppState>,
    hardware_signature: String,
) -> Result<Vec<UpsMetadata>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .get_disambiguation_candidates(&hardware_signature)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_ups_metadata(
    state: State<'_, AppState>,
    metadata: UpsMetadata,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .save_ups_metadata(&metadata)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_ups_metadata(state: State<'_, AppState>) -> Result<Vec<UpsMetadata>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .list_all_ups_metadata()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_last_connected_device(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .get_setting("last_connected_device")
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_last_connected_device(
    state: State<'_, AppState>,
    unique_id: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .set_setting("last_connected_device", &unique_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_device_usb_uuid(
    state: State<'_, AppState>,
    unique_id: String,
    new_usb_uuid: String,
    updated_at: String,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .update_device_usb_uuid(&unique_id, &new_usb_uuid, &updated_at)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fast_probe_device(port_name: String) -> Result<Option<DiscoveredDevice>, String> {
    tokio::task::spawn_blocking(move || probe_port(&port_name))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_events(state: State<'_, AppState>) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || state_clone.db.clear_events().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn acknowledge_event(state: State<'_, AppState>, event_id: i64) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .acknowledge_event(event_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn acknowledge_all_events(state: State<'_, AppState>) -> Result<usize, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .acknowledge_all_events()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_poll_interval(state: State<AppState>) -> u64 {
    *state.poll_interval_tx.subscribe().borrow()
}

#[tauri::command]
pub fn set_poll_interval(state: State<AppState>, secs: u64) -> Result<(), String> {
    let secs = secs.clamp(1, 3600);
    let _ = state.poll_interval_tx.send(secs);
    state
        .db
        .set_setting("poll_interval_secs", &secs.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_close_to_minimize(state: State<AppState>) -> Result<bool, String> {
    let val = state
        .db
        .get_setting("close_to_minimize")
        .map_err(|e| e.to_string())?;
    Ok(val.map(|v| v != "false").unwrap_or(true))
}

#[tauri::command]
pub fn set_close_to_minimize(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state
        .db
        .set_setting("close_to_minimize", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_start_minimized(state: State<AppState>) -> Result<bool, String> {
    let val = state
        .db
        .get_setting("start_minimized")
        .map_err(|e| e.to_string())?;
    Ok(val.map(|v| v != "false").unwrap_or(true))
}

#[tauri::command]
pub fn set_start_minimized(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state
        .db
        .set_setting("start_minimized", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_theme(state: State<AppState>) -> Result<String, String> {
    let val = state
        .db
        .get_setting("theme")
        .map_err(|e| e.to_string())?;
    Ok(val.unwrap_or_else(|| "system".to_string()))
}

#[tauri::command]
pub fn set_theme(state: State<AppState>, theme: String) -> Result<(), String> {
    state
        .db
        .set_setting("theme", &theme)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub async fn get_db_stats(state: State<'_, AppState>) -> Result<DbStats, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone.db.get_db_stats().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prune_telemetry(
    state: State<'_, AppState>,
    older_than_days: u32,
) -> Result<usize, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .prune_telemetry(older_than_days)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_telemetry(state: State<'_, AppState>) -> Result<usize, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .clear_telemetry()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vacuum_database(state: State<'_, AppState>) -> Result<(), String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .db
            .vacuum_database()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Detects hardware state transitions and alarms by diffing status between consecutive poll cycles.
pub fn detect_status_events(
    prev: Option<&Q1Status>,
    curr: &Q1Status,
    port: &str,
) -> Vec<EventLogRecord> {
    let mut events = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    let Some(prev) = prev else {
        return events;
    };

    // 1. AC Utility Failure (Blackout) - Rising Edge
    if !prev.utility_fail && curr.utility_fail {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UTILITY_FAIL".into(),
            severity: "critical".into(),
            message:
                "AC Utility Failure: Mains grid power lost. Inverter operating on battery mode."
                    .into(),
            acknowledged: false,
        });
    } else if prev.utility_fail && !curr.utility_fail {
        // Falling edge - Grid Power Restored
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UTILITY_RESTORE".into(),
            severity: "success".into(),
            message: "AC Utility Restored: Mains grid power restored. Resumed normal line mode."
                .into(),
            acknowledged: false,
        });
    }

    // 2. Battery Low Warning (Critical)
    if !prev.battery_low && curr.battery_low {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_LOW".into(),
            severity: "critical".into(),
            message: "Low Battery: Battery capacity critically depleted. Prepare connected loads for shutdown.".into(),
            acknowledged: false,
        });
    } else if prev.battery_low && !curr.battery_low {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_NORMAL".into(),
            severity: "success".into(),
            message: "Battery Normal: Battery voltage recovered above low threshold.".into(),
            acknowledged: false,
        });
    }

    // 3. Bypass Active Alarm
    if !prev.bypass_active && curr.bypass_active {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BYPASS_ACTIVE".into(),
            severity: "warning".into(),
            message:
                "Bypass Mode Active: Load switched to static bypass line directly from utility."
                    .into(),
            acknowledged: false,
        });
    } else if prev.bypass_active && !curr.bypass_active {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BYPASS_CLEARED".into(),
            severity: "info".into(),
            message: "Inverter Output Restored: UPS switched back from bypass to conditioned inverter mode.".into(),
            acknowledged: false,
        });
    }

    // 4. UPS Hardware Failure
    if !prev.ups_failed && curr.ups_failed {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "UPS_FAULT".into(),
            severity: "critical".into(),
            message: "UPS Hardware Fault: Internal inverter or component failure detected.".into(),
            acknowledged: false,
        });
    }

    // 5. Battery Self-Test Lifecycle
    if !prev.test_in_progress && curr.test_in_progress {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_TEST_STARTED".into(),
            severity: "info".into(),
            message: "Battery Self-Test Active: UPS is executing a battery discharge self-test under load.".into(),
            acknowledged: false,
        });
    } else if prev.test_in_progress && !curr.test_in_progress {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "BATTERY_TEST_COMPLETED".into(),
            severity: "info".into(),
            message: "Battery Self-Test Completed: Self-test completed; normal AC line mode restored.".into(),
            acknowledged: false,
        });
    }

    // 5. Output Overload (> 100%)
    if prev.output_load_pct <= 100 && curr.output_load_pct > 100 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVERLOAD".into(),
            severity: "critical".into(),
            message: format!("Overload: Output load reached {}% (exceeds 100% rated capacity). Reduce connected load immediately.", curr.output_load_pct),
            acknowledged: false,
        });
    } else if prev.output_load_pct > 100 && curr.output_load_pct <= 100 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVERLOAD_CLEARED".into(),
            severity: "info".into(),
            message: format!(
                "Overload Cleared: Output load normalized to {}%.",
                curr.output_load_pct
            ),
            acknowledged: false,
        });
    }

    // 6. Over-temperature (threshold: >= 55Â°C)
    if prev.temperature_c < 55 && curr.temperature_c >= 55 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now.clone(),
            port_name: port.to_string(),
            event_type: "OVER_TEMP".into(),
            severity: "warning".into(),
            message: format!("Over Temperature: Internal heatsink reached {}Â°C. Check ventilation and ambient airflow.", curr.temperature_c),
            acknowledged: false,
        });
    } else if prev.temperature_c >= 55 && curr.temperature_c < 50 {
        events.push(EventLogRecord {
            id: None,
            timestamp: now,
            port_name: port.to_string(),
            event_type: "TEMP_NORMAL".into(),
            severity: "info".into(),
            message: format!(
                "Temperature Normal: Internal temperature decreased to {}Â°C.",
                curr.temperature_c
            ),
            acknowledged: false,
        });
    }

    events
}

// ============================================================================
// ESP32 Hardware Bridge (IoT) Management Commands
// ============================================================================

#[tauri::command]
pub async fn get_bridge_status(
    state: State<'_, AppState>,
    port_name: Option<String>,
) -> Result<Option<BridgeStatus>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        // 1. If a BridgeTransport is currently active in MultiPortManager, query it directly
        if let Ok(status) = state_clone
            .manager
            .with_bridge_transport(port_name.as_deref(), |bridge, key| {
                let st = bridge.ping()?;
                crate::serial::bridge_adapter::emit_transport_status(&key, &st.active_transport, bridge.ws_host().as_deref());
                Ok(st)
            })
        {
            if status.wifi_connected && !status.ip.is_empty() {
                let _ = state_clone.db.set_setting("bridge_fallback_host", &status.ip);
            }
            return Ok(Some(status));
        }

        // 2. Otherwise, check available serial ports for an un-connected ESP32 Bridge
        if let Ok(ports) = serialport::available_ports() {
            for p in ports {
                if let Some(status) = probe_serial_bridge(&p.port_name) {
                    return Ok(Some(status));
                }
            }
        }

        // 3. Finally, check saved fallback WebSocket host or mDNS `upsed-bridge.local`
        let fallback_host = state_clone
            .db
            .get_setting("bridge_fallback_host")
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| BRIDGE_DEFAULT_MDNS_HOST.to_string());

        if let Some((_ws_port_id, status)) = probe_ws_bridge(&fallback_host) {
            return Ok(Some(status));
        }

        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn configure_bridge_wifi(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: Option<String>,
    ssid: String,
    password: String,
) -> Result<BridgeStatus, String> {
    let _ = app.emit(
        "ups-wifi-provision-status",
        WifiProvisionStatusEvent {
            phase: "saving".into(),
            ssid: ssid.clone(),
            ip: None,
            error: None,
        },
    );

    let state_clone = state.inner().clone();
    let ssid_clone = ssid.clone();
    let pass_clone = password.clone();
    let port_clone = port_name.clone();

    // Perform the immediate provisioning push in a blocking task (returns in <100ms)
    let status = tokio::task::spawn_blocking(move || -> Result<BridgeStatus, String> {
        // 1. Try active BridgeTransport in MultiPortManager first
        if let Ok(status) = state_clone.manager.with_bridge_transport(
            port_clone.as_deref(),
            |bridge, _key| bridge.set_wifi(&ssid_clone, &pass_clone),
        ) {
            return Ok(status);
        }

        // 2. Otherwise, scan serial ports to find the USB-connected ESP32 Bridge and push Wi-Fi config
        if let Ok(ports) = serialport::available_ports() {
            for p in ports {
                if probe_serial_bridge(&p.port_name).is_some() {
                    let bridge_id = format!("BRIDGE:{}", p.port_name);
                    let mut temp_bridge =
                        BridgeTransport::open(&bridge_id, None).map_err(|e| e.to_string())?;
                    let status = temp_bridge
                        .set_wifi(&ssid_clone, &pass_clone)
                        .map_err(|e| e.to_string())?;
                    return Ok(status);
                }
            }
        }

        Err("No connected ESP32 Hardware Bridge found over USB or Wi-Fi".into())
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = app.emit(
        "ups-wifi-provision-status",
        WifiProvisionStatusEvent {
            phase: "reconnecting".into(),
            ssid: ssid.clone(),
            ip: if status.ip.is_empty() { None } else { Some(status.ip.clone()) },
            error: None,
        },
    );

    // Spawn async background monitor to track Wi-Fi association and verify connection or rollback
    let app_handle = app.clone();
    let target_ssid = ssid.clone();
    let state_bg = state.inner().clone();
    let port_bg = port_name.clone();

    tauri::async_runtime::spawn(async move {
        // Grace period for ESP32 to disconnect and initiate association
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let start_time = Instant::now();
        let max_wait = Duration::from_secs(18);

        while start_time.elapsed() < max_wait {
            // Check 1: Query active bridge via MultiPortManager
            let query_res = state_bg.manager.with_bridge_transport(
                port_bg.as_deref(),
                |bridge, _key| bridge.ping(),
            );

            let status_opt = match query_res {
                Ok(st) => Some(st),
                Err(_) => {
                    // Check 2: Try probing mDNS
                    let mdns_probe = tokio::task::spawn_blocking(|| {
                        crate::serial::bridge_adapter::probe_ws_bridge("upsed-bridge.local")
                    }).await.ok().flatten();

                    if let Some((_, st)) = mdns_probe {
                        Some(st)
                    } else {
                        // Check fallback IP if stored
                        if let Ok(Some(saved_ip)) = state_bg.db.get_setting("bridge_fallback_host") {
                            let ip_probe = tokio::task::spawn_blocking(move || {
                                crate::serial::bridge_adapter::probe_ws_bridge(&saved_ip)
                            }).await.ok().flatten();
                            ip_probe.map(|(_, st)| st)
                        } else {
                            None
                        }
                    }
                }
            };

            if let Some(st) = status_opt {
                if st.wifi_connected {
                    if st.ssid == target_ssid {
                        // Success: Bridge associated with the new target Wi-Fi!
                        if !st.ip.is_empty() {
                            let _ = state_bg.db.set_setting("bridge_fallback_host", &st.ip);
                        }
                        let _ = app_handle.emit(
                            "ups-wifi-provision-status",
                            WifiProvisionStatusEvent {
                                phase: "connected".into(),
                                ssid: target_ssid.clone(),
                                ip: Some(st.ip.clone()),
                                error: None,
                            },
                        );
                        return;
                    } else if !st.ssid.is_empty() {
                        // Rollback: Bridge restored its previous working network
                        let _ = app_handle.emit(
                            "ups-wifi-provision-status",
                            WifiProvisionStatusEvent {
                                phase: "rollback".into(),
                                ssid: st.ssid.clone(),
                                ip: Some(st.ip.clone()),
                                error: Some(st.wifi_last_error.clone()),
                            },
                        );
                        return;
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(1500)).await;
        }

        // Timed out waiting for bridge to associate or rollback
        let _ = app_handle.emit(
            "ups-wifi-provision-status",
            WifiProvisionStatusEvent {
                phase: "failed".into(),
                ssid: target_ssid,
                ip: None,
                error: Some("Bridge did not reappear on network after 18 seconds".into()),
            },
        );
    });

    Ok(status)
}

#[tauri::command]
pub async fn sync_bridge_backlog(
    state: State<'_, AppState>,
    port_name: Option<String>,
) -> Result<usize, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let (key, status, records) = state_clone
            .manager
            .with_bridge_transport(port_name.as_deref(), |bridge, key| {
                let st = bridge.ping()?;
                let recs = bridge.drain_backlog()?;
                Ok((key, st, recs))
            })
            .map_err(|e| e.to_string())?;

        let count = commit_bridge_backlog_to_db(&state_clone.db, &key, &records, status.uptime_sec);
        if count > 0 {
            let _ = state_clone.db.insert_event(&EventLogRecord {
                id: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
                port_name: key,
                event_type: "BRIDGE_SYNC".into(),
                severity: "info".into(),
                message: format!(
                    "ESP32 Bridge Backlog Synced: Imported {} offline MessagePack telemetry samples.",
                    count
                ),
                acknowledged: true,
            });
        }
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_bridge_fallback_host(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .db
        .get_setting("bridge_fallback_host")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| BRIDGE_DEFAULT_MDNS_HOST.to_string()))
}

#[tauri::command]
pub fn set_bridge_fallback_host(state: State<'_, AppState>, host: String) -> Result<(), String> {
    state
        .db
        .set_setting("bridge_fallback_host", host.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_bridge_wifi(
    state: State<'_, AppState>,
    port_name: Option<String>,
) -> Result<Vec<WifiScanNetwork>, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        // 1. Try active BridgeTransport
        if let Ok(networks) = state_clone
            .manager
            .with_bridge_transport(port_name.as_deref(), |bridge, _key| bridge.scan_wifi())
        {
            return Ok(networks);
        }

        // 2. Scan serial ports for bridge
        if let Ok(ports) = serialport::available_ports() {
            for p in ports {
                if probe_serial_bridge(&p.port_name).is_some() {
                    let bridge_id = format!("BRIDGE:{}", p.port_name);
                    let mut temp_bridge =
                        BridgeTransport::open(&bridge_id, None).map_err(|e| e.to_string())?;
                    return temp_bridge.scan_wifi().map_err(|e| e.to_string());
                }
            }
        }

        Err("No connected ESP32 Hardware Bridge available for Wi-Fi scan".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_bridge_backlog(
    state: State<'_, AppState>,
    port_name: Option<String>,
) -> Result<usize, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        state_clone
            .manager
            .with_bridge_transport(port_name.as_deref(), |bridge, _key| bridge.clear_backlog())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn test_bridge_websocket(host: String) -> Result<WsTestResult, String> {
    tokio::task::spawn_blocking(move || {
        Ok(test_ws_connection(&host, 81))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discover_bridge_on_lan() -> Result<Vec<(String, BridgeStatus)>, String> {
    tokio::task::spawn_blocking(move || {
        Ok(scan_lan_for_bridge())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_bridge_log_history() -> Result<Vec<BridgeLogEntry>, String> {
    Ok(get_all_bridge_logs())
}

fn find_local_bridge_firmware() -> Option<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from("upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin"),
        std::path::PathBuf::from("../upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin"),
        std::path::PathBuf::from("../../upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin"),
    ];

    for path in &candidates {
        if path.exists() && path.is_file() {
            if let Ok(abs) = std::fs::canonicalize(path) {
                return Some(abs);
            }
            return Some(path.clone());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin");
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse_parts = |s: &str| -> Vec<u32> {
        let clean = s.trim_start_matches(|c: char| !c.is_ascii_digit());
        clean
            .split('.')
            .filter_map(|p| p.split('-').next().and_then(|num| num.parse().ok()))
            .collect()
    };
    let l_parts = parse_parts(latest);
    let c_parts = parse_parts(current);
    if l_parts.is_empty() || c_parts.is_empty() {
        return latest != current && !latest.is_empty();
    }
    l_parts > c_parts
}

#[tauri::command]
pub async fn check_bridge_firmware_update(
    current_version: String,
) -> Result<BridgeFirmwareCheckResult, String> {
    // 1. Check local build binary
    let (local_path, local_size, local_mod) = if let Some(path) = find_local_bridge_firmware() {
        let meta = std::fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len());
        let modified = meta
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string());
        (Some(path.to_string_lossy().to_string()), size, modified)
    } else {
        (None, None, None)
    };

    // 2. Query GitHub Releases for Sandakan/UPSED
    let mut latest_version: Option<String> = None;
    let mut update_available = false;
    let mut release_notes: Option<String> = None;
    let mut published_at: Option<String> = None;
    let mut download_url: Option<String> = None;
    let mut binary_size: Option<u64> = None;

    let client = reqwest::Client::builder()
        .user_agent("UPSED-Desktop")
        .timeout(Duration::from_secs(5))
        .build();

    if let Ok(client) = client {
        let url = "https://api.github.com/repos/Sandakan/UPSED/releases/latest";
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(release) = resp.json::<serde_json::Value>().await {
                    if let Some(tag) = release.get("tag_name").and_then(|v| v.as_str()) {
                        latest_version = Some(tag.to_string());
                        release_notes = release.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());
                        published_at = release.get("published_at").and_then(|v| v.as_str()).map(|s| s.to_string());

                        if let Some(assets) = release.get("assets").and_then(|v| v.as_array()) {
                            for asset in assets {
                                let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                if name.ends_with(".bin") {
                                    download_url = asset.get("browser_download_url").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    binary_size = asset.get("size").and_then(|v| v.as_u64());
                                    break;
                                }
                            }
                        }

                        let clean_latest = tag.trim_start_matches(|c: char| !c.is_ascii_digit());
                        let clean_current = current_version.trim_start_matches(|c: char| !c.is_ascii_digit());
                        update_available = is_version_newer(clean_latest, clean_current);
                    }
                }
            }
        }
    }

    Ok(BridgeFirmwareCheckResult {
        current_version,
        latest_version,
        update_available,
        release_notes,
        published_at,
        download_url,
        binary_size,
        local_binary_path: local_path,
        local_binary_size: local_size,
        local_binary_modified: local_mod,
    })
}

#[tauri::command]
pub async fn flash_bridge_firmware(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    port_name: Option<String>,
    source: String,
    custom_path: Option<String>,
    download_url: Option<String>,
) -> Result<String, String> {
    // 1. Strict secret verification
    let _ = dotenvy::dotenv();
    let secret = std::env::var("UPSED_OTA_SECRET").map_err(|_| {
        "UPSED_OTA_SECRET is missing from environment. Please define UPSED_OTA_SECRET in your .env file.".to_string()
    })?;
    if secret.trim().is_empty() {
        return Err("UPSED_OTA_SECRET is empty in .env. Please set a secure password.".into());
    }

    // 2. Binary retrieval
    let _ = app.emit("ups-ota-progress", OtaProgressEvent {
        phase: "downloading".into(),
        percentage: 5,
        bytes_transferred: 0,
        total_bytes: 0,
        message: "Resolving firmware binary...".into(),
    });

    let binary_bytes: Vec<u8> = match source.as_str() {
        "github" => {
            let url = download_url.ok_or_else(|| "No download_url provided for GitHub update".to_string())?;
            let _ = app.emit("ups-ota-progress", OtaProgressEvent {
                phase: "downloading".into(),
                percentage: 10,
                bytes_transferred: 0,
                total_bytes: 0,
                message: "Downloading release binary from GitHub...".into(),
            });
            let client = reqwest::Client::builder()
                .user_agent("UPSED-Desktop")
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(|e| e.to_string())?;
            let resp = client.get(&url).send().await.map_err(|e| format!("Failed to download firmware: {}", e))?;
            let bytes = resp.bytes().await.map_err(|e| format!("Failed to read firmware stream: {}", e))?;
            bytes.to_vec()
        }
        "local" => {
            let path = find_local_bridge_firmware().ok_or_else(|| {
                "Local firmware binary not found at upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin".to_string()
            })?;
            std::fs::read(&path).map_err(|e| format!("Failed to read local firmware at {}: {}", path.display(), e))?
        }
        "file" => {
            let p_str = custom_path.ok_or_else(|| "No custom file path provided".to_string())?;
            std::fs::read(&p_str).map_err(|e| format!("Failed to read custom firmware at {}: {}", p_str, e))?
        }
        _ => return Err(format!("Unknown firmware source: {}", source)),
    };

    let total_len = binary_bytes.len() as u64;
    if total_len == 0 {
        return Err("Firmware binary is empty (0 bytes)".into());
    }
    if binary_bytes[0] != 0xE9 {
        return Err(format!(
            "Invalid ESP32 firmware binary (magic byte 0x{:02X} != 0xE9). Aborting flash.",
            binary_bytes[0]
        ));
    }

    push_bridge_log(BridgeLogEntry {
        seq: 0,
        ms: 0,
        level: "INFO".into(),
        msg: format!("Starting wireless OTA flash (source: {}, size: {} bytes)", source, total_len),
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: "DESKTOP-OTA".into(),
    });

    // 3. Request on-demand OTA Lease
    let _ = app.emit("ups-ota-progress", OtaProgressEvent {
        phase: "leasing".into(),
        percentage: 20,
        bytes_transferred: 0,
        total_bytes: total_len,
        message: "Activating on-demand OTA server on ESP32 Bridge...".into(),
    });

    let state_clone = state.inner().clone();
    let port_opt = port_name.clone();
    let secret_clone = secret.trim().to_string();

    let lease_info = tokio::task::spawn_blocking(move || {
        state_clone
            .manager
            .with_bridge_transport(port_opt.as_deref(), |bridge, _key| {
                bridge.start_ota(&secret_clone)
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let target_url = format!("http://{}:{}/update", lease_info.ip, lease_info.port);
    tracing::info!("[OTA] Lease acquired: posting firmware to {}", target_url);

    // 4. Stream Upload via HTTP POST Multipart
    let _ = app.emit("ups-ota-progress", OtaProgressEvent {
        phase: "uploading".into(),
        percentage: 40,
        bytes_transferred: total_len / 4,
        total_bytes: total_len,
        message: format!("Writing firmware to ESP32 ({:.1} KB)...", total_len as f64 / 1024.0),
    });

    let part = reqwest::multipart::Part::bytes(binary_bytes)
        .file_name("firmware.bin")
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new().part("firmware", part);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(&target_url)
        .header("X-UPSED-OTA-TOKEN", secret.trim())
        .multipart(form)
        .send()
        .await;

    match res {
        Ok(response) => {
            if !response.status().is_success() {
                let err_text = response.text().await.unwrap_or_else(|_| "HTTP error".into());
                let _ = app.emit("ups-ota-progress", OtaProgressEvent {
                    phase: "error".into(),
                    percentage: 0,
                    bytes_transferred: 0,
                    total_bytes: total_len,
                    message: format!("ESP32 OTA error: {}", err_text),
                });
                return Err(format!("ESP32 OTA failed: {}", err_text));
            }
        }
        Err(e) => {
            let _ = app.emit("ups-ota-progress", OtaProgressEvent {
                phase: "error".into(),
                percentage: 0,
                bytes_transferred: 0,
                total_bytes: total_len,
                message: format!("Failed to stream firmware to bridge: {}", e),
            });
            return Err(format!("HTTP upload failed: {}", e));
        }
    }

    // 5. Post-flash reboot
    let _ = app.emit("ups-ota-progress", OtaProgressEvent {
        phase: "rebooting".into(),
        percentage: 95,
        bytes_transferred: total_len,
        total_bytes: total_len,
        message: "Firmware flashing complete! ESP32 is rebooting...".into(),
    });

    tokio::time::sleep(Duration::from_secs(4)).await;

    let _ = app.emit("ups-ota-progress", OtaProgressEvent {
        phase: "success".into(),
        percentage: 100,
        bytes_transferred: total_len,
        total_bytes: total_len,
        message: "Bridge successfully updated and rebooted!".into(),
    });

    push_bridge_log(BridgeLogEntry {
        seq: 0,
        ms: 0,
        level: "INFO".into(),
        msg: "Wireless OTA firmware flash completed successfully. Bridge rebooted.".into(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: "DESKTOP-OTA".into(),
    });

    Ok("Bridge firmware updated successfully".into())
}


