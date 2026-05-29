// Pre-filtering: top-N selection, deduplication, and path classification

use std::collections::HashSet;

use crate::config::Config;
use crate::types::{FilteredProcess, FilteredSnapshot, PathStatus, ProcessSample};

/// Classifies a process executable path as Standard, Suspicious, or Unknown.
///
/// - If `exe_path` is `None` → `PathStatus::Unknown` (likely a system process we can't read)
/// - If `exe_path` starts with a known safe directory (case-insensitive) → `PathStatus::Standard`
/// - Otherwise → `PathStatus::Suspicious`
///
/// Safe directories include: `C:\Windows\`, `C:\Program Files\`, `C:\Program Files (x86)\`,
/// `C:\ProgramData\`, and common system service paths.
pub fn classify_path(exe_path: &Option<String>) -> PathStatus {
    match exe_path {
        None => PathStatus::Unknown,
        Some(path) => {
            let lower = path.to_lowercase();
            if lower.starts_with(r"c:\windows\")
                || lower.starts_with(r"c:\program files\")
                || lower.starts_with(r"c:\program files (x86)\")
                || lower.starts_with(r"c:\programdata\")
                || lower.starts_with(r"c:\program files\windowsapps\")
            {
                PathStatus::Standard
            } else {
                PathStatus::Suspicious
            }
        }
    }
}

/// Filters a list of process samples into a deduplicated `FilteredSnapshot`.
///
/// 1. Selects top-N processes by memory usage (descending).
/// 2. Selects top-N processes by CPU usage (descending).
/// 3. Merges both lists, deduplicating by PID.
/// 4. Classifies each process's executable path.
pub fn filter_snapshot(processes: &[ProcessSample], config: &Config) -> FilteredSnapshot {
    let n = config.top_n;

    // Select top-N by memory (descending)
    let mut by_memory: Vec<usize> = (0..processes.len()).collect();
    by_memory.sort_by(|&a, &b| processes[b].memory_bytes.cmp(&processes[a].memory_bytes));
    by_memory.truncate(n);

    // Select top-N by CPU (descending)
    let mut by_cpu: Vec<usize> = (0..processes.len()).collect();
    by_cpu.sort_by(|&a, &b| {
        processes[b]
            .cpu_percent
            .partial_cmp(&processes[a].cpu_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    by_cpu.truncate(n);

    // Merge both lists, deduplicate by PID
    let mut seen_pids = HashSet::new();
    let mut merged = Vec::new();

    for &idx in by_memory.iter().chain(by_cpu.iter()) {
        let process = &processes[idx];
        if seen_pids.insert(process.pid) {
            let path_status = classify_path(&process.exe_path);
            merged.push(FilteredProcess {
                sample: process.clone(),
                path_status,
            });
        }
    }

    FilteredSnapshot { processes: merged }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_process(name: &str, pid: u32, cpu: f32, memory: u64, path: Option<&str>) -> ProcessSample {
        ProcessSample {
            name: name.to_string(),
            pid,
            cpu_percent: cpu,
            memory_bytes: memory,
            disk_read_bytes: 0,
            disk_write_bytes: 0,
            exe_path: path.map(|s| s.to_string()),
            start_time: 0,
            parent_pid: None,
        }
    }

    // --- classify_path tests ---

    #[test]
    fn test_classify_path_none_is_unknown() {
        assert_eq!(classify_path(&None), PathStatus::Unknown);
    }

    #[test]
    fn test_classify_path_windows_dir_is_standard() {
        let path = Some(r"C:\Windows\System32\svchost.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Standard);
    }

    #[test]
    fn test_classify_path_program_files_is_standard() {
        let path = Some(r"C:\Program Files\MyApp\app.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Standard);
    }

    #[test]
    fn test_classify_path_program_files_x86_is_standard() {
        let path = Some(r"C:\Program Files (x86)\OldApp\app.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Standard);
    }

    #[test]
    fn test_classify_path_case_insensitive() {
        let path = Some(r"c:\WINDOWS\explorer.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Standard);

        let path2 = Some(r"C:\PROGRAM FILES\test.exe".to_string());
        assert_eq!(classify_path(&path2), PathStatus::Standard);
    }

    #[test]
    fn test_classify_path_non_standard_is_suspicious() {
        let path = Some(r"D:\Tools\hack.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Suspicious);
    }

    #[test]
    fn test_classify_path_user_dir_is_suspicious() {
        let path = Some(r"C:\Users\Admin\Downloads\app.exe".to_string());
        assert_eq!(classify_path(&path), PathStatus::Suspicious);
    }

    // --- filter_snapshot tests ---

    #[test]
    fn test_filter_empty_processes() {
        let config = Config::default();
        let result = filter_snapshot(&[], &config);
        assert!(result.processes.is_empty());
    }

    #[test]
    fn test_filter_fewer_than_n_processes() {
        let config = Config { top_n: 10, ..Config::default() };
        let processes = vec![
            make_process("a", 1, 50.0, 1000, Some(r"C:\Windows\a.exe")),
            make_process("b", 2, 30.0, 2000, Some(r"D:\b.exe")),
        ];
        let result = filter_snapshot(&processes, &config);
        // Both should be included (only 2 processes, N=10)
        assert_eq!(result.processes.len(), 2);
    }

    #[test]
    fn test_filter_top_n_by_memory_and_cpu() {
        let config = Config { top_n: 2, ..Config::default() };
        let processes = vec![
            make_process("low_both", 1, 10.0, 100, None),
            make_process("high_mem", 2, 20.0, 9000, None),
            make_process("high_cpu", 3, 90.0, 200, None),
            make_process("mid", 4, 50.0, 5000, None),
        ];
        let result = filter_snapshot(&processes, &config);

        let pids: HashSet<u32> = result.processes.iter().map(|p| p.sample.pid).collect();
        // Top-2 by memory: pid 2 (9000), pid 4 (5000)
        // Top-2 by CPU: pid 3 (90%), pid 4 (50%)
        // Merged: pid 2, 4, 3
        assert!(pids.contains(&2));
        assert!(pids.contains(&3));
        assert!(pids.contains(&4));
        assert!(!pids.contains(&1));
    }

    #[test]
    fn test_filter_deduplicates_by_pid() {
        let config = Config { top_n: 5, ..Config::default() };
        let processes = vec![
            make_process("top", 1, 95.0, 8000, None),
            make_process("other", 2, 10.0, 100, None),
        ];
        let result = filter_snapshot(&processes, &config);
        // Process with pid 1 appears in both top-by-memory and top-by-cpu
        // but should only appear once in the result
        let pid_1_count = result.processes.iter().filter(|p| p.sample.pid == 1).count();
        assert_eq!(pid_1_count, 1);
        assert_eq!(result.processes.len(), 2);
    }

    #[test]
    fn test_filter_classifies_paths() {
        let config = Config { top_n: 10, ..Config::default() };
        let processes = vec![
            make_process("system", 1, 10.0, 100, Some(r"C:\Windows\System32\svc.exe")),
            make_process("user_app", 2, 20.0, 200, Some(r"C:\Users\Me\app.exe")),
            make_process("unknown", 3, 30.0, 300, None),
        ];
        let result = filter_snapshot(&processes, &config);

        let find = |pid: u32| result.processes.iter().find(|p| p.sample.pid == pid).unwrap();
        assert_eq!(find(1).path_status, PathStatus::Standard);
        assert_eq!(find(2).path_status, PathStatus::Suspicious);
        assert_eq!(find(3).path_status, PathStatus::Unknown);
    }

    #[test]
    fn test_filter_top_n_equals_one() {
        let config = Config { top_n: 1, ..Config::default() };
        let processes = vec![
            make_process("a", 1, 10.0, 5000, None),
            make_process("b", 2, 90.0, 1000, None),
            make_process("c", 3, 50.0, 3000, None),
        ];
        let result = filter_snapshot(&processes, &config);

        let pids: HashSet<u32> = result.processes.iter().map(|p| p.sample.pid).collect();
        // Top-1 by memory: pid 1 (5000)
        // Top-1 by CPU: pid 2 (90%)
        // Merged: pid 1, pid 2
        assert!(pids.contains(&1));
        assert!(pids.contains(&2));
        assert_eq!(result.processes.len(), 2);
    }
}
