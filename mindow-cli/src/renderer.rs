use std::time::Duration;

use colored::Colorize;
use mindow_core::types::{
    Alert, AlertSeverity, BatteryStatus, ChargingState, PathStatus, SystemSample,
};

use crate::GroupedProcess;

const WIDTH: usize = 60;
const BAR_WIDTH: usize = 25;

// ==================== PUBLIC API ====================

pub fn render_status(system: &SystemSample, grouped: &[GroupedProcess], alerts: &[Alert]) {
    println!();
    render_system(system);
    println!();
    render_processes(grouped);
    println!();
    render_alerts(alerts);
    println!();
}

pub fn render_watch_frame(
    system: &SystemSample,
    grouped: &[GroupedProcess],
    alerts: &[Alert],
    sample_number: u64,
    elapsed: Duration,
) {
    let mins = elapsed.as_secs() / 60;
    let secs = elapsed.as_secs() % 60;
    println!(
        "  {}",
        format!("MINDOW v{}  |  Sample #{}  |  {}m {}s",
            env!("CARGO_PKG_VERSION"), sample_number, mins, secs)
            .bold().cyan()
    );
    render_status(system, grouped, alerts);
}

// ==================== SYSTEM ====================

fn render_system(system: &SystemSample) {
    println!("{}", "=".repeat(WIDTH).dimmed());
    println!("  {}", "SYSTEM".bold().cyan());
    println!("{}", "-".repeat(WIDTH).dimmed());

    let avg_cpu = if system.per_core_cpu.is_empty() { 0.0 }
    else { system.per_core_cpu.iter().sum::<f32>() / system.per_core_cpu.len() as f32 };

    let mem_pct = if system.total_memory == 0 { 0.0 }
    else { (system.used_memory as f64 / system.total_memory as f64) * 100.0 };
    let mem_used = system.used_memory as f64 / (1024.0 * 1024.0 * 1024.0);
    let mem_total = system.total_memory as f64 / (1024.0 * 1024.0 * 1024.0);

    // CPU
    let cpu_bar = bar_high_bad(avg_cpu as f64, 100.0);
    let cpu_val = color_high_bad(avg_cpu, &format!("{:.1}%", avg_cpu));
    println!("  {}     {}  {}", "CPU:".bright_white().bold(), cpu_bar, cpu_val);

    // Memory
    let mem_bar = bar_high_bad(mem_pct, 100.0);
    let mem_val = color_high_bad(mem_pct as f32, &format!("{:.1}% ({:.1}/{:.1} GB)", mem_pct, mem_used, mem_total));
    println!("  {}  {}  {}", "Memory:".bright_white().bold(), mem_bar, mem_val);

    // Battery
    match &system.battery {
        BatteryStatus::Available { level, charging } => {
            let state = match charging {
                ChargingState::Charging => "Charging",
                ChargingState::Discharging => "Discharging",
                ChargingState::Full => "Full",
                ChargingState::Unknown => "Unknown",
            };
            let bat_bar = bar_high_good(*level as f64, 100.0);
            let bat_val = color_high_good(*level, &format!("{:.0}% ({})", level, state));
            println!("  {} {}  {}", "Battery:".bright_white().bold(), bat_bar, bat_val);
        }
        BatteryStatus::Unavailable => {
            println!("  {} {}", "Battery:".bright_white().bold(), "N/A".dimmed());
        }
    }
    println!("{}", "=".repeat(WIDTH).dimmed());
}

// ==================== PROCESSES ====================

fn render_processes(grouped: &[GroupedProcess]) {
    println!("{}", "=".repeat(WIDTH).dimmed());
    println!("  {}", "PROCESSES".bold().cyan());
    println!("{}", "-".repeat(WIDTH).dimmed());

    // Header
    println!(
        "  {:<28} {:>7} {:>9}  {}",
        "NAME".bold().cyan(), "CPU%".bold().cyan(), "MEMORY".bold().cyan(), "ST".bold().cyan()
    );
    println!("  {}", "-".repeat(WIDTH - 4));

    for (i, proc) in grouped.iter().enumerate() {
        let display_name = if proc.count > 1 {
            format!("{} ({})", truncate_name(&proc.name, 22), proc.count)
        } else {
            truncate_name(&proc.name, 28)
        };

        let cpu = proc.total_cpu;
        let mem = proc.total_memory;

        // Pad BEFORE coloring (critical for alignment)
        let name_pad = format!("{:<28}", display_name);
        let cpu_pad = format!("{:>6.1}%", cpu);
        let mem_pad = format!("{:>9}", format_memory(mem));

        // Color name by path status
        let name_c = match proc.path_status {
            PathStatus::System => name_pad.cyan().to_string(),
            PathStatus::User => name_pad.bright_white().to_string(),
            PathStatus::Unknown => name_pad.yellow().to_string(),
        };

        // Color CPU by intensity
        let cpu_c = if cpu > 80.0 { cpu_pad.red().bold().to_string() }
            else if cpu > 40.0 { cpu_pad.yellow().to_string() }
            else if cpu > 10.0 { cpu_pad.white().to_string() }
            else { cpu_pad.green().to_string() };

        // Color memory by size
        let mem_c = if mem > 1_000_000_000 { mem_pad.red().bold().to_string() }
            else if mem > 500_000_000 { mem_pad.yellow().to_string() }
            else if mem > 200_000_000 { mem_pad.white().to_string() }
            else { mem_pad.green().to_string() };

        // Status tag
        let st = match proc.path_status {
            PathStatus::System => "[S]".cyan().to_string(),
            PathStatus::User => "[U]".bright_white().to_string(),
            PathStatus::Unknown => "[?]".yellow().to_string(),
        };

        println!("  {} {} {}  {}", name_c, cpu_c, mem_c, st);

        // Separator every 5 rows
        if (i + 1) % 5 == 0 && i + 1 < grouped.len() {
            println!("  {}", ".".repeat(WIDTH - 4).dimmed().dimmed());
        }
    }
    println!("{}", "=".repeat(WIDTH).dimmed());
}

