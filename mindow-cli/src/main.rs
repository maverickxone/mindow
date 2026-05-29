mod renderer;

use clap::{Parser, Subcommand, ValueEnum};
use mindow_core::collector::{Collect, SysinfoCollector};
use mindow_core::config::{validate_config, RawConfig};
use mindow_core::filter::filter_snapshot;
use mindow_core::rule_engine::RuleEngine;

#[derive(Parser)]
#[command(name = "mindow", version = "0.5.0", about = "Windows system resource analyzer")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Number of top processes to display (default: 10)
    #[arg(long, global = true)]
    top: Option<usize>,

    /// Sampling interval in seconds for watch mode (default: 10)
    #[arg(long, global = true)]
    interval: Option<u64>,

    /// CPU threshold percentage for high CPU detection (default: 80)
    #[arg(long, global = true)]
    cpu_threshold: Option<f32>,

    /// Number of consecutive memory samples for leak detection (default: 5)
    #[arg(long, global = true)]
    mem_samples: Option<usize>,

    /// Number of consecutive CPU samples for high CPU detection (default: 5)
    #[arg(long, global = true)]
    cpu_samples: Option<usize>,

    /// Sort processes by field (default: mem)
    #[arg(long, global = true, default_value = "mem")]
    sort: SortField,

    /// Disable colored output
    #[arg(long, global = true)]
    no_color: bool,

    /// Show all processes (don't filter to top-N only)
    #[arg(long, global = true)]
    all: bool,
}

#[derive(Clone, ValueEnum)]
enum SortField {
    Mem,
    Cpu,
    Name,
    Pid,
}

#[derive(Subcommand)]
enum Commands {
    /// Take a one-time snapshot of system health
    Status,
    /// Continuously monitor system over time
    Watch,
    /// Update mindow to the latest version from source
    Update,
}

fn main() {
    // Set Windows console to UTF-8 to avoid garbled output
    renderer::setup_console();

    let cli = Cli::parse();

    // Disable colors if requested
    if cli.no_color {
        colored::control::set_override(false);
    }

    // If --all is passed, override top_n to a very large number
    let top_n = if cli.all { Some(500) } else { cli.top };

    // Build RawConfig from parsed CLI arguments
    let raw = RawConfig {
        top_n,
        interval_secs: cli.interval,
        cpu_threshold: cli.cpu_threshold,
        mem_samples: cli.mem_samples,
        cpu_samples: cli.cpu_samples,
    };

    // Validate configuration, falling back to defaults for invalid values
    let result = validate_config(raw);

    // Print any validation warnings to stderr
    for warning in &result.warnings {
        eprintln!("Warning: {}", warning);
    }

    let config = result.config;
    let sort_field = cli.sort;

    // Dispatch to the appropriate command
    match cli.command {
        Commands::Status => {
            use std::thread;
            use std::time::Duration;

            // 1. Create collector — initial refresh seeds CPU baseline
            let mut collector = SysinfoCollector::new();

            // 2. Wait briefly so the second refresh produces accurate CPU delta
            thread::sleep(Duration::from_millis(500));

            // 3. Collect real data (second refresh gives accurate CPU %)
            let processes = collector.collect_processes();
            let system = collector.collect_system();

            // 4. Filter the processes
            let snapshot = filter_snapshot(&processes, &config);

            // 5. Group same-name processes (like Task Manager does)
            let mut grouped = group_processes(&snapshot);

            // 6. Sort grouped processes
            sort_grouped(&mut grouped, &sort_field);

            // 7. Evaluate rules (single cycle, so trend-based rules won't fire)
            let mut engine = RuleEngine::new(config);
            let alerts = engine.evaluate(&snapshot, &system);

            // 8. Render output
            renderer::render_status(&system, &grouped, &alerts);
        }
        Commands::Watch => {
            use std::sync::atomic::{AtomicBool, Ordering};
            use std::sync::Arc;
            use std::thread;
            use std::time::{Duration, Instant};

            // Set up Ctrl+C handler
            let running = Arc::new(AtomicBool::new(true));
            let r = running.clone();
            ctrlc::set_handler(move || {
                r.store(false, Ordering::SeqCst);
            })
            .expect("Error setting Ctrl-C handler");

            let mut collector = SysinfoCollector::new();
            let mut engine = RuleEngine::new(config.clone());
            let start = Instant::now();
            let mut sample_number: u64 = 0;

            while running.load(Ordering::SeqCst) {
                sample_number += 1;

                // Collect
                let processes = collector.collect_processes();
                let system = collector.collect_system();

                // Filter
                let snapshot = filter_snapshot(&processes, &config);

                // Group same-name processes
                let mut grouped = group_processes(&snapshot);

                // Sort
                sort_grouped(&mut grouped, &sort_field);

                // Evaluate (RuleEngine accumulates trend data across iterations)
                let alerts = engine.evaluate(&snapshot, &system);

                // Clear screen for fresh frame
                print!("\x1B[2J\x1B[1;1H");

                // Render with sample number and elapsed time
                let elapsed = start.elapsed();
                renderer::render_watch_frame(&system, &grouped, &alerts, sample_number, elapsed);

                // Sleep until next interval (or break if Ctrl+C pressed during sleep)
                let cycle_elapsed = start.elapsed();
                let next_wake = Duration::from_secs(config.interval_secs * sample_number);
                if let Some(sleep_duration) = next_wake.checked_sub(cycle_elapsed) {
                    // Sleep in small increments to check for Ctrl+C
                    let sleep_step = Duration::from_millis(100);
                    let mut remaining = sleep_duration;
                    while remaining > Duration::ZERO && running.load(Ordering::SeqCst) {
                        let step = remaining.min(sleep_step);
                        thread::sleep(step);
                        remaining = remaining.saturating_sub(step);
                    }
                }
            }

            println!("\nWatch mode stopped.");
        }
        Commands::Update => {
            use std::process::Command;
            println!("Updating mindow...");
            let source_dir = env!("CARGO_MANIFEST_DIR");
            let parent = std::path::Path::new(source_dir).parent().unwrap_or(std::path::Path::new("."));
            let status = Command::new("cargo")
                .args(["install", "--path", "mindow-cli", "--force"])
                .current_dir(parent)
                .status();
            match status {
                Ok(s) if s.success() => println!("mindow updated successfully."),
                Ok(s) => eprintln!("Update failed with exit code: {}", s),
                Err(e) => eprintln!("Failed to run cargo: {}", e),
            }
        }
    }
}

