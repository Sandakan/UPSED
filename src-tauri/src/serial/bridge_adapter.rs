use crate::protocol::ProtocolError;
use crate::serial::adapter::SerialTransport;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serialport::SerialPort;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tungstenite::protocol::WebSocket;
use tungstenite::Message;

pub const BRIDGE_SERIAL_BAUD: u32 = 115200;
pub const BRIDGE_DEFAULT_WS_PORT: u16 = 81;
pub const BRIDGE_DEFAULT_MDNS_HOST: &str = "upsed-bridge.local";

/// Status snapshot returned by the ESP32-S3 Hardware Bridge (`bridge.ping` / `bridge.getStatus`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeStatus {
    pub bridge: String,
    pub fw: String,
    pub mac: String,
    pub mode: String,
    pub wifi_connected: bool,
    pub ssid: String,
    pub ip: String,
    #[serde(default = "default_hostname")]
    pub hostname: String,
    #[serde(default = "default_ws_port")]
    pub ws_port: u16,
    #[serde(default)]
    pub rssi: i32,
    #[serde(default)]
    pub wifi_last_error: String,
    #[serde(default)]
    pub log_seq: u64,
    #[serde(default)]
    pub backlog_records: usize,
    #[serde(default)]
    pub backlog_capacity: usize,
    #[serde(default)]
    pub psram_active: bool,
    #[serde(default)]
    pub psram_free: usize,
    #[serde(default)]
    pub uptime_sec: u64,
    /// Populated by Rust to indicate whether the active link is `"usb"` or `"websocket"`.
    #[serde(default)]
    pub active_transport: String,
}

fn default_hostname() -> String {
    BRIDGE_DEFAULT_MDNS_HOST.to_string()
}

fn default_ws_port() -> u16 {
    BRIDGE_DEFAULT_WS_PORT
}

/// Offline telemetry record deserialized from the ESP32's MessagePack PSRAM ring buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeBacklogRecord {
    pub ts: u64,
    pub raw: String,
}

/// Real-time diagnostic log entry streamed from the ESP32 or Rust Bridge subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeLogEntry {
    pub seq: u64,
    pub ms: u64,
    pub level: String,
    pub msg: String,
    pub timestamp: String,
    pub source: String,
}

/// Discovered 2.4GHz Wi-Fi network from the ESP32 scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiScanNetwork {
    pub ssid: String,
    pub rssi: i32,
    pub open: bool,
    pub channel: i32,
}

/// Result of testing a WebSocket connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsTestResult {
    pub reachable: bool,
    pub host: String,
    pub port: u16,
    pub latency_ms: u64,
    pub status: Option<BridgeStatus>,
    pub error: Option<String>,
}

// Global buffer for recent Bridge diagnostic logs (capacity: 250)
static BRIDGE_LOG_BUFFER: OnceLock<Mutex<Vec<BridgeLogEntry>>> = OnceLock::new();
static BRIDGE_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static GLOBAL_LAST_ACK_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn set_bridge_app_handle(handle: tauri::AppHandle) {
    let _ = BRIDGE_APP_HANDLE.set(handle);
}

pub fn get_bridge_app_handle() -> Option<&'static tauri::AppHandle> {
    BRIDGE_APP_HANDLE.get()
}

pub fn get_bridge_log_buffer() -> &'static Mutex<Vec<BridgeLogEntry>> {
    BRIDGE_LOG_BUFFER.get_or_init(|| Mutex::new(Vec::with_capacity(250)))
}

pub fn push_bridge_log(entry: BridgeLogEntry) {
    if let Ok(mut buf) = get_bridge_log_buffer().lock() {
        // Deduplicate incoming ESP32-FW notifications: if this sequence number is already recorded with identical text, skip
        if entry.source == "ESP32-FW"
            && entry.seq > 0
            && buf.iter().any(|existing| existing.seq == entry.seq && existing.msg == entry.msg)
        {
            return;
        }

        match entry.level.as_str() {
            "DEBUG" => tracing::debug!("[{}] {}", entry.source, entry.msg),
            "WARN" => tracing::warn!("[{}] {}", entry.source, entry.msg),
            "ERROR" => tracing::error!("[{}] {}", entry.source, entry.msg),
            _ => tracing::info!("[{}] {}", entry.source, entry.msg),
        }

        if let Some(app) = get_bridge_app_handle() {
            let _ = app.emit("upsed://bridge-log", &entry);
        }

        if buf.len() >= 250 {
            buf.remove(0);
        }
        buf.push(entry);
    }
}