// ==================== ALERTS ====================

fn render_alerts(alerts: &[Alert]) {
    if alerts.is_empty() {
        println!("  {}", "[OK] System appears healthy".green().bold());
        return;
    }

    println!("{}", "=".repeat(WIDTH).dimmed());
    println!("  {}", format!("ALERTS ({})", alerts.len()).bold().red());
    println!("{}", "-".repeat(WIDTH).dimmed());

    for alert in alerts {
        let msg = format_alert(alert);
        match alert.severity() {
            AlertSeverity::Critical => {
                for line in msg.lines() {
                    println!("  {}", line.red().bold());
                }
            }
            AlertSeverity::Warning => {
                for line in msg.lines() {
                    println!("  {}", line.yellow());
                }
            }
        }
    }
    println!("{}", "=".repeat(WIDTH).dimmed());
}

// ==================== BAR HELPERS ====================

fn bar_high_bad(value: f64, max: f64) -> String {
    let ratio = (value / max).clamp(0.0, 1.0);
    let filled = (ratio * BAR_WIDTH as f64).round() as usize;
    let empty = BAR_WIDTH - filled;
    let bar = format!("[{}{}]", "#".repeat(filled), ".".repeat(empty));
    let pct = (ratio * 100.0) as f32;
    if pct > 85.0 { bar.red().to_string() }
    else if pct > 60.0 { bar.yellow().to_string() }
    else { bar.green().to_string() }
}

fn bar_high_good(value: f64, max: f64) -> String {
    let ratio = (value / max).clamp(0.0, 1.0);
    let filled = (ratio * BAR_WIDTH as f64).round() as usize;
    let empty = BAR_WIDTH - filled;
    let bar = format!("[{}{}]", "#".repeat(filled), ".".repeat(empty));
    let pct = (ratio * 100.0) as f32;
    if pct < 20.0 { bar.red().to_string() }
    else if pct < 50.0 { bar.yellow().to_string() }
    else { bar.green().to_string() }
}

fn color_high_bad(pct: f32, text: &str) -> String {
    if pct > 85.0 { text.red().bold().to_string() }
    else if pct > 60.0 { text.yellow().to_string() }
    else { text.green().to_string() }
}

fn color_high_good(level: f32, text: &str) -> String {
    if level < 20.0 { text.red().bold().to_string() }
    else if level < 50.0 { text.yellow().to_string() }
    else { text.green().to_string() }
}

// ==================== FORMAT HELPERS ====================

fn format_alert(alert: &Alert) -> String {
    match alert {
        Alert::MemoryPressure { used_percent, candidates } => {
            let mut msg = format!("[!!] Memory Pressure: {:.1}% used", used_percent);
            for c in candidates.iter().take(5) {
                msg.push_str(&format!("\n       - {} ({})", c.name, format_memory(c.memory_bytes)));
            }
            msg
        }
        Alert::HighCpu { process_name, pid, average_cpu, duration_secs } => {
            format!("[!!] High CPU: {} (PID {}) avg {:.1}% for {}s", process_name, pid, average_cpu, duration_secs)
        }
        Alert::MemoryLeak { process_name, pid, start_memory, current_memory, consecutive_samples } => {
            format!("[..] Mem Leak: {} (PID {}) {} -> {} ({} samples)",
                process_name, pid, format_memory(*start_memory), format_memory(*current_memory), consecutive_samples)
        }
        Alert::BatteryWarning { battery_level, offending_processes } => {
            let mut msg = format!("[..] Battery Low: {:.0}%", battery_level);
            for p in offending_processes.iter().take(3) {
                msg.push_str(&format!("\n       - {} (CPU {:.1}%)", p.name, p.cpu_percent));
            }
            msg
        }
    }
}

fn truncate_name(name: &str, max_len: usize) -> String {
    if name.len() <= max_len { name.to_string() }
    else { format!("{}...", &name[..max_len.saturating_sub(3)]) }
}

fn format_memory(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 { format!("{:.1} GB", mb / 1024.0) }
    else if mb >= 100.0 { format!("{:.0} MB", mb) }
    else { format!("{:.1} MB", mb) }
}

// ==================== CONSOLE SETUP ====================

#[cfg(windows)]
pub fn setup_console() {
    unsafe {
        extern "system" { fn SetConsoleOutputCP(cp: u32) -> i32; }
        SetConsoleOutputCP(65001);
    }
}
#[cfg(not(windows))]
pub fn setup_console() {}

// ==================== TESTS ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_memory() {
        assert_eq!(format_memory(50 * 1024 * 1024), "50.0 MB");
        assert_eq!(format_memory(500 * 1024 * 1024), "500 MB");
        assert_eq!(format_memory(2 * 1024 * 1024 * 1024), "2.0 GB");
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate_name("chrome", 20), "chrome");
        let r = truncate_name("very_long_process_name_here", 20);
        assert!(r.len() <= 20);
        assert!(r.ends_with("..."));
    }

    #[test]
    fn test_bar() {
        let e = bar_high_bad(0.0, 100.0);
        assert!(e.contains("[........................."));
        let f = bar_high_bad(100.0, 100.0);
        assert!(f.contains("[#########################"));
    }
}
