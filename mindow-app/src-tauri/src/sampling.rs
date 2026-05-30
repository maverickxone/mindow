// Background sampling thread: collects system/process data every 2 seconds,
// evaluates rules, updates baselines/history, and pushes events to the frontend.

use std::panic;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::Emitter;

use mindow_ai::baseline;
use mindow_core::collector::{Collect, SysinfoCollector};
use mindow_core::config::Config;
use mindow_core::filter::filter_snapshot;
use mindow_core::types::{BatteryStatus, ChargingState, PathStatus};

use crate::state::{
    AlertInfo, AppState, BatteryChargingState, PathStatusInfo, ProcessInfo, SnapshotData, SystemInfo,
};

/// Maximum number of data points to keep in performance history (2 minutes at 2s interval).
const MAX_HISTORY_POINTS: usize = 60;

/// Sampling interval in seconds.
const SAMPLING_INTERVAL_SECS: u64 = 2;

/// Starts the background sampling loop in a dedicated thread.
///
/// The thread runs indefinitely (until the application exits), performing the following
/// each cycle:
/// 1. Collect process and system data via `mindow_core::collector`
/// 2. Filter/merge processes via `mindow_core::filter`
/// 3. Evaluate alert rules via `mindow_core::rule_engine`
/// 4. Update baselines via `mindow_ai::baseline`
/// 5. Append to performance history (capped at 60 data points)
/// 6. Emit "snapshot-updated" event to the frontend
///
/// Uses `std::panic::catch_unwind` to protect against panics within the sampling loop.
pub fn start_sampling_loop(
    app_handle: tauri::AppHandle,
    state: Arc<AppState>,
    config: Config,
) {
    thread::spawn(move || {
        let mut collector = SysinfoCollector::new();

        // Allow initial CPU baseline to seed (first refresh gives 0% CPU)
        thread::sleep(Duration::from_millis(500));

        loop {
            let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
                sampling_cycle(&mut collector, &app_handle, &state, &config);
            }));

            if let Err(e) = result {
                let msg = if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                eprintln!("[sampling] panic caught, resuming: {}", msg);
            }

            thread::sleep(Duration::from_secs(SAMPLING_INTERVAL_SECS));
        }
    });
}

