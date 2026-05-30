use mindow_core::types::{
    Alert, BatteryStatus, ChargingState, FilteredSnapshot, PathStatus, SystemSample,
};

/// 构建系统提示词
pub fn build_system_prompt(language: &str) -> String {
    match language {
        "en" => {
            "You are a Windows system resource analyst. Analyze the provided system data and give a report in 3 sections:\n\
             1. System Overview - summarize the overall health\n\
             2. Anomaly Analysis - explain any issues detected\n\
             3. Recommendations - give specific actionable suggestions\n\
             Keep the response concise and practical."
                .to_string()
        }
        _ => {
            // "cn" default
            "你是一个 Windows 系统资源分析师。分析提供的系统数据，给出包含三个部分的报告：\n\
             1. 系统概要 - 总结整体健康状况\n\
             2. 异常分析 - 解释检测到的问题\n\
             3. 具体建议 - 给出可操作的建议\n\
             保持回复简洁实用。"
                .to_string()
        }
    }
}

/// 构建用户提示词（包含系统数据和告警）
pub fn build_user_prompt(
    system: &SystemSample,
    snapshot: &FilteredSnapshot,
    alerts: &[Alert],
) -> String {
    let mut prompt = String::new();

    // System metrics
    prompt.push_str("## System Metrics\n\n");
    let mem_pct = if system.total_memory > 0 {
        (system.used_memory as f64 / system.total_memory as f64) * 100.0
    } else {
        0.0
    };
    let avg_cpu = if system.per_core_cpu.is_empty() {
        0.0
    } else {
        system.per_core_cpu.iter().sum::<f32>() / system.per_core_cpu.len() as f32
    };

    prompt.push_str(&format!(
        "- Total Memory: {:.1} GB\n",
        system.total_memory as f64 / 1024.0 / 1024.0 / 1024.0
    ));
    prompt.push_str(&format!(
        "- Used Memory: {:.1} GB ({:.1}%)\n",
        system.used_memory as f64 / 1024.0 / 1024.0 / 1024.0,
        mem_pct
    ));
    prompt.push_str(&format!("- Average CPU: {:.1}%\n", avg_cpu));

    // Battery
    match &system.battery {
        BatteryStatus::Available { level, charging } => {
            let state = match charging {
                ChargingState::Charging => "Charging",
                ChargingState::Discharging => "Discharging",
                ChargingState::Full => "Full",
                ChargingState::Unknown => "Unknown",
            };
            prompt.push_str(&format!("- Battery: {:.0}% ({})\n", level, state));
        }
        BatteryStatus::Unavailable => {
            prompt.push_str("- Battery: N/A\n");
        }
    }

    // Process table
    prompt.push_str(&format_processes_table(snapshot));

    // Alerts
    prompt.push_str(&format_alerts(alerts));

    prompt
}

/// 将进程列表格式化为 Markdown 表格
fn format_processes_table(snapshot: &FilteredSnapshot) -> String {
    let mut table = String::new();
    table.push_str("\n## Top Processes\n\n");
    table.push_str("| Name | PID | CPU% | Memory | Path Status |\n");
    table.push_str("|------|-----|------|--------|-------------|\n");
    for proc in &snapshot.processes {
        let mem_mb = proc.sample.memory_bytes as f64 / 1024.0 / 1024.0;
        let status = match proc.path_status {
            PathStatus::Standard => "OK",
            PathStatus::Suspicious => "Suspicious",
            PathStatus::Unknown => "Unknown",
        };
        table.push_str(&format!(
            "| {} | {} | {:.1}% | {:.0} MB | {} |\n",
            proc.sample.name, proc.sample.pid, proc.sample.cpu_percent, mem_mb, status
        ));
    }
    table
}

/// 将告警列表格式化为结构化文本
fn format_alerts(alerts: &[Alert]) -> String {
    let mut output = String::new();
    output.push_str("\n## Active Alerts\n\n");
    if alerts.is_empty() {
        output.push_str("No alerts - system appears healthy.\n");
    } else {
        for alert in alerts {
            match alert {
                Alert::MemoryLeak {
                    process_name,
                    pid,
                    start_memory,
                    current_memory,
                    consecutive_samples,
                } => {
                    output.push_str(&format!(
                        "- [Memory Leak] {process_name} (PID {pid}): {:.0} MB -> {:.0} MB ({consecutive_samples} samples)\n",
                        *start_memory as f64 / 1024.0 / 1024.0,
                        *current_memory as f64 / 1024.0 / 1024.0,
                    ));
                }
                Alert::HighCpu {
                    process_name,
                    pid,
                    average_cpu,
                    duration_secs,
                } => {
                    output.push_str(&format!(
                        "- [High CPU] {process_name} (PID {pid}): avg {average_cpu:.1}% for {duration_secs}s\n"
                    ));
                }
                Alert::BatteryWarning {
                    battery_level,
                    offending_processes,
                } => {
                    output.push_str(&format!(
                        "- [Battery Warning] Level: {battery_level:.0}%, offenders: "
                    ));
                    let names: Vec<&str> =
                        offending_processes.iter().map(|p| p.name.as_str()).collect();
                    output.push_str(&names.join(", "));
                    output.push('\n');
                }
                Alert::MemoryPressure {
                    used_percent,
                    candidates,
                } => {
                    output.push_str(&format!(
                        "- [Memory Pressure] Used: {used_percent:.1}%, candidates: "
                    ));
                    let names: Vec<&str> = candidates.iter().map(|c| c.name.as_str()).collect();
                    output.push_str(&names.join(", "));
                    output.push('\n');
                }
                Alert::SuspiciousPath {
                    process_name,
                    pid,
                    path_status: _,
                } => {
                    output.push_str(&format!(
                        "- [Suspicious Path] {process_name} (PID {pid})\n"
                    ));
                }
            }
        }
    }
    output
}

