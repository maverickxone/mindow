// Rule engine: memory leak, high CPU, battery warning, memory pressure, suspicious path

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
    /// Used to prevent oscillation between 80-85% thresholds.
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
    ///
    /// Steps:
    /// 1. Collect active PIDs from the snapshot
    /// 2. Remove stale trend entries for terminated processes
    /// 3. Push new samples into the trend store for each process
    /// 4. Evaluate each rule in order
    /// 5. Collect and return all generated alerts
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
        // Also clean stale process names
        self.process_names.retain(|pid, _| active_pids.contains(pid));

        // Step 3: Push new samples into the trend store
        for process in &snapshot.processes {
            self.trend_store.push_sample(
                process.sample.pid,
                process.sample.memory_bytes,
                process.sample.cpu_percent,
                &self.config,
            );
            // Track process names for use in per-process rules
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

        // Rule 5: Suspicious Path (per-process)
        alerts.extend(self.check_suspicious_paths(snapshot));

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
        use crate::types::{MemoryCandidate, PathStatus};

        // Guard: avoid division by zero if total_memory is 0
        if system.total_memory == 0 {
            return Vec::new();
        }

        let used_percent =
            (system.used_memory as f32 / system.total_memory as f32) * 100.0;

        // Hysteresis logic
        if !self.memory_pressure_active && used_percent > 85.0 {
            // Activate
            self.memory_pressure_active = true;
        } else if self.memory_pressure_active && used_percent < 80.0 {
            // Deactivate (clear)
            self.memory_pressure_active = false;
        }
        // Otherwise: remain in current state (no oscillation between 80-85%)

        if self.memory_pressure_active {
            // Build candidate list: non-essential processes (Suspicious or Unknown)
            // sorted by memory_bytes descending
            let mut candidates: Vec<MemoryCandidate> = snapshot
                .processes
                .iter()
                .filter(|p| {
                    matches!(
                        p.path_status,
                        PathStatus::Suspicious | PathStatus::Unknown
                    )
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
    /// battery < 20%, discharging, and non-essential processes using resources.
    ///
    /// Activation: battery level < 20% AND Discharging AND at least one
    /// non-essential process with CPU > 5%.
    ///
    /// Offender list: all non-essential processes with CPU > 5% OR memory > 200 MB.
    ///
    /// Clear: battery >= 20% OR charging state != Discharging.
    fn check_battery_warning(
        &self,
        snapshot: &FilteredSnapshot,
        system: &SystemSample,
    ) -> Vec<Alert> {
        // Step 1: Check battery status - clear condition if unavailable, not discharging, or level >= 20
        let (level, charging) = match &system.battery {
            BatteryStatus::Unavailable => return Vec::new(),
            BatteryStatus::Available { level, charging } => (*level, charging),
        };

        // Clear condition: battery >= 20% OR not discharging
        if level >= 20.0 || *charging != ChargingState::Discharging {
            return Vec::new();
        }

        // Step 2: Battery level < 20% AND Discharging
        // Find non-essential processes (Suspicious or Unknown path status)
        // Activation requires at least one non-essential process with CPU > 5%
        let has_activating_process = snapshot.processes.iter().any(|p| {
            p.path_status != PathStatus::Standard && p.sample.cpu_percent > 5.0
        });

        if !has_activating_process {
            return Vec::new();
        }

        // Step 3: Build offender list - non-essential processes with CPU > 5% OR memory > 200 MB
        let offending_processes: Vec<BatteryOffender> = snapshot
            .processes
            .iter()
            .filter(|p| {
                p.path_status != PathStatus::Standard
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
    ///
    /// For each process in the trend store:
    /// 1. Get the memory trend buffer
    /// 2. Check if it has at least config.mem_samples entries (full buffer)
    /// 3. Check if all consecutive values are strictly monotonically increasing
    /// 4. If so, generate Alert::MemoryLeak with process_name, pid, start_memory,
    ///    current_memory, and consecutive_samples
    fn check_memory_leaks(&self) -> Vec<Alert> {
        let mut alerts = Vec::new();
        let required_samples = self.config.mem_samples;

        for &pid in self.trend_store.memory_trend_pids() {
            let trend = match self.trend_store.get_memory_trend(pid) {
                Some(t) => t,
                None => continue,
            };

            // Only trigger when buffer has at least mem_samples entries
            if trend.len() < required_samples {
                continue;
            }

            // Check the last `required_samples` entries for strictly monotonically increasing
            let samples: Vec<u64> = trend.iter().rev().take(required_samples).copied().collect::<Vec<_>>();
            // samples is in reverse order, so reverse it back
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
    ///
    /// For each PID in the trend store:
    /// 1. Get the CPU trend buffer
    /// 2. Check if it has at least config.cpu_samples entries (full buffer)
    /// 3. Check if ALL samples strictly exceed config.cpu_threshold
    /// 4. If so, generate Alert::HighCpu with process_name, pid,
    ///    average_cpu (arithmetic mean), and duration_secs
    fn check_high_cpu(&self) -> Vec<Alert> {
        let mut alerts = Vec::new();
        let required_samples = self.config.cpu_samples;
        let threshold = self.config.cpu_threshold;

        for &pid in self.trend_store.cpu_trend_pids() {
            let trend = match self.trend_store.get_cpu_trend(pid) {
                Some(t) => t,
                None => continue,
            };

            // Only trigger when buffer has at least cpu_samples entries
            if trend.len() < required_samples {
                continue;
            }

            // Check the last `required_samples` entries — all must strictly exceed threshold
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

    /// Checks for processes running from suspicious (non-standard) paths.
    /// Generates Alert::SuspiciousPath only for processes with PathStatus::Suspicious.
    /// Processes with PathStatus::Unknown are NOT flagged — this typically means we lack
    /// permissions to read the exe path (common for system services like svchost, MsMpEng).
    fn check_suspicious_paths(&self, snapshot: &FilteredSnapshot) -> Vec<Alert> {
        let mut alerts = Vec::new();
        for process in &snapshot.processes {
            if process.path_status == PathStatus::Suspicious {
                alerts.push(Alert::SuspiciousPath {
                    process_name: process.sample.name.clone(),
                    pid: process.sample.pid,
                    path_status: process.path_status.clone(),
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
                exe_path: Some(format!("C:\\Program Files\\{}", name)),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::Standard,
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
        let snapshot = FilteredSnapshot {
            processes: vec![],
        };
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

        // Verify trend store has entries for both PIDs
        // We can't access trend_store directly, but we can verify
        // by calling evaluate again with the same snapshot and checking
        // the trend store grows
        engine.evaluate(&snapshot, &system);

        // After two evaluations, we know samples were pushed
        // (stubs return empty alerts, but the trend store is updated)
    }

    #[test]
    fn test_evaluate_removes_stale_pids() {
        let mut engine = RuleEngine::new(default_config());

        // First evaluation with pid 1 and 2
        let snapshot1 = FilteredSnapshot {
            processes: vec![
                make_process(1, "proc_a", 50.0, 1000),
                make_process(2, "proc_b", 30.0, 2000),
            ],
        };
        let system = make_system_sample();
        engine.evaluate(&snapshot1, &system);

        // Second evaluation with only pid 1 (pid 2 terminated)
        let snapshot2 = FilteredSnapshot {
            processes: vec![make_process(1, "proc_a", 55.0, 1100)],
        };
        engine.evaluate(&snapshot2, &system);

        // pid 2 should have been cleaned from trend store
        // (stubs still return empty, but stale cleanup ran)
    }

    #[test]
    fn test_evaluate_returns_alerts_and_updates_active() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![make_process(1, "proc_a", 50.0, 1000)],
        };
        let system = make_system_sample();

        let alerts = engine.evaluate(&snapshot, &system);

        // With stubs, alerts should be empty
        assert!(alerts.is_empty());
        assert_eq!(engine.active_alerts(), alerts.as_slice());
    }

    #[test]
    fn test_evaluate_with_battery_available() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![make_process(1, "proc_a", 50.0, 1000)],
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

        // make_process creates Standard path processes, so no battery warning fires
        let alerts = engine.evaluate(&snapshot, &system);
        // Only SuspiciousPath alerts should not appear for Standard paths
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    // --- Battery Warning tests ---

    fn make_non_essential_process(pid: u32, name: &str, cpu: f32, mem: u64) -> FilteredProcess {
        FilteredProcess {
            sample: ProcessSample {
                name: name.to_string(),
                pid,
                cpu_percent: cpu,
                memory_bytes: mem,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: Some(format!("D:\\Games\\{}", name)),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::Suspicious,
        }
    }

    #[test]
    fn test_battery_warning_triggers_when_conditions_met() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "game.exe", 10.0, 100_000_000),
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
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert_eq!(battery_alerts.len(), 1);

        if let Alert::BatteryWarning { battery_level, offending_processes } = &battery_alerts[0] {
            assert_eq!(*battery_level, 15.0);
            assert_eq!(offending_processes.len(), 1);
            assert_eq!(offending_processes[0].name, "game.exe");
            assert_eq!(offending_processes[0].pid, 1);
            assert_eq!(offending_processes[0].cpu_percent, 10.0);
        } else {
            panic!("Expected BatteryWarning alert");
        }
    }

    #[test]
    fn test_battery_warning_not_triggered_when_battery_unavailable() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "game.exe", 10.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Unavailable,
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    #[test]
    fn test_battery_warning_not_triggered_when_charging() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "game.exe", 10.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 15.0,
                charging: ChargingState::Charging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    #[test]
    fn test_battery_warning_not_triggered_when_level_above_20() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "game.exe", 10.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 25.0,
                charging: ChargingState::Discharging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    #[test]
    fn test_battery_warning_not_triggered_when_no_non_essential_high_cpu() {
        let mut engine = RuleEngine::new(default_config());
        // Non-essential process with CPU <= 5%
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "idle_app.exe", 3.0, 100_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 10.0,
                charging: ChargingState::Discharging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    #[test]
    fn test_battery_warning_offender_list_includes_high_memory() {
        let mut engine = RuleEngine::new(default_config());
        // Process A: CPU > 5% (activator + offender)
        // Process B: CPU <= 5% but memory > 200 MB (offender only)
        // Process C: Standard path (not included)
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "activator.exe", 10.0, 50_000_000),
                make_non_essential_process(2, "memory_hog.exe", 2.0, 300_000_000),
                make_process(3, "system_svc.exe", 90.0, 500_000_000),
            ],
        };
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 10.0,
                charging: ChargingState::Discharging,
            },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert_eq!(battery_alerts.len(), 1);

        if let Alert::BatteryWarning { offending_processes, .. } = &battery_alerts[0] {
            assert_eq!(offending_processes.len(), 2);
            let names: Vec<&str> = offending_processes.iter().map(|p| p.name.as_str()).collect();
            assert!(names.contains(&"activator.exe"));
            assert!(names.contains(&"memory_hog.exe"));
        } else {
            panic!("Expected BatteryWarning alert");
        }
    }

    #[test]
    fn test_battery_warning_clears_when_level_rises() {
        let mut engine = RuleEngine::new(default_config());
        let snapshot = FilteredSnapshot {
            processes: vec![
                make_non_essential_process(1, "game.exe", 10.0, 100_000_000),
            ],
        };

        // First: trigger the alert
        let system_low = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 15.0,
                charging: ChargingState::Discharging,
            },
        };
        let alerts = engine.evaluate(&snapshot, &system_low);
        assert!(alerts.iter().any(|a| matches!(a, Alert::BatteryWarning { .. })));

        // Second: battery level rises above 20% - alert clears
        let system_high = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level: 25.0,
                charging: ChargingState::Discharging,
            },
        };
        let alerts = engine.evaluate(&snapshot, &system_high);
        let battery_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::BatteryWarning { .. })).collect();
        assert!(battery_alerts.is_empty());
    }

    // --- Memory Leak Detection tests ---

    #[test]
    fn test_memory_leak_detected_with_monotonically_increasing_samples() {
        // Configure mem_samples = 3 for easier testing
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed 3 snapshots with strictly increasing memory
        for mem in [1000u64, 2000, 3000] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "leaky_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        // After 3 samples (= mem_samples), a memory leak should be detected
        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert_eq!(leak_alerts.len(), 1);

        if let Alert::MemoryLeak { process_name, pid, start_memory, current_memory, consecutive_samples } = &leak_alerts[0] {
            assert_eq!(process_name, "leaky_app");
            assert_eq!(*pid, 1);
            assert_eq!(*start_memory, 1000);
            assert_eq!(*current_memory, 3000);
            assert_eq!(*consecutive_samples, 3);
        } else {
            panic!("Expected MemoryLeak alert");
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

        // Feed 3 snapshots where memory decreases at some point
        for mem in [1000u64, 2000, 1500] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "normal_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert!(leak_alerts.is_empty());
    }

    #[test]
    fn test_memory_leak_not_detected_with_insufficient_samples() {
        let config = Config {
            mem_samples: 5,
            cpu_samples: 5,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed only 3 increasing samples when we need 5
        for mem in [1000u64, 2000, 3000] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "leaky_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert!(leak_alerts.is_empty());
    }

    #[test]
    fn test_memory_leak_not_detected_with_equal_values() {
        // Equal values are NOT strictly increasing
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        for mem in [1000u64, 1000, 1000] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "stable_app", 10.0, mem)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert!(leak_alerts.is_empty());
    }

    #[test]
    fn test_memory_leak_multiple_processes() {
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Process 1: leaking (strictly increasing)
        // Process 2: not leaking (stable)
        for (mem1, mem2) in [(1000u64, 5000u64), (2000, 5000), (3000, 5000)] {
            let snapshot = FilteredSnapshot {
                processes: vec![
                    make_process(1, "leaky", 10.0, mem1),
                    make_process(2, "stable", 10.0, mem2),
                ],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::MemoryLeak { .. })).collect();
        assert_eq!(leak_alerts.len(), 1);

        if let Alert::MemoryLeak { process_name, pid, .. } = &leak_alerts[0] {
            assert_eq!(process_name, "leaky");
            assert_eq!(*pid, 1);
        }
    }

    // --- Sustained High CPU Detection tests ---

    #[test]
    fn test_high_cpu_detected_when_all_samples_exceed_threshold() {
        // Configure cpu_samples = 3, cpu_threshold = 80.0 for easier testing
        let config = Config {
            cpu_samples: 3,
            mem_samples: 3,
            cpu_threshold: 80.0,
            interval_secs: 10,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed 3 snapshots all with CPU > 80.0
        for cpu in [85.0f32, 90.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "heavy_app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert_eq!(cpu_alerts.len(), 1);

        if let Alert::HighCpu { process_name, pid, average_cpu, duration_secs } = &cpu_alerts[0] {
            assert_eq!(process_name, "heavy_app");
            assert_eq!(*pid, 1);
            // Average of 85.0, 90.0, 95.0 = 90.0
            assert!((average_cpu - 90.0).abs() < 0.01);
            // duration = cpu_samples * interval_secs = 3 * 10 = 30
            assert_eq!(*duration_secs, 30);
        } else {
            panic!("Expected HighCpu alert");
        }
    }

    #[test]
    fn test_high_cpu_not_detected_when_one_sample_at_threshold() {
        // "Exceeding" means STRICTLY greater than threshold (>), not >=
        let config = Config {
            cpu_samples: 3,
            mem_samples: 3,
            cpu_threshold: 80.0,
            interval_secs: 10,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed 3 snapshots: one is exactly at threshold (80.0), not above it
        for cpu in [85.0f32, 80.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert!(cpu_alerts.is_empty());
    }

    #[test]
    fn test_high_cpu_not_detected_with_insufficient_samples() {
        let config = Config {
            cpu_samples: 5,
            mem_samples: 5,
            cpu_threshold: 80.0,
            interval_secs: 10,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed only 3 high-CPU samples when we need 5
        for cpu in [85.0f32, 90.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert!(cpu_alerts.is_empty());
    }

    #[test]
    fn test_high_cpu_not_detected_when_one_sample_below_threshold() {
        let config = Config {
            cpu_samples: 3,
            mem_samples: 3,
            cpu_threshold: 80.0,
            interval_secs: 10,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // One sample is below threshold
        for cpu in [85.0f32, 70.0, 95.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "app", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert!(cpu_alerts.is_empty());
    }

    #[test]
    fn test_high_cpu_multiple_processes() {
        let config = Config {
            cpu_samples: 3,
            mem_samples: 3,
            cpu_threshold: 80.0,
            interval_secs: 10,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Process 1: sustained high CPU
        // Process 2: not sustained (one sample below)
        for (cpu1, cpu2) in [(85.0f32, 90.0f32), (90.0, 50.0), (95.0, 85.0)] {
            let snapshot = FilteredSnapshot {
                processes: vec![
                    make_process(1, "runaway", cpu1, 1000),
                    make_process(2, "normal", cpu2, 1000),
                ],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert_eq!(cpu_alerts.len(), 1);

        if let Alert::HighCpu { process_name, pid, .. } = &cpu_alerts[0] {
            assert_eq!(process_name, "runaway");
            assert_eq!(*pid, 1);
        } else {
            panic!("Expected HighCpu alert");
        }
    }

    #[test]
    fn test_high_cpu_duration_calculation() {
        let config = Config {
            cpu_samples: 4,
            mem_samples: 4,
            cpu_threshold: 50.0,
            interval_secs: 5,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = make_system_sample();

        // Feed 4 samples all above threshold
        for cpu in [60.0f32, 70.0, 80.0, 90.0] {
            let snapshot = FilteredSnapshot {
                processes: vec![make_process(1, "cpu_hog", cpu, 1000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let cpu_alerts: Vec<_> = alerts.iter().filter(|a| matches!(a, Alert::HighCpu { .. })).collect();
        assert_eq!(cpu_alerts.len(), 1);

        if let Alert::HighCpu { duration_secs, average_cpu, .. } = &cpu_alerts[0] {
            // duration = cpu_samples * interval_secs = 4 * 5 = 20
            assert_eq!(*duration_secs, 20);
            // Average of 60, 70, 80, 90 = 75.0
            assert!((average_cpu - 75.0).abs() < 0.01);
        } else {
            panic!("Expected HighCpu alert");
        }
    }
}
