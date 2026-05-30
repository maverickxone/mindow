use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use mindow_ai::baseline::{self, BaselineStore};
use mindow_ai::knowledge::{self, KnowledgeBase};
use mindow_core::rule_engine::RuleEngine;
use mindow_core::types::Alert;
use serde::Serialize;

/// Backend global shared state managed by Tauri.
pub struct AppState {
    /// Current process snapshot (updated every 2 seconds)
    pub snapshot: Arc<Mutex<SnapshotData>>,
    /// Rule engine (maintains state across sampling cycles)
    pub rule_engine: Arc<Mutex<RuleEngine>>,
    /// Performance history (last 60 data points for charts)
    pub performance_history: Arc<Mutex<PerformanceHistory>>,
    /// Baseline data
    pub baselines: Arc<Mutex<BaselineStore>>,
    /// Whether baselines can be safely written to disk
    pub baselines_writable: bool,
    /// Knowledge base
    pub knowledge: Arc<Mutex<KnowledgeBase>>,
    /// Whether knowledge base can be safely written to disk
    pub knowledge_writable: bool,
    /// Notification dedup cooldown records (alert_key -> last_sent_time)
    pub notification_cooldowns: Arc<Mutex<HashMap<String, Instant>>>,
}

/// Current snapshot of processes, system info, and active alerts.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotData {
    pub processes: Vec<ProcessInfo>,
    pub system: SystemInfo,
    pub alerts: Vec<AlertInfo>,
}

/// Performance history for real-time charts (last 60 data points = 2 minutes).
#[derive(Debug, Clone, Serialize)]
pub struct PerformanceHistory {
    pub cpu_history: VecDeque<f32>,
    pub memory_history: VecDeque<f64>,
    pub disk_read_history: VecDeque<u64>,
    pub disk_write_history: VecDeque<u64>,
    pub per_core_cpu: Vec<f32>,
}

/// System-level metrics.
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    pub total_memory: u64,
    pub used_memory: u64,
    pub cpu_avg: f32,
    pub per_core_cpu: Vec<f32>,
    pub battery_level: Option<f32>,
    pub battery_charging: Option<BatteryChargingState>,
}

/// Battery charging state for frontend display.
#[derive(Debug, Clone, Serialize)]
pub enum BatteryChargingState {
    Charging,
    Discharging,
    Full,
}

/// Process information sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub path_status: PathStatusInfo,
    pub instance_count: u32,
    pub baseline_deviation: Option<f64>,
    pub exe_path: Option<String>,
    pub parent_pid: Option<u32>,
}

/// Path status classification for frontend display.
#[derive(Debug, Clone, Serialize)]
pub enum PathStatusInfo {
    System,
    User,
    Unknown,
}

/// Alert information serialized for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AlertInfo {
    pub alert_type: AlertType,
    pub severity: AlertSeverity,
    pub message: String,
    pub process_name: Option<String>,
    pub pid: Option<u32>,
}

/// Alert type enum matching the core rule_engine alerts.
#[derive(Debug, Clone, Serialize)]
pub enum AlertType {
    MemoryLeak,
    HighCpu,
    MemoryPressure,
    BatteryWarning,
}

/// Alert severity for frontend display.
#[derive(Debug, Clone, Serialize)]
pub enum AlertSeverity {
    Critical,
    Warning,
}

impl AppState {
    /// Create a new AppState with default/empty values and loaded baseline/knowledge data.
    pub fn new() -> Self {
        let config = mindow_core::config::Config::default();
        let rule_engine = RuleEngine::new(config);

        let baseline_result = baseline::load_baselines();
        let knowledge_result = knowledge::load_knowledge();

        Self {
            snapshot: Arc::new(Mutex::new(SnapshotData::default())),
            rule_engine: Arc::new(Mutex::new(rule_engine)),
            performance_history: Arc::new(Mutex::new(PerformanceHistory::new())),
            baselines: Arc::new(Mutex::new(baseline_result.store)),
            baselines_writable: baseline_result.writable,
            knowledge: Arc::new(Mutex::new(knowledge_result.kb)),
            knowledge_writable: knowledge_result.writable,
            notification_cooldowns: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SnapshotData {
    fn default() -> Self {
        Self {
            processes: Vec::new(),
            system: SystemInfo::default(),
            alerts: Vec::new(),
        }
    }
}

impl Default for SystemInfo {
    fn default() -> Self {
        Self {
            total_memory: 0,
            used_memory: 0,
            cpu_avg: 0.0,
            per_core_cpu: Vec::new(),
            battery_level: None,
            battery_charging: None,
        }
    }
}

impl PerformanceHistory {
    /// Create a new empty performance history.
    pub fn new() -> Self {
        Self {
            cpu_history: VecDeque::with_capacity(60),
            memory_history: VecDeque::with_capacity(60),
            disk_read_history: VecDeque::with_capacity(60),
            disk_write_history: VecDeque::with_capacity(60),
            per_core_cpu: Vec::new(),
        }
    }
}

impl AlertInfo {
    /// Convert a core Alert into a frontend-friendly AlertInfo.
    pub fn from_alert(alert: &Alert) -> Self {
        match alert {
            Alert::MemoryLeak {
                process_name,
                pid,
                start_memory,
                current_memory,
                ..
            } => AlertInfo {
                alert_type: AlertType::MemoryLeak,
                severity: AlertSeverity::Warning,
                message: format!(
                    "{} 内存持续增长：{:.0} MB → {:.0} MB",
                    process_name,
                    *start_memory as f64 / 1_048_576.0,
                    *current_memory as f64 / 1_048_576.0
                ),
                process_name: Some(process_name.clone()),
                pid: Some(*pid),
            },
            Alert::HighCpu {
                process_name,
                pid,
                average_cpu,
                duration_secs,
            } => AlertInfo {
                alert_type: AlertType::HighCpu,
                severity: AlertSeverity::Critical,
                message: format!(
                    "{} CPU 持续高占用：平均 {:.1}%，持续 {} 秒",
                    process_name, average_cpu, duration_secs
                ),
                process_name: Some(process_name.clone()),
                pid: Some(*pid),
            },
            Alert::MemoryPressure {
                used_percent,
                candidates,
            } => {
                let top_names: Vec<&str> = candidates
                    .iter()
                    .take(3)
                    .map(|c| c.name.as_str())
                    .collect();
                AlertInfo {
                    alert_type: AlertType::MemoryPressure,
                    severity: AlertSeverity::Critical,
                    message: format!(
                        "系统内存压力：已用 {:.1}%，建议关闭：{}",
                        used_percent,
                        top_names.join("、")
                    ),
                    process_name: None,
                    pid: None,
                }
            }
            Alert::BatteryWarning {
                battery_level,
                offending_processes,
            } => {
                let top_names: Vec<&str> = offending_processes
                    .iter()
                    .take(3)
                    .map(|p| p.name.as_str())
                    .collect();
                AlertInfo {
                    alert_type: AlertType::BatteryWarning,
                    severity: AlertSeverity::Warning,
                    message: format!(
                        "电量 {:.0}%，高耗电进程：{}",
                        battery_level,
                        top_names.join("、")
                    ),
                    process_name: None,
                    pid: None,
                }
            }
        }
    }
}
