mod ai;
mod renderer;

use clap::{Parser, Subcommand, ValueEnum};
use mindow_core::collector::{Collect, SysinfoCollector};
use mindow_core::config::{validate_config, RawConfig};
use mindow_core::filter::filter_snapshot;
use mindow_core::rule_engine::RuleEngine;

#[derive(Parser)]
#[command(name = "mindow", version = "1.0.0", about = "Windows system resource analyzer")]
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
    /// AI 分析报告
    Report {
        /// 报告语言: cn | en
        #[arg(long)]
        lang: Option<String>,
    },
    /// 配置管理
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Update mindow to the latest version from source
    Update,
}

#[derive(Subcommand)]
enum ConfigAction {
    /// 设置配置项: mindow config set <key> <value>
    Set {
        /// 配置字段名 (provider, model, api_key, base_url, language)
        key: String,
        /// 配置值
        value: String,
    },
    /// 显示当前配置
    Show,
    /// 交互式初始化配置
    Init,
}

#[tokio::main]
async fn main() {
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
        Commands::Report { lang } => {
            use std::io::{self, Write};
            use std::thread;
            use std::time::Duration;
            use ai::client::{AiClient, AiClientConfig, AiError, Provider, StreamCallback};

            // 1. Load config
            let ai_config = match ai::config::load_config() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error: {}\nHint: Run `mindow config init` to set up.", e);
                    return;
                }
            };

            // 2. Check API key
            if ai_config.api_key.is_empty() {
                eprintln!("Error: API 密钥未配置");
                eprintln!("Hint:  运行 `mindow config set api_key <your-key>` 设置密钥");
                return;
            }

            // 3. Determine language
            let language = lang.unwrap_or(ai_config.language.clone());

            // 4. Collect system data
            let mut collector = SysinfoCollector::new();
            thread::sleep(Duration::from_millis(500));
            let processes = collector.collect_processes();
            let system = collector.collect_system();

            // 5. Filter and evaluate
            let snapshot = filter_snapshot(&processes, &config);
            let mut engine = RuleEngine::new(config.clone());
            let alerts = engine.evaluate(&snapshot, &system);

            // 6. Build prompts
            let system_prompt = ai::prompt::build_system_prompt(&language);
            let user_prompt = ai::prompt::build_user_prompt(&system, &snapshot, &alerts);

            // 7. Build report header
            let header = ai::report::build_report_header(&system, &alerts);

            // 8. Create AI client
            let provider = if ai_config.provider == "claude" {
                Provider::Claude
            } else {
                Provider::OpenAI
            };

            let client_config = AiClientConfig {
                provider: provider.clone(),
                model: ai_config.model.clone(),
                api_key: ai_config.api_key.clone(),
                base_url: ai_config.base_url.clone(),
                timeout_secs: 30,
            };

            // 9. Create stream callback
            struct ReportCallback {
                accumulated: String,
            }
            impl StreamCallback for ReportCallback {
                fn on_delta(&mut self, text: &str) {
                    print!("{}", text);
                    io::stdout().flush().ok();
                    self.accumulated.push_str(text);
                }
                fn on_complete(&mut self) {
                    println!();
                }
                fn on_error(&mut self, error: &AiError) {
                    eprintln!("\nError: {}", error);
                }
            }

            let mut callback = ReportCallback { accumulated: String::new() };

            println!("\nAnalyzing system... (streaming from {})\n", ai_config.provider);

            // 10. Call AI
            let result = match provider {
                Provider::OpenAI => {
                    let client = ai::client::OpenAiClient::new(client_config);
                    client.stream_completion(&system_prompt, &user_prompt, &mut callback).await
                }
                Provider::Claude => {
                    let client = ai::client::ClaudeClient::new(client_config);
                    client.stream_completion(&system_prompt, &user_prompt, &mut callback).await
                }
            };

            // 11. Save report
            match result {
                Ok(()) => {
                    match ai::report::save_report(&header, &callback.accumulated) {
                        Ok(path) => println!("\nReport saved to: {}", path.display()),
                        Err(e) => eprintln!("\nWarning: Failed to save report: {}", e),
                    }
                }
                Err(AiError::StreamInterrupted { ref partial_content }) => {
                    eprintln!("\nStream interrupted. Saving partial report...");
                    match ai::report::save_partial_report(&header, partial_content) {
                        Ok(path) => println!("Partial report saved to: {}", path.display()),
                        Err(e) => eprintln!("Failed to save partial report: {}", e),
                    }
                }
                Err(e) => {
                    eprintln!("\nError: {}", e);
                }
            }
        }
        Commands::Config { action } => {
            match action {
                ConfigAction::Set { key, value } => {
                    match ai::config::set_config_field(&key, &value) {
                        Ok(()) => println!("Config updated: {} = {}", key, value),
                        Err(e) => eprintln!("Error: {}", e),
                    }
                }
                ConfigAction::Show => {
                    match ai::config::load_config() {
                        Ok(config) => {
                            println!("  provider:  {}", config.provider);
                            println!("  model:     {}", if config.model.is_empty() { "(not set)".to_string() } else { config.model });
                            println!("  api_key:   {}", if config.api_key.is_empty() { "(not set)".to_string() } else { ai::config::mask_api_key(&config.api_key) });
                            println!("  base_url:  {}", config.base_url);
                            println!("  language:  {}", config.language);
                        }
                        Err(e) => eprintln!("Error loading config: {}", e),
                    }
                }
                ConfigAction::Init => {
                    use std::io::{self, Write, BufRead};
                    let stdin = io::stdin();
                    let mut stdout = io::stdout();

                    println!("Mindow Configuration Setup");
                    println!("==========================\n");

                    print!("Provider (openai/claude) [openai]: ");
                    stdout.flush().unwrap();
                    let mut provider = String::new();
                    stdin.lock().read_line(&mut provider).unwrap();
                    let provider = provider.trim();
                    let provider = if provider.is_empty() { "openai" } else { provider };

                    print!("API Key: ");
                    stdout.flush().unwrap();
                    let mut api_key = String::new();
                    stdin.lock().read_line(&mut api_key).unwrap();
                    let api_key = api_key.trim().to_string();

                    let default_model = if provider == "claude" { "claude-sonnet-4-20250514" } else { "gpt-4o-mini" };
                    print!("Model [{}]: ", default_model);
                    stdout.flush().unwrap();
                    let mut model = String::new();
                    stdin.lock().read_line(&mut model).unwrap();
                    let model = if model.trim().is_empty() { default_model.to_string() } else { model.trim().to_string() };

                    let default_url = if provider == "claude" { "https://api.anthropic.com" } else { "https://api.openai.com" };
                    print!("Base URL [{}]: ", default_url);
                    stdout.flush().unwrap();
                    let mut base_url = String::new();
                    stdin.lock().read_line(&mut base_url).unwrap();
                    let base_url = if base_url.trim().is_empty() { default_url.to_string() } else { base_url.trim().to_string() };

                    print!("Language (cn/en) [cn]: ");
                    stdout.flush().unwrap();
                    let mut language = String::new();
                    stdin.lock().read_line(&mut language).unwrap();
                    let language = if language.trim().is_empty() { "cn".to_string() } else { language.trim().to_string() };

                    let ai_cfg = ai::config::AiConfig {
                        provider: provider.to_string(),
                        model,
                        api_key,
                        base_url,
                        language,
                    };

                    match ai::config::save_config(&ai_cfg) {
                        Ok(()) => {
                            println!("\nConfig saved to: {:?}", ai::config::config_path());
                            println!("Done! Run `mindow report` to generate an AI analysis.");
                        }
                        Err(e) => eprintln!("Error saving config: {}", e),
                    }
                }
            }
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
