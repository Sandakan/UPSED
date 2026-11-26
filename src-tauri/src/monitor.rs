use crate::commands::{connect_device_internal, detect_status_events, AppState, UpsTelemetryPayload};
use crate::db::TelemetryRecord;
use crate::protocol::Q1Status;
use crate::serial::scan_available_ports_with_context;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static WAKE_RECOVERY_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Signals the background monitor that the host system resumed from sleep or network restored.
pub fn request_wake_recovery() {
    WAKE_RECOVERY_REQUESTED.store(true, Ordering::Relaxed);
}

pub async fn run_background_monitor(
    app: AppHandle,
    state: AppState,
    mut interval_rx: tokio::sync::watch::Receiver<u64>,
) {
    tracing::info!("Starting UPSED background multi-UPS monitor task with unified event pipeline");

    // Allow initial application startup to settle before first probe
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut fast_interval = tokio::time::interval(Duration::from_millis(400));
    fast_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let mut last_slow_tick = tokio::time::Instant::now();
    let mut last_wall_clock = chrono::Utc::now();
    let mut wake_burst_remaining: u8 = 0;
    let mut is_initial = true;

    loop {
        let current_interval_secs = (*interval_rx.borrow()).max(1);

        tokio::select! {
            _ = fast_interval.tick() => {
                let now = tokio::time::Instant::now();
                let wall_now = chrono::Utc::now();
                let elapsed_wall_secs = wall_now.signed_duration_since(last_wall_clock).num_seconds();
                last_wall_clock = wall_now;

                let manual_wake = WAKE_RECOVERY_REQUESTED.swap(false, Ordering::Relaxed);
                let clock_jump_detected = elapsed_wall_secs > (current_interval_secs as i64 + 4);

                if manual_wake || clock_jump_detected {
                    tracing::info!(
                        "System resume / wake recovery triggered (manual={}, wall_jump={}s). Resetting stale transports and starting 2s fast retry burst",
                        manual_wake,
                        elapsed_wall_secs
                    );
                    state.manager.reset_stale_transports();
                    wake_burst_remaining = 3;
                }

                let elapsed_slow = now.duration_since(last_slow_tick).as_secs();
                let effective_interval = if wake_burst_remaining > 0 {
                    2
                } else {
                    current_interval_secs
                };

                if is_initial || manual_wake || clock_jump_detected || elapsed_slow >= effective_interval {
                    is_initial = false;
                    last_slow_tick = now;
                    let app_c = app.clone();
                    let state_c = state.clone();
                    let any_failed = tokio::task::spawn_blocking(move || {
                        slow_poll_cycle_step(&app_c, &state_c)
                    }).await.unwrap_or(false);

                    if wake_burst_remaining > 0 {
                        if !any_failed {
                            wake_burst_remaining = 0;
                        } else {
                            wake_burst_remaining = wake_burst_remaining.saturating_sub(1);
                        }
                    }
                } else {
                    let app_c = app.clone();
                    let state_c = state.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        fast_drain_cycle_step(&app_c, &state_c);
                    }).await;
                }
            }
            changed = interval_rx.changed() => {
                if changed.is_ok() {
                    let new_sec = *interval_rx.borrow();
                    tracing::info!("Background monitor: interval updated to {}s, triggering cycle", new_sec);
                    // Re-arm so slow cycle fires promptly
                    last_slow_tick = tokio::time::Instant::now() - Duration::from_secs(new_sec);
                    last_wall_clock = chrono::Utc::now();
                }
            }
        }
    }
}

