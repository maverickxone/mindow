use colored::Colorize;
use rustyline::error::ReadlineError;
use rustyline::DefaultEditor;

use mindow_ai as ai;
use mindow_core::collector::{Collect, SysinfoCollector};
use mindow_core::config::{validate_config, RawConfig};
use mindow_core::filter::filter_snapshot;
use mindow_core::rule_engine::RuleEngine;

pub async fn run_interactive() {
    // Welcome banner
    println!();
    println!("{}", "=".repeat(60).dimmed());
    println!();
    println!("  {}  {}", "Mindow".bold().cyan(), format!("v{}", env!("CARGO_PKG_VERSION")).dimmed());
    println!("  {}", "Windows System Resource Analyzer + AI".dimmed());
    println!();
    println!("  {}  {}",
        "/help for commands".cyan(),
        "Ctrl+C twice to exit".dimmed()
    );
    println!();
    println!("{}", "=".repeat(60).dimmed());
    println!();

    let mut rl = match DefaultEditor::new() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to initialize readline: {}", e);
            return;
        }
    };

    // Load history
    let history_path = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".mindow")
        .join("history.txt");
    let _ = rl.load_history(&history_path);

    let mut ctrl_c_count = 0u8;

    loop {
        // Plain prompt — no ANSI codes to avoid rustyline width miscalculation
        let readline = rl.readline("> ");

        match readline {
            Ok(line) => {
                ctrl_c_count = 0; // reset on valid input
                let input = line.trim().to_string();
                if input.is_empty() {
                    continue;
                }
                let _ = rl.add_history_entry(&input);

                if input == "/" || input == "/help" || input == "/h" || input == "/?" {
                    // Show command selector
                    let should_quit = show_command_selector().await;
                    if should_quit {
                        break;
                    }
                } else if input.starts_with('/') {
                    let should_quit = handle_slash_command(&input).await;
                    if should_quit {
                        break;
                    }
                } else {
                    // Free text -> AI question
                    handle_free_text(&input).await;
                }
            }
            Err(ReadlineError::Interrupted) => {
                ctrl_c_count += 1;
                if ctrl_c_count >= 2 {
                    break;
                }
                println!("  {}", "Press Ctrl+C again to exit.".dimmed());
                // Immediately wait for next input without showing a new prompt
                match rl.readline("") {
                    Err(ReadlineError::Interrupted) | Err(ReadlineError::Eof) => break,
                    _ => { ctrl_c_count = 0; }
                }
            }
            Err(ReadlineError::Eof) => {
                break;
            }
            Err(err) => {
                eprintln!("Error: {:?}", err);
                break;
            }
        }
    }

    // Save history
    if let Some(parent) = history_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = rl.save_history(&history_path);

    println!("{}", "Goodbye.".dimmed());
}

