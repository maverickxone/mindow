// Tauri invoke commands: request-response IPC handlers for the frontend.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::ai_bridge;
use crate::state::{AppState, SnapshotData};
use crate::system_ops;
use mindow_ai::config as ai_config;

/// Response for get_performance_history — serializes VecDeque as Vec for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PerformanceHistoryResponse {
    pub cpu_history: Vec<f32>,
    pub memory_history: Vec<f64>,
    pub disk_read_history: Vec<u64>,
    pub disk_write_history: Vec<u64>,
    pub battery_history: Vec<f32>,
    pub per_core_cpu: Vec<f32>,
    pub timestamps: Vec<u64>,
}

/// Response for get_process_trend — per-process memory and CPU history.
#[derive(Debug, Clone, Serialize)]
pub struct ProcessTrendResponse {
    pub memory_trend: Vec<u64>,
    pub cpu_trend: Vec<f32>,
}

/// Returns the current snapshot data (processes, system info, alerts).
#[tauri::command]
pub fn get_snapshot(state: State<Arc<AppState>>) -> SnapshotData {
    let snapshot = state.snapshot.lock().unwrap();
    snapshot.clone()
}

/// Returns the last 60 performance history data points for charts.
#[tauri::command]
pub fn get_performance_history(state: State<Arc<AppState>>) -> PerformanceHistoryResponse {
    let history = state.performance_history.lock().unwrap();

    // Generate approximate timestamps (2 seconds apart, ending at "now")
    let len = history.cpu_history.len();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let timestamps: Vec<u64> = (0..len)
        .map(|i| now_ms - ((len - 1 - i) as u64) * 2000)
        .collect();

    PerformanceHistoryResponse {
        cpu_history: history.cpu_history.iter().copied().collect(),
        memory_history: history.memory_history.iter().copied().collect(),
        disk_read_history: history.disk_read_history.iter().copied().collect(),
        disk_write_history: history.disk_write_history.iter().copied().collect(),
        battery_history: history.battery_history.iter().copied().collect(),
        per_core_cpu: history.per_core_cpu.clone(),
        timestamps,
    }
}

/// Returns the memory and CPU trend history for a specific process by PID.
#[tauri::command]
pub fn get_process_trend(pid: u32, state: State<Arc<AppState>>) -> ProcessTrendResponse {
    let engine = state.rule_engine.lock().unwrap();
    let trend_store = engine.trend_store();

    let memory_trend = trend_store
        .get_memory_trend(pid)
        .map(|v| v.iter().copied().collect())
        .unwrap_or_default();

    let cpu_trend = trend_store
        .get_cpu_trend(pid)
        .map(|v| v.iter().copied().collect())
        .unwrap_or_default();

    ProcessTrendResponse {
        memory_trend,
        cpu_trend,
    }
}

/// Terminate a process by PID. Attempts normal termination first;
/// if access is denied, triggers UAC elevation via runas.
#[tauri::command]
pub fn kill_process(pid: u32) -> Result<String, String> {
    system_ops::kill_process(pid)
}

/// Open Windows Explorer and select the file at the given path.
#[tauri::command]
pub fn open_file_location(path: String) -> Result<(), String> {
    system_ops::open_file_location(&path)
}

/// A tree node representing a process and its children with aggregated resource usage.
#[derive(Debug, Clone, Serialize)]
pub struct ProcessTreeNode {
    pub process: crate::state::ProcessInfo,
    pub children: Vec<ProcessTreeNode>,
    pub aggregated_cpu: f32,
    pub aggregated_memory: u64,
}

/// Build a process tree from the flat snapshot list based on parent_pid relationships.
/// Returns the list of root nodes (processes whose parent_pid is None or whose parent is not found).
#[tauri::command]
pub fn get_process_tree(state: State<Arc<AppState>>) -> Vec<ProcessTreeNode> {
    let snapshot = state.snapshot.lock().unwrap();
    build_process_tree(&snapshot.processes)
}

