use crate::protocol::{
    decode_response, encode_command, parse_device_id, parse_firmware_version, parse_protocol_id,
    DeviceCapabilities, ProtocolError, Q1Status,
};
use crate::serial::scanner::{
    compute_hardware_signature, extract_hid_id, generate_unique_id, is_candidate_ups_hid,
    DiscoveredDevice,
};
use hidapi::{HidApi, HidDevice};
use std::collections::HashMap;
use std::ffi::CString;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::OnceLock;
use std::time::Duration;

/// Dual reply channel supporting both synchronous callers (with timeout) and Tokio async callers.
pub enum Reply<T> {
    Sync(SyncSender<T>),
    Async(tokio::sync::oneshot::Sender<T>),
}

impl<T> Reply<T> {
    pub fn send(self, val: T) {
        match self {
            Reply::Sync(sender) => {
                let _ = sender.send(val);
            }
            Reply::Async(sender) => {
                let _ = sender.send(val);
            }
        }
    }
}

/// Target descriptor for opening a HID device.
#[derive(Clone, Debug)]
pub enum HidOpenTarget {
    VidPid(u16, u16),
    Path(CString),
    PortName(String),
}

/// Requests dispatched to the dedicated HID actor thread.
pub enum HidActorCommand {
    ScanDevices {
        active_ports: Vec<String>,
        reply: Reply<Vec<DiscoveredDevice>>,
    },
    ResolveUsbUuid {
        port_name: String,
        reply: Reply<Option<String>>,
    },
    OpenDevice {
        target: HidOpenTarget,
        port_name: String,
        reply: Reply<Result<u64, ProtocolError>>,
    },
    SendCommand {
        device_id: u64,
        port_name: String,
        cmd_str: String,
        timeout: Duration,
        reply: Reply<Result<String, ProtocolError>>,
    },
    CloseDevice {
        device_id: u64,
    },
    InspectApi(Box<dyn FnOnce(&HidApi) + Send>),
    Shutdown,
}

/// Global handle to the dedicated HID actor thread.
struct HidActorHandle {
    tx: SyncSender<HidActorCommand>,
}

static HID_ACTOR: OnceLock<HidActorHandle> = OnceLock::new();

fn get_actor() -> &'static HidActorHandle {
    HID_ACTOR.get_or_init(|| {
        let (tx, rx) = sync_channel::<HidActorCommand>(64);
        std::thread::Builder::new()
            .name("upsed-hid-actor".to_string())
            .spawn(move || {
                run_actor_loop(rx);
            })
            .expect("Failed to spawn dedicated upsed-hid-actor thread");

        HidActorHandle { tx }
    })
}

/// Executes the main event loop pinned to the dedicated HID OS thread.
/// All interactions with IOKit/hidapi (including creation, enumeration, report I/O, and closing)
/// are strictly confined to this thread to prevent macOS CFRunLoop PAC verification crashes.
fn run_actor_loop(rx: Receiver<HidActorCommand>) {
    tracing::info!("Dedicated upsed-hid-actor thread started");

    let mut hid_api = match HidApi::new() {
        Ok(api) => Some(api),
        Err(e) => {
            tracing::warn!("Failed to initialize HidApi on actor thread: {}", e);
            None
        }
    };

    let mut open_devices: HashMap<u64, HidDevice> = HashMap::new();
    let mut next_device_id: u64 = 1;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            HidActorCommand::ScanDevices {
                active_ports,
                reply,
            } => {
                let res = if let Some(ref mut api) = hid_api {
                    if let Err(e) = api.refresh_devices() {
                        tracing::warn!("Failed to refresh HID devices: {}", e);
                    }
                    scan_hid_devices_on_actor(api, &active_ports)
                } else {
                    Vec::new()
                };
                reply.send(res);
            }
            HidActorCommand::ResolveUsbUuid { port_name, reply } => {
                let res = if let Some(ref mut api) = hid_api {
                    if let Err(e) = api.refresh_devices() {
                        tracing::warn!("Failed to refresh HID devices for UUID: {}", e);
                    }
                    resolve_usb_uuid_on_actor(api, &port_name)
                } else {
                    None
                };
                reply.send(res);
            }
            HidActorCommand::OpenDevice {
                target,
                port_name,
                reply,
            } => {
                let res = if let Some(ref mut api) = hid_api {
                    open_device_on_actor(
                        api,
                        target,
                        &port_name,
                        &mut open_devices,
                        &mut next_device_id,
                    )
                } else {
                    Err(ProtocolError::IoError("HID subsystem not available".into()))
                };
                reply.send(res);
            }
            HidActorCommand::SendCommand {
                device_id,
                port_name,
                cmd_str,
                timeout,
                reply,
            } => {
                let res = if let Some(dev) = open_devices.get(&device_id) {
                    execute_hid_command(dev, &port_name, &cmd_str, timeout)
                } else {
                    Err(ProtocolError::IoError(format!(
                        "HID device handle {} for port {} not found or already closed",
                        device_id, port_name
                    )))
                };
                reply.send(res);
            }
            HidActorCommand::CloseDevice { device_id } => {
                if let Some(_dev) = open_devices.remove(&device_id) {
                    tracing::debug!("Closed and dropped HID device ID {}", device_id);
                }
            }
            HidActorCommand::InspectApi(f) => {
                if let Some(ref api) = hid_api {
                    f(api);
                }
            }
            HidActorCommand::Shutdown => {
                tracing::info!("upsed-hid-actor thread received shutdown request, releasing all devices");
                open_devices.clear();
                drop(hid_api);
                break;
            }
        }
    }

    tracing::info!("upsed-hid-actor thread exiting");
}