pub fn get_all_bridge_logs() -> Vec<BridgeLogEntry> {
    if let Ok(buf) = get_bridge_log_buffer().lock() {
        buf.clone()
    } else {
        Vec::new()
    }
}

/// Dual-Mode ESP32 Hardware Bridge Transport (`SerialTransport` implementation).
pub struct BridgeTransport {
    port_identifier: String,
    serial_port_name: Option<String>,
    serial_port: Option<Box<dyn SerialPort>>,
    ws_host: Option<String>,
    ws_port: u16,
    ws_socket: Option<WebSocket<TcpStream>>,
    active_medium: String,
    next_rpc_id: u64,
    last_status: Arc<Mutex<Option<BridgeStatus>>>,
}

impl BridgeTransport {
    pub fn open(
        port_identifier: &str,
        fallback_ws_host: Option<String>,
    ) -> Result<Self, ProtocolError> {
        push_bridge_log(BridgeLogEntry {
            seq: 0,
            ms: 0,
            level: "INFO".into(),
            msg: format!("Opening BridgeTransport for '{}' (fallback host: {:?})", port_identifier, fallback_ws_host),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "BRIDGE-RPC".into(),
        });

        let mut serial_port_name = None;
        let mut ws_host = fallback_ws_host.filter(|s| !s.trim().is_empty());
        let mut ws_port = BRIDGE_DEFAULT_WS_PORT;

        if let Some(ws_target) = port_identifier.strip_prefix("BRIDGE:WS:") {
            let (host, port) = parse_host_port(ws_target, BRIDGE_DEFAULT_WS_PORT);
            ws_host = Some(host);
            ws_port = port;
        } else if let Some(com_port) = port_identifier.strip_prefix("BRIDGE:") {
            serial_port_name = Some(com_port.to_string());
        } else {
            serial_port_name = Some(port_identifier.to_string());
        }

        let initial_medium = if serial_port_name.is_some() {
            "usb".to_string()
        } else {
            "websocket".to_string()
        };

        let mut transport = Self {
            port_identifier: port_identifier.to_string(),
            serial_port_name,
            serial_port: None,
            ws_host,
            ws_port,
            ws_socket: None,
            active_medium: initial_medium,
            next_rpc_id: 1,
            last_status: Arc::new(Mutex::new(None)),
        };

        let status = transport.ping()?;
        push_bridge_log(BridgeLogEntry {
            seq: 0,
            ms: 0,
            level: "INFO".into(),
            msg: format!("BridgeTransport connected via {}! (ESP32 MAC: {}, IP: {}, Mode: {})", status.active_transport, status.mac, status.ip, status.mode),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "BRIDGE-RPC".into(),
        });

        Ok(transport)
    }

    pub fn last_status_handle(&self) -> Arc<Mutex<Option<BridgeStatus>>> {
        self.last_status.clone()
    }

    pub fn ping(&mut self) -> Result<BridgeStatus, ProtocolError> {
        let (val, medium) = self.call_rpc("bridge.ping", json!({}))?;
        let mut status: BridgeStatus = serde_json::from_value(val)
            .map_err(|e| ProtocolError::ParseError(format!("Invalid bridge.ping payload: {}", e)))?;
        status.active_transport = medium;

        if status.wifi_connected && !status.ip.is_empty() {
            self.ws_host = Some(status.ip.clone());
            self.ws_port = if status.ws_port > 0 { status.ws_port } else { BRIDGE_DEFAULT_WS_PORT };
        }

        if let Ok(mut guard) = self.last_status.lock() {
            *guard = Some(status.clone());
        }
        Ok(status)
    }

