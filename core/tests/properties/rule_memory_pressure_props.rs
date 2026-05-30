// Feature: mindow-v05, Property 9: Memory Pressure Hysteresis
//
// For any sequence of system memory states, the memory-pressure alert SHALL activate
// when used_memory/total_memory exceeds 85%, and SHALL remain active until
// used_memory/total_memory drops below 80%. The alert SHALL NOT oscillate when
// usage is between 80% and 85%.
//
// **Validates: Requirements 8.1, 8.3**

// Feature: mindow-v05, Property 10: Memory Pressure Candidate Ordering
//
// For any memory-pressure alert, the candidate process list SHALL be sorted in
// strictly descending order by memory usage, and SHALL contain all non-essential
// processes.
//
// **Validates: Requirements 8.2**

use proptest::prelude::*;

use mindow_core::config::Config;
use mindow_core::rule_engine::RuleEngine;
use mindow_core::types::{
    Alert, BatteryStatus, FilteredProcess, FilteredSnapshot, PathStatus, ProcessSample,
    SystemSample,
};

/// Strategy to generate a memory usage ratio between 0.0 and 1.0.
fn arb_memory_ratio() -> impl Strategy<Value = f32> {
    0.0f32..1.0
}

/// Strategy to generate a sequence of memory usage ratios (length 2..30).
fn arb_memory_ratio_sequence() -> impl Strategy<Value = Vec<f32>> {
    prop::collection::vec(arb_memory_ratio(), 2..30)
}

/// Helper: create a SystemSample with the given memory usage ratio.
/// Uses a fixed total_memory of 16 GB to avoid edge cases.
fn make_system_with_ratio(ratio: f32) -> SystemSample {
    let total_memory: u64 = 16_000_000_000;
    let used_memory = (total_memory as f64 * ratio as f64) as u64;
    SystemSample {
        total_memory,
        used_memory,
        per_core_cpu: vec![50.0],
        battery: BatteryStatus::Unavailable,
    }
}

