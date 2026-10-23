use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryRecord {
    pub id: Option<i64>,
    pub timestamp: String,
    pub ups_id: String,
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
    pub ups_id: Option<String>,
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
    pub bridge_mac: Option<String>,
    pub hardware_signature: Option<String>,
    pub rated_va: u32,
    pub power_factor: f32,
    pub rated_watts: u32,
    pub battery_voltage: u32,
    pub battery_capacity_ah: f32,
    pub battery_chemistry: String,
    pub topology: String,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    pub bridge_ws_host: Option<String>,
    pub last_port: Option<String>,
    #[serde(default)]
    pub is_primary: bool,
    pub updated_at: String,
}

fn default_poll_interval() -> u64 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub file_size_bytes: u64,
    pub wal_size_bytes: u64,
    pub telemetry_count: u64,
    pub events_count: u64,
    pub oldest_telemetry: Option<String>,
    pub newest_telemetry: Option<String>,
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
    writer: Arc<Mutex<Connection>>,
    reader: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl Database {
    pub fn init<P: AsRef<Path>>(path: P) -> Result<Self> {
        let p = path.as_ref();
        let db_path = p.to_path_buf();
        let is_memory = p == Path::new(":memory:") || p.to_str() == Some(":memory:");

        let writer_conn = Connection::open(p)?;
        Self::apply_pragmas(&writer_conn)?;
        Self::init_schema(&writer_conn)?;

        let writer = Arc::new(Mutex::new(writer_conn));

        let reader = if is_memory {
            writer.clone()
        } else {
            let reader_conn = Connection::open(p)?;
            Self::apply_pragmas(&reader_conn)?;
            Arc::new(Mutex::new(reader_conn))
        };

        Ok(Self {
            writer,
            reader,
            db_path,
        })
    }

    fn apply_pragmas(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            PRAGMA mmap_size = 268435456;
            PRAGMA temp_store = MEMORY;
            PRAGMA wal_autocheckpoint = 1000;
            ",
        )?;
        Ok(())
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        // Detect legacy schema that used port_name without foreign keys
        let needs_fresh_start = {
            let mut is_legacy = false;
            if let Ok(mut stmt) = conn.prepare("PRAGMA table_info(telemetry)") {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
                    let cols: Vec<String> = rows.filter_map(|r| r.ok()).collect();
                    if !cols.is_empty() && (cols.contains(&"port_name".to_string()) || !cols.contains(&"ups_id".to_string())) {
                        is_legacy = true;
                    }
                }
            }
            if !is_legacy {
                if let Ok(mut stmt) = conn.prepare("PRAGMA table_info(events)") {
                    if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
                        let cols: Vec<String> = rows.filter_map(|r| r.ok()).collect();
                        if !cols.is_empty() && (cols.contains(&"port_name".to_string()) || !cols.contains(&"ups_id".to_string())) {
                            is_legacy = true;
                        }
                    }
                }
            }
            is_legacy
        };

        if needs_fresh_start {
            tracing::info!("[DATABASE] Legacy schema detected (unlinked port_name). Resetting tables to relational ups_id schema.");
            conn.execute_batch(
                "
                PRAGMA foreign_keys = OFF;
                DROP TABLE IF EXISTS telemetry;
                DROP TABLE IF EXISTS events;
                DROP TABLE IF EXISTS ups_metadata;
                PRAGMA foreign_keys = ON;
                ",
            )?;
        }

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ups_metadata (
                unique_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                usb_uuid TEXT,
                bridge_mac TEXT,
                hardware_signature TEXT,
                rated_va INTEGER NOT NULL DEFAULT 1000,
                power_factor REAL NOT NULL DEFAULT 0.8,
                rated_watts INTEGER NOT NULL DEFAULT 800,
                battery_voltage INTEGER NOT NULL DEFAULT 24,
                battery_capacity_ah REAL NOT NULL DEFAULT 9.0,
                battery_chemistry TEXT NOT NULL DEFAULT 'VRLA_SLA',
                topology TEXT NOT NULL DEFAULT 'Online',
                poll_interval_secs INTEGER NOT NULL DEFAULT 10,
                bridge_ws_host TEXT,
                last_port TEXT,
                is_primary INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                ups_id TEXT NOT NULL,
                grid_voltage REAL,
                output_voltage REAL,
                grid_frequency REAL DEFAULT 50.0,
                output_frequency REAL DEFAULT 50.0,
                load_pct INTEGER,
                output_watts INTEGER DEFAULT 0,
                battery_voltage REAL,
                temperature_c INTEGER,
                FOREIGN KEY (ups_id) REFERENCES ups_metadata(unique_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                ups_id TEXT,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                message TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (ups_id) REFERENCES ups_metadata(unique_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS auth_credentials (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_telemetry_ups_time ON telemetry(ups_id, timestamp ASC);
            CREATE INDEX IF NOT EXISTS idx_telemetry_ups_id ON telemetry(ups_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_events_ack ON events(acknowledged);
            CREATE INDEX IF NOT EXISTS idx_events_ups_time ON events(ups_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_ups_metadata_bridge_mac ON ups_metadata(bridge_mac);
            CREATE INDEX IF NOT EXISTS idx_ups_metadata_usb_uuid ON ups_metadata(usb_uuid);
            CREATE INDEX IF NOT EXISTS idx_ups_metadata_hw_sig ON ups_metadata(hardware_signature);
            ",
        )?;

        // Column migrations for ups_metadata
        let _ = conn.execute("ALTER TABLE ups_metadata ADD COLUMN poll_interval_secs INTEGER NOT NULL DEFAULT 10", []);
        let _ = conn.execute("ALTER TABLE ups_metadata ADD COLUMN bridge_ws_host TEXT", []);
        let _ = conn.execute("ALTER TABLE ups_metadata ADD COLUMN last_port TEXT", []);
        let _ = conn.execute("ALTER TABLE ups_metadata ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0", []);

        Ok(())
    }

    pub fn insert_telemetry(&self, record: &TelemetryRecord) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute(
            "INSERT INTO telemetry (timestamp, ups_id, grid_voltage, output_voltage, grid_frequency, output_frequency, load_pct, output_watts, battery_voltage, temperature_c)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.timestamp,
                record.ups_id,
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

    pub fn insert_telemetry_if_not_exists(&self, record: &TelemetryRecord) -> Result<bool> {
        let conn = self.writer.lock().unwrap();
        let mut check_stmt = conn.prepare_cached(
            "SELECT 1 FROM telemetry WHERE ups_id = ?1 AND timestamp = ?2 LIMIT 1",
        )?;
        let exists: bool = check_stmt.exists(params![record.ups_id, record.timestamp])?;
        if exists {
            return Ok(false);
        }
        conn.execute(
            "INSERT INTO telemetry (timestamp, ups_id, grid_voltage, output_voltage, grid_frequency, output_frequency, load_pct, output_watts, battery_voltage, temperature_c)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.timestamp,
                record.ups_id,
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
        Ok(true)
    }

    pub fn query_recent_telemetry(
        &self,
        ups_id: &str,
        limit: u32,
    ) -> Result<Vec<TelemetryRecord>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, ups_id, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
             FROM telemetry WHERE ups_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![ups_id, limit], |row| {
            Ok(TelemetryRecord {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                ups_id: row.get(2)?,
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
        ups_id: &str,
        start_time: &str,
        end_time: &str,
        max_points: Option<u32>,
    ) -> Result<Vec<TelemetryRecord>> {
        let conn = self.reader.lock().unwrap();

        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM telemetry WHERE ups_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3",
            params![ups_id, start_time, end_time],
            |row| row.get(0),
        )?;

        let step = match max_points {
            Some(0) => 1,
            Some(limit) => {
                let max_p = limit.max(100);
                if count > max_p {
                    (count as f64 / max_p as f64).ceil() as u32
                } else {
                    1
                }
            }
            None => {
                let max_p = 5000;
                if count > max_p {
                    (count as f64 / max_p as f64).ceil() as u32
                } else {
                    1
                }
            }
        };

        let mut results = Vec::new();

        if step > 1 {
            let sql = format!(
                "SELECT id, timestamp, ups_id, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
                 FROM (
                     SELECT id, timestamp, ups_id, grid_voltage, output_voltage, grid_frequency, output_frequency, load_pct, output_watts, battery_voltage, temperature_c,
                            ROW_NUMBER() OVER (ORDER BY timestamp ASC) as rn
                     FROM telemetry
                     WHERE ups_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3
                 )
                 WHERE (rn - 1) % {} = 0
                 ORDER BY timestamp ASC",
                step
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![ups_id, start_time, end_time], |row| {
                Ok(TelemetryRecord {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    ups_id: row.get(2)?,
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
                "SELECT id, timestamp, ups_id, grid_voltage, output_voltage, COALESCE(grid_frequency, 50.0), COALESCE(output_frequency, 50.0), load_pct, COALESCE(output_watts, 0), battery_voltage, temperature_c
                 FROM telemetry
                 WHERE ups_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3
                 ORDER BY timestamp ASC",
            )?;
            let rows = stmt.query_map(params![ups_id, start_time, end_time], |row| {
                Ok(TelemetryRecord {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    ups_id: row.get(2)?,
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
        let conn = self.writer.lock().unwrap();
        conn.execute(
            "INSERT INTO events (timestamp, ups_id, event_type, severity, message, acknowledged)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                record.timestamp,
                record.ups_id,
                record.event_type,
                record.severity,
                record.message,
                if record.acknowledged { 1 } else { 0 },
            ],
        )?;
        Ok(())
    }

    pub fn query_recent_events(
        &self,
        ups_id: Option<&str>,
        include_system: bool,
        limit: u32,
    ) -> Result<Vec<EventLogRecord>> {
        let conn = self.reader.lock().unwrap();
        let (sql, rows) = match (ups_id, include_system) {
            (Some(id), true) => {
                let mut stmt = conn.prepare(
                    "SELECT id, timestamp, ups_id, event_type, COALESCE(severity, 'info'), message, COALESCE(acknowledged, 0)
                     FROM events WHERE ups_id = ?1 OR ups_id IS NULL ORDER BY id DESC LIMIT ?2",
                )?;
                let list = stmt
                    .query_map(params![id, limit], Self::map_event_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                (stmt, list)
            }
            (Some(id), false) => {
                let mut stmt = conn.prepare(
                    "SELECT id, timestamp, ups_id, event_type, COALESCE(severity, 'info'), message, COALESCE(acknowledged, 0)
                     FROM events WHERE ups_id = ?1 ORDER BY id DESC LIMIT ?2",
                )?;
                let list = stmt
                    .query_map(params![id, limit], Self::map_event_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                (stmt, list)
            }
            (None, _) => {
                let mut stmt = conn.prepare(
                    "SELECT id, timestamp, ups_id, event_type, COALESCE(severity, 'info'), message, COALESCE(acknowledged, 0)
                     FROM events ORDER BY id DESC LIMIT ?1",
                )?;
                let list = stmt
                    .query_map(params![limit], Self::map_event_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                (stmt, list)
            }
        };
        drop(sql);
        Ok(rows)
    }

    fn map_event_row(row: &rusqlite::Row) -> rusqlite::Result<EventLogRecord> {
        let ack_int: i64 = row.get(6)?;
        Ok(EventLogRecord {
            id: Some(row.get(0)?),
            timestamp: row.get(1)?,
            ups_id: row.get(2)?,
            event_type: row.get(3)?,
            severity: row.get(4)?,
            message: row.get(5)?,
            acknowledged: ack_int != 0,
        })
    }

    pub fn clear_events(&self, ups_id: Option<&str>) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        if let Some(id) = ups_id {
            conn.execute("DELETE FROM events WHERE ups_id = ?1", params![id])?;
        } else {
            conn.execute("DELETE FROM events", [])?;
        }
        Ok(())
    }

    pub fn acknowledge_event(&self, event_id: i64) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute("UPDATE events SET acknowledged = 1 WHERE id = ?1", params![event_id])?;
        Ok(())
    }

    pub fn acknowledge_all_events(&self, ups_id: Option<&str>) -> Result<usize> {
        let conn = self.writer.lock().unwrap();
        let rows = if let Some(id) = ups_id {
            conn.execute(
                "UPDATE events SET acknowledged = 1 WHERE (ups_id = ?1 OR ups_id IS NULL) AND acknowledged = 0",
                params![id],
            )?
        } else {
            conn.execute("UPDATE events SET acknowledged = 1 WHERE acknowledged = 0", [])?
        };
        Ok(rows)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_auth_credentials(&self) -> Result<Option<crate::auth::CredentialRecord>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare("SELECT username, password_hash FROM auth_credentials LIMIT 1")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some(crate::auth::CredentialRecord {
                username: row.get(0)?,
                password_hash: row.get(1)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn set_auth_credentials(&self, username: &str, password_hash: &str) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("DELETE FROM auth_credentials", [])?;
        conn.execute(
            "INSERT INTO auth_credentials (username, password_hash, updated_at) VALUES (?1, ?2, ?3)",
            params![username, password_hash, now],
        )?;
        Ok(())
    }

    pub fn delete_auth_credentials(&self) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute("DELETE FROM auth_credentials", [])?;
        Ok(())
    }

    pub fn update_device_usb_uuid(
        &self,
        unique_id: &str,
        new_usb_uuid: &str,
        updated_at: &str,
    ) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute(
            "UPDATE ups_metadata SET usb_uuid = ?1, updated_at = ?2 WHERE unique_id = ?3",
            params![new_usb_uuid, updated_at, unique_id],
        )?;
        Ok(())
    }

    pub fn get_ups_metadata(&self, unique_id: &str) -> Result<Option<UpsMetadata>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, usb_uuid, bridge_mac, hardware_signature, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, poll_interval_secs, bridge_ws_host, last_port, is_primary, updated_at
             FROM ups_metadata WHERE unique_id = ?1",
        )?;

        let mut rows = stmt.query(params![unique_id])?;
        if let Some(row) = rows.next()? {
            let is_primary_int: i64 = row.get(15)?;
            Ok(Some(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                usb_uuid: row.get(2)?,
                bridge_mac: row.get(3)?,
                hardware_signature: row.get(4)?,
                rated_va: row.get(5)?,
                power_factor: row.get(6)?,
                rated_watts: row.get(7)?,
                battery_voltage: row.get(8)?,
                battery_capacity_ah: row.get(9)?,
                battery_chemistry: row.get(10)?,
                topology: row.get(11)?,
                poll_interval_secs: row.get::<_, i64>(12)? as u64,
                bridge_ws_host: row.get(13)?,
                last_port: row.get(14)?,
                is_primary: is_primary_int != 0,
                updated_at: row.get(16)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn resolve_ups_metadata(
        &self,
        unique_id: &str,
        bridge_mac: Option<&str>,
        usb_uuid: Option<&str>,
        hardware_sig: Option<&str>,
    ) -> Result<Option<UpsMetadata>> {
        if let Some(meta) = self.get_ups_metadata(unique_id)? {
            if (bridge_mac.is_some() && meta.bridge_mac.as_deref() != bridge_mac)
                || (usb_uuid.is_some() && meta.usb_uuid.as_deref() != usb_uuid)
                || (hardware_sig.is_some() && meta.hardware_signature.as_deref() != hardware_sig)
            {
                let _ = self.link_transport_to_profile(unique_id, bridge_mac, usb_uuid, hardware_sig);
            }
            return Ok(Some(meta));
        }

        let clean_mac = bridge_mac.map(|m| m.replace(|c: char| !c.is_alphanumeric(), "").to_uppercase());
        if let Some(mac) = clean_mac.as_deref() {
            let legacy_prefix = format!("BRIDGE-MAC-{}", mac);
            let conn = self.writer.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT unique_id FROM ups_metadata WHERE unique_id LIKE ?1 || '%' LIMIT 1",
            )?;
            let legacy_id: Option<String> = stmt.query_row(params![legacy_prefix], |row| row.get(0)).ok();
            drop(stmt);

            if let Some(old_id) = legacy_id {
                let canonical_id = format!("BRIDGE-MAC-{}", mac);
                let now = chrono::Utc::now().to_rfc3339();
                tracing::info!(
                    "[DATABASE] Auto-migrating legacy profile '{}' -> canonical '{}'",
                    old_id,
                    canonical_id
                );
                let _ = conn.execute(
                    "UPDATE ups_metadata SET unique_id = ?1, bridge_mac = ?2, hardware_signature = COALESCE(?3, hardware_signature), updated_at = ?4 WHERE unique_id = ?5",
                    params![canonical_id, mac, hardware_sig, now, old_id],
                );
                drop(conn);
                return self.get_ups_metadata(&canonical_id);
            }
        }

        let conn = self.reader.lock().unwrap();
        if let Some(mac) = clean_mac.as_deref() {
            let mut stmt = conn.prepare(
                "SELECT unique_id FROM ups_metadata WHERE bridge_mac = ?1 LIMIT 1",
            )?;
            if let Ok(matched_id) = stmt.query_row(params![mac], |row| row.get::<_, String>(0)) {
                drop(stmt);
                drop(conn);
                return self.get_ups_metadata(&matched_id);
            }
        }

        if let Some(uuid) = usb_uuid {
            let mut stmt = conn.prepare(
                "SELECT unique_id FROM ups_metadata WHERE usb_uuid = ?1 LIMIT 1",
            )?;
            if let Ok(matched_id) = stmt.query_row(params![uuid], |row| row.get::<_, String>(0)) {
                drop(stmt);
                drop(conn);
                return self.get_ups_metadata(&matched_id);
            }
        }

        Ok(None)
    }

    pub fn link_transport_to_profile(
        &self,
        unique_id: &str,
        bridge_mac: Option<&str>,
        usb_uuid: Option<&str>,
        hardware_sig: Option<&str>,
    ) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        let clean_mac = bridge_mac.map(|m| m.replace(|c: char| !c.is_alphanumeric(), "").to_uppercase());
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE ups_metadata SET 
                bridge_mac = COALESCE(?1, bridge_mac),
                usb_uuid = COALESCE(?2, usb_uuid),
                hardware_signature = COALESCE(?3, hardware_signature),
                updated_at = ?4
             WHERE unique_id = ?5",
            params![clean_mac, usb_uuid, hardware_sig, now, unique_id],
        )?;
        Ok(())
    }

    pub fn get_disambiguation_candidates(&self, hardware_sig: &str) -> Result<Vec<UpsMetadata>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, usb_uuid, bridge_mac, hardware_signature, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, poll_interval_secs, bridge_ws_host, last_port, is_primary, updated_at
             FROM ups_metadata WHERE hardware_signature = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![hardware_sig], |row| {
            let is_primary_int: i64 = row.get(15)?;
            Ok(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                usb_uuid: row.get(2)?,
                bridge_mac: row.get(3)?,
                hardware_signature: row.get(4)?,
                rated_va: row.get(5)?,
                power_factor: row.get(6)?,
                rated_watts: row.get(7)?,
                battery_voltage: row.get(8)?,
                battery_capacity_ah: row.get(9)?,
                battery_chemistry: row.get(10)?,
                topology: row.get(11)?,
                poll_interval_secs: row.get::<_, i64>(12)? as u64,
                bridge_ws_host: row.get(13)?,
                last_port: row.get(14)?,
                is_primary: is_primary_int != 0,
                updated_at: row.get(16)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn save_ups_metadata(&self, meta: &UpsMetadata) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute(
            "INSERT INTO ups_metadata (unique_id, name, usb_uuid, bridge_mac, hardware_signature, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, poll_interval_secs, bridge_ws_host, last_port, is_primary, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(unique_id) DO UPDATE SET
                name = excluded.name,
                usb_uuid = COALESCE(excluded.usb_uuid, ups_metadata.usb_uuid),
                bridge_mac = COALESCE(excluded.bridge_mac, ups_metadata.bridge_mac),
                hardware_signature = COALESCE(excluded.hardware_signature, ups_metadata.hardware_signature),
                rated_va = excluded.rated_va,
                power_factor = excluded.power_factor,
                rated_watts = excluded.rated_watts,
                battery_voltage = excluded.battery_voltage,
                battery_capacity_ah = excluded.battery_capacity_ah,
                battery_chemistry = excluded.battery_chemistry,
                topology = excluded.topology,
                poll_interval_secs = excluded.poll_interval_secs,
                bridge_ws_host = COALESCE(excluded.bridge_ws_host, ups_metadata.bridge_ws_host),
                last_port = COALESCE(excluded.last_port, ups_metadata.last_port),
                is_primary = excluded.is_primary,
                updated_at = excluded.updated_at",
            params![
                meta.unique_id,
                meta.name,
                meta.usb_uuid,
                meta.bridge_mac,
                meta.hardware_signature,
                meta.rated_va,
                meta.power_factor,
                meta.rated_watts,
                meta.battery_voltage,
                meta.battery_capacity_ah,
                meta.battery_chemistry,
                meta.topology,
                meta.poll_interval_secs as i64,
                meta.bridge_ws_host,
                meta.last_port,
                if meta.is_primary { 1 } else { 0 },
                meta.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_all_ups_metadata(&self) -> Result<Vec<UpsMetadata>> {
        let conn = self.reader.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, usb_uuid, bridge_mac, hardware_signature, rated_va, power_factor, rated_watts, battery_voltage, battery_capacity_ah, battery_chemistry, topology, poll_interval_secs, bridge_ws_host, last_port, is_primary, updated_at
             FROM ups_metadata ORDER BY is_primary DESC, updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let is_primary_int: i64 = row.get(15)?;
            Ok(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                usb_uuid: row.get(2)?,
                bridge_mac: row.get(3)?,
                hardware_signature: row.get(4)?,
                rated_va: row.get(5)?,
                power_factor: row.get(6)?,
                rated_watts: row.get(7)?,
                battery_voltage: row.get(8)?,
                battery_capacity_ah: row.get(9)?,
                battery_chemistry: row.get(10)?,
                topology: row.get(11)?,
                poll_interval_secs: row.get::<_, i64>(12)? as u64,
                bridge_ws_host: row.get(13)?,
                last_port: row.get(14)?,
                is_primary: is_primary_int != 0,
                updated_at: row.get(16)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn delete_ups_metadata(&self, unique_id: &str) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute("DELETE FROM ups_metadata WHERE unique_id = ?1", params![unique_id])?;
        Ok(())
    }

    pub fn set_primary_ups(&self, unique_id: &str) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute("UPDATE ups_metadata SET is_primary = 0", [])?;
        conn.execute("UPDATE ups_metadata SET is_primary = 1 WHERE unique_id = ?1", params![unique_id])?;
        Ok(())
    }

    pub fn prune_telemetry(&self, older_than_days: u32, ups_id: Option<&str>) -> Result<usize> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days as i64);
        let cutoff_iso = cutoff.to_rfc3339();
        let conn = self.writer.lock().unwrap();
        let count = if let Some(id) = ups_id {
            conn.execute(
                "DELETE FROM telemetry WHERE ups_id = ?1 AND timestamp < ?2",
                params![id, cutoff_iso],
            )?
        } else {
            conn.execute(
                "DELETE FROM telemetry WHERE timestamp < ?1",
                params![cutoff_iso],
            )?
        };
        Ok(count)
    }

    pub fn clear_telemetry(&self, ups_id: Option<&str>) -> Result<usize> {
        let conn = self.writer.lock().unwrap();
        let count = if let Some(id) = ups_id {
            conn.execute("DELETE FROM telemetry WHERE ups_id = ?1", params![id])?
        } else {
            conn.execute("DELETE FROM telemetry", [])?
        };
        Ok(count)
    }

    pub fn vacuum_database(&self) -> Result<()> {
        let conn = self.writer.lock().unwrap();
        conn.execute_batch(
            "
            VACUUM;
            PRAGMA optimize;
            ",
        )?;
        Ok(())
    }

    pub fn get_db_stats(&self) -> Result<DbStats> {
        let file_size_bytes = std::fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let wal_path = {
            let mut p = self.db_path.clone().into_os_string();
            p.push("-wal");
            PathBuf::from(p)
        };
        let wal_size_bytes = std::fs::metadata(&wal_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let conn = self.reader.lock().unwrap();
        let telemetry_count: u64 = conn.query_row("SELECT COUNT(*) FROM telemetry", [], |r| r.get(0))?;
        let events_count: u64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))?;
        let oldest_telemetry: Option<String> = conn
            .query_row("SELECT MIN(timestamp) FROM telemetry", [], |r| r.get(0))
            .optional()?
            .flatten();
        let newest_telemetry: Option<String> = conn
            .query_row("SELECT MAX(timestamp) FROM telemetry", [], |r| r.get(0))
            .optional()?
            .flatten();

        Ok(DbStats {
            file_size_bytes,
            wal_size_bytes,
            telemetry_count,
            events_count,
            oldest_telemetry,
            newest_telemetry,
        })
    }
}
