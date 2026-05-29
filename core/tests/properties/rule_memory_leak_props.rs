// Feature: mindow-v05, Property 5: Memory Leak Detection
//
// For any process with a trend buffer containing N consecutive memory samples that are
// strictly monotonically increasing, the rule engine SHALL generate a memory-leak alert
// containing the correct process name, PID, first sample value as start_memory, last
// sample value as current_memory, and N as consecutive_samples. For any trend buffer
// where the samples are NOT monotonically increasing, no memory-leak alert SHALL be
// generated.
//
// Validates: Requirements 5.2, 5.3

use proptest::prelude::*;
use mindow_core::config::Config;
use mindow_core::rule_engine::RuleEngine;
use mindow_core::types::{
    Alert, BatteryStatus, FilteredProcess, FilteredSnapshot, PathStatus, ProcessSample,
    SystemSample,
};

/// Creates a SystemSample that will NOT trigger memory pressure or battery alerts.
/// total_memory is very large so used_memory ratio stays low.
fn safe_system_sample() -> SystemSample {
    SystemSample {
        total_memory: 64_000_000_000, // 64 GB
        used_memory: 8_000_000_000,   // 8 GB (12.5% — well below 85%)
        per_core_cpu: vec![30.0, 40.0],
        battery: BatteryStatus::Unavailable,
    }
}

/// Creates a FilteredSnapshot with a single process at a given memory value.
/// Uses a Standard path to avoid SuspiciousPath alerts, and low CPU to avoid
/// battery/high-cpu interactions.
fn make_snapshot(pid: u32, name: &str, memory_bytes: u64) -> FilteredSnapshot {
    FilteredSnapshot {
        processes: vec![FilteredProcess {
            sample: ProcessSample {
                name: name.to_string(),
                pid,
                cpu_percent: 1.0,
                memory_bytes,
                disk_read_bytes: 0,
                disk_write_bytes: 0,
                exe_path: Some("C:\\Program Files\\test_app.exe".to_string()),
                start_time: 1000,
                parent_pid: None,
            },
            path_status: PathStatus::Standard,
        }],
    }
}

