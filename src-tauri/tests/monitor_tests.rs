use upsed_lib::db::{AppSettings, Database, TelemetryRecord};

#[test]
fn monitor_001_app_settings_defaults() {
    let settings = AppSettings::default();
    assert_eq!(settings.poll_interval_secs, 10);
    assert!(settings.battery_bridge_enabled, "Battery bridge should be enabled by default per user requirement");
    assert!(settings.close_to_minimize, "Close to minimize should be enabled by default");
    assert!(settings.start_minimized, "Start minimized should be enabled by default");
}

#[test]
fn monitor_002_settings_persistence() {
    let temp_db = std::env::temp_dir().join(format!("upsed_test_{}.db", uuid_or_timestamp()));
    let db = Database::init(&temp_db).expect("Failed to init temp db");

    db.set_setting("poll_interval_secs", "5").unwrap();
    assert_eq!(db.get_setting("poll_interval_secs").unwrap(), Some("5".into()));

    db.set_setting("close_to_minimize", "false").unwrap();
    assert_eq!(db.get_setting("close_to_minimize").unwrap(), Some("false".into()));

    db.set_setting("start_minimized", "false").unwrap();
    assert_eq!(db.get_setting("start_minimized").unwrap(), Some("false".into()));

    let _ = std::fs::remove_file(&temp_db);
}

#[tokio::test]
async fn monitor_003_watch_channel_dynamic_cadence() {
    let (tx, mut rx) = tokio::sync::watch::channel(10u64);
    assert_eq!(*rx.borrow(), 10);

    // Update interval
    tx.send(2).unwrap();
    rx.changed().await.unwrap();
    assert_eq!(*rx.borrow(), 2);
}

