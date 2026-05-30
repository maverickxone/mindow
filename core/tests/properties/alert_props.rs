// Property: Alert Severity Classification
//
// For any alert, the severity SHALL be classified as:
// Critical (red) for MemoryPressure and HighCpu alerts,
// Warning (yellow) for MemoryLeak and BatteryWarning alerts.

use proptest::prelude::*;
use mindow_core::types::{Alert, AlertSeverity, BatteryOffender, MemoryCandidate};

// --- Generators for Alert variants ---

fn arb_memory_candidate() -> impl Strategy<Value = MemoryCandidate> {
    ("[a-z]{1,10}", 1u32..10000, 1u64..10_000_000_000).prop_map(|(name, pid, memory_bytes)| {
        MemoryCandidate { name, pid, memory_bytes }
    })
}

fn arb_battery_offender() -> impl Strategy<Value = BatteryOffender> {
    ("[a-z]{1,10}", 1u32..10000, 0.0f32..100.0, 1u64..10_000_000_000).prop_map(
        |(name, pid, cpu_percent, memory_bytes)| BatteryOffender {
            name,
            pid,
            cpu_percent,
            memory_bytes,
        },
    )
}

fn arb_memory_pressure_alert() -> impl Strategy<Value = Alert> {
    (0.0f32..100.0, proptest::collection::vec(arb_memory_candidate(), 0..5)).prop_map(
        |(used_percent, candidates)| Alert::MemoryPressure {
            used_percent,
            candidates,
        },
    )
}

fn arb_high_cpu_alert() -> impl Strategy<Value = Alert> {
    ("[a-z]{1,10}", 1u32..10000, 0.0f32..100.0, 1u64..100000).prop_map(
        |(process_name, pid, average_cpu, duration_secs)| Alert::HighCpu {
            process_name,
            pid,
            average_cpu,
            duration_secs,
        },
    )
}

fn arb_memory_leak_alert() -> impl Strategy<Value = Alert> {
    ("[a-z]{1,10}", 1u32..10000, 1u64..10_000_000_000, 1u64..10_000_000_000, 2usize..100)
        .prop_map(
            |(process_name, pid, start_memory, current_memory, consecutive_samples)| {
                Alert::MemoryLeak {
                    process_name,
                    pid,
                    start_memory,
                    current_memory,
                    consecutive_samples,
                }
            },
        )
}

fn arb_battery_warning_alert() -> impl Strategy<Value = Alert> {
    (0.0f32..100.0, proptest::collection::vec(arb_battery_offender(), 0..5)).prop_map(
        |(battery_level, offending_processes)| Alert::BatteryWarning {
            battery_level,
            offending_processes,
        },
    )
}

/// Strategy that generates any arbitrary Alert variant.
fn arb_alert() -> impl Strategy<Value = Alert> {
    prop_oneof![
        arb_memory_pressure_alert(),
        arb_high_cpu_alert(),
        arb_memory_leak_alert(),
        arb_battery_warning_alert(),
    ]
}

proptest! {
    #[test]
    fn prop_memory_pressure_is_critical(alert in arb_memory_pressure_alert()) {
        prop_assert_eq!(alert.severity(), AlertSeverity::Critical);
    }

    #[test]
    fn prop_high_cpu_is_critical(alert in arb_high_cpu_alert()) {
        prop_assert_eq!(alert.severity(), AlertSeverity::Critical);
    }

    #[test]
    fn prop_memory_leak_is_warning(alert in arb_memory_leak_alert()) {
        prop_assert_eq!(alert.severity(), AlertSeverity::Warning);
    }

    #[test]
    fn prop_battery_warning_is_warning(alert in arb_battery_warning_alert()) {
        prop_assert_eq!(alert.severity(), AlertSeverity::Warning);
    }

    #[test]
    fn prop_severity_is_deterministic(alert in arb_alert()) {
        let first = alert.severity();
        let second = alert.severity();
        prop_assert_eq!(first, second);
    }

    #[test]
    fn prop_severity_is_exhaustive(alert in arb_alert()) {
        let sev = alert.severity();
        prop_assert!(
            sev == AlertSeverity::Critical || sev == AlertSeverity::Warning,
            "Severity must be Critical or Warning, got {:?}", sev
        );
    }
}
