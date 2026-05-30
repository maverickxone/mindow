// AI bridge module: connects the Tauri frontend to the mindow-ai streaming client.
// Provides stream_analyze_process (per-process AI analysis) and stream_chat (free conversation).

use serde::Serialize;
use tauri::Emitter;

use mindow_ai::client::{
    AiClient, AiClientConfig, AiError, ClaudeClient, OpenAiClient, Provider, StreamCallback,
};
use mindow_ai::config::{self, AiConfig};

use crate::state::AppState;

/// Payload emitted to the frontend on each streaming text chunk.
/// `request_id` lets the frontend ignore events from a stale/other stream.
#[derive(Debug, Clone, Serialize)]
pub struct AiDeltaPayload {
    pub request_id: String,
    pub delta: String,
}

/// Payload emitted when streaming completes or encounters an error.
#[derive(Debug, Clone, Serialize)]
pub struct AiDonePayload {
    pub request_id: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Build a system context summary from the current AppState snapshot.
/// Includes CPU average, memory usage, and top 5 processes by CPU.
fn build_system_context(state: &AppState) -> String {
    let snapshot = state.snapshot.lock().unwrap();
    let sys = &snapshot.system;

    let mem_used_gb = sys.used_memory as f64 / 1_073_741_824.0;
    let mem_total_gb = sys.total_memory as f64 / 1_073_741_824.0;
    let mem_pct = if sys.total_memory > 0 {
        (sys.used_memory as f64 / sys.total_memory as f64) * 100.0
    } else {
        0.0
    };

    let mut context = format!(
        "## 当前系统状态\n\n\
         - CPU 平均使用率: {:.1}%\n\
         - 内存: {:.1} GB / {:.1} GB ({:.1}%)\n",
        sys.cpu_avg, mem_used_gb, mem_total_gb, mem_pct,
    );

    // Top 5 processes by CPU
    let mut procs = snapshot.processes.clone();
    procs.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
    let top_procs: Vec<_> = procs.iter().take(5).collect();

    if !top_procs.is_empty() {
        context.push_str("\n## TOP 进程 (按 CPU)\n\n");
        context.push_str("| 名称 | PID | CPU% | 内存 |\n");
        context.push_str("|------|-----|------|------|\n");
        for p in &top_procs {
            let mem_mb = p.memory_bytes as f64 / 1_048_576.0;
            context.push_str(&format!(
                "| {} | {} | {:.1}% | {:.0} MB |\n",
                p.name, p.pid, p.cpu_percent, mem_mb
            ));
        }
    }

    // Active alerts
    if !snapshot.alerts.is_empty() {
        context.push_str("\n## 当前活跃告警\n\n");
        for alert in &snapshot.alerts {
            context.push_str(&format!("- {}\n", alert.message));
        }
    }

    context
}

/// Load AI config and validate that the API key is present.
fn load_ai_config() -> Result<AiConfig, String> {
    let ai_config = config::load_config().map_err(|e| format!("配置加载失败: {}", e))?;
    if ai_config.api_key.is_empty() {
        return Err(
            "API 密钥未配置。请在 ~/.mindow/config.toml 中设置 api_key，或运行 mindow config set api_key <key>"
                .to_string(),
        );
    }
    Ok(ai_config)
}

/// Create an AI client based on the loaded config.
fn create_client_config(ai_config: &AiConfig) -> (AiClientConfig, Provider) {
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

    (client_config, provider)
}

/// StreamCallback implementation that emits Tauri events to the frontend.
struct TauriStreamCallback {
    app_handle: tauri::AppHandle,
    request_id: String,
}

impl StreamCallback for TauriStreamCallback {
    fn on_delta(&mut self, text: &str) {
        let payload = AiDeltaPayload {
            request_id: self.request_id.clone(),
            delta: text.to_string(),
        };
        let _ = self.app_handle.emit("ai-delta", &payload);
    }

    fn on_complete(&mut self) {
        let payload = AiDonePayload {
            request_id: self.request_id.clone(),
            success: true,
            error: None,
        };
        let _ = self.app_handle.emit("ai-done", &payload);
    }

