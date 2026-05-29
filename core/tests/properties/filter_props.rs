// Feature: mindow-v05, Property 2: Top-N Selection Correctness
//
// For any list of processes and any positive integer N, selecting the top-N
// by a numeric field (CPU or memory) SHALL return exactly min(N, list_length)
// processes, and every returned process SHALL have a field value greater than
// or equal to every non-returned process's field value.
//
// **Validates: Requirements 3.1, 3.2**

use proptest::prelude::*;
use std::collections::HashSet;

use mindow_core::config::Config;
use mindow_core::filter::filter_snapshot;
use mindow_core::types::ProcessSample;

/// Strategy to generate an arbitrary ProcessSample with a unique PID.
fn arb_process_sample(pid: u32) -> impl Strategy<Value = ProcessSample> {
    (
        "[a-z]{1,8}",          // name
        0.0f32..200.0,         // cpu_percent
        0u64..10_000_000_000,  // memory_bytes (0..10GB, realistic range)
    )
        .prop_map(move |(name, cpu_percent, memory_bytes)| ProcessSample {
            name,
            pid,
            cpu_percent,
            memory_bytes,
            disk_read_bytes: 0,
            disk_write_bytes: 0,
            exe_path: None,
            start_time: 0,
            parent_pid: None,
        })
}

/// Strategy to generate a Vec of ProcessSamples with unique PIDs, size 0..50.
fn arb_process_list() -> impl Strategy<Value = Vec<ProcessSample>> {
    (0usize..50).prop_flat_map(|len| {
        let strategies: Vec<_> = (0..len)
            .map(|i| arb_process_sample(i as u32 + 1))
            .collect();
        strategies
    })
}

proptest! {
    /// Property 2: Top-N by memory — the filtered output contains all processes
    /// that should be in the top-N by memory. Specifically:
    /// - Sort all processes by memory descending
    /// - The first min(N, len) processes by memory must ALL appear in the output
    /// - Every process selected by memory has memory_bytes >= every non-selected
    ///   process's memory_bytes
    #[test]
    fn prop_top_n_memory_selection(
        processes in arb_process_list(),
        n in 1usize..20,
    ) {
        let config = Config { top_n: n, ..Config::default() };
        let result = filter_snapshot(&processes, &config);

        let result_pids: HashSet<u32> = result.processes.iter().map(|p| p.sample.pid).collect();

        // Determine expected top-N by memory
        let mut by_memory = processes.clone();
        by_memory.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
        let top_n_mem: Vec<&ProcessSample> = by_memory.iter().take(n.min(processes.len())).collect();

        // All top-N by memory must be in the result
        for proc in &top_n_mem {
            prop_assert!(
                result_pids.contains(&proc.pid),
                "Process pid={} with memory_bytes={} should be in top-{} by memory but is missing from output",
                proc.pid, proc.memory_bytes, n
            );
        }

        // The selection correctness property: every selected-by-memory process
        // has memory >= every non-selected process's memory
        let top_n_mem_pids: HashSet<u32> = top_n_mem.iter().map(|p| p.pid).collect();
        let min_selected_memory = top_n_mem.iter().map(|p| p.memory_bytes).min().unwrap_or(0);

        for proc in &processes {
            if !top_n_mem_pids.contains(&proc.pid) {
                prop_assert!(
                    proc.memory_bytes <= min_selected_memory,
                    "Non-selected process pid={} has memory_bytes={} which exceeds min selected memory={}",
                    proc.pid, proc.memory_bytes, min_selected_memory
                );
            }
        }
    }

    /// Property 2: Top-N by CPU — the filtered output contains all processes
    /// that should be in the top-N by CPU. Specifically:
    /// - Sort all processes by CPU descending
    /// - The first min(N, len) processes by CPU must ALL appear in the output
    /// - Every process selected by CPU has cpu_percent >= every non-selected
    ///   process's cpu_percent
    #[test]
    fn prop_top_n_cpu_selection(
        processes in arb_process_list(),
        n in 1usize..20,
    ) {
        let config = Config { top_n: n, ..Config::default() };
        let result = filter_snapshot(&processes, &config);

        let result_pids: HashSet<u32> = result.processes.iter().map(|p| p.sample.pid).collect();

        // Determine expected top-N by CPU
        let mut by_cpu = processes.clone();
        by_cpu.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
        let top_n_cpu: Vec<&ProcessSample> = by_cpu.iter().take(n.min(processes.len())).collect();

        // All top-N by CPU must be in the result
        for proc in &top_n_cpu {
            prop_assert!(
                result_pids.contains(&proc.pid),
                "Process pid={} with cpu_percent={} should be in top-{} by CPU but is missing from output",
                proc.pid, proc.cpu_percent, n
            );
        }

        // The selection correctness property: every selected-by-CPU process
        // has cpu >= every non-selected process's cpu
        let top_n_cpu_pids: HashSet<u32> = top_n_cpu.iter().map(|p| p.pid).collect();
        let min_selected_cpu = top_n_cpu.iter().map(|p| p.cpu_percent).fold(f32::INFINITY, f32::min);

        for proc in &processes {
            if !top_n_cpu_pids.contains(&proc.pid) {
                prop_assert!(
                    proc.cpu_percent <= min_selected_cpu,
                    "Non-selected process pid={} has cpu_percent={} which exceeds min selected cpu={}",
                    proc.pid, proc.cpu_percent, min_selected_cpu
                );
            }
        }
    }

    /// Property 2: Output size correctness — the filtered snapshot contains
    /// at least min(N, len) processes (from memory) and at least min(N, len)
    /// from CPU, merged. The total is at most 2*min(N, len) and at least
    /// min(N, len) (when both lists fully overlap).
    #[test]
    fn prop_top_n_output_size(
        processes in arb_process_list(),
        n in 1usize..20,
    ) {
        let config = Config { top_n: n, ..Config::default() };
        let result = filter_snapshot(&processes, &config);

        let expected_per_list = n.min(processes.len());
        let output_len = result.processes.len();

        // Output must contain at least min(N, len) processes (from one list)
        // and at most 2 * min(N, len) (if no overlap between memory and CPU lists)
        prop_assert!(
            output_len >= expected_per_list,
            "Output has {} processes but expected at least {} (min(N={}, len={}))",
            output_len, expected_per_list, n, processes.len()
        );
        prop_assert!(
            output_len <= 2 * expected_per_list,
            "Output has {} processes but expected at most {} (2 * min(N={}, len={}))",
            output_len, 2 * expected_per_list, n, processes.len()
        );

        // No duplicate PIDs in output
        let pids: Vec<u32> = result.processes.iter().map(|p| p.sample.pid).collect();
        let unique_pids: HashSet<u32> = pids.iter().copied().collect();
        prop_assert_eq!(
            pids.len(),
            unique_pids.len(),
            "Output contains duplicate PIDs"
        );
    }
}

