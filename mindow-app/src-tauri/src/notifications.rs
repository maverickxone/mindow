// Notification management module: sends Windows system notifications for alerts
// with 5-minute cooldown deduplication based on alert type + process name.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri_plugin_notification::NotificationExt;

use crate::state::{AlertInfo, AlertSeverity, AlertType, AppState};

/// Cooldown duration: same alert type + process won't re-notify within this window.
pub(crate) const NOTIFICATION_COOLDOWN_SECS: u64 = 300; // 5 minutes

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
        AlertType::MemoryLeak => "⚠️ 内存泄漏警告".to_string(),
        AlertType::HighCpu => "🔴 CPU 持续高占用".to_string(),
        AlertType::MemoryPressure => "🔴 系统内存压力".to_string(),
        AlertType::BatteryWarning => "⚠️ 电池电量警告".to_string(),
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
    let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

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
/// Also cleans up expired cooldown entries to prevent unbounded HashMap growth.
pub fn check_and_send_alerts(alerts: &[AlertInfo], state: &Arc<AppState>, app_handle: &tauri::AppHandle) {
    if alerts.is_empty() {
        return;
    }

    let mut cooldowns = state.notification_cooldowns.lock().unwrap();
    let now = Instant::now();
    let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

    // Clean up expired cooldown entries (older than 5 minutes)
    cooldowns.retain(|_, last_sent| now.duration_since(*last_sent) < cooldown_duration);

    // Send notifications for each alert (respecting cooldown)
    for alert in alerts {
        send_alert_notification(alert, &mut cooldowns, app_handle);
    }
}

/// Check if a notification should be allowed (not in cooldown).
/// Returns true if the notification is NOT in cooldown and should proceed.
/// This is a pure logic function extracted for testability.
pub(crate) fn should_allow_notification(
    key: &str,
    cooldowns: &HashMap<String, Instant>,
    now: Instant,
    cooldown_duration: Duration,
) -> bool {
    if let Some(last_sent) = cooldowns.get(key) {
        if now.duration_since(*last_sent) < cooldown_duration {
            return false; // Still in cooldown, skip
        }
    }
    true // Not in cooldown, allow
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

    // **Validates: Requirements 7.5**
    //
    // Property 2: 告警不重复
    // Same alert type within 5-minute cooldown only triggers one notification.
    proptest! {
        #[test]
        fn prop_same_alert_blocked_within_cooldown(alert in arb_alert_info(), elapsed_secs in 0u64..299) {
            // Given: a cooldown map with an entry for this alert recorded at `base_time`
            let mut cooldowns: HashMap<String, Instant> = HashMap::new();
            let key = cooldown_key(&alert);
            let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

            // Record initial send at `base_time`
            let base_time = Instant::now();
            cooldowns.insert(key.clone(), base_time);

            // Simulate time passing (less than 5 minutes)
            // We add the elapsed duration to base_time to get "now"
            let simulated_now = base_time + Duration::from_secs(elapsed_secs);

            // The same alert should be BLOCKED (not allowed)
            let allowed = should_allow_notification(&key, &cooldowns, simulated_now, cooldown_duration);
            prop_assert!(!allowed,
                "Alert with key '{}' should be blocked within cooldown ({} secs < 300 secs)",
                key, elapsed_secs
            );
        }

        #[test]
        fn prop_same_alert_allowed_after_cooldown(alert in arb_alert_info(), extra_secs in 0u64..600) {
            // Given: a cooldown map with an entry for this alert recorded at `base_time`
            let mut cooldowns: HashMap<String, Instant> = HashMap::new();
            let key = cooldown_key(&alert);
            let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

            // Record initial send at `base_time`
            let base_time = Instant::now();
            cooldowns.insert(key.clone(), base_time);

            // Simulate time passing: 300 seconds (cooldown) + extra_secs
            let simulated_now = base_time + Duration::from_secs(NOTIFICATION_COOLDOWN_SECS + extra_secs);

            // The same alert should be ALLOWED after cooldown expires
            let allowed = should_allow_notification(&key, &cooldowns, simulated_now, cooldown_duration);
            prop_assert!(allowed,
                "Alert with key '{}' should be allowed after cooldown ({} secs >= 300 secs)",
                key, NOTIFICATION_COOLDOWN_SECS + extra_secs
            );
        }
    }

    // Unit test: verify cooldown_key generation is deterministic and format is correct
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

    // Unit test: fresh cooldown map always allows notification
    #[test]
    fn test_empty_cooldowns_always_allows() {
        let cooldowns: HashMap<String, Instant> = HashMap::new();
        let now = Instant::now();
        let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

        let allowed = should_allow_notification("MemoryLeak:chrome", &cooldowns, now, cooldown_duration);
        assert!(allowed);
    }

    // Unit test: exactly at cooldown boundary (300 seconds) should allow
    #[test]
    fn test_exactly_at_cooldown_boundary_allows() {
        let mut cooldowns: HashMap<String, Instant> = HashMap::new();
        let base_time = Instant::now();
        cooldowns.insert("HighCpu:firefox".to_string(), base_time);

        let now = base_time + Duration::from_secs(300);
        let cooldown_duration = Duration::from_secs(NOTIFICATION_COOLDOWN_SECS);

        let allowed = should_allow_notification("HighCpu:firefox", &cooldowns, now, cooldown_duration);
        assert!(allowed, "Should be allowed at exactly 300 seconds (not strictly less than)");
    }
}