/// A grouped process entry — merges all same-name processes.
pub struct GroupedProcess {
    pub name: String,
    pub count: usize,
    pub total_cpu: f32,
    pub total_memory: u64,
    pub path_status: mindow_core::types::PathStatus,
}

/// Group same-name processes, summing CPU and memory.
fn group_processes(snapshot: &mindow_core::types::FilteredSnapshot) -> Vec<GroupedProcess> {
    use std::collections::HashMap;
    use mindow_core::types::PathStatus;

    let mut groups: HashMap<String, GroupedProcess> = HashMap::new();

    for proc in &snapshot.processes {
        // Strip .exe suffix for grouping (case-insensitive)
        let key = proc.sample.name.to_lowercase();

        let entry = groups.entry(key).or_insert_with(|| GroupedProcess {
            name: proc.sample.name.clone(),
            count: 0,
            total_cpu: 0.0,
            total_memory: 0,
            path_status: proc.path_status.clone(),
        });

        entry.count += 1;
        entry.total_cpu += proc.sample.cpu_percent;
        entry.total_memory += proc.sample.memory_bytes;

        // Use the "worst" path status
        if proc.path_status == PathStatus::Suspicious {
            entry.path_status = PathStatus::Suspicious;
        }
    }

    groups.into_values().collect()
}

/// Sort grouped processes by the given field.
fn sort_grouped(grouped: &mut Vec<GroupedProcess>, field: &SortField) {
    match field {
        SortField::Mem => {
            grouped.sort_by(|a, b| b.total_memory.cmp(&a.total_memory));
        }
        SortField::Cpu => {
            grouped.sort_by(|a, b| {
                b.total_cpu.partial_cmp(&a.total_cpu)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        SortField::Name => {
            grouped.sort_by(|a, b| {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            });
        }
        SortField::Pid => {
            // For grouped, sort by memory as fallback
            grouped.sort_by(|a, b| b.total_memory.cmp(&a.total_memory));
        }
    }
}