/// Executes a single sampling cycle.
fn sampling_cycle(
    collector: &mut SysinfoCollector,
    app_handle: &tauri::AppHandle,
    state: &Arc<AppState>,
    config: &Config,
) {
    // 1. Collect raw process and system data
    let processes = collector.collect_processes();
    let system_sample = collector.collect_system();

    // 2. Filter processes (top-N by CPU and memory, deduplicated)
    let filtered = filter_snapshot(&processes, config);

    // 3. Evaluate rules (memory leak, high CPU, battery, memory pressure)
    let alerts = {
        let mut engine = state.rule_engine.lock().unwrap();
        engine.evaluate(&filtered, &system_sample)
    };

    // 4. Update baselines with filtered process data
    {
        let mut baselines = state.baselines.lock().unwrap();
        for fp in &filtered.processes {
            let mem_mb = fp.sample.memory_bytes as f64 / 1_048_576.0;
            let cpu = fp.sample.cpu_percent as f64;
            baseline::update_baseline(&mut baselines, &fp.sample.name, mem_mb, cpu);
        }
        // Only persist to disk if writable (file wasn't corrupted)
        if state.baselines_writable {
            let _ = baseline::save_baselines(&baselines);
        }
    }

    // 5. Build frontend-friendly data structures
    let baseline_store = state.baselines.lock().unwrap();

    let process_infos: Vec<ProcessInfo> = filtered
        .processes
        .iter()
        .map(|fp| {
            let mem_mb = fp.sample.memory_bytes as f64 / 1_048_576.0;
            let deviation = baseline::check_memory_anomaly(&baseline_store, &fp.sample.name, mem_mb);

            ProcessInfo {
                name: fp.sample.name.clone(),
                pid: fp.sample.pid,
                cpu_percent: fp.sample.cpu_percent,
                memory_bytes: fp.sample.memory_bytes,
                disk_read_bytes: fp.sample.disk_read_bytes,
                disk_write_bytes: fp.sample.disk_write_bytes,
                path_status: match fp.path_status {
                    PathStatus::System => PathStatusInfo::System,
                    PathStatus::User => PathStatusInfo::User,
                    PathStatus::Unknown => PathStatusInfo::Unknown,
                },
                instance_count: 1, // Individual process; grouping done in frontend
                baseline_deviation: deviation,
                exe_path: fp.sample.exe_path.clone(),
                parent_pid: fp.sample.parent_pid,
            }
        })
        .collect();

    drop(baseline_store);

    // Build system info
    let cpu_avg = if system_sample.per_core_cpu.is_empty() {
        0.0
    } else {
        system_sample.per_core_cpu.iter().sum::<f32>() / system_sample.per_core_cpu.len() as f32
    };

    let (battery_level, battery_charging) = match &system_sample.battery {
        BatteryStatus::Available { level, charging } => {
            let charging_state = match charging {
                ChargingState::Charging => Some(BatteryChargingState::Charging),
                ChargingState::Discharging => Some(BatteryChargingState::Discharging),
                ChargingState::Full => Some(BatteryChargingState::Full),
                ChargingState::Unknown => None,
            };
            (Some(*level), charging_state)
        }
        BatteryStatus::Unavailable => (None, None),
    };

    let system_info = SystemInfo {
        total_memory: system_sample.total_memory,
        used_memory: system_sample.used_memory,
        cpu_avg,
        per_core_cpu: system_sample.per_core_cpu.clone(),
        battery_level,
        battery_charging,
    };

    // Build alert infos
    let alert_infos: Vec<AlertInfo> = alerts.iter().map(AlertInfo::from_alert).collect();

    // 5.5 Check alerts and send system notifications (with 5-min cooldown dedup)
    crate::notifications::check_and_send_alerts(&alert_infos, state, app_handle);

    // Build the snapshot
    let snapshot = SnapshotData {
        processes: process_infos,
        system: system_info.clone(),
        alerts: alert_infos,
    };

    // 6. Update shared state
    {
        let mut snap = state.snapshot.lock().unwrap();
        *snap = snapshot.clone();
    }

    // 7. Update performance history (capped at MAX_HISTORY_POINTS)
    {
        let mut history = state.performance_history.lock().unwrap();

        // CPU average
        if history.cpu_history.len() >= MAX_HISTORY_POINTS {
            history.cpu_history.pop_front();
        }
        history.cpu_history.push_back(cpu_avg);

        // Memory percentage
        let mem_percent = if system_sample.total_memory > 0 {
            (system_sample.used_memory as f64 / system_sample.total_memory as f64) * 100.0
        } else {
            0.0
        };
        if history.memory_history.len() >= MAX_HISTORY_POINTS {
            history.memory_history.pop_front();
        }
        history.memory_history.push_back(mem_percent);

        // Disk I/O (sum of all filtered processes as approximation)
        let total_read: u64 = filtered.processes.iter().map(|p| p.sample.disk_read_bytes).sum();
        let total_write: u64 = filtered.processes.iter().map(|p| p.sample.disk_write_bytes).sum();
        if history.disk_read_history.len() >= MAX_HISTORY_POINTS {
            history.disk_read_history.pop_front();
        }
        history.disk_read_history.push_back(total_read);
        if history.disk_write_history.len() >= MAX_HISTORY_POINTS {
            history.disk_write_history.pop_front();
        }
        history.disk_write_history.push_back(total_write);

        // Per-core CPU (latest values)
        history.per_core_cpu = system_sample.per_core_cpu.clone();
    }

    // 8. Emit event to frontend
    let _ = app_handle.emit("snapshot-updated", &snapshot);
}