    pub fn set_wifi(&mut self, ssid: &str, pass: &str) -> Result<BridgeStatus, ProtocolError> {
        push_bridge_log(BridgeLogEntry {
            seq: 0,
            ms: 0,
            level: "INFO".into(),
            msg: format!("Pushing Wi-Fi configuration for SSID: '{}'", ssid),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "BRIDGE-RPC".into(),
        });

        let (val, medium) = self.call_rpc_with_timeout(
            "bridge.setWifi",
            json!({ "ssid": ssid, "pass": pass }),
            Duration::from_secs(14),
        )?;

        let mut status: BridgeStatus = serde_json::from_value(val)
            .map_err(|e| ProtocolError::ParseError(format!("Invalid bridge.setWifi payload: {}", e)))?;
        status.active_transport = medium;

        if status.wifi_connected && !status.ip.is_empty() {
            self.ws_host = Some(status.ip.clone());
            push_bridge_log(BridgeLogEntry {
                seq: 0,
                ms: 0,
                level: "INFO".into(),
                msg: format!("Wi-Fi connected! ESP32 IP is {}, WebSocket ready on port {}", status.ip, status.ws_port),
                timestamp: chrono::Utc::now().to_rfc3339(),
                source: "BRIDGE-RPC".into(),
            });
        } else {
            push_bridge_log(BridgeLogEntry {
                seq: 0,
                ms: 0,
                level: "WARN".into(),
                msg: format!("Wi-Fi did not connect immediately: {}", status.wifi_last_error),
                timestamp: chrono::Utc::now().to_rfc3339(),
                source: "BRIDGE-RPC".into(),
            });
        }

        if let Ok(mut guard) = self.last_status.lock() {
            *guard = Some(status.clone());
        }
        Ok(status)
    }

    pub fn scan_wifi(&mut self) -> Result<Vec<WifiScanNetwork>, ProtocolError> {
        push_bridge_log(BridgeLogEntry {
            seq: 0,
            ms: 0,
            level: "INFO".into(),
            msg: "Requesting ESP32 2.4GHz Wi-Fi scan...".into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "BRIDGE-RPC".into(),
        });

        let (val, _) = self.call_rpc_with_timeout(
            "bridge.scanWifi",
            json!({}),
            Duration::from_secs(10),
        )?;

        let networks: Vec<WifiScanNetwork> = val
            .get("networks")
            .cloned()
            .and_then(|arr| serde_json::from_value(arr).ok())
            .unwrap_or_default();

        push_bridge_log(BridgeLogEntry {
            seq: 0,
            ms: 0,
            level: "INFO".into(),
            msg: format!("Wi-Fi scan returned {} networks", networks.len()),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "BRIDGE-RPC".into(),
        });

        Ok(networks)
    }

    pub fn drain_backlog(&mut self) -> Result<Vec<BridgeBacklogRecord>, ProtocolError> {
        let mut all_records = Vec::new();
        for _ in 0..200 {
            let (val, _) = self.call_rpc("bridge.getBacklog", json!({ "limit": 50 }))?;
            let batch: Vec<BridgeBacklogRecord> = val
                .get("records")
                .cloned()
                .and_then(|arr| serde_json::from_value(arr).ok())
                .unwrap_or_default();

            if batch.is_empty() {
                break;
            }
            let fetched_count = batch.len();
            all_records.extend(batch);

            let _ = self.call_rpc("bridge.clearBacklog", json!({ "count": fetched_count }))?;
            let total_remaining = val
                .get("total_remaining")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            if total_remaining <= fetched_count {
                break;
            }
        }
        Ok(all_records)
    }

    pub fn clear_backlog(&mut self) -> Result<usize, ProtocolError> {
        let (val, _) = self.call_rpc("bridge.clearBacklog", json!({ "count": 0 }))?;
        let remaining = val
            .get("remaining")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        Ok(remaining)
    }

