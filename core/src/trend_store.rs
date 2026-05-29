// Trend store: ring buffers for per-process memory and CPU history

use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::Config;

/// Stores per-process trend data as fixed-size ring buffers.
/// Used by the rule engine to detect memory leaks and sustained high CPU.
#[derive(Debug, Clone)]
pub struct TrendStore {
    memory_trends: HashMap<u32, VecDeque<u64>>,
    cpu_trends: HashMap<u32, VecDeque<f32>>,
}

impl TrendStore {
    /// Creates a new empty TrendStore.
    pub fn new() -> Self {
        Self {
            memory_trends: HashMap::new(),
            cpu_trends: HashMap::new(),
        }
    }

    /// Pushes a new sample for a process, maintaining ring buffer capacity.
    /// The capacity is `max(config.mem_samples, config.cpu_samples)`.
    /// When a buffer exceeds capacity, the oldest entry is removed from the front.
    pub fn push_sample(&mut self, pid: u32, mem: u64, cpu: f32, config: &Config) {
        let capacity = config.mem_samples.max(config.cpu_samples);

        let mem_buf = self.memory_trends.entry(pid).or_insert_with(VecDeque::new);
        mem_buf.push_back(mem);
        while mem_buf.len() > capacity {
            mem_buf.pop_front();
        }

        let cpu_buf = self.cpu_trends.entry(pid).or_insert_with(VecDeque::new);
        cpu_buf.push_back(cpu);
        while cpu_buf.len() > capacity {
            cpu_buf.pop_front();
        }
    }

    /// Returns the memory trend buffer for a given PID, if it exists.
    pub fn get_memory_trend(&self, pid: u32) -> Option<&VecDeque<u64>> {
        self.memory_trends.get(&pid)
    }

    /// Returns the CPU trend buffer for a given PID, if it exists.
    pub fn get_cpu_trend(&self, pid: u32) -> Option<&VecDeque<f32>> {
        self.cpu_trends.get(&pid)
    }

    /// Removes trend entries for PIDs not present in the active set.
    /// Called each evaluation cycle to clean up terminated processes.
    pub fn remove_stale(&mut self, active_pids: &HashSet<u32>) {
        self.memory_trends.retain(|pid, _| active_pids.contains(pid));
        self.cpu_trends.retain(|pid, _| active_pids.contains(pid));
    }

    /// Returns an iterator over all PIDs that have memory trend entries.
    pub fn memory_trend_pids(&self) -> impl Iterator<Item = &u32> {
        self.memory_trends.keys()
    }

    /// Returns an iterator over all PIDs that have CPU trend entries.
    pub fn cpu_trend_pids(&self) -> impl Iterator<Item = &u32> {
        self.cpu_trends.keys()
    }
}