proptest! {
    /// Property 5 (positive case): When a process has mem_samples consecutive
    /// strictly increasing memory values, a MemoryLeak alert is generated with
    /// correct fields.
    ///
    /// **Validates: Requirements 5.2, 5.3**
    #[test]
    fn prop_memory_leak_detected_when_strictly_increasing(
        mem_samples in 2usize..10,
        pid in 1u32..100_000,
        name_suffix in "[a-z]{3,8}",
    ) {
        // Generate a strictly increasing sequence of length mem_samples
        let runner = proptest::test_runner::TestRunner::default();
        let _ = runner; // just to ensure it's not optimized away

        // We use a nested prop_flat_map approach inline:
        // Since proptest! doesn't easily support dependent strategies,
        // we generate the values manually using a deterministic approach
        // based on the pid (as a seed-like value)
        let base_mem = 1_000_000u64 + (pid as u64 * 1000);
        let increment = 100_000u64;
        let memory_values: Vec<u64> = (0..mem_samples)
            .map(|i| base_mem + increment * (i as u64 + 1))
            .collect();

        // Verify our generated sequence IS strictly increasing
        assert!(memory_values.windows(2).all(|w| w[1] > w[0]),
            "Test setup error: memory_values should be strictly increasing");

        let process_name = format!("app_{}", name_suffix);
        let config = Config {
            mem_samples,
            cpu_samples: mem_samples, // match to avoid buffer capacity issues
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = safe_system_sample();

        // Feed mem_samples snapshots with increasing memory
        for &mem_val in &memory_values {
            let snapshot = make_snapshot(pid, &process_name, mem_val);
            engine.evaluate(&snapshot, &system);
        }

        // After mem_samples evaluations, check for memory leak alert
        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| matches!(a, Alert::MemoryLeak { .. }))
            .collect();

        prop_assert_eq!(
            leak_alerts.len(), 1,
            "Expected exactly 1 MemoryLeak alert, got {}: {:?}",
            leak_alerts.len(), leak_alerts
        );

        if let Alert::MemoryLeak {
            process_name: alert_name,
            pid: alert_pid,
            start_memory,
            current_memory,
            consecutive_samples,
        } = &leak_alerts[0]
        {
            prop_assert_eq!(alert_name, &process_name);
            prop_assert_eq!(*alert_pid, pid);
            prop_assert_eq!(*start_memory, memory_values[0]);
            prop_assert_eq!(*current_memory, memory_values[mem_samples - 1]);
            prop_assert_eq!(*consecutive_samples, mem_samples);
        } else {
            prop_assert!(false, "Expected MemoryLeak alert variant");
        }
    }

    /// Property 5 (negative case): When a process's memory samples are NOT
    /// strictly monotonically increasing, no MemoryLeak alert SHALL be generated.
    ///
    /// **Validates: Requirements 5.2, 5.3**
    #[test]
    fn prop_no_memory_leak_when_not_strictly_increasing(
        mem_samples in 2usize..10,
        pid in 1u32..100_000,
        break_position in 0usize..8, // which pair to break monotonicity at
    ) {
        // Generate a sequence of length mem_samples that is NOT strictly increasing
        let base_mem = 1_000_000u64;
        let increment = 100_000u64;

        // Start with an increasing sequence then break it at break_position
        let break_idx = (break_position % (mem_samples - 1)) + 1; // index 1..mem_samples-1
        let mut memory_values: Vec<u64> = (0..mem_samples)
            .map(|i| base_mem + increment * (i as u64 + 1))
            .collect();

        // Break strict monotonicity by making value at break_idx <= value at break_idx-1
        memory_values[break_idx] = memory_values[break_idx - 1]; // equal, not strictly increasing

        // Verify our sequence is NOT strictly monotonically increasing
        let is_strictly_increasing = memory_values.windows(2).all(|w| w[1] > w[0]);
        assert!(!is_strictly_increasing,
            "Test setup error: memory_values should NOT be strictly increasing");

        let config = Config {
            mem_samples,
            cpu_samples: mem_samples,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = safe_system_sample();

        // Feed mem_samples snapshots
        for &mem_val in &memory_values {
            let snapshot = make_snapshot(pid, "test_proc", mem_val);
            engine.evaluate(&snapshot, &system);
        }

        // After all evaluations, no MemoryLeak alert should be present
        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| matches!(a, Alert::MemoryLeak { .. }))
            .collect();

        prop_assert!(
            leak_alerts.is_empty(),
            "Expected no MemoryLeak alerts for non-increasing sequence {:?}, got {:?}",
            memory_values, leak_alerts
        );
    }

    /// Property 5 (negative case variant): When memory values decrease at some point,
    /// no MemoryLeak alert is generated.
    ///
    /// **Validates: Requirements 5.2, 5.3**
    #[test]
    fn prop_no_memory_leak_when_values_decrease(
        mem_samples in 2usize..10,
        pid in 1u32..100_000,
        decrease_position in 0usize..8,
    ) {
        let base_mem = 2_000_000u64;
        let increment = 100_000u64;

        // Start with increasing, then introduce a decrease
        let break_idx = (decrease_position % (mem_samples - 1)) + 1;
        let mut memory_values: Vec<u64> = (0..mem_samples)
            .map(|i| base_mem + increment * (i as u64 + 1))
            .collect();

        // Make value decrease (strictly less than previous)
        memory_values[break_idx] = memory_values[break_idx - 1].saturating_sub(1);

        let config = Config {
            mem_samples,
            cpu_samples: mem_samples,
            ..Config::default()
        };
        let mut engine = RuleEngine::new(config);
        let system = safe_system_sample();

        for &mem_val in &memory_values {
            let snapshot = make_snapshot(pid, "decreasing_proc", mem_val);
            engine.evaluate(&snapshot, &system);
        }

        let alerts = engine.active_alerts();
        let leak_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| matches!(a, Alert::MemoryLeak { .. }))
            .collect();

        prop_assert!(
            leak_alerts.is_empty(),
            "Expected no MemoryLeak alert for sequence with decrease {:?}, got {:?}",
            memory_values, leak_alerts
        );
    }
}