    pub fn call_rpc(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<(Value, String), ProtocolError> {
        self.call_rpc_with_timeout(method, params, Duration::from_millis(2500))
    }

    pub fn call_rpc_with_timeout(
        &mut self,
        method: &str,
        mut params: Value,
        timeout: Duration,
    ) -> Result<(Value, String), ProtocolError> {
        let rpc_id = self.next_rpc_id;
        self.next_rpc_id = self.next_rpc_id.wrapping_add(1);

        // Option 1: Attach ack_seq so the ESP32 flushes unacknowledged real-time logs
        if let Some(obj) = params.as_object_mut() {
            obj.insert("ack_seq".to_string(), json!(GLOBAL_LAST_ACK_SEQ.load(Ordering::Relaxed)));
        }

        let request_json = json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
            "params": params,
        });
        let serialized_req = serde_json::to_string(&request_json)
            .map_err(|e| ProtocolError::IoError(e.to_string()))?;

        // 1. Primary Link: Check USB Serial
        if let Some(ref port_name) = self.serial_port_name {
            let mut should_try_usb = self.active_medium == "usb";

            if self.active_medium == "websocket" {
                // Currently on Wi-Fi failover: check if COM port has physically reappeared
                let is_available = serialport::available_ports()
                    .map(|ports| ports.iter().any(|p| p.port_name == *port_name))
                    .unwrap_or(false);

                if is_available {
                    push_bridge_log(BridgeLogEntry {
                        seq: 0,
                        ms: 0,
                        level: "INFO".into(),
                        msg: format!("USB port '{}' reconnected! Switching transport from WebSocket back to USB", port_name),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        source: "BRIDGE-RPC".into(),
                    });
                    self.active_medium = "usb".to_string();
                    should_try_usb = true;
                } else {
                    tracing::debug!("[BRIDGE-RPC] USB port '{}' not detected while on WebSocket; continuing on WebSocket", port_name);
                }
            }

            if should_try_usb {
                match self.try_serial_rpc(rpc_id, &serialized_req, timeout) {
                    Ok(res_val) => {
                        self.active_medium = "usb".to_string();
                        self.update_cached_transport("usb", &res_val);
                        self.ws_socket = None;
                        return Ok((res_val, "usb".to_string()));
                    }
                    Err(ProtocolError::CommandNak) => return Err(ProtocolError::CommandNak),
                    Err(err) => {
                        push_bridge_log(BridgeLogEntry {
                            seq: 0,
                            ms: 0,
                            level: "WARN".into(),
                            msg: format!("USB Serial RPC failed ({:?}); failing over to Wi-Fi WebSocket...", err),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            source: "BRIDGE-RPC".into(),
                        });
                        self.serial_port = None;
                        self.active_medium = "websocket".to_string();
                    }
                }
            }
        }

