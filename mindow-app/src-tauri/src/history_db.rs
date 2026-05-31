// SQLite-based history persistence for performance metrics and alerts.
// Stores system metrics every sampling cycle, auto-cleans data older than 7 days.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::state::SystemInfo;

/// Maximum age of history data in seconds (7 days).
const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;

/// How often to run cleanup (every 500 cycles ≈ ~17 minutes at 2s interval).
const CLEANUP_INTERVAL: u64 = 500;

/// Thread-safe wrapper around the SQLite connection.
pub struct HistoryDb {
    conn: Mutex<Connection>,
    cycle_count: Mutex<u64>,
}

impl HistoryDb {
    /// Open (or create) the history database at ~/.mindow/history.db.
    pub fn open() -> Result<Self, String> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }

        let conn = Connection::open(&path)
            .map_err(|e| format!("Failed to open history db: {}", e))?;

        // WAL mode for better concurrent read/write
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        // Create tables
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS system_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                cpu_avg REAL NOT NULL,
                mem_used INTEGER NOT NULL,
                mem_total INTEGER NOT NULL,
                disk_read INTEGER NOT NULL,
                disk_write INTEGER NOT NULL,
                battery_level REAL
            );
            CREATE INDEX IF NOT EXISTS idx_metrics_ts ON system_metrics(timestamp);

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                alert_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                message TEXT NOT NULL,
                process_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(timestamp);",
        )
        .map_err(|e| format!("Failed to create tables: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
            cycle_count: Mutex::new(0),
        })
    }

    /// Record a system metrics snapshot.
    pub fn record_metrics(
        &self,
        system: &SystemInfo,
        disk_read: u64,
        disk_write: u64,
    ) {
        let now = now_unix_secs();
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO system_metrics (timestamp, cpu_avg, mem_used, mem_total, disk_read, disk_write, battery_level)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                now,
                system.cpu_avg as f64,
                system.used_memory,
                system.total_memory,
                disk_read,
                disk_write,
                system.battery_level.map(|l| l as f64),
            ],
        );

        // Periodic cleanup
        drop(conn);
        self.maybe_cleanup();
    }

    /// Record an alert event.
    pub fn record_alert(&self, alert_type: &str, severity: &str, message: &str, process_name: Option<&str>) {
        let now = now_unix_secs();
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO alerts (timestamp, alert_type, severity, message, process_name)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![now, alert_type, severity, message, process_name],
        );
    }

    /// Run cleanup if enough cycles have passed.
    fn maybe_cleanup(&self) {
        let mut count = self.cycle_count.lock().unwrap();
        *count += 1;
        if *count % CLEANUP_INTERVAL != 0 {
            return;
        }

        let cutoff = now_unix_secs().saturating_sub(MAX_AGE_SECS);
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM system_metrics WHERE timestamp < ?1", params![cutoff]);
        let _ = conn.execute("DELETE FROM alerts WHERE timestamp < ?1", params![cutoff]);
    }
}

/// Database file path: ~/.mindow/history.db
fn db_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".mindow").join("history.db")
}

/// Current Unix timestamp in seconds.
fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
