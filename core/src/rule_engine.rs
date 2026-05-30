// Rule engine: memory leak, high CPU, battery warning, memory pressure

use std::collections::{HashMap, HashSet};

use crate::config::Config;
use crate::trend_store::TrendStore;
use crate::types::{
    Alert, BatteryOffender, BatteryStatus, ChargingState, FilteredSnapshot, PathStatus,
    SystemSample,
};

/// The rule engine evaluates collected data against predefined rules
/// to detect anomalies and generate alerts.
#[derive(Debug, Clone)]
pub struct RuleEngine {
    config: Config,
    trend_store: TrendStore,
    active_alerts: Vec<Alert>,
    /// Hysteresis flag for memory pressure: true if currently in pressure state.
    memory_pressure_active: bool,
    /// Mapping of PID to process name, updated each evaluation cycle.
    process_names: HashMap<u32, String>,
}

impl RuleEngine {
    /// Creates a new RuleEngine with the given configuration.
    pub fn new(config: Config) -> Self {
        Self {
            config,
            trend_store: TrendStore::new(),
            active_alerts: Vec::new(),
            memory_pressure_active: false,
            process_names: HashMap::new(),
        }
    }

    /// Evaluates the current snapshot and system state against all rules.
    pub fn evaluate(
        &mut self,
        snapshot: &FilteredSnapshot,
        system: &SystemSample,
    ) -> Vec<Alert> {
        // Step 1: Collect active PIDs
        let active_pids: HashSet<u32> = snapshot
            .processes
            .iter()
            .map(|p| p.sample.pid)
            .collect();

        // Step 2: Remove stale trend entries
        self.trend_store.remove_stale(&active_pids);
        self.process_names.retain(|pid, _| active_pids.contains(pid));

        // Step 3: Push new samples into the trend store
        for process in &snapshot.processes {
            self.trend_store.push_sample(
                process.sample.pid,
                process.sample.memory_bytes,
                process.sample.cpu_percent,
                &self.config,
            );
            self.process_names.insert(process.sample.pid, process.sample.name.clone());
        }

        // Step 4: Evaluate rules in order and collect alerts
        let mut alerts = Vec::new();

        // Rule 1: Memory Pressure (system-level)
        alerts.extend(self.check_memory_pressure(snapshot, system));

        // Rule 2: Battery Warning (system-level)
        alerts.extend(self.check_battery_warning(snapshot, system));

        // Rule 3: Memory Leak (per-process)
        alerts.extend(self.check_memory_leaks());

        // Rule 4: Sustained High CPU (per-process)
        alerts.extend(self.check_high_cpu());

        // Update active alerts
        self.active_alerts = alerts.clone();

        alerts
    }

    /// Checks for system memory pressure (used/total > 85%).
    /// Uses hysteresis: activates at 85%, clears at 80%.
    fn check_memory_pressure(
        &mut self,
        snapshot: &FilteredSnapshot,
        system: &SystemSample,
    ) -> Vec<Alert> {
        use crate::types::MemoryCandidate;

        if system.total_memory == 0 {
            return Vec::new();
        }

        let used_percent =
            (system.used_memory as f32 / system.total_memory as f32) * 100.0;

        // Hysteresis logic
        if !self.memory_pressure_active && used_percent > 85.0 {
            self.memory_pressure_active = true;
        } else if self.memory_pressure_active && used_percent < 80.0 {
            self.memory_pressure_active = false;
        }

        if self.memory_pressure_active {
            // Build candidate list: non-system processes (User or Unknown)
            // sorted by memory_bytes descending
            let mut candidates: Vec<MemoryCandidate> = snapshot
                .processes
                .iter()
                .filter(|p| {
                    matches!(p.path_status, PathStatus::User | PathStatus::Unknown)
                })
                .map(|p| MemoryCandidate {
                    name: p.sample.name.clone(),
                    pid: p.sample.pid,
                    memory_bytes: p.sample.memory_bytes,
                })
                .collect();

            candidates.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));