        // 2. Auto-Failover Link: Try Wi-Fi WebSocket
        match self.try_ws_rpc(rpc_id, &serialized_req, timeout) {
            Ok(res_val) => {
                self.active_medium = "websocket".to_string();
                self.update_cached_transport("websocket", &res_val);
                Ok((res_val, "websocket".to_string()))
            }
            Err(ws_err) => {
                push_bridge_log(BridgeLogEntry {
                    seq: 0,
                    ms: 0,
                    level: "ERROR".into(),
                    msg: format!("WebSocket RPC failed: {:?}", ws_err),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    source: "BRIDGE-RPC".into(),
                });
                Err(ws_err)
            }
        }
    }

    fn update_cached_transport(&mut self, medium: &str, result_val: &Value) {
        if let Some(ip) = result_val.get("ip").and_then(|v| v.as_str()) {
            if !ip.is_empty() {
                self.ws_host = Some(ip.to_string());
            }
        }
        if let Ok(mut guard) = self.last_status.lock() {
            if let Some(ref mut st) = *guard {
                st.active_transport = medium.to_string();
                if let Some(backlog) = result_val.get("backlog_records").and_then(|v| v.as_u64()) {
                    st.backlog_records = backlog as usize;
                }
                if let Some(seq) = result_val.get("log_seq").and_then(|v| v.as_u64()) {
                    st.log_seq = seq;
                }
            }
        }
    }

    fn try_serial_rpc(
        &mut self,
        expected_id: u64,
        serialized_req: &str,
        timeout: Duration,
    ) -> Result<Value, ProtocolError> {
        let port_name = self
            .serial_port_name
            .as_ref()
            .ok_or_else(|| ProtocolError::IoError("No serial port configured".into()))?;

        if self.serial_port.is_none() {
            let opened = serialport::new(port_name, BRIDGE_SERIAL_BAUD)
                .timeout(timeout)
                .open()
                .map_err(|e| ProtocolError::IoError(e.to_string()))?;
            self.serial_port = Some(opened);
        }

        let port = self.serial_port.as_mut().unwrap();
        let _ = port.set_timeout(timeout);
        let _ = port.clear(serialport::ClearBuffer::Input);

        let mut payload = serialized_req.as_bytes().to_vec();
        payload.push(b'\n');

        port.write_all(&payload)
            .map_err(|e| ProtocolError::IoError(e.to_string()))?;
        port.flush()
            .map_err(|e| ProtocolError::IoError(e.to_string()))?;

        let mut reader = BufReader::new(port);
        let start = Instant::now();

        // Read loop: demultiplex real-time notifications until matching RPC ID response arrives
        while start.elapsed() < timeout {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || !trimmed.starts_with('{') {
                        continue; // Skip boot / non-JSON lines
                    }

                    if let Ok(doc) = serde_json::from_str::<Value>(trimmed) {
                        // Check if this is an unprompted real-time notification
                        if doc.get("id").is_none() || doc.get("id").map(|v| v.is_null()).unwrap_or(false) {
                            if doc.get("method").and_then(|m| m.as_str()) == Some("bridge.log") {
                                process_bridge_notification(&doc);
                            }
                            continue;
                        }

                        // Response frame: check if it matches our expected RPC ID
                        let resp_id = doc.get("id").and_then(|v| v.as_u64());
                        if resp_id == Some(expected_id) {
                            return parse_jsonrpc_doc(&doc);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
                Err(e) => return Err(ProtocolError::IoError(e.to_string())),
            }
        }

        Err(ProtocolError::Timeout)
    }

    fn try_ws_rpc(
        &mut self,
        expected_id: u64,
        serialized_req: &str,
        timeout: Duration,
    ) -> Result<Value, ProtocolError> {
        let candidate_hosts: Vec<String> = match &self.ws_host {
            Some(host) if host != BRIDGE_DEFAULT_MDNS_HOST => {
                vec![host.clone(), BRIDGE_DEFAULT_MDNS_HOST.to_string()]
            }
            _ => vec![BRIDGE_DEFAULT_MDNS_HOST.to_string()],
        };

        let mut attempt_errors = Vec::new();

        for host in candidate_hosts {
            if self.ws_socket.is_none() {
                if let Ok(ws) = connect_ws(&host, self.ws_port, timeout) {
                    self.ws_socket = Some(ws);
                    self.ws_host = Some(host.clone());
                } else {
                    attempt_errors.push(format!("ws://{}:{} (connection failed)", host, self.ws_port));
                    continue;
                }
            }

            if let Some(ref mut ws) = self.ws_socket {
                let _ = ws.get_ref().set_read_timeout(Some(timeout));
                let _ = ws.get_ref().set_write_timeout(Some(timeout));

                if let Err(e) = ws.send(Message::Text(serialized_req.to_string())) {
                    self.ws_socket = None;
                    attempt_errors.push(format!("ws://{}:{} send error: {}", host, self.ws_port, e));
                    continue;
                }

                let start = Instant::now();
                while start.elapsed() < timeout {
                    match ws.read() {
                        Ok(Message::Text(txt)) => {
                            let trimmed = txt.trim();
                            if let Ok(doc) = serde_json::from_str::<Value>(trimmed) {
                                if doc.get("id").is_none() || doc.get("id").map(|v| v.is_null()).unwrap_or(false) {
                                    if doc.get("method").and_then(|m| m.as_str()) == Some("bridge.log") {
                                        process_bridge_notification(&doc);
                                    }
                                    continue;
                                }

                                let resp_id = doc.get("id").and_then(|v| v.as_u64());
                                if resp_id == Some(expected_id) {
                                    return parse_jsonrpc_doc(&doc);
                                }
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            self.ws_socket = None;
                            attempt_errors.push(format!("ws://{}:{} read error: {}", host, self.ws_port, e));
                            break;
                        }
                    }
                }
            }
        }

        if attempt_errors.is_empty() {
            Err(ProtocolError::Timeout)
        } else {
            Err(ProtocolError::IoError(format!(
                "Failed to communicate with bridge WebSocket across hosts: {}",
                attempt_errors.join("; ")
            )))
        }
    }
}

fn process_bridge_notification(doc: &Value) {
    if let Some(params) = doc.get("params") {
        let seq = params.get("seq").and_then(|v| v.as_u64()).unwrap_or(0);
        let ms = params.get("ms").and_then(|v| v.as_u64()).unwrap_or(0);
        let level = params.get("level").and_then(|v| v.as_str()).unwrap_or("INFO").to_string();
        let msg = params.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let current = GLOBAL_LAST_ACK_SEQ.load(Ordering::Relaxed);
        if seq > current || (seq <= 5 && current > 100) {
            GLOBAL_LAST_ACK_SEQ.store(seq, Ordering::Relaxed);
        }

        push_bridge_log(BridgeLogEntry {
            seq,
            ms,
            level,
            msg,
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "ESP32-FW".to_string(),
        });
    }
}

impl SerialTransport for BridgeTransport {
    fn send_command(&mut self, cmd_str: &str) -> Result<String, ProtocolError> {
        let clean_cmd = cmd_str.trim_end_matches(['\r', '\n']);
        let (result, _) = match self.call_rpc("ups.cmd", json!({ "cmd": clean_cmd })) {
            Ok(res) => res,
            Err(ProtocolError::Timeout)
                if clean_cmd == "Q"
                    || clean_cmd == "CT"
                    || clean_cmd == "BZON"
                    || clean_cmd == "BZOFF" =>
            {
                return Ok("(OK".into());
            }
            Err(e) => return Err(e),
        };

        let raw = result
            .get("raw")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ProtocolError::ParseError("Missing 'raw' field in bridge ups.cmd response".into())
            })?
            .trim()
            .to_string();

        if raw.starts_with("(NAK") {
            return Err(ProtocolError::CommandNak);
        }

        Ok(raw)
    }

    fn port_name(&self) -> &str {
        &self.port_identifier
    }

    fn as_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }
}

