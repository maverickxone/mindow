// Feature: mindow-v05, Property 1: Trend Buffer Capacity Invariant
//
// For any sequence of samples pushed to a trend buffer with configured capacity N,
// the buffer SHALL never contain more than N entries, and SHALL always contain the
// most recent N values (or fewer if fewer have been pushed).
//
// Validates: Requirements 5.1, 6.1, 10.3

use proptest::prelude::*;
use mindow_core::config::Config;
use mindow_core::trend_store::TrendStore;

proptest! {
    /// Property 1: Trend Buffer Capacity Invariant
    ///
    /// For an arbitrary capacity N (1..=50), an arbitrary sequence of (u64, f32)
    /// samples (length 1..100), and an arbitrary PID:
    /// 1. After each push, buffer length <= N
    /// 2. After all pushes, buffer contains the last min(num_pushed, N) values
    /// 3. Values are the most recent ones pushed (in order)
    ///
    /// **Validates: Requirements 5.1, 6.1, 10.3**
    #[test]
    fn prop_trend_buffer_capacity_invariant(
        capacity in 1usize..=50,
        samples in proptest::collection::vec((any::<u64>(), any::<f32>()), 1..100),
        pid in any::<u32>(),
    ) {
        let config = Config {
            mem_samples: capacity,
            cpu_samples: capacity,
            ..Config::default()
        };
        let mut store = TrendStore::new();

        // Push each sample and verify capacity invariant after every push
        for (i, &(mem, cpu)) in samples.iter().enumerate() {
            store.push_sample(pid, mem, cpu, &config);

            // 1. After each push, buffer length <= N
            let mem_trend = store.get_memory_trend(pid).unwrap();
            let cpu_trend = store.get_cpu_trend(pid).unwrap();

            prop_assert!(
                mem_trend.len() <= capacity,
                "Memory buffer exceeded capacity after push {}: len={}, capacity={}",
                i + 1, mem_trend.len(), capacity
            );
            prop_assert!(
                cpu_trend.len() <= capacity,
                "CPU buffer exceeded capacity after push {}: len={}, capacity={}",
                i + 1, cpu_trend.len(), capacity
            );
        }

        let num_pushed = samples.len();
        let expected_len = num_pushed.min(capacity);

        // 2. After all pushes, buffer contains the last min(num_pushed, N) values
        let mem_trend = store.get_memory_trend(pid).unwrap();
        let cpu_trend = store.get_cpu_trend(pid).unwrap();

        prop_assert_eq!(
            mem_trend.len(), expected_len,
            "Expected memory buffer len={}, got len={}",
            expected_len, mem_trend.len()
        );
        prop_assert_eq!(
            cpu_trend.len(), expected_len,
            "Expected CPU buffer len={}, got len={}",
            expected_len, cpu_trend.len()
        );

        // 3. Values are the most recent ones pushed (in order)
        let expected_samples: Vec<_> = samples.iter()
            .skip(num_pushed.saturating_sub(capacity))
            .collect();

        for (j, &(expected_mem, expected_cpu)) in expected_samples.iter().enumerate() {
            prop_assert_eq!(
                mem_trend[j], *expected_mem,
                "Memory mismatch at index {}: expected {}, got {}",
                j, expected_mem, mem_trend[j]
            );
            prop_assert_eq!(
                cpu_trend[j], *expected_cpu,
                "CPU mismatch at index {}: expected {}, got {}",
                j, expected_cpu, cpu_trend[j]
            );
        }
    }

    /// Property 1 (variant): Capacity uses max(mem_samples, cpu_samples)
    ///
    /// When mem_samples != cpu_samples, the effective capacity is the max of both.
    /// The buffer SHALL never exceed that max capacity.
    ///
    /// **Validates: Requirements 5.1, 6.1, 10.3**
    #[test]
    fn prop_trend_buffer_capacity_uses_max(
        mem_samples in 1usize..=25,
        cpu_samples in 1usize..=25,
        samples in proptest::collection::vec((any::<u64>(), any::<f32>()), 1..100),
        pid in any::<u32>(),
    ) {
        let config = Config {
            mem_samples,
            cpu_samples,
            ..Config::default()
        };
        let effective_capacity = mem_samples.max(cpu_samples);
        let mut store = TrendStore::new();

        for &(mem, cpu) in &samples {
            store.push_sample(pid, mem, cpu, &config);
        }

        let mem_trend = store.get_memory_trend(pid).unwrap();
        let cpu_trend = store.get_cpu_trend(pid).unwrap();

        // Buffer length must not exceed effective capacity
        prop_assert!(
            mem_trend.len() <= effective_capacity,
            "Memory buffer len {} exceeds effective capacity {} (mem_samples={}, cpu_samples={})",
            mem_trend.len(), effective_capacity, mem_samples, cpu_samples
        );
        prop_assert!(
            cpu_trend.len() <= effective_capacity,
            "CPU buffer len {} exceeds effective capacity {} (mem_samples={}, cpu_samples={})",
            cpu_trend.len(), effective_capacity, mem_samples, cpu_samples
        );

        // Should contain exactly min(num_pushed, effective_capacity) entries
        let expected_len = samples.len().min(effective_capacity);
        prop_assert_eq!(mem_trend.len(), expected_len);
        prop_assert_eq!(cpu_trend.len(), expected_len);

        // Should contain the most recent values
        let skip = samples.len().saturating_sub(effective_capacity);
        for (j, &(expected_mem, expected_cpu)) in samples.iter().skip(skip).enumerate() {
            prop_assert_eq!(mem_trend[j], expected_mem);
            prop_assert_eq!(cpu_trend[j], expected_cpu);
        }
    }
}