/// Helper: create a minimal FilteredSnapshot with one non-essential process.
/// This ensures there are candidates for the alert when it activates.
fn make_snapshot_with_non_essential() -> FilteredSnapshot {
    FilteredSnapshot {
        processes: vec![FilteredProcess {
            sample: ProcessSample {
                name: "user_app.exe".to_string(),
                pid: 1,
                cpu_percent: 10.0,
                memory_bytes: 500_000_000,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: Some("D:\\Apps\\user_app.exe".to_string()),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::User,
        }],
    }
}

proptest! {
    /// Property 9: Memory Pressure Hysteresis
    ///
    /// For any sequence of memory usage ratios, the memory pressure alert state
    /// should follow hysteresis rules:
    /// - Activate when ratio > 0.85
    /// - Remain active until ratio < 0.80
    /// - Not oscillate when ratio is between 0.80 and 0.85
    #[test]
    fn prop_memory_pressure_hysteresis(
        ratios in arb_memory_ratio_sequence(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);
        let snapshot = make_snapshot_with_non_essential();

        // Track expected pressure state using the same hysteresis logic
        let mut expected_active = false;

        for ratio in &ratios {
            let system = make_system_with_ratio(*ratio);
            let alerts = engine.evaluate(&snapshot, &system);

            // Apply hysteresis logic to expected state
            let used_percent = (*ratio) * 100.0;
            if !expected_active && used_percent > 85.0 {
                expected_active = true;
            } else if expected_active && used_percent < 80.0 {
                expected_active = false;
            }
            // Between 80% and 85%: no change to expected_active

            // Check if memory pressure alert is present in the result
            let has_pressure_alert = alerts
                .iter()
                .any(|a| matches!(a, Alert::MemoryPressure { .. }));

            prop_assert_eq!(
                has_pressure_alert,
                expected_active,
                "Memory pressure mismatch at ratio={:.4} (used_percent={:.2}%): \
                 alert_present={}, expected_active={}",
                ratio,
                used_percent,
                has_pressure_alert,
                expected_active
            );
        }
    }

    /// Property 9 (supplementary): Alert should not oscillate in the dead zone.
    ///
    /// If memory usage stays between 80% and 85% after initial activation,
    /// the alert state should remain unchanged (no flip-flopping).
    #[test]
    fn prop_memory_pressure_no_oscillation_in_dead_zone(
        // First ratio > 85% to activate, then stay in 80-85% zone
        initial_ratio in 0.86f32..0.99,
        dead_zone_ratios in prop::collection::vec(0.80f32..0.85, 2..20),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);
        let snapshot = make_snapshot_with_non_essential();

        // Activate with initial high ratio
        let system = make_system_with_ratio(initial_ratio);
        let alerts = engine.evaluate(&snapshot, &system);
        prop_assert!(
            alerts.iter().any(|a| matches!(a, Alert::MemoryPressure { .. })),
            "Expected memory pressure to activate at ratio={}",
            initial_ratio
        );

        // Feed dead zone ratios �?alert should remain active throughout
        for ratio in &dead_zone_ratios {
            let system = make_system_with_ratio(*ratio);
            let alerts = engine.evaluate(&snapshot, &system);
            let has_pressure = alerts
                .iter()
                .any(|a| matches!(a, Alert::MemoryPressure { .. }));

            prop_assert!(
                has_pressure,
                "Memory pressure should remain active in dead zone at ratio={:.4} ({}%)",
                ratio,
                ratio * 100.0
            );
        }
    }

    /// Property 9 (supplementary): Alert should clear when below 80%.
    ///
    /// If initially active (>85%) and then drops below 80%, the alert should clear.
    #[test]
    fn prop_memory_pressure_clears_below_80(
        activate_ratio in 0.86f32..0.99,
        clear_ratio in 0.0f32..0.7999,
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);
        let snapshot = make_snapshot_with_non_essential();

        // Activate
        let system = make_system_with_ratio(activate_ratio);
        engine.evaluate(&snapshot, &system);

        // Clear
        let system = make_system_with_ratio(clear_ratio);
        let alerts = engine.evaluate(&snapshot, &system);

        let has_pressure = alerts
            .iter()
            .any(|a| matches!(a, Alert::MemoryPressure { .. }));

        prop_assert!(
            !has_pressure,
            "Memory pressure should clear at ratio={:.4} ({}%) after activation",
            clear_ratio,
            clear_ratio * 100.0
        );
    }
}

// --- Property 10: Memory Pressure Candidate Ordering ---

/// Strategy to generate a FilteredProcess with given path status.
fn arb_filtered_process(pid: u32, path_status: PathStatus) -> impl Strategy<Value = FilteredProcess> {
    (
        "[a-z]{1,8}\\.exe", // name
        0u64..10_000_000_000, // memory_bytes
        0.0f32..100.0, // cpu_percent
    )
        .prop_map(move |(name, memory_bytes, cpu_percent)| FilteredProcess {
            sample: ProcessSample {
                name,
                pid,
                cpu_percent,
                memory_bytes,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: if path_status == PathStatus::Unknown {
                    None
                } else {
                    Some(format!("D:\\Apps\\app_{}.exe", pid))
                },
                start_time: 1000,
                parent_pid: None,
            },
            path_status: path_status.clone(),
        })
}

/// Strategy to generate a mix of System, User, and Unknown processes.
fn arb_mixed_processes() -> impl Strategy<Value = Vec<FilteredProcess>> {
    (1usize..20).prop_flat_map(|len| {
        let strategies: Vec<_> = (0..len)
            .map(|i| {
                let pid = i as u32 + 1;
                // Alternate: even PIDs are System, odd PIDs alternate between User and Unknown
                let status = if i % 3 == 0 {
                    PathStatus::System
                } else if i % 3 == 1 {
                    PathStatus::User
                } else {
                    PathStatus::Unknown
                };
                arb_filtered_process(pid, status)
            })
            .collect();
        strategies
    })
}