fn fast_drain_cycle_step(app: &AppHandle, state: &AppState) {
    let approved_profiles = state.db.list_all_ups_metadata().unwrap_or_default();
    let primary_id = approved_profiles
        .iter()
        .find(|p| p.is_primary)
        .map(|p| p.unique_id.clone())
        .or_else(|| approved_profiles.first().map(|p| p.unique_id.clone()));

    // 1. DRAIN NOTIFICATIONS FROM BRIDGE DEVICES (Zero 2400-baud UART load!)
    let bridge_events = state.manager.drain_bridge_notifications();
    for (port_name, mut ups_id_opt, events) in bridge_events {
        if ups_id_opt.is_none() {
            ups_id_opt = state.manager.get_device_ups_id(&port_name);
        }

        for ev in events {
            if let Ok(status) = Q1Status::parse(&ev.raw) {
                let prev_status = state.manager.get_last_status(&port_name);
                state.manager.update_device_status(&port_name, status.clone());

                let smoothed = ups_id_opt.as_deref().map(|uid| {
                    state.manager.ingest_bucket_sample(uid, &status)
                });

                if let Some(ref uid) = ups_id_opt {
                    let detected = detect_status_events(prev_status.as_ref(), &status, Some(uid));
                    for event_record in detected {
                        let _ = state.db.insert_event(&event_record);
                        crate::notifications::emit_ups_event(app, &event_record);
                    }
                }

                // Update OS native battery bridge if primary
                if (ups_id_opt.is_some() && primary_id.as_deref() == ups_id_opt.as_deref())
                    || primary_id.is_none()
                {
                    let mut bridge = state.bridge.lock().unwrap();
                    bridge.update(&status);
                }

                let _ = app.emit(
                    "ups-telemetry",
                    &UpsTelemetryPayload {
                        ups_id: ups_id_opt.clone(),
                        port_name: port_name.clone(),
                        status,
                        record: smoothed,
                        bucket_committed: false,
                    },
                );
            }
        }
    }

    // 2. DIRECT SERIAL / HID INTERFACES: STRICT ISOLATION & SEGREGATION
    // Direct serial ports are COMPLETELY SKIPPED during steady-state Line Mode!
    let connected_list = state.manager.list_connected_details();
    let is_urgent_fast_enabled = state
        .db
        .get_setting("urgent_fast_poll")
        .ok()
        .flatten()
        .map(|v| v != "false")
        .unwrap_or(true);

    for (info, mut ups_id_opt, last_status) in connected_list {
        if state.manager.is_bridge_device(&info.port_name) {
            continue; // Already handled by bridge drain above
        }

        if ups_id_opt.is_none() {
            ups_id_opt = state.manager.get_device_ups_id(&info.port_name);
        }

        // A. Targeted Completion Probe: Has an active test or shutdown timed out?
        let is_completion_due = state.manager.take_due_completion_probe(&info.port_name);

        // B. Urgent Fast Watch: Is adaptive turbo active and >= 2s elapsed since last poll?
        let last_poll = state.manager.get_device_last_polled_at(&info.port_name);
        let elapsed_since_poll = last_poll
            .map(|t| t.elapsed() >= Duration::from_millis(1900))
            .unwrap_or(true);
        let is_fast_watch_due = is_urgent_fast_enabled
            && state.manager.is_fast_watch_active(&info.port_name)
            && elapsed_since_poll;

        if is_completion_due || is_fast_watch_due {
            // Execute targeted 1-shot query on direct serial
            if let Ok(status) = state.manager.poll_device_force_refresh(&info.port_name, true) {
                let prev_status = last_status;
                let smoothed = ups_id_opt.as_deref().map(|uid| {
                    state.manager.ingest_bucket_sample(uid, &status)
                });

                if let Some(ref uid) = ups_id_opt {
                    let detected = detect_status_events(prev_status.as_ref(), &status, Some(uid));
                    for event_record in detected {
                        let _ = state.db.insert_event(&event_record);
                        crate::notifications::emit_ups_event(app, &event_record);
                    }
                }

                if (ups_id_opt.is_some() && primary_id.as_deref() == ups_id_opt.as_deref())
                    || primary_id.is_none()
                {
                    let mut bridge = state.bridge.lock().unwrap();
                    bridge.update(&status);
                }

                let _ = app.emit(
                    "ups-telemetry",
                    &UpsTelemetryPayload {
                        ups_id: ups_id_opt.clone(),
                        port_name: info.port_name.clone(),
                        status,
                        record: smoothed,
                        bucket_committed: false,
                    },
                );
            }
        }
    }
}