pub fn parse_jsonrpc_doc(doc: &Value) -> Result<Value, ProtocolError> {
    if let Some(err_obj) = doc.get("error") {
        if !err_obj.is_null() {
            let code = err_obj.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
            let msg = err_obj
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Bridge RPC error");
            if code == -32000 {
                return Err(ProtocolError::Timeout);
            }
            return Err(ProtocolError::IoError(format!(
                "Bridge RPC error ({}): {}",
                code, msg
            )));
        }
    }

    doc.get("result")
        .cloned()
        .ok_or_else(|| ProtocolError::ParseError("Missing 'result' in JSON-RPC response".into()))
}

pub fn parse_jsonrpc_response(raw_json: &str) -> Result<Value, ProtocolError> {
    let doc: Value = serde_json::from_str(raw_json)
        .map_err(|e| ProtocolError::ParseError(format!("Invalid JSON-RPC response: {}", e)))?;
    parse_jsonrpc_doc(&doc)
}

fn parse_host_port(input: &str, default_port: u16) -> (String, u16) {
    let trimmed = input
        .trim()
        .trim_start_matches("ws://")
        .trim_end_matches('/');
    if let Some((h, p_str)) = trimmed.rsplit_once(':') {
        if let Ok(p) = p_str.parse::<u16>() {
            return (h.to_string(), p);
        }
    }
    (trimmed.to_string(), default_port)
}

