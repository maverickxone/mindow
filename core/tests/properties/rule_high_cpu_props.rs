// Feature: mindow-v05, Property 6: High CPU Detection
//
// For any process with a trend buffer containing M consecutive CPU samples where
// every sample exceeds the configured threshold, the rule engine SHALL generate a
// high-cpu alert with the arithmetic mean of those M samples as average_cpu.
// For any trend buffer where at least one sample is at or below the threshold,
// no high-cpu alert SHALL be generated.
//
// Validates: Requirements 6.2, 6.3

use proptest::prelude::*;
use mindow_core::config::Config;
use mindow_core::rule_engine::RuleEngine;
use mindow_core::types::{
    Alert, BatteryStatus, FilteredProcess, FilteredSnapshot, PathStatus, ProcessSample,
    SystemSample,
};

/// Helper: create a FilteredProcess with PathStatus::System to avoid SuspiciousPath alerts.
fn make_standard_process(pid: u32, name: &str, cpu: f32, mem: u64) -> FilteredProcess {
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
        path_status: PathStatus::System,
    }
}

/// Helper: create a SystemSample that won't trigger memory pressure or battery warnings.
fn safe_system_sample() -> SystemSample {
    SystemSample {
        total_memory: 16_000_000_000,
        used_memory: 4_000_000_000, // 25% - well below 85% threshold
        per_core_cpu: vec![30.0, 40.0],
        battery: BatteryStatus::Unavailable,
    }
}

proptest! {
    /// Property 6 (positive case): When ALL CPU samples strictly exceed the threshold,
    /// a HighCpu alert SHALL be generated with correct average_cpu.
    ///
    /// **Validates: Requirements 6.2, 6.3**
    #[test]
    fn prop_high_cpu_alert_generated_when_all_exceed_threshold(
        cpu_threshold in 10.0f32..90.0f32,
        cpu_samples in 2usize..=10,
        // Generate values in 0.0..1.0 range, then scale to (threshold, 100.0]
        raw_values in proptest::collection::vec(0.0f32..1.0f32, 2..=10),
    ) {
        // Only use first cpu_samples values
        let num_samples = cpu_samples;
        if raw_values.len() < num_samples {
            // Skip if we don't have enough raw values (proptest will retry)
            return Ok(());
        }
        let raw_values = &raw_values[..num_samples];

        // Scale values to (threshold, 100.0] range - all strictly above threshold
        let values: Vec<f32> = raw_values
            .iter()
            .map(|&r| cpu_threshold + 0.01 + r * (100.0 - cpu_threshold - 0.01))
            .collect();

        // Verify precondition: all values strictly exceed threshold
        for &v in &values {
            prop_assert!(v > cpu_threshold, "Precondition failed: {} should > {}", v, cpu_threshold);
        }

        let config = Config {
            cpu_threshold,
            cpu_samples: num_samples,
            mem_samples: num_samples,
            interval_secs: 10,
            ..Config::default()
        };

        let mut engine = RuleEngine::new(config);
        let system = safe_system_sample();

        // Feed cpu_samples values via repeated evaluate() calls
        for &cpu_val in &values {
            let snapshot = FilteredSnapshot {
                processes: vec![make_standard_process(1, "test_proc", cpu_val, 1_000_000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        // After feeding exactly cpu_samples values all exceeding threshold,
        // a HighCpu alert should be generated
        let alerts = engine.active_alerts();
        let high_cpu_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| matches!(a, Alert::HighCpu { .. }))
            .collect();

        prop_assert_eq!(
            high_cpu_alerts.len(), 1,
            "Expected exactly 1 HighCpu alert, got {}: threshold={}, samples={:?}",
            high_cpu_alerts.len(), cpu_threshold, values
        );

        if let Alert::HighCpu { average_cpu, pid, duration_secs, .. } = high_cpu_alerts[0] {
            // Verify the arithmetic mean
            let expected_avg: f32 = values.iter().sum::<f32>() / values.len() as f32;
            let diff = (average_cpu - expected_avg).abs();
            prop_assert!(
                diff < 0.01,
                "average_cpu mismatch: expected {}, got {}, diff={}",
                expected_avg, average_cpu, diff
            );

            // Verify PID
            prop_assert_eq!(*pid, 1u32);

            // Verify duration_secs = cpu_samples * interval_secs
            let expected_duration = (num_samples as u64) * 10;
            prop_assert_eq!(
                *duration_secs, expected_duration,
                "duration_secs mismatch: expected {}, got {}",
                expected_duration, duration_secs
            );
        } else {
            prop_assert!(false, "Expected HighCpu alert variant");
        }
    }

    /// Property 6 (negative case): When at least one CPU sample is at or below the
    /// threshold, NO HighCpu alert SHALL be generated.
    ///
    /// **Validates: Requirements 6.2, 6.3**
    #[test]
    fn prop_no_high_cpu_alert_when_any_sample_at_or_below_threshold(
        cpu_threshold in 10.0f32..90.0f32,
        cpu_samples in 2usize..=10,
        // Generate arbitrary CPU values
        raw_values in proptest::collection::vec(0.0f32..100.0f32, 2..=10),
        // Index where we force a value at or below threshold
        below_index_raw in 0usize..10,
        // The forced low value (at or below threshold)
        low_value_factor in 0.0f32..=1.0f32,
    ) {
        let num_samples = cpu_samples;
        if raw_values.len() < num_samples {
            return Ok(());
        }
        let mut values: Vec<f32> = raw_values[..num_samples].to_vec();

        // Force one value to be at or below the threshold
        let below_index = below_index_raw % num_samples;
        values[below_index] = low_value_factor * cpu_threshold;

        // Verify precondition: at least one value is at or below threshold
        let has_low = values.iter().any(|&v| v <= cpu_threshold);
        prop_assert!(has_low, "Precondition failed: no value at or below threshold");

        let config = Config {
            cpu_threshold,
            cpu_samples: num_samples,
            mem_samples: num_samples,
            interval_secs: 10,
            ..Config::default()
        };

        let mut engine = RuleEngine::new(config);
        let system = safe_system_sample();

        // Feed cpu_samples values where at least one is at or below threshold
        for &cpu_val in &values {
            let snapshot = FilteredSnapshot {
                processes: vec![make_standard_process(1, "test_proc", cpu_val, 1_000_000)],
            };
            engine.evaluate(&snapshot, &system);
        }

        // No HighCpu alert should be generated
        let alerts = engine.active_alerts();
        let high_cpu_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| matches!(a, Alert::HighCpu { .. }))
            .collect();

        prop_assert!(
            high_cpu_alerts.is_empty(),
            "Expected no HighCpu alert but got {}: threshold={}, samples={:?}",
            high_cpu_alerts.len(), cpu_threshold, values
        );
    }
}