impl Default for TrendStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> Config {
        Config::default()
    }

    #[test]
    fn test_new_trend_store_is_empty() {
        let store = TrendStore::new();
        assert!(store.get_memory_trend(1).is_none());
        assert!(store.get_cpu_trend(1).is_none());
    }

    #[test]
    fn test_push_sample_creates_entry() {
        let mut store = TrendStore::new();
        let config = default_config();
        store.push_sample(100, 1024, 50.0, &config);

        let mem = store.get_memory_trend(100).unwrap();
        assert_eq!(mem.len(), 1);
        assert_eq!(mem[0], 1024);

        let cpu = store.get_cpu_trend(100).unwrap();
        assert_eq!(cpu.len(), 1);
        assert_eq!(cpu[0], 50.0);
    }

    #[test]
    fn test_push_sample_appends_to_existing() {
        let mut store = TrendStore::new();
        let config = default_config();
        store.push_sample(100, 1000, 10.0, &config);
        store.push_sample(100, 2000, 20.0, &config);
        store.push_sample(100, 3000, 30.0, &config);

        let mem = store.get_memory_trend(100).unwrap();
        assert_eq!(mem.len(), 3);
        assert_eq!(mem[0], 1000);
        assert_eq!(mem[1], 2000);
        assert_eq!(mem[2], 3000);
    }

    #[test]
    fn test_ring_buffer_capacity_enforced() {
        let mut store = TrendStore::new();
        // Config with mem_samples=3, cpu_samples=3 → capacity = 3
        let config = Config {
            mem_samples: 3,
            cpu_samples: 3,
            ..Config::default()
        };

        store.push_sample(1, 100, 10.0, &config);
        store.push_sample(1, 200, 20.0, &config);
        store.push_sample(1, 300, 30.0, &config);
        store.push_sample(1, 400, 40.0, &config); // should evict first

        let mem = store.get_memory_trend(1).unwrap();
        assert_eq!(mem.len(), 3);
        assert_eq!(mem[0], 200);
        assert_eq!(mem[1], 300);
        assert_eq!(mem[2], 400);

        let cpu = store.get_cpu_trend(1).unwrap();
        assert_eq!(cpu.len(), 3);
        assert_eq!(cpu[0], 20.0);
        assert_eq!(cpu[1], 30.0);
        assert_eq!(cpu[2], 40.0);
    }

    #[test]
    fn test_capacity_uses_max_of_mem_and_cpu_samples() {
        let mut store = TrendStore::new();
        // mem_samples=2, cpu_samples=4 → capacity = 4
        let config = Config {
            mem_samples: 2,
            cpu_samples: 4,
            ..Config::default()
        };

        for i in 1..=6 {
            store.push_sample(1, i * 100, i as f32 * 10.0, &config);
        }

        let mem = store.get_memory_trend(1).unwrap();
        assert_eq!(mem.len(), 4); // capacity is max(2, 4) = 4
        assert_eq!(mem[0], 300);
        assert_eq!(mem[3], 600);

        let cpu = store.get_cpu_trend(1).unwrap();
        assert_eq!(cpu.len(), 4);
        assert_eq!(cpu[0], 30.0);
        assert_eq!(cpu[3], 60.0);
    }

    #[test]
    fn test_multiple_pids_independent() {
        let mut store = TrendStore::new();
        let config = default_config();

        store.push_sample(1, 100, 10.0, &config);
        store.push_sample(2, 200, 20.0, &config);

        assert_eq!(store.get_memory_trend(1).unwrap()[0], 100);
        assert_eq!(store.get_memory_trend(2).unwrap()[0], 200);
        assert_eq!(store.get_cpu_trend(1).unwrap()[0], 10.0);
        assert_eq!(store.get_cpu_trend(2).unwrap()[0], 20.0);
    }

    #[test]
    fn test_remove_stale_removes_inactive_pids() {
        let mut store = TrendStore::new();
        let config = default_config();

        store.push_sample(1, 100, 10.0, &config);
        store.push_sample(2, 200, 20.0, &config);
        store.push_sample(3, 300, 30.0, &config);

        let active: HashSet<u32> = [1, 3].into_iter().collect();
        store.remove_stale(&active);

        assert!(store.get_memory_trend(1).is_some());
        assert!(store.get_memory_trend(2).is_none());
        assert!(store.get_memory_trend(3).is_some());
        assert!(store.get_cpu_trend(2).is_none());
    }

    #[test]
    fn test_remove_stale_empty_active_set_removes_all() {
        let mut store = TrendStore::new();
        let config = default_config();

        store.push_sample(1, 100, 10.0, &config);
        store.push_sample(2, 200, 20.0, &config);

        let active: HashSet<u32> = HashSet::new();
        store.remove_stale(&active);

        assert!(store.get_memory_trend(1).is_none());
        assert!(store.get_memory_trend(2).is_none());
    }

    #[test]
    fn test_remove_stale_on_empty_store_is_noop() {
        let mut store = TrendStore::new();
        let active: HashSet<u32> = [1, 2].into_iter().collect();
        store.remove_stale(&active);
        // No panic, nothing to remove
    }

    #[test]
    fn test_default_trait() {
        let store = TrendStore::default();
        assert!(store.get_memory_trend(1).is_none());
    }
}