fn slow_poll_cycle_step(app: &AppHandle, state: &AppState) -> bool {
    let approved_profiles = state.db.list_all_ups_metadata().unwrap_or_default();

    if approved_profiles.is_empty() && state.manager.list_devices().is_empty() {
        crate::tray::update_tray_state(app, false, None);
        return false;
    }

    // Auto-reconnect approved profiles that are not yet active in manager
    for profile in &approved_profiles {
        if !state.manager.is_connected(&profile.unique_id) {
            // 1. Try last known port
            let mut connected = false;
            if let Some(ref port) = profile.last_port {
                if connect_device_internal(state, port, None).is_ok() {
                    connected = true;
                }
            }

            // 2. Try configured bridge host if port failed
            if !connected {
                if let Some(ref host) = profile.bridge_ws_host {
                    let ws_port = if host.starts_with("BRIDGE:") {
                        host.clone()
                    } else if host.starts_with("WS:") {
                        format!("BRIDGE:{}", host)
                    } else {
                        format!("BRIDGE:WS:{}", host)
                    };
                    if connect_device_internal(state, &ws_port, None).is_ok() {
                        connected = true;
                    }
                }
            }

            // 3. Scan available ports using Stage T1 Read-Only commands to locate device
            if !connected {
                let active = state.manager.list_devices();
                let fallback_setting = state.db.get_setting("bridge_fallback_host").ok().flatten();
                let fallback = profile.bridge_ws_host.as_deref().or(fallback_setting.as_deref());
                let discovered = scan_available_ports_with_context(&active, fallback);

                for dev in discovered {
                    let is_match = dev.unique_id == profile.unique_id
                        || (profile.usb_uuid.is_some() && profile.usb_uuid == dev.usb_uuid)
                        || (profile.bridge_mac.is_some() && profile.bridge_mac == dev.bridge_mac)
                        || (profile.hardware_signature.is_some() && profile.hardware_signature == dev.hardware_signature);

                    if is_match {
                        let _ = connect_device_internal(state, &dev.port_name, None);
                        break;
                    }
                }
            }
        }
    }

    // Poll each connected device
    let connected_list = state.manager.list_connected_details();
    if connected_list.is_empty() {
        crate::tray::update_tray_state(app, false, None);
        return true;
    }

    let mut primary_status: Option<Q1Status> = None;
    let mut device_summaries: Vec<(String, Option<Q1Status>)> = Vec::new();
    let mut any_poll_failed = false;

    // Determine primary profile ID
    let primary_id = approved_profiles
        .iter()
        .find(|p| p.is_primary)
        .map(|p| p.unique_id.clone())
        .or_else(|| approved_profiles.first().map(|p| p.unique_id.clone()));

    for (info, mut ups_id_opt, last_status) in connected_list {
        // Resolve ups_id_opt against approved profiles if not yet bound
        if ups_id_opt.is_none() {
            let matched = approved_profiles.iter().find(|p| {
                p.unique_id == info.unique_id
                    || (info.bridge_mac.is_some() && p.bridge_mac == info.bridge_mac)
                    || (info.usb_uuid.is_some() && p.usb_uuid == info.usb_uuid)
                    || (info.hardware_signature.is_some() && p.hardware_signature == info.hardware_signature)
                    || (p.last_port.as_deref() == Some(&info.port_name))
            }).or_else(|| {
                if approved_profiles.len() == 1 {
                    approved_profiles.first()
                } else {
                    None
                }
            });

            if let Some(prof) = matched {
                ups_id_opt = Some(prof.unique_id.clone());
                state.manager.set_device_ups_id(&info.port_name, prof.unique_id.clone());
            }
        }

        let matched_profile = ups_id_opt
            .as_ref()
            .and_then(|uid| approved_profiles.iter().find(|p| p.unique_id == *uid));
        let device_label = matched_profile
            .map(|p| p.name.clone())
            .unwrap_or_else(|| info.port_name.clone());

        match state.manager.poll_device(&info.port_name) {
            Ok(mut status) => {
                crate::tray::enrich_output_watts(&mut status, matched_profile);
                let mut committed_record: Option<TelemetryRecord> = None;

                // If profile is approved, commit smoothed telemetry to SQLite and detect events
                if let Some(ref uid) = ups_id_opt {
                    // Pull smoothed record from accumulator bucket (averaging continuous metrics, preserving test dips)
                    let record = state.manager.take_completed_bucket(uid).unwrap_or_else(|| {
                        TelemetryRecord {
                            id: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            ups_id: uid.clone(),
                            grid_voltage: status.grid_voltage_v,
                            output_voltage: status.output_voltage_v,
                            grid_frequency: status.grid_frequency_hz,
                            output_frequency: status.output_frequency_hz,
                            load_pct: status.output_load_pct,
                            output_watts: status.output_watts,
                            battery_voltage: status.battery_voltage_v,
                            temperature_c: status.temperature_c,
                        }
                    });

                    let _ = state.db.insert_telemetry(&record);
                    committed_record = Some(record);

                    // Detect rising-edge events
                    let detected = detect_status_events(last_status.as_ref(), &status, Some(uid));
                    for ev in &detected {
                        let _ = state.db.insert_event(ev);
                        crate::notifications::emit_ups_event(app, ev);
                    }
                }

                // Push completed telemetry payload with bucket_committed: true!
                let _ = app.emit(
                    "ups-telemetry",
                    &UpsTelemetryPayload {
                        ups_id: ups_id_opt.clone(),
                        port_name: info.port_name.clone(),
                        status: status.clone(),
                        record: committed_record,
                        bucket_committed: true,
                    },
                );

                if (ups_id_opt.is_some() && primary_id.as_deref() == ups_id_opt.as_deref())
                    || primary_status.is_none()
                {
                    primary_status = Some(status.clone());
                }

                device_summaries.push((device_label, Some(status)));

                // Sync active bridge transport state & query lightweight telemetry status
                if let Ok(Some(st)) = state.manager.with_bridge_transport(Some(&info.port_name), |b, k| {
                    match b.ping() {
                        Ok(st) => {
                            crate::serial::bridge_adapter::emit_transport_status(&k, &st.active_transport, b.ws_host().as_deref());
                            Ok(Some(st))
                        }
                        Err(e) => {
                            tracing::debug!("Periodic bridge status ping skipped or failed for {}: {}", info.port_name, e);
                            crate::serial::bridge_adapter::emit_transport_status(&k, b.active_medium(), b.ws_host().as_deref());
                            Ok(None)
                        }
                    }
                }) {
                    let _ = app.emit("bridge-status", &st);
                    if st.wifi_connected && !st.ip.is_empty() {
                        let _ = state.db.set_setting("bridge_fallback_host", &st.ip);
                    }
                }
            }
            Err(err) => {
                any_poll_failed = true;
                let fail_count = state.manager.get_consecutive_poll_failures(&info.port_name);
                tracing::warn!(
                    "Background poll failed for UPS on {} (consecutive failures: {}): {}",
                    info.port_name,
                    fail_count,
                    err
                );
                if fail_count >= 4 && !state.manager.is_bridge_device(&info.port_name) {
                    tracing::warn!(
                        "Unregistering unresponsive direct device {} after {} failures to allow clean auto-reconnect",
                        info.port_name,
                        fail_count
                    );
                    let _ = state.manager.unregister_device(&info.port_name);
                }
                device_summaries.push((device_label, None));
            }
        }
    }

    // Update OS native battery bridge with primary UPS status
    let mut bridge = state.bridge.lock().unwrap();
    if let Some(ref st) = primary_status {
        bridge.update(st);
    }
    let is_bridge_enabled = bridge.is_enabled();
    drop(bridge);

    // Update system tray with primary icon and multi-device tooltip summary
    let summary_refs: Vec<(&str, Option<&Q1Status>)> = device_summaries
        .iter()
        .map(|(name, st)| (name.as_str(), st.as_ref()))
        .collect();

    crate::tray::update_tray_state_multi(app, primary_status.as_ref(), &summary_refs);

    // Backward compatibility for single tray status
    if primary_status.is_none() && is_bridge_enabled {
        crate::tray::update_tray_state(app, false, None);
    }

    any_poll_failed
}
