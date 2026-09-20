use upsed_lib::db::{AppSettings, Database};

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
fn monitor_004_legacy_database_migration() {
    let temp_dir = std::env::temp_dir().join(format!("upsed_mig_test_{}", uuid_or_timestamp()));
    std::fs::create_dir_all(&temp_dir).unwrap();

    let legacy_db = temp_dir.join("voltwatch.db");
    let target_db = temp_dir.join("upsed.db");

    // 1. Populate legacy VoltWatch database
    {
        let db = Database::init(&legacy_db).expect("Failed to initialize legacy db");
        db.set_setting("poll_interval_secs", "30").unwrap();
        db.set_setting("migrated_flag", "true").unwrap();
    }

    assert!(legacy_db.exists());
    assert!(!target_db.exists());

    // 2. Perform migration
    let candidates = vec![legacy_db.clone()];
    let migrated = upsed_lib::db::migrate_legacy_db_if_needed(&target_db, &candidates);
    assert!(migrated, "Migration should report true when copying legacy db");
    assert!(target_db.exists(), "Target upsed.db must exist after migration");

    // 3. Verify data in migrated target
    {
        let db = Database::init(&target_db).expect("Failed to open migrated upsed db");
        assert_eq!(db.get_setting("poll_interval_secs").unwrap(), Some("30".into()));
        assert_eq!(db.get_setting("migrated_flag").unwrap(), Some("true".into()));
    }

    // 4. Repeated migration when target already exists should be a no-op
    let re_migrated = upsed_lib::db::migrate_legacy_db_if_needed(&target_db, &candidates);
    assert!(!re_migrated, "Migration should return false when target already populated");

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
}

fn uuid_or_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