/// Construct the tree structure from a flat list of processes (public for testing).
pub fn build_process_tree(processes: &[crate::state::ProcessInfo]) -> Vec<ProcessTreeNode> {
    use std::collections::HashMap;

    // Index processes by PID for quick lookup
    let pid_set: std::collections::HashSet<u32> = processes.iter().map(|p| p.pid).collect();

    // Group processes by their parent_pid
    let mut children_map: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut roots: Vec<usize> = Vec::new();

    for (idx, process) in processes.iter().enumerate() {
        match process.parent_pid {
            Some(ppid) if pid_set.contains(&ppid) && ppid != process.pid => {
                children_map.entry(ppid).or_default().push(idx);
            }
            _ => {
                // Root node: no parent, parent not in list, or self-referencing
                roots.push(idx);
            }
        }
    }

    // Recursively build tree nodes
    fn build_node(
        idx: usize,
        processes: &[crate::state::ProcessInfo],
        children_map: &HashMap<u32, Vec<usize>>,
    ) -> ProcessTreeNode {
        let process = &processes[idx];
        let children: Vec<ProcessTreeNode> = children_map
            .get(&process.pid)
            .map(|child_indices| {
                child_indices
                    .iter()
                    .map(|&ci| build_node(ci, processes, children_map))
                    .collect()
            })
            .unwrap_or_default();

        // Aggregate: self + all descendants
        let children_cpu: f32 = children.iter().map(|c| c.aggregated_cpu).sum();
        let children_memory: u64 = children.iter().map(|c| c.aggregated_memory).sum();

        ProcessTreeNode {
            aggregated_cpu: process.cpu_percent + children_cpu,
            aggregated_memory: process.memory_bytes + children_memory,
            process: process.clone(),
            children,
        }
    }

    roots
        .iter()
        .map(|&idx| build_node(idx, processes, &children_map))
        .collect()
}


/// AI analyze process: streams AI analysis for a specific process via events.
/// The frontend should listen for "ai-delta" and "ai-done" events.
#[tauri::command]
pub async fn ai_analyze_process(
    request_id: String,
    process_name: String,
    pid: Option<u32>,
    app_handle: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state_ref = state.inner().as_ref();
    ai_bridge::stream_analyze_process(app_handle, &request_id, &process_name, pid, state_ref).await
}

/// Toggle autostart: enable or disable the application's registry Run key entry.
#[tauri::command]
pub fn toggle_autostart(enable: bool) -> Result<(), String> {
    system_ops::set_autostart(enable)
}

/// Get the current autostart status from the registry.
#[tauri::command]
pub fn get_autostart_status() -> bool {
    system_ops::get_autostart()
}

/// AI chat: streams a free-form AI conversation response via events.
/// System context (CPU, memory, top processes) is automatically attached.
/// Supports multi-turn conversation by accepting a messages history array.
#[tauri::command]
pub async fn ai_chat(
    request_id: String,
    user_message: String,
    history: Option<Vec<crate::ai_bridge::ChatMessage>>,
    app_handle: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let state_ref = state.inner().as_ref();
    ai_bridge::stream_chat(app_handle, &request_id, &user_message, history.as_deref(), state_ref).await
}

/// Application settings structure serialized to/from JSON config file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub autostart: bool,
    pub shortcut: String,
    #[serde(rename = "aiEndpoint", default)]
    pub ai_endpoint: String,
    #[serde(rename = "aiApiKey", default)]
    pub ai_api_key: String,
    #[serde(rename = "sidebarExpanded", default)]
    pub sidebar_expanded: bool,
    #[serde(rename = "notificationsEnabled", default)]
    pub notifications_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: "zh".to_string(),
            autostart: system_ops::get_autostart(),
            shortcut: "Ctrl+Shift+M".to_string(),
            ai_endpoint: String::new(),
            ai_api_key: String::new(),
            sidebar_expanded: false,
            notifications_enabled: false,
        }
    }
}

/// Get the settings file path (~/.mindow/gui_settings.json)
fn settings_file_path() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".mindow").join("gui_settings.json")
}

/// Get current application settings from the config file.
#[tauri::command]
pub fn get_settings() -> AppSettings {
    let path = settings_file_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => AppSettings::default(),
        }
    } else {
        AppSettings::default()
    }
}

/// Save application settings to the config file.
#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let path = settings_file_path();

    // Sync notifications_enabled to runtime state
    state.notifications_enabled.store(
        settings.notifications_enabled,
        std::sync::atomic::Ordering::Relaxed,
    );

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

