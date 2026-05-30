// Notification management module: sends Windows system notifications for alerts
// with cooldown deduplication, startup silence, and per-cycle limiting.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri_plugin_notification::NotificationExt;

use crate::state::{AlertInfo, AlertSeverity, AlertType, AppState};

/// Cooldown duration: same alert type + process won't re-notify within this window.
/// Critical alerts: 5 minutes. Warning alerts: 15 minutes.
pub(crate) const CRITICAL_COOLDOWN_SECS: u64 = 300; // 5 minutes
pub(crate) const WARNING_COOLDOWN_SECS: u64 = 900; // 15 minutes

/// Startup silence period: no notifications in the first 30 seconds.
pub(crate) const STARTUP_SILENCE_SECS: u64 = 30;

/// Maximum notifications per sampling cycle (2 seconds).
pub(crate) const MAX_NOTIFICATIONS_PER_CYCLE: usize = 2;

/// Application start time — set once on AppState creation.
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// Initialize the start time. Call once at app startup.
pub fn init_start_time() {
    START_TIME.get_or_init(Instant::now);
}

/// Check if we're still in the startup silence period.
fn in_startup_silence() -> bool {
    match START_TIME.get() {
        Some(start) => start.elapsed() < Duration::from_secs(STARTUP_SILENCE_SECS),
        None => false,
    }
}

/// Generate a deduplication key from alert type and process name.
/// Format: "AlertType:process_name" (e.g., "MemoryLeak:chrome")
pub(crate) fn cooldown_key(alert: &AlertInfo) -> String {
    let type_name = match &alert.alert_type {
        AlertType::MemoryLeak => "MemoryLeak",
        AlertType::HighCpu => "HighCpu",
        AlertType::MemoryPressure => "MemoryPressure",
        AlertType::BatteryWarning => "BatteryWarning",
    };
    let process = alert.process_name.as_deref().unwrap_or("system");
    format!("{}:{}", type_name, process)
}

/// Build a notification title based on alert type and severity.
fn notification_title(alert: &AlertInfo) -> String {
    match &alert.alert_type {
        AlertType::MemoryLeak => "内存泄漏警告".to_string(),
        AlertType::HighCpu => "CPU 持续高占用".to_string(),
        AlertType::MemoryPressure => "系统内存压力".to_string(),
        AlertType::BatteryWarning => "电池电量警告".to_string(),
    }
}

/// Check if a notification should be sent (not in cooldown) and send it.
/// Returns true if a notification was actually sent.
fn send_alert_notification(
    alert: &AlertInfo,
    cooldowns: &mut HashMap<String, Instant>,
    app_handle: &tauri::AppHandle,
) -> bool {
    let key = cooldown_key(alert);
    let now = Instant::now();

    // Use different cooldown duration based on severity
    let cooldown_duration = match alert.severity {
        AlertSeverity::Critical => Duration::from_secs(CRITICAL_COOLDOWN_SECS),
        AlertSeverity::Warning => Duration::from_secs(WARNING_COOLDOWN_SECS),
    };

    // Check if this alert is still in cooldown
    if let Some(last_sent) = cooldowns.get(&key) {
        if now.duration_since(*last_sent) < cooldown_duration {
            return false; // Still in cooldown, skip
        }
    }

    // Build and send notification via tauri-plugin-notification
    let title = notification_title(alert);
    let result = app_handle
        .notification()
        .builder()
        .title(&title)
        .body(&alert.message)
        .show();

    match result {
        Ok(()) => {
            // Update cooldown timestamp
            cooldowns.insert(key, now);
            true
        }
        Err(e) => {
            eprintln!("[notifications] failed to send notification: {}", e);
            false
        }
    }
}

/// Check all current alerts and send notifications for those not in cooldown.
/// Called from the sampling loop after rule evaluation produces new alerts.
///
/// Respects:
/// - Startup silence period (no notifications in first 30 seconds)
/// - Per-cycle limit (max 2 notifications per call)
/// - Cooldown dedup (same alert type + process within cooldown window)
/// - Expired entry cleanup to prevent unbounded HashMap growth.
pub fn check_and_send_alerts(alerts: &[AlertInfo], state: &Arc<AppState>, app_handle: &tauri::AppHandle) {
    if alerts.is_empty() {
        return;
    }

    // Don't send notifications during startup silence
    if in_startup_silence() {
        return;
    }

    // Check if notifications are enabled (controlled by settings)
    if !state.notifications_enabled.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }

    let mut cooldowns = state.notification_cooldowns.lock().unwrap();
    let now = Instant::now();
    // Use the longer cooldown for cleanup purposes
    let max_cooldown = Duration::from_secs(WARNING_COOLDOWN_SECS);

    // Clean up expired cooldown entries
    cooldowns.retain(|_, last_sent| now.duration_since(*last_sent) < max_cooldown);

    // Send notifications for each alert (respecting cooldown and per-cycle limit)
    let mut sent_count = 0;
    for alert in alerts {
        if sent_count >= MAX_NOTIFICATIONS_PER_CYCLE {
            break;
        }
        if send_alert_notification(alert, &mut cooldowns, app_handle) {
            sent_count += 1;
        }
    }
}