// Feature: mindow-v05, Property 3: Merge Deduplication
//
// For any two lists of processes (top-N by memory and top-N by CPU), merging them
// SHALL produce a list containing every unique process from both lists exactly once,
// with no duplicates by PID.
//
// **Validates: Requirements 3.3**

/// Strategy to generate a Vec of ProcessSamples with unique PIDs, size 0..30.
/// Uses index-based PIDs to guarantee uniqueness.
fn arb_process_list_for_merge() -> impl Strategy<Value = Vec<ProcessSample>> {
    (0usize..30).prop_flat_map(|len| {
        let strategies: Vec<_> = (0..len)
            .map(|i| arb_process_sample(i as u32 + 1))
            .collect();
        strategies
    })
}

proptest! {
    /// Property 3: Merge Deduplication
    ///
    /// For any list of processes (with unique PIDs, size 0..30) and any N (1..15),
    /// calling filter_snapshot SHALL:
    /// 1. Produce output with no duplicate PIDs
    /// 2. The output set of PIDs is exactly the union of (top-N by memory PIDs) and
    ///    (top-N by CPU PIDs)
    ///
    /// **Validates: Requirements 3.3**
    #[test]
    fn prop_merge_deduplication(
        processes in arb_process_list_for_merge(),
        n in 1usize..=15,
    ) {
        let config = Config {
            top_n: n,
            ..Config::default()
        };

        let result = filter_snapshot(&processes, &config);

        // 1. No duplicate PIDs in the output
        let output_pids: Vec<u32> = result.processes.iter().map(|p| p.sample.pid).collect();
        let output_pid_set: HashSet<u32> = output_pids.iter().copied().collect();

        prop_assert_eq!(
            output_pids.len(),
            output_pid_set.len(),
            "Output contains duplicate PIDs: {:?}",
            output_pids
        );

        // 2. Compute expected PID set: union of top-N by memory and top-N by CPU
        // Top-N by memory (descending)
        let mut by_memory: Vec<&ProcessSample> = processes.iter().collect();
        by_memory.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
        by_memory.truncate(n);
        let top_mem_pids: HashSet<u32> = by_memory.iter().map(|p| p.pid).collect();

        // Top-N by CPU (descending)
        let mut by_cpu: Vec<&ProcessSample> = processes.iter().collect();
        by_cpu.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
        by_cpu.truncate(n);
        let top_cpu_pids: HashSet<u32> = by_cpu.iter().map(|p| p.pid).collect();

        let expected_pids: HashSet<u32> = top_mem_pids.union(&top_cpu_pids).copied().collect();

        prop_assert!(
            output_pid_set == expected_pids,
            "Output PID set {:?} != expected union {:?} (top_mem={:?}, top_cpu={:?})",
            output_pid_set,
            expected_pids,
            top_mem_pids,
            top_cpu_pids
        );
    }
}
