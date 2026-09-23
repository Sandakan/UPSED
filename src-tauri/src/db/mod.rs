use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryRecord {
    pub id: Option<i64>,
    pub timestamp: String,
    pub port_name: String,
    pub grid_voltage: f32,
    pub output_voltage: f32,
    pub grid_frequency: f32,
    pub output_frequency: f32,
    pub load_pct: u32,
    pub output_watts: u32,
    pub battery_voltage: f32,
    pub temperature_c: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLogRecord {
    pub id: Option<i64>,
    pub timestamp: String,
    pub port_name: String,
    pub event_type: String,
    #[serde(default = "default_severity")]
    pub severity: String,
    pub message: String,
    #[serde(default)]
    pub acknowledged: bool,
}

fn default_severity() -> String {
    "info".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub poll_interval_secs: u64,
    pub battery_bridge_enabled: bool,
    pub auto_shutdown_enabled: bool,
    pub shutdown_battery_pct: u32,
    pub close_to_minimize: bool,
    pub start_minimized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsMetadata {
    pub unique_id: String,
    pub name: String,
    pub usb_uuid: Option<String>,
    pub rated_va: u32,
    pub power_factor: f32,
    pub rated_watts: u32,
    pub battery_voltage: u32,
    pub battery_capacity_ah: f32,
    pub battery_chemistry: String,
    pub topology: String,
    pub updated_at: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            poll_interval_secs: 10,
            battery_bridge_enabled: true,
            auto_shutdown_enabled: false,
            shutdown_battery_pct: 15,
            close_to_minimize: true,
            start_minimized: true,
        }
    }
}

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn init<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                port_name TEXT NOT NULL,
                grid_voltage REAL,
                output_voltage REAL,
                grid_frequency REAL DEFAULT 50.0,
                output_frequency REAL DEFAULT 50.0,
                load_pct INTEGER,
                output_watts INTEGER DEFAULT 0,
                battery_voltage REAL,
                temperature_c INTEGER
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                port_name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                message TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ups_metadata (
                unique_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                usb_uuid TEXT,
                rated_va INTEGER NOT NULL DEFAULT 1000,
                power_factor REAL NOT NULL DEFAULT 0.8,
                rated_watts INTEGER NOT NULL DEFAULT 800,
                battery_voltage INTEGER NOT NULL DEFAULT 24,
                battery_capacity_ah REAL NOT NULL DEFAULT 9.0,
                battery_chemistry TEXT NOT NULL DEFAULT 'VRLA_SLA',
                topology TEXT NOT NULL DEFAULT 'Online',
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        // Lightweight column migrations for backward compatibility
        let _ = conn.execute(
            "ALTER TABLE telemetry ADD COLUMN grid_frequency REAL DEFAULT 50.0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE telemetry ADD COLUMN output_frequency REAL DEFAULT 50.0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE telemetry ADD COLUMN output_watts INTEGER DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE ups_metadata ADD COLUMN usb_uuid TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE ups_metadata ADD COLUMN rated_va INTEGER NOT NULL DEFAULT 1000",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE ups_metadata ADD COLUMN power_factor REAL NOT NULL DEFAULT 0.8",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE ups_metadata ADD COLUMN battery_chemistry TEXT NOT NULL DEFAULT 'VRLA_SLA'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE ups_metadata ADD COLUMN topology TEXT NOT NULL DEFAULT 'Online'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE events ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE events ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_telemetry_port_time ON telemetry(port_name, timestamp)",
            [],
        );

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn insert_telemetry(&self, record: &TelemetryRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO telemetry (timestamp, port_name, grid_voltage, output_voltage, grid_frequency, output_frequency, load_pct, output_watts, battery_voltage, temperature_c)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.timestamp,
                record.port_name,
                record.grid_voltage,
                record.output_voltage,
                record.grid_frequency,
                record.output_frequency,
                record.load_pct,
                record.output_watts,
                record.battery_voltage,
                record.temperature_c,
            ],
        )?;
        Ok(())
    }

    pub fn query_recent_telemetry(
        &self,
        port_name: &str,
        limit: u32,
    ) -> Result<Vec<TelemetryRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, port_name, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
             FROM telemetry WHERE port_name = ?1 ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![port_name, limit], |row| {
            Ok(TelemetryRecord {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                port_name: row.get(2)?,
                grid_voltage: row.get(3)?,
                output_voltage: row.get(4)?,
                grid_frequency: row.get(5)?,
                output_frequency: row.get(6)?,
                load_pct: row.get(7)?,
                output_watts: row.get(8)?,
                battery_voltage: row.get(9)?,
                temperature_c: row.get(10)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        results.reverse(); // chronological order
        Ok(results)
    }

    pub fn query_telemetry_range(
        &self,
        port_name: &str,
        start_time: &str,
        end_time: &str,
        max_points: Option<u32>,
    ) -> Result<Vec<TelemetryRecord>> {
        let conn = self.conn.lock().unwrap();

        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM telemetry WHERE port_name = ?1 AND timestamp >= ?2 AND timestamp <= ?3",
            params![port_name, start_time, end_time],
            |row| row.get(0),
        )?;

        let max_p = max_points.unwrap_or(1500).max(100);
        let step = if count > max_p {
            (count as f64 / max_p as f64).ceil() as u32
        } else {
            1
        };

        let mut results = Vec::new();

        if step > 1 {
            let sql = format!(
                "SELECT id, timestamp, port_name, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
                 FROM (
                     SELECT *, ROW_NUMBER() OVER (ORDER BY id ASC) as rn
                     FROM telemetry
                     WHERE port_name = ?1 AND timestamp >= ?2 AND timestamp <= ?3
                 )
                 WHERE (rn - 1) % {} = 0
                 ORDER BY id ASC",
                step
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![port_name, start_time, end_time], |row| {
                Ok(TelemetryRecord {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    port_name: row.get(2)?,
                    grid_voltage: row.get(3)?,
                    output_voltage: row.get(4)?,
                    grid_frequency: row.get(5)?,
                    output_frequency: row.get(6)?,
                    load_pct: row.get(7)?,
                    output_watts: row.get(8)?,
                    battery_voltage: row.get(9)?,
                    temperature_c: row.get(10)?,
                })
            })?;
            for r in rows {
                results.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, timestamp, port_name, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
                 FROM telemetry
                 WHERE port_name = ?1 AND timestamp >= ?2 AND timestamp <= ?3
                 ORDER BY id ASC",
            )?;
            let rows = stmt.query_map(params![port_name, start_time, end_time], |row| {
                Ok(TelemetryRecord {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    port_name: row.get(2)?,
                    grid_voltage: row.get(3)?,
                    output_voltage: row.get(4)?,
                    grid_frequency: row.get(5)?,
                    output_frequency: row.get(6)?,
                    load_pct: row.get(7)?,
                    output_watts: row.get(8)?,
                    battery_voltage: row.get(9)?,
                    temperature_c: row.get(10)?,
                })
            })?;
            for r in rows {
                results.push(r?);
            }
        }

        Ok(results)
    }

    pub fn insert_event(&self, record: &EventLogRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO events (timestamp, port_name, event_type, severity, message, acknowledged)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                record.timestamp,
                record.port_name,
                record.event_type,
                record.severity,
                record.message,
                if record.acknowledged { 1 } else { 0 },
            ],
        )?;
        Ok(())
    }

    pub fn query_recent_events(&self, limit: u32) -> Result<Vec<EventLogRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, port_name, event_type, COALESCE(severity, 'info'), message, COALESCE(acknowledged, 0)
             FROM events ORDER BY id DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            let ack_int: i64 = row.get(6)?;
            Ok(EventLogRecord {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                port_name: row.get(2)?,
                event_type: row.get(3)?,
                severity: row.get(4)?,
                message: row.get(5)?,
                acknowledged: ack_int != 0,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn clear_events(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM events", [])?;
        Ok(())
    }

    pub fn acknowledge_event(&self, event_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE events SET acknowledged = 1 WHERE id = ?1", params![event_id])?;
        Ok(())
    }

    pub fn acknowledge_all_events(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("UPDATE events SET acknowledged = 1 WHERE acknowledged = 0", [])?;
        Ok(rows)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn update_device_usb_uuid(
        &self,
        unique_id: &str,
        new_usb_uuid: &str,
        updated_at: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE ups_metadata SET usb_uuid = ?1, updated_at = ?2 WHERE unique_id = ?3",
            params![new_usb_uuid, updated_at, unique_id],
        )?;
        Ok(())
    }

    pub fn get_ups_metadata(&self, unique_id: &str) -> Result<Option<UpsMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, usb_uuid, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, updated_at
             FROM ups_metadata WHERE unique_id = ?1",
        )?;

        let mut rows = stmt.query(params![unique_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                usb_uuid: row.get(2)?,
                rated_va: row.get(3)?,
                power_factor: row.get(4)?,
                rated_watts: row.get(5)?,
                battery_voltage: row.get(6)?,
                battery_capacity_ah: row.get(7)?,
                battery_chemistry: row.get(8)?,
                topology: row.get(9)?,
                updated_at: row.get(10)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_ups_metadata(&self, meta: &UpsMetadata) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ups_metadata (unique_id, name, usb_uuid, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(unique_id) DO UPDATE SET
                name = excluded.name,
                usb_uuid = excluded.usb_uuid,
                rated_va = excluded.rated_va,
                power_factor = excluded.power_factor,
                rated_watts = excluded.rated_watts,
                battery_voltage = excluded.battery_voltage,
                battery_capacity_ah = excluded.battery_capacity_ah,
                battery_chemistry = excluded.battery_chemistry,
                topology = excluded.topology,
                updated_at = excluded.updated_at",
            params![
                meta.unique_id,
                meta.name,
                meta.usb_uuid,
                meta.rated_va,
                meta.power_factor,
                meta.rated_watts,
                meta.battery_voltage,
                meta.battery_capacity_ah,
                meta.battery_chemistry,
                meta.topology,
                meta.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_all_ups_metadata(&self) -> Result<Vec<UpsMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, usb_uuid, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, updated_at
             FROM ups_metadata ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                usb_uuid: row.get(2)?,
                rated_va: row.get(3)?,
                power_factor: row.get(4)?,
                rated_watts: row.get(5)?,
                battery_voltage: row.get(6)?,
                battery_capacity_ah: row.get(7)?,
                battery_chemistry: row.get(8)?,
                topology: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }
}

/// Migrates a legacy VoltWatch database to the new UPSED database path if `target_db`
/// is missing or empty. Returns true if migration succeeded.
pub fn migrate_legacy_db_if_needed(target_db: &Path, candidate_paths: &[std::path::PathBuf]) -> bool {
    let needs_migration = !target_db.exists()
        || std::fs::metadata(target_db).map(|m| m.len() == 0).unwrap_or(false);

    if !needs_migration {
        return false;
    }

    for legacy in candidate_paths {
        if legacy.exists() {
            if let Ok(meta) = std::fs::metadata(legacy) {
                if meta.len() > 0 {
                    log::info!("Migrating legacy VoltWatch database from {:?} to {:?}", legacy, target_db);
                    if std::fs::copy(legacy, target_db).is_ok() {
                        // Also copy WAL and SHM files if they exist
                        if let Some(file_name) = legacy.file_name() {
                            let mut wal_name = file_name.to_os_string();
                            wal_name.push("-wal");
                            let wal_source = legacy.with_file_name(&wal_name);
                            if wal_source.exists() {
                                if let Some(target_file_name) = target_db.file_name() {
                                    let mut target_wal_name = target_file_name.to_os_string();
                                    target_wal_name.push("-wal");
                                    let _ = std::fs::copy(&wal_source, target_db.with_file_name(target_wal_name));
                                }
                            }

                            let mut shm_name = file_name.to_os_string();
                            shm_name.push("-shm");
                            let shm_source = legacy.with_file_name(&shm_name);
                            if shm_source.exists() {
                                if let Some(target_file_name) = target_db.file_name() {
                                    let mut target_shm_name = target_file_name.to_os_string();
                                    target_shm_name.push("-shm");
                                    let _ = std::fs::copy(&shm_source, target_db.with_file_name(target_shm_name));
                                }
                            }
                        }
                        return true;
                    }
                }
            }
        }
    }
    false
}