/// Build the AI prompt for process search.
/// Requests response in English to avoid encoding issues across terminal types.
pub fn build_search_prompt(
    process_name: &str,
    exe_path: &Option<String>,
    memory_mb: f64,
    cpu: f64,
    process_count: usize,
    baseline_summary: &Option<String>,
    web_search_context: &Option<String>,
) -> String {
    let mut prompt = format!(
        "I see a process called \"{}\" (running {} instances)\n\
         Path: {}\n\
         Total memory: {:.0} MB\n\
         Total CPU: {:.1}%\n\
         {}\n",
        process_name,
        process_count,
        exe_path.as_deref().unwrap_or("unknown"),
        memory_mb,
        cpu,
        baseline_summary.as_deref().unwrap_or("(no historical data)")
    );

    if let Some(context) = web_search_context {
        prompt.push_str(&format!(
            "\nWeb search results about this process:\n{}\n",
            context
        ));
    }

    prompt.push_str(
        "\nTell me:\n\
         1. What is this software? (one sentence)\n\
         2. Category (e.g. Browser, IDE, System Service, Game, etc.)\n\
         3. Typical memory usage range\n\
         4. Risk level: safe / caution / suspicious\n\
         5. Any advice\n\n\
         Reply in this JSON format ONLY:\n\
         {\"description\": \"...\", \"category\": \"...\", \"typical_memory\": \"...\", \"risk\": \"safe|caution|suspicious\", \"advice\": \"...\"}\n\
         Output JSON only, nothing else.",
    );

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use mindow_core::types::{FilteredProcess, ProcessSample};

    #[test]
    fn test_system_prompt_cn_contains_chinese() {
        let prompt = build_system_prompt("cn");
        assert!(prompt.contains("系统"));
        assert!(prompt.contains("分析师"));
    }

    #[test]
    fn test_system_prompt_en_contains_english() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains("System"));
        assert!(prompt.contains("analyst"));
    }

    #[test]
    fn test_system_prompt_default_is_cn() {
        let prompt = build_system_prompt("unknown");
        assert!(prompt.contains("系统"));
    }

    #[test]
    fn test_user_prompt_contains_system_data() {
        let system = SystemSample {
            total_memory: 16 * 1024 * 1024 * 1024, // 16 GB
            used_memory: 12 * 1024 * 1024 * 1024,  // 12 GB
            per_core_cpu: vec![45.0, 55.0, 30.0, 60.0],
            battery: BatteryStatus::Available {
                level: 85.0,
                charging: ChargingState::Charging,
            },
        };
        let snapshot = FilteredSnapshot {
            processes: vec![FilteredProcess {
                sample: ProcessSample {
                    name: "chrome.exe".to_string(),
                    pid: 1234,
                    cpu_percent: 25.5,
                    memory_bytes: 500 * 1024 * 1024,
                    disk_read_bytes: 0,
                    disk_write_bytes: 0,
                    exe_path: Some("C:\\Program Files\\Google\\Chrome\\chrome.exe".to_string()),
                    start_time: 0,
                    parent_pid: None,
                },
                path_status: PathStatus::Standard,
            }],
        };
        let alerts = vec![Alert::HighCpu {
            process_name: "chrome.exe".to_string(),
            pid: 1234,
            average_cpu: 92.3,
            duration_secs: 50,
        }];

        let prompt = build_user_prompt(&system, &snapshot, &alerts);

        // Contains memory info
        assert!(prompt.contains("16.0 GB"));
        assert!(prompt.contains("12.0 GB"));
        // Contains CPU info
        assert!(prompt.contains("Average CPU"));
        // Contains process info
        assert!(prompt.contains("chrome.exe"));
        assert!(prompt.contains("1234"));
        // Contains battery info
        assert!(prompt.contains("85%"));
        assert!(prompt.contains("Charging"));
        // Contains alert info
        assert!(prompt.contains("High CPU"));
        assert!(prompt.contains("92.3"));
    }

    #[test]
    fn test_user_prompt_empty_alerts_shows_healthy() {
        let system = SystemSample {
            total_memory: 8 * 1024 * 1024 * 1024,
            used_memory: 4 * 1024 * 1024 * 1024,
            per_core_cpu: vec![10.0, 15.0],
            battery: BatteryStatus::Unavailable,
        };
        let snapshot = FilteredSnapshot { processes: vec![] };
        let alerts: Vec<Alert> = vec![];

        let prompt = build_user_prompt(&system, &snapshot, &alerts);

        assert!(prompt.contains("No alerts") || prompt.contains("healthy"));
    }

    #[test]
    fn test_user_prompt_battery_unavailable() {
        let system = SystemSample {
            total_memory: 8 * 1024 * 1024 * 1024,
            used_memory: 4 * 1024 * 1024 * 1024,
            per_core_cpu: vec![10.0],
            battery: BatteryStatus::Unavailable,
        };
        let snapshot = FilteredSnapshot { processes: vec![] };
        let alerts: Vec<Alert> = vec![];

        let prompt = build_user_prompt(&system, &snapshot, &alerts);

        assert!(prompt.contains("N/A"));
    }
}
