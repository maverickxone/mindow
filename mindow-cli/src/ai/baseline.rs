#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Historical baseline statistics for a process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessBaseline {
    pub samples: u64,
    pub avg_memory_mb: f64,
    pub max_memory_mb: f64,
    pub p95_memory_mb: f64,
    pub avg_cpu: f64,
    pub max_cpu: f64,
    pub last_updated: String,
}

/// All baselines stored in a single file
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BaselineStore {
    pub entries: HashMap<String, ProcessBaseline>,
}

/// Path: ~/.mindow/baselines.json
pub fn baseline_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mindow").join("baselines.json")
}

/// Load baselines from disk
pub fn load_baselines() -> BaselineStore {
    let path = baseline_path();
    if !path.exists() {
        return BaselineStore::default();
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => BaselineStore::default(),
    }
}

/// Save baselines to disk
pub fn save_baselines(store: &BaselineStore) -> Result<(), std::io::Error> {
    let path = baseline_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(store)?;
    fs::write(&path, content)
}

/// Update baseline with a new sample for a process.
/// Uses incremental averaging to avoid storing all raw samples.
pub fn update_baseline(store: &mut BaselineStore, process_name: &str, memory_mb: f64, cpu: f64) {
    let key = process_name.to_lowercase().trim_end_matches(".exe").to_string();
    let now = chrono::Local::now().format("%Y-%m-%d").to_string();

    let entry = store.entries.entry(key).or_insert_with(|| ProcessBaseline {
        samples: 0,
        avg_memory_mb: 0.0,
        max_memory_mb: 0.0,
        p95_memory_mb: 0.0,
        avg_cpu: 0.0,
        max_cpu: 0.0,
        last_updated: now.clone(),
    });

    entry.samples += 1;
    let n = entry.samples as f64;

    // Incremental average: new_avg = old_avg + (value - old_avg) / n
    entry.avg_memory_mb += (memory_mb - entry.avg_memory_mb) / n;
    entry.avg_cpu += (cpu - entry.avg_cpu) / n;

    // Track max
    if memory_mb > entry.max_memory_mb {
        entry.max_memory_mb = memory_mb;
    }
    if cpu > entry.max_cpu {
        entry.max_cpu = cpu;
    }

    // Approximate p95 using exponential moving average toward max
    // Simple heuristic: p95 ≈ avg + 1.5 * (max - avg) * 0.3 (converges over time)
    entry.p95_memory_mb = entry.avg_memory_mb + (entry.max_memory_mb - entry.avg_memory_mb) * 0.6;

    entry.last_updated = now;
}

/// Check if current memory is anomalous compared to baseline.
/// Returns None if not enough samples (< 10), or Some(deviation_factor).
pub fn check_memory_anomaly(store: &BaselineStore, process_name: &str, current_memory_mb: f64) -> Option<f64> {
    let key = process_name.to_lowercase().trim_end_matches(".exe").to_string();
    let entry = store.entries.get(&key)?;

    // Need at least 10 samples for meaningful baseline
    if entry.samples < 10 {
        return None;
    }

    // Anomaly = current is > 1.5x the p95 baseline
    if entry.p95_memory_mb > 0.0 {
        let ratio = current_memory_mb / entry.p95_memory_mb;
        if ratio > 1.5 {
            return Some(ratio);
        }
    }
    None
}

/// Get a human-readable baseline summary for a process
pub fn get_baseline_summary(store: &BaselineStore, process_name: &str) -> Option<String> {
    let key = process_name.to_lowercase().trim_end_matches(".exe").to_string();
    let entry = store.entries.get(&key)?;

    Some(format!(
        "Samples: {}, Avg Memory: {:.0} MB, Max: {:.0} MB, Avg CPU: {:.1}%",
        entry.samples, entry.avg_memory_mb, entry.max_memory_mb, entry.avg_cpu
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_baseline_first_sample() {
        let mut store = BaselineStore::default();
        update_baseline(&mut store, "chrome.exe", 500.0, 10.0);

        let entry = store.entries.get("chrome").unwrap();
        assert_eq!(entry.samples, 1);
        assert_eq!(entry.avg_memory_mb, 500.0);
        assert_eq!(entry.avg_cpu, 10.0);
        assert_eq!(entry.max_memory_mb, 500.0);
    }

    #[test]
    fn test_update_baseline_multiple_samples() {
        let mut store = BaselineStore::default();
        update_baseline(&mut store, "chrome.exe", 400.0, 5.0);
        update_baseline(&mut store, "chrome.exe", 600.0, 15.0);

        let entry = store.entries.get("chrome").unwrap();
        assert_eq!(entry.samples, 2);
        assert!((entry.avg_memory_mb - 500.0).abs() < 0.1);
        assert!((entry.avg_cpu - 10.0).abs() < 0.1);
        assert_eq!(entry.max_memory_mb, 600.0);
    }

    #[test]
    fn test_check_memory_anomaly_not_enough_samples() {
        let mut store = BaselineStore::default();
        for _ in 0..5 {
            update_baseline(&mut store, "app.exe", 100.0, 5.0);
        }
        // Only 5 samples, need 10
        assert!(check_memory_anomaly(&store, "app.exe", 500.0).is_none());
    }

    #[test]
    fn test_check_memory_anomaly_normal() {
        let mut store = BaselineStore::default();
        for _ in 0..20 {
            update_baseline(&mut store, "app.exe", 100.0, 5.0);
        }
        // 120 MB is within normal range
        assert!(check_memory_anomaly(&store, "app.exe", 120.0).is_none());
    }

    #[test]
    fn test_check_memory_anomaly_detected() {
        let mut store = BaselineStore::default();
        for _ in 0..20 {
            update_baseline(&mut store, "app.exe", 100.0, 5.0);
        }
        // 500 MB is way above p95 (~100 MB) * 1.5
        let result = check_memory_anomaly(&store, "app.exe", 500.0);
        assert!(result.is_some());
        assert!(result.unwrap() > 1.5);
    }

    #[test]
    fn test_get_baseline_summary() {
        let mut store = BaselineStore::default();
        update_baseline(&mut store, "test.exe", 200.0, 8.0);
        update_baseline(&mut store, "test.exe", 300.0, 12.0);

        let summary = get_baseline_summary(&store, "test.exe");
        assert!(summary.is_some());
        assert!(summary.unwrap().contains("Samples: 2"));
    }
}
