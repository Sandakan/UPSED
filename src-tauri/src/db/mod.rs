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
    pub load_pct: u32,
    pub battery_voltage: f32,
    pub temperature_c: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLogRecord {
    pub id: Option<i64>,
    pub timestamp: String,
    pub port_name: String,
    pub event_type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub poll_interval_secs: u64,
    pub battery_bridge_enabled: bool,
    pub auto_shutdown_enabled: bool,
    pub shutdown_battery_pct: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsMetadata {
    pub unique_id: String,
    pub name: String,
    pub rated_watts: u32,
    pub rated_va: u32,
    pub battery_voltage: u32,
    pub battery_capacity_ah: f32,
    pub updated_at: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            poll_interval_secs: 30,
            battery_bridge_enabled: false, // Default disabled as requested
            auto_shutdown_enabled: false,
            shutdown_battery_pct: 15,
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
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                port_name TEXT NOT NULL,
                grid_voltage REAL,
                output_voltage REAL,
                load_pct INTEGER,
                battery_voltage REAL,
                temperature_c INTEGER
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                port_name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ups_metadata (
                unique_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                rated_watts INTEGER NOT NULL DEFAULT 600,
                rated_va INTEGER NOT NULL DEFAULT 1000,
                battery_voltage INTEGER NOT NULL DEFAULT 24,
                battery_capacity_ah REAL NOT NULL DEFAULT 9.0,
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn insert_telemetry(&self, record: &TelemetryRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO telemetry (timestamp, port_name, grid_voltage, output_voltage, load_pct, battery_voltage, temperature_c)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.timestamp,
                record.port_name,
                record.grid_voltage,
                record.output_voltage,
                record.load_pct,
                record.battery_voltage,
                record.temperature_c,
            ],
        )?;
        Ok(())
    }

    pub fn query_recent_telemetry(&self, port_name: &str, limit: u32) -> Result<Vec<TelemetryRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, port_name, grid_voltage, output_voltage, load_pct, battery_voltage, temperature_c
             FROM telemetry WHERE port_name = ?1 ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![port_name, limit], |row| {
            Ok(TelemetryRecord {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                port_name: row.get(2)?,
                grid_voltage: row.get(3)?,
                output_voltage: row.get(4)?,
                load_pct: row.get(5)?,
                battery_voltage: row.get(6)?,
                temperature_c: row.get(7)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        results.reverse(); // chronological order
        Ok(results)
    }

    pub fn insert_event(&self, record: &EventLogRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO events (timestamp, port_name, event_type, message)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                record.timestamp,
                record.port_name,
                record.event_type,
                record.message,
            ],
        )?;
        Ok(())
    }

    pub fn query_recent_events(&self, limit: u32) -> Result<Vec<EventLogRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, port_name, event_type, message
             FROM events ORDER BY id DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok(EventLogRecord {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                port_name: row.get(2)?,
                event_type: row.get(3)?,
                message: row.get(4)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn get_ups_metadata(&self, unique_id: &str) -> Result<Option<UpsMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, rated_watts, rated_va, battery_voltage, battery_capacity_ah, updated_at
             FROM ups_metadata WHERE unique_id = ?1",
        )?;

        let mut rows = stmt.query(params![unique_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                rated_watts: row.get(2)?,
                rated_va: row.get(3)?,
                battery_voltage: row.get(4)?,
                battery_capacity_ah: row.get(5)?,
                updated_at: row.get(6)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_ups_metadata(&self, meta: &UpsMetadata) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ups_metadata (unique_id, name, rated_watts, rated_va, battery_voltage, battery_capacity_ah, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(unique_id) DO UPDATE SET
                name = excluded.name,
                rated_watts = excluded.rated_watts,
                rated_va = excluded.rated_va,
                battery_voltage = excluded.battery_voltage,
                battery_capacity_ah = excluded.battery_capacity_ah,
                updated_at = excluded.updated_at",
            params![
                meta.unique_id,
                meta.name,
                meta.rated_watts,
                meta.rated_va,
                meta.battery_voltage,
                meta.battery_capacity_ah,
                meta.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_all_ups_metadata(&self) -> Result<Vec<UpsMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT unique_id, name, rated_watts, rated_va, battery_voltage, battery_capacity_ah, updated_at
             FROM ups_metadata ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(UpsMetadata {
                unique_id: row.get(0)?,
                name: row.get(1)?,
                rated_watts: row.get(2)?,
                rated_va: row.get(3)?,
                battery_voltage: row.get(4)?,
                battery_capacity_ah: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }
}
