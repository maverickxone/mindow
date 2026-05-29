// System and process data collection via sysinfo and battery crates

use crate::types::{BatteryStatus, ChargingState, ProcessSample, SystemSample};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// Trait for collecting system and process data.
pub trait Collect {
    /// Collect metrics for all running processes.
    /// Processes that have terminated or whose data is unavailable are skipped gracefully.
    fn collect_processes(&mut self) -> Vec<ProcessSample>;

    /// Collect system-level metrics: memory, CPU, and battery status.
    fn collect_system(&mut self) -> SystemSample;
}

/// Collector implementation backed by the `sysinfo` and `battery` crates.
pub struct SysinfoCollector {
    system: System,
}

impl SysinfoCollector {
    /// Creates a new `SysinfoCollector` with an initial full system refresh.
    pub fn new() -> Self {
        let mut system = System::new_all();
        // Perform an initial refresh to populate process and CPU data.
        // CPU usage requires at least two measurements to be accurate,
        // but the first call seeds the baseline.
        system.refresh_all();
        Self { system }
    }
}

impl Default for SysinfoCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl Collect for SysinfoCollector {
    fn collect_processes(&mut self) -> Vec<ProcessSample> {
        // Refresh process data: memory, CPU, disk usage, and exe path.
        // The `true` flag removes dead processes from the internal map.
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::everything(),
        );

        let mut samples = Vec::new();

        for (_pid, process) in self.system.processes() {
            // Build a ProcessSample for each live process.
            // If any field is unavailable, use graceful defaults.
            let name = process.name().to_string_lossy().to_string();
            let pid = process.pid().as_u32();
            let cpu_percent = process.cpu_usage();
            let memory_bytes = process.memory();
            let disk_usage = process.disk_usage();
            let disk_read_bytes = disk_usage.total_read_bytes;
            let disk_write_bytes = disk_usage.total_written_bytes;
            let exe_path = process.exe().map(|p| p.to_string_lossy().to_string());
            let start_time = process.start_time();
            let parent_pid = process.parent().map(|p| p.as_u32());

            samples.push(ProcessSample {
                name,
                pid,
                cpu_percent,
                memory_bytes,
                disk_read_bytes,
                disk_write_bytes,
                exe_path,
                start_time,
                parent_pid,
            });
        }

        samples
    }

    fn collect_system(&mut self) -> SystemSample {
        // Refresh memory and CPU data
        self.system.refresh_memory();
        self.system.refresh_cpu_usage();

        let total_memory = self.system.total_memory();
        let used_memory = self.system.used_memory();

        // Gather per-core CPU usage
        let per_core_cpu: Vec<f32> = self.system.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();

        // Collect battery status separately via the battery crate
        let battery = collect_battery_status();

        SystemSample {
            total_memory,
            used_memory,
            per_core_cpu,
            battery,
        }
    }
}

/// Collects battery status using the `battery` crate.
/// Returns `BatteryStatus::Unavailable` if no battery hardware is found or if an error occurs.
fn collect_battery_status() -> BatteryStatus {
    let manager = match battery::Manager::new() {
        Ok(m) => m,
        Err(_) => return BatteryStatus::Unavailable,
    };

    let mut batteries = match manager.batteries() {
        Ok(b) => b,
        Err(_) => return BatteryStatus::Unavailable,
    };

    // Use the first battery found
    match batteries.next() {
        Some(Ok(bat)) => {
            let level = bat.state_of_charge().get::<battery::units::ratio::percent>();
            let charging = map_battery_state(bat.state());
            BatteryStatus::Available { level, charging }
        }
        Some(Err(_)) => BatteryStatus::Unavailable,
        None => BatteryStatus::Unavailable,
    }
}

/// Maps the battery crate's `State` enum to our `ChargingState`.
fn map_battery_state(state: battery::State) -> ChargingState {
    match state {
        battery::State::Charging => ChargingState::Charging,
        battery::State::Discharging => ChargingState::Discharging,
        battery::State::Full => ChargingState::Full,
        _ => ChargingState::Unknown,
    }
}