    fn on_error(&mut self, error: &AiError) {
        let payload = AiDonePayload {
            request_id: self.request_id.clone(),
            success: false,
            error: Some(error.to_string()),
        };
        let _ = self.app_handle.emit("ai-done", &payload);
    }
}

/// Stream AI completion using the configured provider.
async fn stream_with_provider(
    client_config: AiClientConfig,
    provider: &Provider,
    system_prompt: &str,
    user_prompt: &str,
    callback: &mut TauriStreamCallback,
) -> Result<(), AiError> {
    match provider {
        Provider::OpenAI => {
            let client = OpenAiClient::new(client_config);
            client
                .stream_completion(system_prompt, user_prompt, callback)
                .await
        }
        Provider::Claude => {
            let client = ClaudeClient::new(client_config);
            client
                .stream_completion(system_prompt, user_prompt, callback)
                .await
        }
    }
}

/// Stream AI analysis for a specific process.
///
/// Builds context from the current snapshot (the target process's stats + system overview),
/// then streams the AI response via "ai-delta" events.
pub async fn stream_analyze_process(
    app_handle: tauri::AppHandle,
    request_id: &str,
    process_name: &str,
    pid: Option<u32>,
    state: &AppState,
) -> Result<(), String> {
    let ai_config = load_ai_config()?;
    let (client_config, provider) = create_client_config(&ai_config);

    // Build process-specific context
    let process_context = {
        let snapshot = state.snapshot.lock().unwrap();
        let matching: Vec<_> = snapshot
            .processes
            .iter()
            .filter(|p| {
                let name_matches = p.name.to_lowercase().contains(&process_name.to_lowercase());
                let pid_matches = pid.map_or(true, |target_pid| p.pid == target_pid);
                name_matches && pid_matches
            })
            .collect();

        if matching.is_empty() {
            format!("进程 \"{}\" 当前未在运行列表中找到。", process_name)
        } else {
            let total_cpu: f32 = matching.iter().map(|p| p.cpu_percent).sum();
            let total_mem: u64 = matching.iter().map(|p| p.memory_bytes).sum();
            let mem_mb = total_mem as f64 / 1_048_576.0;
            let count = matching.len();
            let exe_path = matching
                .first()
                .and_then(|p| p.exe_path.clone())
                .unwrap_or_else(|| "未知".to_string());

            format!(
                "## 目标进程信息\n\n\
                 - 进程名: {}\n\
                 - 实例数: {}\n\
                 - 总 CPU: {:.1}%\n\
                 - 总内存: {:.0} MB\n\
                 - 路径: {}\n",
                process_name, count, total_cpu, mem_mb, exe_path
            )
        }
    };

    // System context
    let system_context = build_system_context(state);

    // Build prompts
    let system_prompt = "你是一个 Windows 系统资源分析师。请用通俗易懂的中文分析用户指定的进程，包括：\n\
        1. 这个进程是什么软件？做什么用的？\n\
        2. 当前资源占用是否正常？\n\
        3. 如果有异常，给出具体建议。\n\
        保持回复简洁实用，面向非技术用户。";

    let user_prompt = format!(
        "{}\n\n{}\n\n请分析进程「{}」的状态。",
        process_context, system_context, process_name
    );

    // Stream the response
    let mut callback = TauriStreamCallback {
        app_handle: app_handle.clone(),
        request_id: request_id.to_string(),
    };

    let result = stream_with_provider(client_config, &provider, system_prompt, &user_prompt, &mut callback).await;

    if let Err(e) = result {
        let payload = AiDonePayload {
            request_id: request_id.to_string(),
            success: false,
            error: Some(e.to_string()),
        };
        let _ = app_handle.emit("ai-done", &payload);
        return Err(e.to_string());
    }

    Ok(())
}

/// Stream AI free chat with system context.
///
/// Attaches the current system state summary so the AI can answer
/// system-related questions with real-time data awareness.
pub async fn stream_chat(
    app_handle: tauri::AppHandle,
    request_id: &str,
    user_message: &str,
    state: &AppState,
) -> Result<(), String> {
    let ai_config = load_ai_config()?;
    let (client_config, provider) = create_client_config(&ai_config);

    // System context
    let system_context = build_system_context(state);

    // Build prompts
    let system_prompt = format!(
        "你是 Mindow 智能助手，一个 Windows 系统资源分析工具的 AI 助手。\n\
         用户可能会问你关于系统状态、进程、性能优化等问题。\n\
         请用通俗易懂的中文回答，面向非技术用户。\n\
         \n\
         以下是当前系统的实时数据，你可以基于这些数据回答用户问题：\n\
         \n\
         {}",
        system_context
    );

    let user_prompt = user_message.to_string();

    // Stream the response
    let mut callback = TauriStreamCallback {
        app_handle: app_handle.clone(),
        request_id: request_id.to_string(),
    };

    let result = stream_with_provider(client_config, &provider, &system_prompt, &user_prompt, &mut callback).await;

    if let Err(e) = result {
        let payload = AiDonePayload {
            request_id: request_id.to_string(),
            success: false,
            error: Some(e.to_string()),
        };
        let _ = app_handle.emit("ai-done", &payload);
        return Err(e.to_string());
    }

    Ok(())
}