            vec![Alert::MemoryPressure {
                used_percent,
                candidates,
            }]
        } else {
            Vec::new()
        }
    }

    /// Checks for battery warning conditions:
    /// battery < 20%, discharging, and non-system processes using resources.
    fn check_battery_warning(
        &self,
        snapshot: &FilteredSnapshot,
        system: &SystemSample,
    ) -> Vec<Alert> {
        let (level, charging) = match &system.battery {
            BatteryStatus::Unavailable => return Vec::new(),
            BatteryStatus::Available { level, charging } => (*level, charging),
        };

        // Clear condition: battery >= 20% OR not discharging
        if level >= 20.0 || *charging != ChargingState::Discharging {
            return Vec::new();
        }

        // Find non-system processes (User or Unknown path status)
        // Activation requires at least one non-system process with CPU > 5%
        let has_activating_process = snapshot.processes.iter().any(|p| {
            p.path_status != PathStatus::System && p.sample.cpu_percent > 5.0
        });

        if !has_activating_process {
            return Vec::new();
        }

        // Build offender list - non-system processes with CPU > 5% OR memory > 200 MB
        let offending_processes: Vec<BatteryOffender> = snapshot
            .processes
            .iter()
            .filter(|p| {
                p.path_status != PathStatus::System
                    && (p.sample.cpu_percent > 5.0 || p.sample.memory_bytes > 200_000_000)
            })
            .map(|p| BatteryOffender {
                name: p.sample.name.clone(),
                pid: p.sample.pid,
                cpu_percent: p.sample.cpu_percent,
                memory_bytes: p.sample.memory_bytes,
            })
            .collect();

        vec![Alert::BatteryWarning {
            battery_level: level,
            offending_processes,
        }]
    }

    /// Checks for memory leaks by detecting monotonically increasing
    /// memory usage in trend buffers.
    fn check_memory_leaks(&self) -> Vec<Alert> {
        let mut alerts = Vec::new();
        let required_samples = self.config.mem_samples;

        for &pid in self.trend_store.memory_trend_pids() {
            let trend = match self.trend_store.get_memory_trend(pid) {
                Some(t) => t,
                None => continue,
            };

            if trend.len() < required_samples {
                continue;
            }

            let samples: Vec<u64> = trend.iter().rev().take(required_samples).copied().collect::<Vec<_>>();
            let samples: Vec<u64> = samples.into_iter().rev().collect();

            let is_monotonically_increasing = samples
                .windows(2)
                .all(|w| w[1] > w[0]);

            if is_monotonically_increasing {
                let process_name = self
                    .process_names
                    .get(&pid)
                    .cloned()
                    .unwrap_or_else(|| format!("unknown-{}", pid));

                alerts.push(Alert::MemoryLeak {
                    process_name,
                    pid,
                    start_memory: samples[0],
                    current_memory: samples[samples.len() - 1],
                    consecutive_samples: required_samples,
                });
            }
        }

        alerts
    }

    /// Checks for sustained high CPU usage by detecting all samples
    /// in the trend buffer exceeding the configured threshold.
    fn check_high_cpu(&self) -> Vec<Alert> {
        let mut alerts = Vec::new();
        let required_samples = self.config.cpu_samples;
        let threshold = self.config.cpu_threshold;

        for &pid in self.trend_store.cpu_trend_pids() {
            let trend = match self.trend_store.get_cpu_trend(pid) {
                Some(t) => t,
                None => continue,
            };

            if trend.len() < required_samples {
                continue;
            }

            let samples: Vec<f32> = trend.iter().rev().take(required_samples).copied().collect();

            let all_exceed = samples.iter().all(|&cpu| cpu > threshold);

            if all_exceed {
                let sum: f32 = samples.iter().sum();
                let average_cpu = sum / samples.len() as f32;
                let duration_secs = (self.config.cpu_samples as u64) * self.config.interval_secs;

                let process_name = self
                    .process_names
                    .get(&pid)
                    .cloned()
                    .unwrap_or_else(|| format!("PID:{}", pid));

                alerts.push(Alert::HighCpu {
                    process_name,
                    pid,
                    average_cpu,
                    duration_secs,
                });
            }
        }
        alerts
    }

    /// Returns a reference to the current active alerts.
    pub fn active_alerts(&self) -> &[Alert] {
        &self.active_alerts
    }

    /// Returns whether memory pressure is currently active (for hysteresis).
    pub fn memory_pressure_active(&self) -> bool {
        self.memory_pressure_active
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        BatteryStatus, ChargingState, FilteredProcess, FilteredSnapshot,
        PathStatus, ProcessSample, SystemSample,
    };

    fn default_config() -> Config {
        Config::default()
    }

    fn make_system_sample() -> SystemSample {
        SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![30.0, 40.0, 50.0, 60.0],
            battery: BatteryStatus::Unavailable,
        }
    }

    fn make_process(pid: u32, name: &str, cpu: f32, mem: u64) -> FilteredProcess {
        FilteredProcess {
            sample: ProcessSample {
                name: name.to_string(),
                pid,
                cpu_percent: cpu,
                memory_bytes: mem,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: Some(format!("C:\\Windows\\{}", name)),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::System,
        }
    }

    fn make_user_process(pid: u32, name: &str, cpu: f32, mem: u64) -> FilteredProcess {
        FilteredProcess {
            sample: ProcessSample {
                name: name.to_string(),
                pid,
                cpu_percent: cpu,
                memory_bytes: mem,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: Some(format!("D:\\Apps\\{}", name)),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::User,
        }
    }

    #[test]
    fn test_new_creates_engine_with_empty_state() {
        let engine = RuleEngine::new(default_config());
        assert!(engine.active_alerts().is_empty());
        assert!(!engine.memory_pressure_active());
    }

    #[test]
    fn test_evaluate_empty_snapshot_returns_no_alerts() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot { processes: vec![] };
        let system = make_system_sample();
        let alerts = engine.evaluate(&snapshot, &system);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_evaluate_pushes_samples_to_trend_store() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_process(1, "proc_a", 50.0, 1000),
                make_process(2, "proc_b", 30.0, 2000),
            ],
        };
        let system = make_system_sample();
        engine.evaluate(&snapshot, &system);
        engine.evaluate(&snapshot, &system);
    }

    #[test]
    fn test_evaluate_removes_stale_pids() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot1 = FilteredSnapshot {
            processes: vec![
                make_process(1, "proc_a", 50.0, 1000),
                make_process(2, "proc_b", 30.0, 2000),
            ],
        };
        let system = make_system_sample();
        engine.evaluate(&snapshot1, &system);

        let snapshot2 = FilteredSnapshot {
            processes: vec![make_process(1, "proc_a", 55.0, 1100)],
        };
        engine.evaluate(&snapshot2, &system);
    }

    #[test]
    fn test_battery_warning_triggers_when_conditions_met() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_user_process(1, "game.exe", 10.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 15.0,
                charging: ChargingState::Discharging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert_eq!(battery_alerts.len(), 1);

        if let Alert::BatteryWarning { battery_level, offending_processes } = &battery_alerts[0] {
            assert_eq!(*battery_level, 15.0);
            assert_eq!(offending_processes.len(), 1);
            assert_eq!(offending_processes[0].name, "game.exe");
        }
    }

    #[test]
    fn test_battery_warning_not_triggered_for_system_processes() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_process(1, "svchost.exe", 50.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 15.0,
                charging: ChargingState::Discharging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    #[test]
    fn test_memory_leak_detected_with_monotonically_increasing_samples() {
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        for mem in [1000u64, 2000, 3000] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "leaky_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert_eq!(leak_alerts.len(), 1);

        if let Alert::MemoryLeak { process_name, start_memory, current_memory, consecutive_samples, .. } = &leak_alerts[0] {
            assert_eq!(process_name, "leaky_app");
            assert_eq!(*start_memory, 1000);
            assert_eq!(*current_memory, 3000);
            assert_eq!(*consecutive_samples, 3);
        }
    }

    #[test]
    fn test_memory_leak_not_detected_when_not_monotonically_increasing() {
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        for mem in [1000u64, 2000, 1500] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "normal_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert!(leak_alerts.is_empty());
    }

    #[test]
    fn test_high_cpu_detected_when_all_samples_exceed_threshold() {
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            cpu_threshold: 80.0,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        for cpu in [85.0f32, 90.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "busy_app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert_eq!(cpu_alerts.len(), 1);
    }

    #[test]
    fn test_high_cpu_not_detected_when_one_sample_below_threshold() {
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            cpu_threshold: 80.0,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        for cpu in [85.0f32, 70.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter()
            .filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert!(cpu_alerts.is_empty());
    }

    #[test]
    fn test_memory_pressure_activates_above_85() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![make_user_process(1, "app.exe", 10.0, 500_000_000)],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 14_000_000_000, // 87.5%
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Unavailable,
        };

        let alerts = engine.evaluate(&snapshot, &system);
        assert!(alerts.iter().any(|a| matches!(a, Alert::MemoryPressure { .. })));
    }
}
