// Feature: mindow-v05, Property 7: Battery Warning Activation and Clearing
//
// For any system state, a battery-warning alert SHALL be active if and only if:
// battery level < 20% AND charging status == Discharging AND at least one
// non-essential process has CPU > 5%. The alert SHALL be cleared whenever
// battery level >= 20% OR charging status != Discharging.
//
// **Validates: Requirements 7.1, 7.3**

// Feature: mindow-v05, Property 8: Battery Warning Offender List Completeness
//
// For any system state that triggers a battery-warning alert, the alert's
// offending process list SHALL contain exactly those non-essential processes
// with CPU > 5% OR memory > 200 MB �?no more, no fewer.
//
// **Validates: Requirements 7.2**

use proptest::prelude::*;
use std::collections::HashSet;

use mindow_core::config::Config;
use mindow_core::rule_engine::RuleEngine;
use mindow_core::types::{
    Alert, BatteryStatus, ChargingState, FilteredProcess, FilteredSnapshot,
    PathStatus, ProcessSample, SystemSample,
};

/// Strategy to generate an arbitrary ChargingState.
fn arb_charging_state() -> impl Strategy<Value = ChargingState> {
    prop_oneof![
        Just(ChargingState::Charging),
        Just(ChargingState::Discharging),
        Just(ChargingState::Full),
        Just(ChargingState::Unknown),
    ]
}

/// Strategy to generate an arbitrary PathStatus.
fn arb_path_status() -> impl Strategy<Value = PathStatus> {
    prop_oneof![
        Just(PathStatus::System),
        Just(PathStatus::User),
        Just(PathStatus::Unknown),
    ]
}

/// Strategy to generate a FilteredProcess with given PID and arbitrary stats.
fn arb_filtered_process(pid: u32) -> impl Strategy<Value = FilteredProcess> {
    (
        "[a-z]{1,8}",           // name
        0.0f32..100.0,          // cpu_percent
        0u64..500_000_000,      // memory_bytes (up to 500MB to cover the 200MB threshold)
        arb_path_status(),
    )
        .prop_map(move |(name, cpu_percent, memory_bytes, path_status)| {
            FilteredProcess {
                sample: ProcessSample {
                    name,
                    pid,
                    cpu_percent,
                    memory_bytes,
                    disk_read_bytes: 0,
                    disk_write_bytes: 0,
                    exe_path: match &path_status {
                        PathStatus::System => Some("C:\\Program Files\\app.exe".to_string()),
                        PathStatus::User => Some("D:\\Games\\app.exe".to_string()),
                        PathStatus::Unknown => None,
                    },
                    start_time: 1000,
                    parent_pid: None,
                },
                path_status,
            }
        })
}

/// Strategy to generate a list of FilteredProcesses with unique PIDs (0..20).
fn arb_process_list() -> impl Strategy<Value = Vec<FilteredProcess>> {
    (1usize..=20).prop_flat_map(|len| {
        let strategies: Vec<_> = (0..len)
            .map(|i| arb_filtered_process(i as u32 + 1))
            .collect();
        strategies
    })
}

/// Strategy to generate a SystemSample with arbitrary battery level and charging state.
fn arb_system_sample() -> impl Strategy<Value = SystemSample> {
    (
        0.0f32..100.0,          // battery level
        arb_charging_state(),
    )
        .prop_map(|(level, charging)| {
            SystemSample {
                total_memory: 16_000_000_000,
                used_memory: 8_000_000_000, // 50% - won't trigger memory pressure
                per_core_cpu: vec![50.0],
                battery: BatteryStatus::Available { level, charging },
            }
        })
}

/// Helper: determine if a process is non-essential (User or Unknown path).
fn is_non_essential(p: &FilteredProcess) -> bool {
    matches!(p.path_status, PathStatus::User | PathStatus::Unknown)
}

/// Helper: extract battery warning alerts from a list of alerts.
fn battery_warnings(alerts: &[Alert]) -> Vec<&Alert> {
    alerts
        .iter()
        .filter(|a| matches!(a, Alert::BatteryWarning { .. }))
        .collect()
}