proptest! {
    /// Property 10: Memory Pressure Candidate Ordering
    ///
    /// When memory pressure is active (> 85%), the candidate process list in the
    /// alert SHALL:
    /// 1. Be sorted in strictly descending order by memory_bytes
    /// 2. Contain exactly all non-essential processes (User or Unknown path)
    #[test]
    fn prop_memory_pressure_candidate_ordering(
        processes in arb_mixed_processes(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);

        let snapshot = FilteredSnapshot {
            processes: processes.clone(),
        };

        // Use ratio > 85% to ensure memory pressure activates
        let system = make_system_with_ratio(0.90);
        let alerts = engine.evaluate(&snapshot, &system);

        // Find the memory pressure alert
        let pressure_alert = alerts
            .iter()
            .find(|a| matches!(a, Alert::MemoryPressure { .. }));

        // Memory pressure should always be active with 90% usage
        prop_assert!(
            pressure_alert.is_some(),
            "Memory pressure alert should be active at 90% usage"
        );

        if let Some(Alert::MemoryPressure { candidates, .. }) = pressure_alert {
            // Compute expected non-essential processes
            let expected_non_essential: Vec<&FilteredProcess> = processes
                .iter()
                .filter(|p| {
                    matches!(p.path_status, PathStatus::User | PathStatus::Unknown)
                })
                .collect();

            // 1. Candidate list should contain exactly all non-essential processes
            prop_assert_eq!(
                candidates.len(),
                expected_non_essential.len(),
                "Candidate count {} != expected non-essential count {}. \
                 Candidates: {:?}, Expected PIDs: {:?}",
                candidates.len(),
                expected_non_essential.len(),
                candidates.iter().map(|c| c.pid).collect::<Vec<_>>(),
                expected_non_essential.iter().map(|p| p.sample.pid).collect::<Vec<_>>()
            );

            // Verify all non-essential PIDs are in the candidate list
            let candidate_pids: std::collections::HashSet<u32> =
                candidates.iter().map(|c| c.pid).collect();
            for proc in &expected_non_essential {
                prop_assert!(
                    candidate_pids.contains(&proc.sample.pid),
                    "Non-essential process pid={} is missing from candidate list",
                    proc.sample.pid
                );
            }

            // 2. Candidate list should be sorted by memory_bytes descending
            for window in candidates.windows(2) {
                prop_assert!(
                    window[0].memory_bytes >= window[1].memory_bytes,
                    "Candidates not sorted descending by memory: {:?} followed by {:?}",
                    window[0],
                    window[1]
                );
            }
        }
    }

    /// Property 10 (supplementary): Candidate list should not include System processes.
    #[test]
    fn prop_memory_pressure_candidates_exclude_system(
        processes in arb_mixed_processes(),
    ) {
        let config = Config::default();
        let mut engine = RuleEngine::new(config);

        let snapshot = FilteredSnapshot {
            processes: processes.clone(),
        };

        // Use ratio > 85% to activate memory pressure
        let system = make_system_with_ratio(0.90);
        let alerts = engine.evaluate(&snapshot, &system);

        if let Some(Alert::MemoryPressure { candidates, .. }) =
            alerts.iter().find(|a| matches!(a, Alert::MemoryPressure { .. }))
        {
            // Get PIDs of System processes
            let system_pids: std::collections::HashSet<u32> = processes
                .iter()
                .filter(|p| p.path_status == PathStatus::System)
                .map(|p| p.sample.pid)
                .collect();

            // No System process should be in candidates
            for candidate in candidates {
                prop_assert!(
                    !system_pids.contains(&candidate.pid),
                    "System process pid={} should NOT be in memory pressure candidates",
                    candidate.pid
                );
            }
        }
    }
}