/// AI configuration structure received from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfigPayload {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

/// Save AI configuration to ~/.mindow/config.toml (the same file the AI backend reads).
#[tauri::command]
pub fn save_ai_config(config: AiConfigPayload) -> Result<(), String> {
    let mut ai_cfg = ai_config::load_config().unwrap_or_default();
    ai_cfg.provider = config.provider;
    ai_cfg.model = config.model;
    ai_cfg.base_url = config.base_url;
    ai_cfg.api_key = config.api_key;
    ai_config::save_config(&ai_cfg).map_err(|e| format!("Failed to save AI config: {}", e))
}

/// Test AI connection by making a minimal API call with the provided config.
/// Returns Ok(()) on success, or an error string describing the failure.
#[tauri::command]
pub async fn test_ai_connection(config: AiConfigPayload) -> Result<String, String> {
    use mindow_ai::client::{AiClient, AiClientConfig, ClaudeClient, OpenAiClient, Provider, StreamCallback, AiError};

    // Determine provider
    let provider = if config.provider == "claude" {
        Provider::Claude
    } else {
        Provider::OpenAI
    };

    let client_config = AiClientConfig {
        provider: provider.clone(),
        model: config.model.clone(),
        api_key: config.api_key.clone(),
        base_url: config.base_url.clone(),
        timeout_secs: 15,
    };

    // Simple callback that just captures whether we got any response
    struct TestCallback {
        got_response: bool,
    }
    impl StreamCallback for TestCallback {
        fn on_delta(&mut self, _text: &str) {
            self.got_response = true;
        }
        fn on_complete(&mut self) {}
        fn on_error(&mut self, _error: &AiError) {}
    }

    let mut callback = TestCallback { got_response: false };

    let result = match &provider {
        Provider::OpenAI => {
            let client = OpenAiClient::new(client_config);
            client.stream_completion("You are a test assistant.", "Say 'ok'.", &mut callback).await
        }
        Provider::Claude => {
            let client = ClaudeClient::new(client_config);
            client.stream_completion("You are a test assistant.", "Say 'ok'.", &mut callback).await
        }
    };

    match result {
        Ok(_) => Ok("Connection successful".to_string()),
        Err(e) => Err(format!("Connection failed: {}", e)),
    }
}