proptest! {
    /// Property 7: Battery Warning Activation and Clearing
    ///
    /// For any system state, a battery-warning alert SHALL be active if and only if:
    /// battery level < 20% AND charging status == Discharging AND at least one
    /// non-essential process has CPU > 5%.
    ///
    /// **Validates: Requirements 7.1, 7.3**
    #[test]
    fn prop_battery_warning_activation_and_clearing(
        processes in arb_process_list(),
        system in arb_system_sample(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);

        let snapshot = FilteredSnapshot {
            processes: processes.clone(),
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let bw_alerts = battery_warnings(&alerts);

        // Determine expected activation condition
        let should_activate = match &system.battery {
            BatteryStatus::Available { level, charging } => {
                *level < 20.0
                    && *charging == ChargingState::Discharging
                    && processes.iter().any(|p| {
                        is_non_essential(p) && p.sample.cpu_percent > 5.0
                    })
            }
            BatteryStatus::Unavailable => false,
        };

        if should_activate {
            prop_assert!(
                bw_alerts.len() == 1,
                "Expected exactly 1 BatteryWarning alert when conditions met, got {}. \
                 Battery: {:?}, Processes: {:?}",
                bw_alerts.len(),
                system.battery,
                processes.iter().map(|p| (p.sample.pid, p.sample.cpu_percent, &p.path_status)).collect::<Vec<_>>()
            );
        } else {
            prop_assert!(
                bw_alerts.is_empty(),
                "Expected no BatteryWarning alert when conditions NOT met, got {}. \
                 Battery: {:?}, Processes: {:?}",
                bw_alerts.len(),
                system.battery,
                processes.iter().map(|p| (p.sample.pid, p.sample.cpu_percent, &p.path_status)).collect::<Vec<_>>()
            );
        }
    }

    /// Property 7 (clearing sub-property): When battery level >= 20% OR charging
    /// state != Discharging, no battery warning alert should be present.
    #[test]
    fn prop_battery_warning_clearing_conditions(
        processes in arb_process_list(),
        level in 20.0f32..100.0,
        charging in arb_charging_state(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);

        let snapshot = FilteredSnapshot {
            processes: processes.clone(),
        };

        // Case 1: battery level >= 20% (any charging state)
        let system = SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available { level, charging: charging.clone() },
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let bw_alerts = battery_warnings(&alerts);

        prop_assert!(
            bw_alerts.is_empty(),
            "Battery warning should be cleared when level >= 20% (level={}), got {} alerts",
            level,
            bw_alerts.len()
        );

        // Case 2: charging state != Discharging (any level that is < 20)
        if charging != ChargingState::Discharging {
            let system2 = SystemSample {
                total_memory: 16_000_000_000,
                used_memory: 8_000_000_000,
                per_core_cpu: vec![50.0],
                battery: BatteryStatus::Available { level: 10.0, charging: charging.clone() },
            };

            let mut engine2 = RuleEngine::new(Config::default());
            let alerts2 = engine2.evaluate(&snapshot, &system2);
            let bw_alerts2 = battery_warnings(&alerts2);

            prop_assert!(
                bw_alerts2.is_empty(),
                "Battery warning should be cleared when charging != Discharging (state={:?}), got {} alerts",
                charging,
                bw_alerts2.len()
            );
        }
    }
}

// --- Property 8: Battery Warning Offender List Completeness ---

/// Strategy to generate a system state that guarantees battery warning trigger:
/// battery level < 20%, Discharging.
fn arb_triggering_system() -> impl Strategy<Value = SystemSample> {
    (0.0f32..19.99).prop_map(|level| {
        SystemSample {
            total_memory: 16_000_000_000,
            used_memory: 8_000_000_000, // 50% - no memory pressure
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Available {
                level,
                charging: ChargingState::Discharging,
            },
        }
    })
}

/// Strategy to generate a process list that guarantees at least one non-essential
/// process with CPU > 5% (the activation condition), plus additional arbitrary processes.
fn arb_process_list_with_activator() -> impl Strategy<Value = Vec<FilteredProcess>> {
    // Generate an activator process: non-essential, CPU > 5%
    let activator = (
        "[a-z]{1,8}",
        5.1f32..100.0, // CPU > 5%
        0u64..500_000_000,
        prop_oneof![Just(PathStatus::User), Just(PathStatus::Unknown)],
    )
        .prop_map(|(name, cpu, mem, path_status)| {
            FilteredProcess {
                sample: ProcessSample {
                    name,
                    pid: 1,
                    cpu_percent: cpu,
                    memory_bytes: mem,
                    disk_read_bytes: 0,
                    disk_write_bytes: 0,
                    exe_path: match &path_status {
                        PathStatus::System => Some("C:\\Program Files\\app.exe".to_string()),
                        PathStatus::User => Some("D:\\Games\\app.exe".to_string()),
                        PathStatus::Unknown => None,
                    },
                    start_time: 1000,
                    parent_pid: None,
                },
                path_status,
            }
        });

    // Generate additional processes (0..15 more)
    let extras = (0usize..15).prop_flat_map(|len| {
        let strategies: Vec<_> = (0..len)
            .map(|i| arb_filtered_process(i as u32 + 2)) // PIDs start at 2
            .collect();
        strategies
    });

    (activator, extras).prop_map(|(act, mut rest)| {
        rest.insert(0, act);
        rest
    })
}

proptest! {
    /// Property 8: Battery Warning Offender List Completeness
    ///
    /// For any system state that triggers a battery-warning alert, the alert's
    /// offending process list SHALL contain exactly those non-essential processes
    /// with CPU > 5% OR memory > 200_000_000 bytes �?no more, no fewer.
    ///
    /// **Validates: Requirements 7.2**
    #[test]
    fn prop_battery_warning_offender_list_completeness(
        processes in arb_process_list_with_activator(),
        system in arb_triggering_system(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);

        let snapshot = FilteredSnapshot {
            processes: processes.clone(),
        };

        let alerts = engine.evaluate(&snapshot, &system);
        let bw_alerts = battery_warnings(&alerts);

        // This state is crafted to trigger �?verify it did
        prop_assert!(
            bw_alerts.len() == 1,
            "Expected BatteryWarning to trigger with activator process, got {} alerts",
            bw_alerts.len()
        );

        if let Alert::BatteryWarning { offending_processes, .. } = bw_alerts[0] {
            // Compute expected offender set: non-essential processes with CPU > 5% OR memory > 200MB
            let expected_offender_pids: HashSet<u32> = processes
                .iter()
                .filter(|p| {
                    is_non_essential(p)
                        && (p.sample.cpu_percent > 5.0 || p.sample.memory_bytes > 200_000_000)
                })
                .map(|p| p.sample.pid)
                .collect();

            let actual_offender_pids: HashSet<u32> = offending_processes
                .iter()
                .map(|o| o.pid)
                .collect();

            // Exact match: no more, no fewer
            prop_assert_eq!(
                &actual_offender_pids,
                &expected_offender_pids,
                "Offender list mismatch.\nActual PIDs: {:?}\nExpected PIDs: {:?}\nProcesses: {:?}",
                actual_offender_pids.clone(),
                expected_offender_pids.clone(),
                processes.iter().map(|p| (p.sample.pid, p.sample.cpu_percent, p.sample.memory_bytes, &p.path_status)).collect::<Vec<_>>()
            );

            // Also verify each offender's fields are correct
            for offender in offending_processes {
                let source = processes
                    .iter()
                    .find(|p| p.sample.pid == offender.pid)
                    .expect("Offender PID should exist in process list");

                prop_assert_eq!(
                    &offender.name, &source.sample.name,
                    "Offender name mismatch for PID {}", offender.pid
                );
                prop_assert_eq!(
                    offender.cpu_percent, source.sample.cpu_percent,
                    "Offender cpu_percent mismatch for PID {}", offender.pid
                );
                prop_assert_eq!(
                    offender.memory_bytes, source.sample.memory_bytes,
                    "Offender memory_bytes mismatch for PID {}", offender.pid
                );
            }
        } else {
            prop_assert!(false, "Alert should be BatteryWarning variant");
        }
    }
}