/// Scans candidate HID devices on the actor thread using the single existing HidApi context.
fn scan_hid_devices_on_actor(api: &mut HidApi, active_ports: &[String]) -> Vec<DiscoveredDevice> {
    let mut discovered = Vec::new();

    // Snapshot candidate device paths, VID, PID, serial, and port names
    struct Candidate {
        path: CString,
        port_name: String,
        usb_uuid: Option<String>,
    }

    let mut candidates = Vec::new();
    for dev in api.device_list() {
        if is_candidate_ups_hid(dev) {
            let id_str = extract_hid_id(dev);
            let port_name = format!(
                "USB:{:04X}:{:04X}:{}",
                dev.vendor_id(),
                dev.product_id(),
                id_str
            );

            // Skip if this port or base device is already active in MultiPortManager
            if active_ports.iter().any(|p| p == &port_name || port_name.starts_with(p)) {
                tracing::debug!("Skipping already active HID UPS on {}", port_name);
                continue;
            }

            let path_str = dev.path().to_string_lossy().to_string();
            let usb_uuid = if !path_str.is_empty() {
                Some(path_str)
            } else {
                dev.serial_number().map(|s| s.to_string())
            };

            candidates.push(Candidate {
                path: dev.path().to_owned(),
                port_name,
                usb_uuid,
            });
        }
    }

    for c in candidates {
        // Avoid duplicate probing of the same port name
        if discovered.iter().any(|d: &DiscoveredDevice| d.port_name == c.port_name) {
            continue;
        }

        if let Ok(dev) = api.open_path(&c.path) {
            if let Some(discovered_device) = probe_candidate_on_actor(&dev, &c.port_name, c.usb_uuid) {
                tracing::info!(
                    "Discovered USB HID UPS on {} (ID: {}) with protocol ID: {}",
                    discovered_device.port_name,
                    discovered_device.unique_id,
                    discovered_device.protocol_id
                );
                discovered.push(discovered_device);
            }
        } else {
            tracing::debug!("Unable to open candidate HID path {:?} for {}", c.path, c.port_name);
        }
    }

    discovered
}