/// Get the icon for a process given its exe_path. Returns a base64 data URL.
/// Results are cached: same exe_path will return instantly on subsequent calls.
#[tauri::command]
pub fn get_process_icon(exe_path: String) -> Option<String> {
    crate::icons::get_icon_base64(&exe_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        AppState, PathStatusInfo, ProcessInfo, SnapshotData, SystemInfo,
    };
    use std::sync::Arc;

    /// Helper: create a minimal AppState for testing.
    fn test_app_state() -> Arc<AppState> {
        Arc::new(AppState::new())
    }

    /// Helper: create a sample ProcessInfo for testing.
    fn sample_process(pid: u32, name: &str, cpu: f32, memory: u64) -> ProcessInfo {
        ProcessInfo {
            name: name.to_string(),
            pid,
            cpu_percent: cpu,
            memory_bytes: memory,
            disk_read_bytes: 0,
            disk_write_bytes: 0,
            path_status: PathStatusInfo::User,
            instance_count: 1,
            baseline_deviation: None,
            exe_path: Some(format!("C:\\Program Files\\{}.exe", name)),
            parent_pid: None,
        }
    }

    // ─── get_snapshot tests ───────────────────────────────────────────────────

    #[test]
    fn test_get_snapshot_returns_default_empty_structure() {
        let state = test_app_state();
        let snapshot = state.snapshot.lock().unwrap().clone();

        // Default snapshot should have empty processes and alerts, and default system info
        assert!(snapshot.processes.is_empty());
        assert!(snapshot.alerts.is_empty());
        assert_eq!(snapshot.system.total_memory, 0);
        assert_eq!(snapshot.system.cpu_avg, 0.0);
    }

    #[test]
    fn test_get_snapshot_returns_populated_data() {
        let state = test_app_state();

        // Populate snapshot with test data
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.processes = vec![
                sample_process(1000, "chrome", 12.5, 500_000_000),
                sample_process(2000, "code", 8.3, 300_000_000),
            ];
            snapshot.system = SystemInfo {
                total_memory: 16_000_000_000,
                used_memory: 10_000_000_000,
                cpu_avg: 35.0,
                per_core_cpu: vec![30.0, 40.0, 35.0, 35.0],
                battery_level: Some(80.0),
                battery_charging: None,
            };
        }

        // Read back and verify structure
        let snapshot = state.snapshot.lock().unwrap().clone();
        assert_eq!(snapshot.processes.len(), 2);
        assert_eq!(snapshot.processes[0].name, "chrome");
        assert_eq!(snapshot.processes[0].pid, 1000);
        assert_eq!(snapshot.processes[0].cpu_percent, 12.5);
        assert_eq!(snapshot.processes[0].memory_bytes, 500_000_000);
        assert_eq!(snapshot.processes[1].name, "code");
        assert_eq!(snapshot.system.total_memory, 16_000_000_000);
        assert_eq!(snapshot.system.cpu_avg, 35.0);
        assert_eq!(snapshot.system.per_core_cpu.len(), 4);
    }

    // ─── get_performance_history tests ────────────────────────────────────────

    #[test]
    fn test_get_performance_history_empty_state() {
        let state = test_app_state();
        let history = state.performance_history.lock().unwrap();

        // Empty state should have empty histories
        assert!(history.cpu_history.is_empty());
        assert!(history.memory_history.is_empty());
        assert!(history.disk_read_history.is_empty());
        assert!(history.disk_write_history.is_empty());
    }

    #[test]
    fn test_get_performance_history_returns_correct_structure() {
        let state = test_app_state();

        // Populate performance history
        {
            let mut history = state.performance_history.lock().unwrap();
            for i in 0..5 {
                history.cpu_history.push_back(10.0 + i as f32);
                history.memory_history.push_back(50.0 + i as f64);
                history.disk_read_history.push_back(1000 * (i + 1) as u64);
                history.disk_write_history.push_back(500 * (i + 1) as u64);
            }
        }

        // Read back and build response (mimicking what get_performance_history does)
        let history = state.performance_history.lock().unwrap();
        let len = history.cpu_history.len();

        let response = PerformanceHistoryResponse {
            cpu_history: history.cpu_history.iter().copied().collect(),
            memory_history: history.memory_history.iter().copied().collect(),
            disk_read_history: history.disk_read_history.iter().copied().collect(),
            disk_write_history: history.disk_write_history.iter().copied().collect(),
            timestamps: (0..len).map(|i| (i as u64) * 2000).collect(),
        };

        assert_eq!(response.cpu_history.len(), 5);
        assert_eq!(response.memory_history.len(), 5);
        assert_eq!(response.disk_read_history.len(), 5);
        assert_eq!(response.disk_write_history.len(), 5);
        assert_eq!(response.timestamps.len(), 5);

        // Verify data values
        assert_eq!(response.cpu_history[0], 10.0);
        assert_eq!(response.cpu_history[4], 14.0);
        assert_eq!(response.memory_history[0], 50.0);
        assert_eq!(response.disk_read_history[2], 3000);
    }

    #[test]
    fn test_get_performance_history_timestamps_are_ordered() {
        let state = test_app_state();

        {
            let mut history = state.performance_history.lock().unwrap();
            for i in 0..10 {
                history.cpu_history.push_back(i as f32);
                history.memory_history.push_back(i as f64);
                history.disk_read_history.push_back(i as u64);
                history.disk_write_history.push_back(i as u64);
            }
        }

        let history = state.performance_history.lock().unwrap();
        let len = history.cpu_history.len();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let timestamps: Vec<u64> = (0..len)
            .map(|i| now_ms - ((len - 1 - i) as u64) * 2000)
            .collect();

        // Timestamps should be monotonically increasing
        for i in 1..timestamps.len() {
            assert!(timestamps[i] > timestamps[i - 1]);
        }
    }

    // ─── get_process_trend tests ──────────────────────────────────────────────

    #[test]
    fn test_get_process_trend_empty_for_unknown_pid() {
        let state = test_app_state();
        let engine = state.rule_engine.lock().unwrap();
        let trend_store = engine.trend_store();

        // PID 99999 should have no trend data
        let memory_trend: Vec<u64> = trend_store
            .get_memory_trend(99999)
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();
        let cpu_trend: Vec<f32> = trend_store
            .get_cpu_trend(99999)
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();

        let response = ProcessTrendResponse {
            memory_trend,
            cpu_trend,
        };

        assert!(response.memory_trend.is_empty());
        assert!(response.cpu_trend.is_empty());
    }

    #[test]
    fn test_get_process_trend_response_structure() {
        // Verify the ProcessTrendResponse structure is correct even when data is populated
        let response = ProcessTrendResponse {
            memory_trend: vec![100_000_000, 110_000_000, 120_000_000],
            cpu_trend: vec![25.0, 30.0, 28.0],
        };

        assert_eq!(response.memory_trend.len(), 3);
        assert_eq!(response.cpu_trend.len(), 3);
        assert_eq!(response.memory_trend[0], 100_000_000);
        assert_eq!(response.memory_trend[2], 120_000_000);
        assert_eq!(response.cpu_trend[0], 25.0);
        assert_eq!(response.cpu_trend[1], 30.0);
    }

    #[test]
    fn test_get_process_trend_logic_with_rule_engine() {
        // Test the actual command logic path: create AppState, verify we can
        // access rule_engine.trend_store() and query a PID that has no data.
        let state = test_app_state();

        // Mimic what the get_process_trend command does
        let engine = state.rule_engine.lock().unwrap();
        let trend_store = engine.trend_store();

        let pid = 42;
        let memory_trend: Vec<u64> = trend_store
            .get_memory_trend(pid)
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();
        let cpu_trend: Vec<f32> = trend_store
            .get_cpu_trend(pid)
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();

        let response = ProcessTrendResponse {
            memory_trend,
            cpu_trend,
        };

        // Fresh state has no trend data for any PID
        assert!(response.memory_trend.is_empty());
        assert!(response.cpu_trend.is_empty());
    }

    // ─── kill_process error handling tests ────────────────────────────────────

    #[test]
    fn test_kill_process_invalid_pid_returns_error() {
        // PID 0 is the System Idle Process and cannot be terminated
        // PID 99999 is very unlikely to exist
        let result = system_ops::kill_process(99999);

        // Should return an error since the process doesn't exist
        assert!(
            result.is_err(),
            "kill_process with non-existent PID should return Err, got: {:?}",
            result
        );
    }

    #[test]
    fn test_kill_process_pid_zero_returns_error() {
        // PID 0 (System Idle Process) should fail to be terminated
        let result = system_ops::kill_process(0);

        // Should return an error (either access denied or invalid handle)
        assert!(
            result.is_err(),
            "kill_process with PID 0 should return Err, got: {:?}",
            result
        );
    }

    // ─── Serialization structure tests ────────────────────────────────────────

    #[test]
    fn test_performance_history_response_serializes() {
        let response = PerformanceHistoryResponse {
            cpu_history: vec![10.0, 20.0, 30.0],
            memory_history: vec![50.0, 60.0, 70.0],
            disk_read_history: vec![100, 200, 300],
            disk_write_history: vec![50, 100, 150],
            timestamps: vec![1000, 2000, 3000],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["cpu_history"].as_array().unwrap().len(), 3);
        assert_eq!(json["memory_history"].as_array().unwrap().len(), 3);
        assert_eq!(json["timestamps"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn test_process_trend_response_serializes() {
        let response = ProcessTrendResponse {
            memory_trend: vec![100_000_000, 110_000_000],
            cpu_trend: vec![25.0, 30.0],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["memory_trend"].as_array().unwrap().len(), 2);
        assert_eq!(json["cpu_trend"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_snapshot_data_serializes() {
        let snapshot = SnapshotData {
            processes: vec![sample_process(100, "test_proc", 5.0, 1_000_000)],
            system: SystemInfo::default(),
            alerts: vec![],
        };

        let json = serde_json::to_value(&snapshot).unwrap();
        assert!(json["processes"].is_array());
        assert_eq!(json["processes"].as_array().unwrap().len(), 1);
        assert!(json["system"].is_object());
        assert!(json["alerts"].is_array());
    }
}