fn connect_ws(
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<WebSocket<TcpStream>, ProtocolError> {
    let addr_str = format!("{}:{}", host, port);
    let mut addrs = addr_str
        .to_socket_addrs()
        .map_err(|e| ProtocolError::IoError(e.to_string()))?;
    let sock_addr = addrs
        .next()
        .ok_or_else(|| ProtocolError::IoError(format!("Could not resolve {}", addr_str)))?;

    let stream = TcpStream::connect_timeout(&sock_addr, timeout)
        .map_err(|e| ProtocolError::IoError(e.to_string()))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let _ = stream.set_nodelay(true);

    let ws_url = format!("ws://{}:{}/", host, port);
    let (ws, _resp) = tungstenite::client(ws_url.as_str(), stream)
        .map_err(|e| ProtocolError::IoError(e.to_string()))?;
    Ok(ws)
}

pub fn probe_serial_bridge(port_name: &str) -> Option<BridgeStatus> {
    let mut port = serialport::new(port_name, BRIDGE_SERIAL_BAUD)
        .timeout(Duration::from_millis(800))
        .open()
        .ok()?;

    let _ = port.clear(serialport::ClearBuffer::Input);
    let ping_req = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"bridge.ping\",\"params\":{}}\n";
    port.write_all(ping_req).ok()?;
    port.flush().ok()?;

    let mut reader = BufReader::new(port);
    let mut line = String::new();
    let n = reader.read_line(&mut line).ok()?;
    if n == 0 {
        return None;
    }

    let res_val = parse_jsonrpc_response(line.trim()).ok()?;
    let mut status: BridgeStatus = serde_json::from_value(res_val).ok()?;
    if status.bridge != "UPSED_BRIDGE_V1" {
        return None;
    }
    status.active_transport = "usb".to_string();
    Some(status)
}

pub fn probe_ws_bridge(host_or_addr: &str) -> Option<(String, BridgeStatus)> {
    let (host, port) = parse_host_port(host_or_addr, BRIDGE_DEFAULT_WS_PORT);
    let mut ws = connect_ws(&host, port, Duration::from_millis(900)).ok()?;

    let ping_req = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"bridge.ping\",\"params\":{}}";
    ws.send(Message::Text(ping_req.into())).ok()?;

    if let Ok(Message::Text(txt)) = ws.read() {
        let res_val = parse_jsonrpc_response(txt.as_str().trim()).ok()?;
        let mut status: BridgeStatus = serde_json::from_value(res_val).ok()?;
        if status.bridge == "UPSED_BRIDGE_V1" {
            status.active_transport = "websocket".to_string();
            let canonical_port_name = format!("BRIDGE:WS:{}:{}", host, port);
            return Some((canonical_port_name, status));
        }
    }
    None
}

/// Test a WebSocket link, reporting latency in milliseconds and bridge status.
pub fn test_ws_connection(host: &str, port: u16) -> WsTestResult {
    let start = Instant::now();
    let (clean_host, clean_port) = parse_host_port(host, port);

    match connect_ws(&clean_host, clean_port, Duration::from_millis(1500)) {
        Ok(mut ws) => {
            let ping_req = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"bridge.ping\",\"params\":{}}";
            if let Err(e) = ws.send(Message::Text(ping_req.into())) {
                return WsTestResult {
                    reachable: false,
                    host: clean_host,
                    port: clean_port,
                    latency_ms: start.elapsed().as_millis() as u64,
                    status: None,
                    error: Some(e.to_string()),
                };
            }

            match ws.read() {
                Ok(Message::Text(txt)) => {
                    let latency_ms = start.elapsed().as_millis() as u64;
                    if let Ok(res_val) = parse_jsonrpc_response(txt.as_str().trim()) {
                        if let Ok(mut status) = serde_json::from_value::<BridgeStatus>(res_val) {
                            status.active_transport = "websocket".to_string();
                            return WsTestResult {
                                reachable: true,
                                host: clean_host,
                                port: clean_port,
                                latency_ms,
                                status: Some(status),
                                error: None,
                            };
                        }
                    }
                    WsTestResult {
                        reachable: false,
                        host: clean_host,
                        port: clean_port,
                        latency_ms,
                        status: None,
                        error: Some("Invalid JSON-RPC payload from bridge".into()),
                    }
                }
                Ok(_) => WsTestResult {
                    reachable: false,
                    host: clean_host,
                    port: clean_port,
                    latency_ms: start.elapsed().as_millis() as u64,
                    status: None,
                    error: Some("Unexpected non-text WebSocket frame".into()),
                },
                Err(e) => WsTestResult {
                    reachable: false,
                    host: clean_host,
                    port: clean_port,
                    latency_ms: start.elapsed().as_millis() as u64,
                    status: None,
                    error: Some(e.to_string()),
                },
            }
        }
        Err(e) => WsTestResult {
            reachable: false,
            host: clean_host,
            port: clean_port,
            latency_ms: start.elapsed().as_millis() as u64,
            status: None,
            error: Some(e.to_string()),
        },
    }
}

/// Sweeps the local /24 subnet for listening UPSED WebSocket bridges on port 81.
pub fn scan_lan_for_bridge() -> Vec<(String, BridgeStatus)> {
    let mut discovered = Vec::new();

    // Determine candidate subnets
    let mut candidate_ips: Vec<String> = Vec::new();
    let local_subnets = ["192.168.1", "192.168.0", "192.168.8", "10.0.0"];

    for subnet in local_subnets {
        // Quick probe of gateway to see if subnet is present
        let test_addr = format!("{}.1:{}", subnet, BRIDGE_DEFAULT_WS_PORT);
        if let Ok(mut addrs) = test_addr.to_socket_addrs() {
            if let Some(sock_addr) = addrs.next() {
                if TcpStream::connect_timeout(&sock_addr, Duration::from_millis(50)).is_ok() {
                    for i in 2..254 {
                        candidate_ips.push(format!("{}.{}", subnet, i));
                    }
                    break;
                }
            }
        }
    }

    if candidate_ips.is_empty() {
        for i in 2..254 {
            candidate_ips.push(format!("192.168.1.{}", i));
        }
    }

    // Sweep candidates with short timeout
    for ip in candidate_ips {
        let addr = format!("{}:{}", ip, BRIDGE_DEFAULT_WS_PORT);
        if let Ok(mut addrs) = addr.to_socket_addrs() {
            if let Some(sock_addr) = addrs.next() {
                if let Ok(stream) = TcpStream::connect_timeout(&sock_addr, Duration::from_millis(150)) {
                    drop(stream);
                    if let Some((port_name, status)) = probe_ws_bridge(&ip) {
                        discovered.push((port_name, status));
                    }
                }
            }
        }
    }

    discovered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_jsonrpc_response_success() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{"raw":"(223.5 223.4 229.8 028 50.0 2.26 30.2 00000001"}}"#;
        let val = parse_jsonrpc_response(raw).expect("Should parse valid JSON-RPC result");
        assert_eq!(
            val.get("raw").and_then(|v| v.as_str()),
            Some("(223.5 223.4 229.8 028 50.0 2.26 30.2 00000001")
        );
    }

    #[test]
    fn test_parse_jsonrpc_response_timeout_error() {
        let raw = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"UPS serial read timeout"}}"#;
        let err = parse_jsonrpc_response(raw).expect_err("Should return error on JSON-RPC error");
        assert_eq!(err, ProtocolError::Timeout);
    }

    #[test]
    fn test_parse_host_port() {
        assert_eq!(
            parse_host_port("192.168.1.142:81", 81),
            ("192.168.1.142".to_string(), 81)
        );
        assert_eq!(
            parse_host_port("upsed-bridge.local", 81),
            ("upsed-bridge.local".to_string(), 81)
        );
    }

    #[test]
    fn test_push_and_get_bridge_log() {
        let entry = BridgeLogEntry {
            seq: 1,
            ms: 500,
            level: "INFO".into(),
            msg: "Test log message".into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source: "TEST".into(),
        };
        push_bridge_log(entry);
        let logs = get_all_bridge_logs();
        assert!(!logs.is_empty());
        assert_eq!(logs.last().unwrap().msg, "Test log message");
    }
}
