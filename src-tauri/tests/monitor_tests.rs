use voltwatch_lib::db::{AppSettings, Database};

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
    let temp_db = std::env::temp_dir().join(format!("voltwatch_test_{}.db", uuid_or_timestamp()));
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

fn uuid_or_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