/// Probes a candidate HID device using strictly Stage T1 Read-Only commands (QPI, fallback Q1, QID, QVFW).
fn probe_candidate_on_actor(
    dev: &HidDevice,
    port_name: &str,
    usb_uuid: Option<String>,
) -> Option<DiscoveredDevice> {
    let timeout = Duration::from_millis(1500);

    // Step 1: Send ONLY QPI (Query Protocol ID)
    let protocol_id = match execute_hid_command(dev, port_name, "QPI", timeout) {
        Ok(qpi_resp) => match parse_protocol_id(&qpi_resp) {
            Ok(pid) => pid,
            Err(_) => {
                // Retry QPI once in case stale bytes were in buffer
                let qpi_retry = execute_hid_command(dev, port_name, "QPI", timeout).ok()?;
                parse_protocol_id(&qpi_retry).ok()?
            }
        },
        Err(_) => {
            // Fallback for older Megatec P00 devices that do not implement QPI
            if let Ok(q1_resp) = execute_hid_command(dev, port_name, "Q1", timeout) {
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
    let serial_number = execute_hid_command(dev, port_name, "QID", timeout)
        .ok()
        .and_then(|r| parse_device_id(&r).ok());

    // Step 3: Query firmware version with QVFW (Read-only)
    let firmware_version = execute_hid_command(dev, port_name, "QVFW", timeout)
        .ok()
        .and_then(|r| parse_firmware_version(&r).ok());

    let unique_id = generate_unique_id(
        serial_number.as_deref(),
        port_name,
        firmware_version.as_deref(),
    );

    let battery_v = execute_hid_command(dev, port_name, "Q1", timeout)
        .ok()
        .and_then(|r| Q1Status::parse(&r).ok())
        .map(|s| s.battery_voltage_v);
    let hardware_signature = Some(compute_hardware_signature(&protocol_id, battery_v, None));

    let capabilities = DeviceCapabilities::for_protocol(&protocol_id);

    Some(DiscoveredDevice {
        port_name: port_name.to_string(),
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

/// Resolves physical USB UUID/Path on the actor thread.
fn resolve_usb_uuid_on_actor(api: &mut HidApi, port_name: &str) -> Option<String> {
    let parts: Vec<&str> = port_name.split(':').collect();
    if parts.len() >= 3 && parts[0] == "USB" {
        let vid = u16::from_str_radix(parts[1], 16).ok()?;
        let pid = u16::from_str_radix(parts[2], 16).ok()?;
        let id_filter = if parts.len() >= 4 {
            parts[3].to_lowercase()
        } else {
            String::new()
        };

        for dev in api.device_list() {
            if dev.vendor_id() == vid && dev.product_id() == pid {
                let path_str = dev.path().to_string_lossy().to_string();
                if id_filter.is_empty()
                    || path_str.to_lowercase().contains(&id_filter)
                    || dev.serial_number().unwrap_or("").to_lowercase().contains(&id_filter)
                {
                    return Some(path_str);
                }
            }
        }
    }
    None
}

/// Opens a HID device on the actor thread and stores it in the actor's map.
fn open_device_on_actor(
    api: &mut HidApi,
    target: HidOpenTarget,
    port_name: &str,
    open_devices: &mut HashMap<u64, HidDevice>,
    next_device_id: &mut u64,
) -> Result<u64, ProtocolError> {
    let dev = match target {
        HidOpenTarget::VidPid(vid, pid) => api.open(vid, pid).map_err(|e| {
            ProtocolError::IoError(format!(
                "Failed to open HID device {:04x}:{:04x} ({}): {}",
                vid, pid, port_name, e
            ))
        })?,
        HidOpenTarget::Path(path) => api.open_path(&path).map_err(|e| {
            ProtocolError::IoError(format!(
                "Failed to open HID device path {:?} ({}): {}",
                path, port_name, e
            ))
        })?,
        HidOpenTarget::PortName(p_name) => {
            let parts: Vec<&str> = p_name.split(':').collect();
            if parts.len() >= 3 && parts[0] == "USB" {
                let vid = u16::from_str_radix(parts[1], 16).map_err(|_| {
                    ProtocolError::InvalidParameter(format!("Invalid Vendor ID in port: {}", p_name))
                })?;
                let pid = u16::from_str_radix(parts[2], 16).map_err(|_| {
                    ProtocolError::InvalidParameter(format!("Invalid Product ID in port: {}", p_name))
                })?;

                let mut matched_path: Option<CString> = None;
                for dev in api.device_list() {
                    if dev.vendor_id() == vid && dev.product_id() == pid {
                        if parts.len() >= 4 {
                            let id_filter = parts[3].to_lowercase();
                            let dev_path = dev.path().to_string_lossy().to_lowercase();
                            let serial = dev.serial_number().unwrap_or("").to_lowercase();
                            if !dev_path.contains(&id_filter) && !serial.contains(&id_filter) {
                                continue;
                            }
                        }
                        matched_path = Some(dev.path().to_owned());
                        break;
                    }
                }

                if let Some(path) = matched_path {
                    api.open_path(&path).map_err(|e| {
                        ProtocolError::IoError(format!(
                            "Failed to open matched HID device path {:?} ({}): {}",
                            path, p_name, e
                        ))
                    })?
                } else {
                    api.open(vid, pid).map_err(|e| {
                        ProtocolError::IoError(format!(
                            "Failed to open fallback HID device {:04x}:{:04x} ({}): {}",
                            vid, pid, p_name, e
                        ))
                    })?
                }
            } else {
                return Err(ProtocolError::InvalidParameter(format!(
                    "Unrecognized USB port name format: {}",
                    p_name
                )));
            }
        }
    };

    let id = *next_device_id;
    *next_device_id += 1;
    open_devices.insert(id, dev);
    Ok(id)
}

/// Executes a Voltronic/Megatec USB HID command with 8-byte chunk framing and response decoding.
pub fn execute_hid_command(
    dev: &HidDevice,
    port_name: &str,
    cmd_str: &str,
    timeout: Duration,
) -> Result<String, ProtocolError> {
    let raw_cmd = encode_command(cmd_str);

    tracing::debug!("HID [{}] Sending command: {:?} ({} bytes)", port_name, cmd_str, raw_cmd.len());

    // Drain any stale input reports in buffer before sending new command
    let mut drain_buf = [0u8; 64];
    let mut drained_total = 0;
    while let Ok(n) = dev.read_timeout(&mut drain_buf, 20) {
        if n == 0 {
            break;
        }
        drained_total += n;
        tracing::trace!("HID [{}] Drained {} stale bytes: {:02x?}", port_name, n, &drain_buf[..n]);
    }
    if drained_total > 0 {
        tracing::debug!("HID [{}] Total drained stale bytes before send: {}", port_name, drained_total);
    }

    // Send command in 8-byte chunks (standard Megatec/Voltronic USB HID chunk size)
    // Prepending report ID 0x00 creates a 9-byte packet compatible with Windows/macOS HID drivers.
    for (chunk_idx, chunk) in raw_cmd.chunks(8).enumerate() {
        let mut report = [0u8; 9];
        report[0] = 0x00; // Report ID
        report[1..1 + chunk.len()].copy_from_slice(chunk);

        tracing::trace!(
            "HID [{}] TX report chunk {}: {:02x?} (ascii: {:?})",
            port_name,
            chunk_idx,
            &report[..1 + chunk.len()],
            String::from_utf8_lossy(chunk)
        );

        if let Err(e) = dev.write(&report) {
            tracing::warn!("HID [{}] Report ID 0 write failed: {}. Trying raw write...", port_name, e);
            dev.write(chunk).map_err(|e2| {
                tracing::error!("HID [{}] Both write attempts failed: fallback={}", port_name, e2);
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
    let timeout_ms = timeout.as_millis() as i32;

    while start.elapsed() < timeout && total_read < buffer.len() {
        let mut chunk = [0u8; 64];
        let n = dev.read_timeout(&mut chunk, timeout_ms).map_err(|e| {
            tracing::error!("HID [{}] Read error: {}", port_name, e);
            ProtocolError::IoError(format!("HID read error: {}", e))
        })?;

        if n == 0 {
            tracing::trace!("HID [{}] Read timeout on chunk, total_read so far={}", port_name, total_read);
            break;
        }

        tracing::trace!(
            "HID [{}] RX chunk ({} bytes): {:02x?} (ascii: {:?})",
            port_name,
            n,
            &chunk[..n],
            String::from_utf8_lossy(&chunk[..n])
        );

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

        buffer[total_read..total_read + bytes_to_copy].copy_from_slice(&slice_to_add[..bytes_to_copy]);
        total_read += bytes_to_copy;

        if end_found {
            break;
        }
    }

    if total_read == 0 {
        // Some UPS firmware execute 'Q' (buzzer toggle), 'CT' (cancel test), BZON, or BZOFF silently.
        if cmd_str == "Q" || cmd_str == "CT" || cmd_str == "BZON" || cmd_str == "BZOFF" {
            tracing::info!("HID [{}] Command {:?} completed with silent hardware acknowledgment", port_name, cmd_str);
            return Ok("(OK".into());
        }
        tracing::warn!("HID [{}] Timeout waiting for response to {:?}", port_name, cmd_str);
        return Err(ProtocolError::Timeout);
    }

    // Trim any trailing null bytes in HID packets before decoding
    let mut clean_end = total_read;
    while clean_end > 0 && buffer[clean_end - 1] == 0 {
        clean_end -= 1;
    }

    let resp_res = decode_response(&buffer[..clean_end]);
    match &resp_res {
        Ok(s) => tracing::debug!("HID [{}] Decoded response: {:?}", port_name, s),
        Err(e) => tracing::warn!("HID [{}] Decode error: {:?} for raw bytes: {:02x?}", port_name, e, &buffer[..clean_end]),
    }
    resp_res
}

// ---------------------------------------------------------------------------
// Public Facade: Synchronous (with safety timeouts) and Async
// ---------------------------------------------------------------------------

/// Synchronously scans for candidate USB HID UPS devices via the dedicated actor thread.
pub fn scan_hid_devices(active_ports: &[String]) -> Vec<DiscoveredDevice> {
    let (tx, rx) = sync_channel(1);
    let actor = get_actor();
    if actor
        .tx
        .send(HidActorCommand::ScanDevices {
            active_ports: active_ports.to_vec(),
            reply: Reply::Sync(tx),
        })
        .is_err()
    {
        return Vec::new();
    }
    rx.recv_timeout(Duration::from_secs(10)).unwrap_or_default()
}

/// Asynchronously scans for candidate USB HID UPS devices via the dedicated actor thread.
pub async fn scan_hid_devices_async(active_ports: Vec<String>) -> Vec<DiscoveredDevice> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let actor = get_actor();
    if actor
        .tx
        .send(HidActorCommand::ScanDevices {
            active_ports,
            reply: Reply::Async(tx),
        })
        .is_err()
    {
        return Vec::new();
    }
    tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .unwrap_or(Ok(Vec::new()))
        .unwrap_or_default()
}

/// Synchronously resolves a physical USB UUID for a port via the actor thread.
pub fn resolve_usb_uuid(port_name: &str) -> Option<String> {
    let (tx, rx) = sync_channel(1);
    let actor = get_actor();
    if actor
        .tx
        .send(HidActorCommand::ResolveUsbUuid {
            port_name: port_name.to_string(),
            reply: Reply::Sync(tx),
        })
        .is_err()
    {
        return None;
    }
    rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

/// Opens a HID device via the actor thread, returning an internal actor device ID.
pub fn open_device(target: HidOpenTarget, port_name: &str) -> Result<u64, ProtocolError> {
    let (tx, rx) = sync_channel(1);
    let actor = get_actor();
    actor
        .tx
        .send(HidActorCommand::OpenDevice {
            target,
            port_name: port_name.to_string(),
            reply: Reply::Sync(tx),
        })
        .map_err(|e| ProtocolError::IoError(format!("Failed to send open to HID actor: {}", e)))?;

    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| ProtocolError::Timeout)?
}

/// Dispatches a command to a previously opened HID device on the actor thread.
pub fn send_command(
    device_id: u64,
    port_name: &str,
    cmd_str: &str,
    timeout: Duration,
) -> Result<String, ProtocolError> {
    let (tx, rx) = sync_channel(1);
    let actor = get_actor();
    actor
        .tx
        .send(HidActorCommand::SendCommand {
            device_id,
            port_name: port_name.to_string(),
            cmd_str: cmd_str.to_string(),
            timeout,
            reply: Reply::Sync(tx),
        })
        .map_err(|e| ProtocolError::IoError(format!("Failed to send command to HID actor: {}", e)))?;

    // Allow 1 extra second beyond device timeout for channel messaging overhead
    rx.recv_timeout(timeout + Duration::from_secs(1))
        .map_err(|_| ProtocolError::Timeout)?
}

/// Closes and releases a HID device on the actor thread.
pub fn close_device(device_id: u64) {
    let actor = get_actor();
    let _ = actor.tx.send(HidActorCommand::CloseDevice { device_id });
}

/// Safely runs an inspection closure on the actor thread with access to the thread-pinned HidApi.
pub fn with_hid_api<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&HidApi) -> R + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = sync_channel(1);
    let actor = get_actor();
    let boxed = Box::new(move |api: &HidApi| {
        let res = f(api);
        let _ = tx.send(res);
    });
    if actor.tx.send(HidActorCommand::InspectApi(boxed)).is_err() {
        return None;
    }
    rx.recv_timeout(Duration::from_secs(5)).ok()
}

/// Signals the dedicated HID actor thread to close all open devices, drop HidApi, and terminate cleanly.
pub fn shutdown_actor() {
    if let Some(actor) = HID_ACTOR.get() {
        let _ = actor.tx.send(HidActorCommand::Shutdown);
    }
}