/// Show interactive command selector — displays usage info for selected command
async fn show_command_selector() -> bool {
    use dialoguer::{Select, theme::ColorfulTheme};

    let commands = vec![
        "/status      - System snapshot",
        "/search      - Analyze a process",
        "/report      - AI system report",
        "/config      - View/edit config",
        "/baseline    - View baselines",
        "/knowledge   - View knowledge base",
        "/clear       - Clear screen",
        "/quit        - Exit",
    ];

    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Select command for usage info")
        .items(&commands)
        .default(0)
        .interact_opt();

    match selection {
        Ok(Some(idx)) => {
            println!();
            match idx {
                0 => {
                    println!("{}", "+-- /status --------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "Show system resource snapshot".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/status");
                    println!("{}    {}", "|".cyan(), "/s".dimmed());
                    println!("{}", "+-------------------------------------------+".cyan());
                }
                1 => {
                    println!("{}", "+-- /search --------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "Analyze a process with AI".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/search <name>           Search by name");
                    println!("{}    {}", "|".cyan(), "/search <PID>            Search by PID");
                    println!("{}    {}", "|".cyan(), "/search <name> --refresh  Re-query AI (skip cache)");
                    println!("{}  {}", "|".cyan(), "Examples:".bold());
                    println!("{}    {}  {}  {}", "|".cyan(), "/search chrome", " ", "/search kiro --refresh".dimmed());
                    println!("{}", "+-------------------------------------------+".cyan());
                }
                2 => {
                    println!("{}", "+-- /report --------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "Generate AI system analysis report".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/report              Full AI report (streaming)");
                    println!("{}  {}", "|".cyan(), "Report saved to ~/.mindow/reports/".dimmed());
                    println!("{}", "+-------------------------------------------+".cyan());
                }
                3 => {
                    println!("{}", "+-- /config ---------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "View or edit AI configuration".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/config               Show current config");
                    println!("{}    {}", "|".cyan(), "/config set <key> <value>  Set a field");
                    println!("{}  {}", "|".cyan(), "Keys:".bold());
                    println!("{}    {}", "|".cyan(), "provider, model, api_key, base_url, language");
                    println!("{}  {}", "|".cyan(), "Examples:".bold());
                    println!("{}    {}", "|".cyan(), "/config set language cn");
                    println!("{}    {}", "|".cyan(), "/config set model deepseek-v4-pro");
                    println!("{}", "+--------------------------------------------+".cyan());
                }
                4 => {
                    println!("{}", "+-- /baseline -------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "View learned process baselines".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/baseline            Show top 20 by memory");
                    println!("{}    {}  {}", "|".cyan(), "/b", "              (shortcut)".dimmed());
                    println!("{}  {}", "|".cyan(), "Baselines auto-update on /status".dimmed());
                    println!("{}", "+--------------------------------------------+".cyan());
                }
                5 => {
                    println!("{}", "+-- /knowledge -----------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "View cached AI process knowledge".bright_white());
                    println!("{}  {}", "|".cyan(), "Usage:".bold());
                    println!("{}    {}", "|".cyan(), "/knowledge           Show all cached entries");
                    println!("{}    {}  {}", "|".cyan(), "/k", "              (shortcut)".dimmed());
                    println!("{}  {}", "|".cyan(), "Clear with: mindow knowledge clear".dimmed());
                    println!("{}", "+--------------------------------------------+".cyan());
                }
                6 => {
                    println!("{}", "+-- /clear ----------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "Clear the terminal screen".bright_white());
                    println!("{}    {}", "|".cyan(), "/clear    /cls");
                    println!("{}", "+--------------------------------------------+".cyan());
                }
                7 => {
                    println!("{}", "+-- /quit -----------------------------------+".cyan());
                    println!("{}  {}", "|".cyan(), "Exit interactive mode".bright_white());
                    println!("{}    {}", "|".cyan(), "/quit   /exit   /q   Ctrl+C x2");
                    println!("{}", "+--------------------------------------------+".cyan());
                }
                _ => {}
            }
            println!();
        }
        Ok(None) | Err(_) => {}
    }
    false
}

/// Handle slash commands. Returns true if should quit.
async fn handle_slash_command(input: &str) -> bool {
    let parts: Vec<&str> = input.splitn(3, ' ').collect();
    let cmd = parts[0];

    match cmd {
        "/quit" | "/exit" | "/q" => return true,

        "/status" | "/s" => {
            run_status().await;
        }

        "/search" => {
            if parts.len() < 2 {
                println!("{}", "Usage: /search <name> [--refresh]".yellow());
            } else {
                let args = parts[1..].join(" ");
                let refresh = args.contains("--refresh");
                let query = args.replace("--refresh", "").trim().to_string();
                if !query.is_empty() {
                    run_search(&query, refresh).await;
                }
            }
        }

        "/report" => {
            run_report().await;
        }

        "/config" => {
            if parts.len() >= 3 && parts[1] == "set" {
                // /config set key value
                let rest: Vec<&str> = input.splitn(4, ' ').collect();
                if rest.len() >= 4 {
                    match ai::config::set_config_field(rest[2], rest[3]) {
                        Ok(()) => println!(
                            "{}",
                            format!("Config updated: {} = {}", rest[2], rest[3]).green()
                        ),
                        Err(e) => println!("{}", format!("Error: {}", e).red()),
                    }
                } else {
                    println!("{}", "Usage: /config set <key> <value>".yellow());
                }
            } else {
                // /config show
                match ai::config::load_config() {
                    Ok(config) => {
                        println!("  {} {}", "provider:".bold(), config.provider);
                        println!(
                            "  {} {}",
                            "model:".bold(),
                            if config.model.is_empty() {
                                "(not set)".to_string()
                            } else {
                                config.model
                            }
                        );
                        println!(
                            "  {} {}",
                            "api_key:".bold(),
                            if config.api_key.is_empty() {
                                "(not set)".to_string()
                            } else {
                                ai::config::mask_api_key(&config.api_key)
                            }
                        );
                        println!("  {} {}", "base_url:".bold(), config.base_url);
                        println!("  {} {}", "language:".bold(), config.language);
                        println!("  {}", "(change with: /config set language cn)".dimmed());
                    }
                    Err(e) => println!("{}", format!("Error: {}", e).red()),
                }
            }
        }

        "/baseline" | "/b" => {
            let baseline_result = ai::baseline::load_baselines();
            if baseline_result.store.entries.is_empty() {
                println!("{}", "No baseline data. Run /status first.".dimmed());
            } else {
                let mut entries: Vec<_> = baseline_result.store.entries.iter().collect();
                entries.sort_by(|a, b| {
                    b.1.avg_memory_mb
                        .partial_cmp(&a.1.avg_memory_mb)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                println!();
                for (name, entry) in entries.iter().take(20) {
                    println!(
                        "  {:<22} Avg: {:>5.0} MB  Max: {:>5.0} MB  CPU: {:>4.1}%",
                        name.white(),
                        entry.avg_memory_mb,
                        entry.max_memory_mb,
                        entry.avg_cpu
                    );
                }
                if entries.len() > 20 {
                    println!(
                        "  {}",
                        format!("... and {} more", entries.len() - 20).dimmed()
                    );
                }
                println!();
            }
        }

        "/knowledge" | "/k" => {
            let kb_result = ai::knowledge::load_knowledge();
            if kb_result.kb.entries.is_empty() {
                println!("{}", "No knowledge cached. Run /search <process> first.".dimmed());
            } else {
                println!();
                let mut entries: Vec<_> = kb_result.kb.entries.iter().collect();
                entries.sort_by_key(|(name, _)| name.to_string());
                for (name, info) in entries {
                    let risk_colored = match info.risk.as_str() {
                        "safe" => "safe".green().bold().to_string(),
                        "caution" => "caution".yellow().bold().to_string(),
                        "suspicious" => "suspicious".red().bold().to_string(),
                        other => other.to_string(),
                    };
                    let header = format!("+-- {} ", name);
                    let border = format!("{}{}+", header, "-".repeat(50usize.saturating_sub(header.len())));
                    println!("{}", border.cyan());
                    println!("{}  {:<12} {}", "|".cyan(), "Type:".bright_white(), info.category.cyan());
                    println!("{}  {:<12} {}", "|".cyan(), "Desc:".bright_white(), info.description);
                    println!("{}  {:<12} {}", "|".cyan(), "Memory:".bright_white(), info.typical_memory);
                    println!("{}  {:<12} {}", "|".cyan(), "Risk:".bright_white(), risk_colored);
                    if !info.advice.is_empty() {
                        println!("{}  {:<12} {}", "|".cyan(), "Advice:".bright_white(), info.advice);
                    }
                    println!("{}  {:<12} {}", "|".cyan(), "Updated:".dimmed(), info.updated.dimmed());
                    println!("{}", format!("+{}+", "-".repeat(49)).cyan());
                    println!();
                }
            }
        }

        "/clear" | "/cls" => {
            print!("\x1B[2J\x1B[1;1H");
            use std::io::Write;
            std::io::stdout().flush().ok();
        }

        _ => {
            println!(
                "{}",
                format!(
                    "Unknown command: {}. Type /help for available commands.",
                    cmd
                )
                .yellow()
            );
        }
    }

    false
}

/// Run status command inline
async fn run_status() {
    use std::thread;
    use std::time::Duration;

    let config = validate_config(RawConfig::default()).config;
    let mut collector = SysinfoCollector::new();
    thread::sleep(Duration::from_millis(500));
    let processes = collector.collect_processes();
    let system = collector.collect_system();
    let snapshot = filter_snapshot(&processes, &config);
    let mut grouped = crate::group_processes(&snapshot);
    crate::sort_grouped(&mut grouped, &crate::SortField::Mem);

    let mut engine = RuleEngine::new(config);
    let alerts = engine.evaluate(&snapshot, &system);

    // Update baselines
    let baseline_result = ai::baseline::load_baselines();
    let mut baseline_store = baseline_result.store;
    for g in &grouped {
        let mem_mb = g.total_memory as f64 / 1024.0 / 1024.0;
        ai::baseline::update_baseline(&mut baseline_store, &g.name, mem_mb, g.total_cpu as f64);
    }
    if baseline_result.writable {
        let _ = ai::baseline::save_baselines(&baseline_store);
    }

    crate::renderer::render_status(&system, &grouped, &alerts);
}

/// Run search command inline
async fn run_search(query: &str, refresh: bool) {
    use std::thread;
    use std::time::Duration;

    use ai::client::{AiClient, AiClientConfig, AiError, Provider, StreamCallback};
    use indicatif::ProgressBar;

    let config = validate_config(RawConfig::default()).config;
    let mut collector = SysinfoCollector::new();
    thread::sleep(Duration::from_millis(500));
    let processes = collector.collect_processes();
    let snapshot = filter_snapshot(&processes, &config);
    let grouped = crate::group_processes(&snapshot);

    // Match query
    let matched_group = grouped
        .iter()
        .find(|g| g.name.to_lowercase().contains(&query.to_lowercase()))
        .or_else(|| {
            if let Ok(pid) = query.parse::<u32>() {
                let proc = processes.iter().find(|p| p.pid == pid);
                proc.and_then(|p| {
                    grouped
                        .iter()
                        .find(|g| g.name.to_lowercase() == p.name.to_lowercase())
                })
            } else {
                None
            }
        });

    let matched_group = match matched_group {
        Some(g) => g,
        None => {
            println!("{}", format!("No matching process: {}", query).yellow());
            return;
        }
    };

    let process_name = &matched_group.name;
    let memory_mb = matched_group.total_memory as f64 / 1024.0 / 1024.0;
    let cpu = matched_group.total_cpu as f64;
    let process_count = matched_group.count;
    let exe_path = processes
        .iter()
        .find(|p| p.name.to_lowercase() == process_name.to_lowercase())
        .and_then(|p| p.exe_path.clone());

    // Update baseline
    let baseline_result = ai::baseline::load_baselines();
    let mut baseline_store = baseline_result.store;
    ai::baseline::update_baseline(&mut baseline_store, process_name, memory_mb, cpu);
    if baseline_result.writable {
        let _ = ai::baseline::save_baselines(&baseline_store);
    }
    let baseline_summary = ai::baseline::get_baseline_summary(&baseline_store, process_name);

    // Check cache
    let kb_result = ai::knowledge::load_knowledge();
    if !refresh {
        if let Some(cached) = ai::knowledge::lookup(&kb_result.kb, process_name) {
            crate::display_search_result(
                process_name,
                cached,
                memory_mb,
                process_count,
                true,
                &baseline_summary,
            );
            return;
        }
    }

    // Load AI config
    let ai_config = match ai::config::load_config() {
        Ok(c) => c,
        Err(e) => {
            println!(
                "{}",
                format!("Error: {}. Run /config set api_key <key>", e).red()
            );
            return;
        }
    };
    if ai_config.api_key.is_empty() {
        println!(
            "{}",
            "API key not set. Run: /config set api_key <your-key>".red()
        );
        return;
    }

    // Web search
    let search_context = ai::websearch::search_process_info(process_name).await;
    if search_context.is_some() {
        println!("  {}", "(web search: found context)".dimmed());
    } else {
        println!("  {}", "(web search: no results)".dimmed());
    }

    // Build prompt
    let system_prompt =
        "You are a Windows process analyst. Analyze the given process information and identify what it is."
            .to_string();
    let user_prompt = ai::prompt::build_search_prompt(
        process_name,
        &exe_path,
        memory_mb,
        cpu,
        process_count,
        &baseline_summary,
        &search_context,
        &ai_config.language,
    );

    // Spinner
    let spinner = ProgressBar::new_spinner();
    spinner.set_message("Analyzing...");
    spinner.enable_steady_tick(Duration::from_millis(100));

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

    struct Cb {
        accumulated: String,
    }
    impl StreamCallback for Cb {
        fn on_delta(&mut self, text: &str) {
            self.accumulated.push_str(text);
        }
        fn on_complete(&mut self) {}
        fn on_error(&mut self, _: &AiError) {}
    }
    let mut callback = Cb {
        accumulated: String::new(),
    };

    let result = match provider {
        Provider::OpenAI => {
            let client = ai::client::OpenAiClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
        Provider::Claude => {
            let client = ai::client::ClaudeClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
    };

    spinner.finish_and_clear();

    match result {
        Ok(()) => {
            let text = callback.accumulated.trim().to_string();
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(json) => {
                    let knowledge = ai::knowledge::ProcessKnowledge {
                        description: json["description"].as_str().unwrap_or("").to_string(),
                        category: json["category"].as_str().unwrap_or("").to_string(),
                        typical_memory: json["typical_memory"].as_str().unwrap_or("").to_string(),
                        risk: json["risk"].as_str().unwrap_or("safe").to_string(),
                        advice: json["advice"].as_str().unwrap_or("").to_string(),
                        updated: chrono::Local::now().format("%Y-%m-%d").to_string(),
                    };
                    let kb_save_result = ai::knowledge::load_knowledge();
                    if kb_save_result.writable {
                        let mut kb = kb_save_result.kb;
                        ai::knowledge::upsert(&mut kb, process_name, knowledge.clone());
                        let _ = ai::knowledge::save_knowledge(&kb);
                    }
                    crate::display_search_result(
                        process_name,
                        &knowledge,
                        memory_mb,
                        process_count,
                        false,
                        &baseline_summary,
                    );
                }
                Err(_) => println!("\n{}", text),
            }
        }
        Err(e) => println!("{}", format!("AI error: {}", e).red()),
    }
}

/// Run report command inline
async fn run_report() {
    use std::io::{self, Write};
    use std::time::Duration;

    use ai::client::{AiClient, AiClientConfig, AiError, Provider, StreamCallback};

    let ai_config = match ai::config::load_config() {
        Ok(c) => c,
        Err(e) => {
            println!(
                "{}",
                format!("Error: {}. Run /config set api_key <key>", e).red()
            );
            return;
        }
    };
    if ai_config.api_key.is_empty() {
        println!(
            "{}",
            "API key not set. Run: /config set api_key <your-key>".red()
        );
        return;
    }

    let config = validate_config(RawConfig::default()).config;
    let mut collector = SysinfoCollector::new();
    std::thread::sleep(Duration::from_millis(500));
    let processes = collector.collect_processes();
    let system = collector.collect_system();
    let snapshot = filter_snapshot(&processes, &config);
    let mut engine = RuleEngine::new(config);
    let alerts = engine.evaluate(&snapshot, &system);

    let language = &ai_config.language;
    let system_prompt = ai::prompt::build_system_prompt(language);
    let user_prompt = ai::prompt::build_user_prompt(&system, &snapshot, &alerts);
    let header = ai::report::build_report_header(&system, &alerts);

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
        timeout_secs: 60,
    };

    struct Cb {
        accumulated: String,
    }
    impl StreamCallback for Cb {
        fn on_delta(&mut self, text: &str) {
            print!("{}", text);
            io::stdout().flush().ok();
            self.accumulated.push_str(text);
        }
        fn on_complete(&mut self) {
            println!();
        }
        fn on_error(&mut self, e: &AiError) {
            eprintln!("\nError: {}", e);
        }
    }
    let mut callback = Cb {
        accumulated: String::new(),
    };

    println!("\n{}\n", "Generating report...".dimmed());

    let result = match provider {
        Provider::OpenAI => {
            let client = ai::client::OpenAiClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
        Provider::Claude => {
            let client = ai::client::ClaudeClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
    };

    match result {
        Ok(()) => match ai::report::save_report(&header, &callback.accumulated) {
            Ok(path) => println!("\n{}", format!("Report saved: {}", path.display()).green()),
            Err(e) => println!("{}", format!("Warning: {}", e).yellow()),
        },
        Err(e) => println!("{}", format!("Error: {}", e).red()),
    }
}

/// Handle free text input → AI question with system context
async fn handle_free_text(input: &str) {
    use std::io::{self, Write};
    use std::thread;
    use std::time::Duration;

    use ai::client::{AiClient, AiClientConfig, AiError, Provider, StreamCallback};

    let ai_config = match ai::config::load_config() {
        Ok(c) => c,
        Err(_) => {
            println!(
                "{}",
                "AI not configured. Run /config set api_key <key>".yellow()
            );
            return;
        }
    };
    if ai_config.api_key.is_empty() {
        println!(
            "{}",
            "API key not set. Run: /config set api_key <your-key>".yellow()
        );
        return;
    }

    // Collect quick system snapshot for context
    let config = validate_config(RawConfig::default()).config;
    let mut collector = SysinfoCollector::new();
    thread::sleep(Duration::from_millis(200));
    let processes = collector.collect_processes();
    let system = collector.collect_system();
    let snapshot = filter_snapshot(&processes, &config);

    let system_prompt = "You are a Windows system analyst assistant. The user is asking about their system. Answer concisely based on the system data provided. Reply in the same language the user uses.".to_string();
    let context = ai::prompt::build_user_prompt(&system, &snapshot, &[]);
    let user_prompt = format!("{}\n\nUser question: {}", context, input);

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

    struct Cb;
    impl StreamCallback for Cb {
        fn on_delta(&mut self, text: &str) {
            print!("{}", text);
            io::stdout().flush().ok();
        }
        fn on_complete(&mut self) {
            println!("\n");
        }
        fn on_error(&mut self, e: &AiError) {
            eprintln!("\nError: {}", e);
        }
    }
    let mut callback = Cb;

    let result = match provider {
        Provider::OpenAI => {
            let client = ai::client::OpenAiClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
        Provider::Claude => {
            let client = ai::client::ClaudeClient::new(client_config);
            client
                .stream_completion(&system_prompt, &user_prompt, &mut callback)
                .await
        }
    };

    if let Err(e) = result {
        println!("{}", format!("Error: {}", e).red());
    }
}