#[test]
fn monitor_005_database_performance_indexes_and_downsampling() {
    let temp_db = std::env::temp_dir().join(format!("upsed_perf_test_{}.db", uuid_or_timestamp()));
    let db = Database::init(&temp_db).expect("Failed to initialize database for performance test");

    let profile = upsed_lib::db::UpsMetadata {
        unique_id: "UPS-TEST-001".into(),
        name: "Test UPS".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: true,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    db.save_ups_metadata(&profile).unwrap();

    // Insert 300 telemetry records spaced 10 seconds apart
    let base_time = chrono::Utc::now() - chrono::Duration::seconds(3000);
    for i in 0..300 {
        let t = base_time + chrono::Duration::seconds((i * 10) as i64);
        db.insert_telemetry(&TelemetryRecord {
            id: None,
            timestamp: t.to_rfc3339(),
            ups_id: "UPS-TEST-001".into(),
            grid_voltage: 230.0 + (i as f32 % 5.0),
            output_voltage: 230.0,
            grid_frequency: 50.0,
            output_frequency: 50.0,
            load_pct: (i % 80) as u32,
            output_watts: 500,
            battery_voltage: 27.2,
            temperature_c: 35,
        })
        .unwrap();
    }

    // 1. Verify query_recent_telemetry with index seek
    let recent = db.query_recent_telemetry("UPS-TEST-001", 20).unwrap();
    assert_eq!(recent.len(), 20);
    // Chronological order verification
    for w in recent.windows(2) {
        assert!(w[0].timestamp <= w[1].timestamp);
    }

    // 2. Verify query_telemetry_range with downsampling
    let start_iso = (base_time - chrono::Duration::seconds(10)).to_rfc3339();
    let end_iso = (base_time + chrono::Duration::seconds(3100)).to_rfc3339();

    // Raw mode (max_points = 0): returns all 300 points
    let raw = db.query_telemetry_range("UPS-TEST-001", &start_iso, &end_iso, Some(0)).unwrap();
    assert_eq!(raw.len(), 300);

    // Downsampled mode (max_points = 100): stride should be ceil(300/100) = 3 -> 100 points
    let downsampled = db.query_telemetry_range("UPS-TEST-001", &start_iso, &end_iso, Some(100)).unwrap();
    assert_eq!(downsampled.len(), 100);

    // Chronological ordering preserved
    for w in downsampled.windows(2) {
        assert!(w[0].timestamp < w[1].timestamp);
    }

    let _ = std::fs::remove_file(&temp_db);
}

#[test]
fn monitor_006_database_concurrency_split_read_write() {
    use std::sync::Arc;
    let temp_db = std::env::temp_dir().join(format!("upsed_concurrency_{}.db", uuid_or_timestamp()));
    let db = Arc::new(Database::init(&temp_db).expect("Failed to init db"));

    let profile = upsed_lib::db::UpsMetadata {
        unique_id: "COM_CONCURRENT".into(),
        name: "Concurrent Test UPS".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: true,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    db.save_ups_metadata(&profile).unwrap();

    let db_writer = Arc::clone(&db);
    let db_reader = Arc::clone(&db);

    // Spawn concurrent writer thread
    let writer_handle = std::thread::spawn(move || {
        for _ in 0..50 {
            db_writer
                .insert_telemetry(&TelemetryRecord {
                    id: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    ups_id: "COM_CONCURRENT".into(),
                    grid_voltage: 230.0,
                    output_voltage: 230.0,
                    grid_frequency: 50.0,
                    output_frequency: 50.0,
                    load_pct: 25,
                    output_watts: 200,
                    battery_voltage: 27.0,
                    temperature_c: 30,
                })
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    });

    // Spawn concurrent reader thread
    let reader_handle = std::thread::spawn(move || {
        let mut read_cycles = 0;
        for _ in 0..50 {
            let res = db_reader.query_recent_telemetry("COM_CONCURRENT", 10).unwrap();
            if !res.is_empty() {
                read_cycles += 1;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        read_cycles
    });

    writer_handle.join().unwrap();
    let read_cycles = reader_handle.join().unwrap();

    assert!(read_cycles > 0, "Reader must successfully read concurrent telemetry writes without deadlocking");

    let _ = std::fs::remove_file(&temp_db);
}

#[test]
fn monitor_007_database_maintenance_pruning_and_stats() {
    let temp_db = std::env::temp_dir().join(format!("upsed_maint_{}.db", uuid_or_timestamp()));
    let db = Database::init(&temp_db).expect("Failed to init db");

    let profile = upsed_lib::db::UpsMetadata {
        unique_id: "COM1".into(),
        name: "Maint Test UPS".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: true,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    db.save_ups_metadata(&profile).unwrap();

    let now = chrono::Utc::now();
    // Insert 10 records from 100 days ago
    for i in 0..10 {
        let t = now - chrono::Duration::days(100) + chrono::Duration::minutes(i);
        db.insert_telemetry(&TelemetryRecord {
            id: None,
            timestamp: t.to_rfc3339(),
            ups_id: "COM1".into(),
            grid_voltage: 230.0,
            output_voltage: 230.0,
            grid_frequency: 50.0,
            output_frequency: 50.0,
            load_pct: 10,
            output_watts: 100,
            battery_voltage: 27.0,
            temperature_c: 30,
        })
        .unwrap();
    }

    // Insert 15 records from 10 days ago
    for i in 0..15 {
        let t = now - chrono::Duration::days(10) + chrono::Duration::minutes(i);
        db.insert_telemetry(&TelemetryRecord {
            id: None,
            timestamp: t.to_rfc3339(),
            ups_id: "COM1".into(),
            grid_voltage: 230.0,
            output_voltage: 230.0,
            grid_frequency: 50.0,
            output_frequency: 50.0,
            load_pct: 10,
            output_watts: 100,
            battery_voltage: 27.0,
            temperature_c: 30,
        })
        .unwrap();
    }

    // Check stats
    let stats = db.get_db_stats().unwrap();
    assert_eq!(stats.telemetry_count, 25);
    assert!(stats.oldest_telemetry.is_some());
    assert!(stats.newest_telemetry.is_some());
    assert!(stats.file_size_bytes > 0);

    // Prune older than 30 days -> should delete the 10 old records
    let pruned = db.prune_telemetry(30, None).unwrap();
    assert_eq!(pruned, 10);

    let stats_after = db.get_db_stats().unwrap();
    assert_eq!(stats_after.telemetry_count, 15);

    // Vacuum database
    db.vacuum_database().unwrap();

    // Clear telemetry
    let cleared = db.clear_telemetry(None).unwrap();
    assert_eq!(cleared, 15);

    let stats_final = db.get_db_stats().unwrap();
    assert_eq!(stats_final.telemetry_count, 0);
    assert!(stats_final.oldest_telemetry.is_none());

    let _ = std::fs::remove_file(&temp_db);
}

#[test]
fn monitor_008_resolve_and_migrate_ups_metadata() {
    use upsed_lib::db::{Database, UpsMetadata};

    let db = Database::init(":memory:").unwrap();

    // 1. Insert a legacy profile with -FW-GENERIC suffix
    let legacy_profile = UpsMetadata {
        unique_id: "BRIDGE-MAC-806599A6B9F8-FW-GENERIC".into(),
        name: "PROLINK PRO901-ES".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: false,
        updated_at: "2026-10-19T08:00:00Z".into(),
    };
    db.save_ups_metadata(&legacy_profile).unwrap();

    // 2. Resolve using clean canonical BRIDGE-MAC ID
    let resolved = db
        .resolve_ups_metadata(
            "BRIDGE-MAC-806599A6B9F8",
            Some("80:65:99:A6:B9:F8"),
            None,
            Some("P00:24V"),
        )
        .unwrap();

    assert!(resolved.is_some());
    let canonical = resolved.unwrap();
    assert_eq!(canonical.unique_id, "BRIDGE-MAC-806599A6B9F8");
    assert_eq!(canonical.name, "PROLINK PRO901-ES");
    assert_eq!(canonical.bridge_mac.as_deref(), Some("806599A6B9F8"));
    assert_eq!(canonical.hardware_signature.as_deref(), Some("P00:24V"));

    // 3. Test twin-unit disambiguation candidates
    let twin_profile = UpsMetadata {
        unique_id: "BRIDGE-MAC-3C8427124A9C".into(),
        name: "PROLINK PRO901-ES #2 (Server)".into(),
        usb_uuid: None,
        bridge_mac: Some("3C8427124A9C".into()),
        hardware_signature: Some("P00:24V".into()),
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: false,
        updated_at: "2026-10-20T10:00:00Z".into(),
    };
    db.save_ups_metadata(&twin_profile).unwrap();

    let candidates = db.get_disambiguation_candidates("P00:24V").unwrap();
    assert_eq!(candidates.len(), 2);
}

fn uuid_or_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

#[test]
fn monitor_009_get_latest_telemetry_timestamp() {
    let temp_db = std::env::temp_dir().join(format!("upsed_test_{}.db", uuid_or_timestamp()));
    let db = Database::init(&temp_db).expect("Failed to init temp db");

    let profile = upsed_lib::db::UpsMetadata {
        unique_id: "UPS-SYNC-01".into(),
        name: "Sync Test Unit".into(),
        usb_uuid: None,
        bridge_mac: None,
        hardware_signature: None,
        rated_va: 1000,
        power_factor: 0.8,
        rated_watts: 800,
        battery_voltage: 24,
        battery_capacity_ah: 9.0,
        battery_chemistry: "VRLA_SLA".into(),
        topology: "LineInteractive".into(),
        poll_interval_secs: 10,
        bridge_ws_host: None,
        last_port: None,
        is_primary: true,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    db.save_ups_metadata(&profile).unwrap();

    // Empty DB returns None
    assert_eq!(db.get_latest_telemetry_timestamp("UPS-SYNC-01").unwrap(), None);

    let t1 = chrono::Utc::now() - chrono::Duration::seconds(50);
    let t2 = chrono::Utc::now();

    db.insert_telemetry(&TelemetryRecord {
        id: None,
        timestamp: t1.to_rfc3339(),
        ups_id: "UPS-SYNC-01".into(),
        grid_voltage: 230.0,
        output_voltage: 230.0,
        grid_frequency: 50.0,
        output_frequency: 50.0,
        load_pct: 20,
        output_watts: 200,
        battery_voltage: 27.2,
        temperature_c: 30,
    }).unwrap();

    db.insert_telemetry(&TelemetryRecord {
        id: None,
        timestamp: t2.to_rfc3339(),
        ups_id: "UPS-SYNC-01".into(),
        grid_voltage: 230.0,
        output_voltage: 230.0,
        grid_frequency: 50.0,
        output_frequency: 50.0,
        load_pct: 20,
        output_watts: 200,
        battery_voltage: 27.2,
        temperature_c: 30,
    }).unwrap();

    let latest = db.get_latest_telemetry_timestamp("UPS-SYNC-01").unwrap();
    assert_eq!(latest, Some(t2.timestamp()));

    // Different UPS ID still returns None
    assert_eq!(db.get_latest_telemetry_timestamp("UPS-OTHER").unwrap(), None);

    let _ = std::fs::remove_file(&temp_db);
}