// TODO: Notification click handling
// In Tauri 2.x, handling notification click events to restore the window
// and navigate to the relevant process is complex and platform-specific.
// This would require:
// 1. Setting an action_type_id on the notification
// 2. Listening for notification action events
// 3. Restoring the window and emitting a frontend navigation event
// For now, notifications are sent without click handling.

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // --- Generators for AlertInfo ---

    fn arb_alert_type() -> impl Strategy<Value = AlertType> {
        prop_oneof![
            Just(AlertType::MemoryLeak),
            Just(AlertType::HighCpu),
            Just(AlertType::MemoryPressure),
            Just(AlertType::BatteryWarning),
        ]
    }

    fn arb_process_name() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            "[a-z]{1,10}".prop_map(Some),
        ]
    }

    fn arb_alert_info() -> impl Strategy<Value = AlertInfo> {
        (arb_alert_type(), arb_process_name()).prop_map(|(alert_type, process_name)| AlertInfo {
            alert_type,
            severity: AlertSeverity::Warning,
            message: "test alert message".to_string(),
            process_name,
            pid: Some(1234),
        })
    }

    /// Helper: check if notification would be allowed based on cooldown map
    fn should_allow(
        key: &str,
        cooldowns: &HashMap<String, Instant>,
        now: Instant,
        cooldown_duration: Duration,
    ) -> bool {
        if let Some(last_sent) = cooldowns.get(key) {
            if now.duration_since(*last_sent) < cooldown_duration {
                return false;
            }
        }
        true
    }

    // **Validates: Requirements 7.5**
    //
    // Property 2: 告警不重复
    // Same alert type within cooldown only triggers one notification.
    proptest! {
        #[test]
        fn prop_same_alert_blocked_within_cooldown(alert in arb_alert_info(), elapsed_secs in 0u64..299) {
            let mut cooldowns: HashMap<String, Instant> = HashMap::new();
            let key = cooldown_key(&alert);
            let cooldown_duration = Duration::from_secs(CRITICAL_COOLDOWN_SECS);

            let base_time = Instant::now();
            cooldowns.insert(key.clone(), base_time);

            let simulated_now = base_time + Duration::from_secs(elapsed_secs);

            let allowed = should_allow(&key, &cooldowns, simulated_now, cooldown_duration);
            prop_assert!(!allowed,
                "Alert with key '{}' should be blocked within cooldown ({} secs < 300 secs)",
                key, elapsed_secs
            );
        }

        #[test]
        fn prop_same_alert_allowed_after_cooldown(alert in arb_alert_info(), extra_secs in 0u64..600) {
            let mut cooldowns: HashMap<String, Instant> = HashMap::new();
            let key = cooldown_key(&alert);
            let cooldown_duration = Duration::from_secs(CRITICAL_COOLDOWN_SECS);

            let base_time = Instant::now();
            cooldowns.insert(key.clone(), base_time);

            let simulated_now = base_time + Duration::from_secs(CRITICAL_COOLDOWN_SECS + extra_secs);

            let allowed = should_allow(&key, &cooldowns, simulated_now, cooldown_duration);
            prop_assert!(allowed,
                "Alert with key '{}' should be allowed after cooldown ({} secs >= 300 secs)",
                key, CRITICAL_COOLDOWN_SECS + extra_secs
            );
        }
    }

    #[test]
    fn test_cooldown_key_format() {
        let alert = AlertInfo {
            alert_type: AlertType::MemoryLeak,
            severity: AlertSeverity::Warning,
            message: "test".to_string(),
            process_name: Some("chrome".to_string()),
            pid: Some(1234),
        };
        assert_eq!(cooldown_key(&alert), "MemoryLeak:chrome");

        let alert_no_process = AlertInfo {
            alert_type: AlertType::HighCpu,
            severity: AlertSeverity::Critical,
            message: "test".to_string(),
            process_name: None,
            pid: None,
        };
        assert_eq!(cooldown_key(&alert_no_process), "HighCpu:system");
    }

    #[test]
    fn test_empty_cooldowns_always_allows() {
        let cooldowns: HashMap<String, Instant> = HashMap::new();
        let now = Instant::now();
        let cooldown_duration = Duration::from_secs(CRITICAL_COOLDOWN_SECS);

        let allowed = should_allow("MemoryLeak:chrome", &cooldowns, now, cooldown_duration);
        assert!(allowed);
    }

    #[test]
    fn test_exactly_at_cooldown_boundary_allows() {
        let mut cooldowns: HashMap<String, Instant> = HashMap::new();
        let base_time = Instant::now();
        cooldowns.insert("HighCpu:firefox".to_string(), base_time);

        let now = base_time + Duration::from_secs(300);
        let cooldown_duration = Duration::from_secs(CRITICAL_COOLDOWN_SECS);

        let allowed = should_allow("HighCpu:firefox", &cooldowns, now, cooldown_duration);
        assert!(allowed, "Should be allowed at exactly 300 seconds (not strictly less than)");
    }

    #[test]
    fn test_warning_has_longer_cooldown() {
        let mut cooldowns: HashMap<String, Instant> = HashMap::new();
        let base_time = Instant::now();
        cooldowns.insert("MemoryLeak:app".to_string(), base_time);

        // At 6 minutes (360s), critical would allow but warning should still block
        let now = base_time + Duration::from_secs(360);
        let warning_cooldown = Duration::from_secs(WARNING_COOLDOWN_SECS);

        let allowed = should_allow("MemoryLeak:app", &cooldowns, now, warning_cooldown);
        assert!(!allowed, "Warning alerts should have 15-minute cooldown");
    }

    #[test]
    fn test_startup_silence() {
        init_start_time();
        // Right after init, we should be in silence
        assert!(in_startup_silence());
    }
}
