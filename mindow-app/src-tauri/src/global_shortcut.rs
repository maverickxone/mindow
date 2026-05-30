use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Default global shortcut for toggling window visibility.
pub const DEFAULT_SHORTCUT: &str = "ctrl+shift+m";

/// Register global shortcuts for the application.
/// Currently registers Ctrl+Shift+M to toggle window show/hide.
/// Handles registration failures gracefully by logging a warning
/// (e.g., when another application already uses the same shortcut).
pub fn register_global_shortcuts(app_handle: &AppHandle) {
    let result = app_handle.global_shortcut().on_shortcut(
        DEFAULT_SHORTCUT,
        |app_handle, _shortcut, _event| {
            toggle_window_visibility(app_handle);
        },
    );

    match result {
        Ok(_) => {
            eprintln!("[mindow] Global shortcut registered: {}", DEFAULT_SHORTCUT);
        }
        Err(e) => {
            eprintln!(
                "[mindow] WARNING: Failed to register global shortcut '{}': {}. \
                 Another application may already be using this shortcut. \
                 You can change the shortcut in Settings.",
                DEFAULT_SHORTCUT, e
            );
        }
    }
}

/// Toggle the main window's visibility:
/// - If visible and not minimized → hide (minimize to tray)
/// - If hidden or minimized → show and focus
fn toggle_window_visibility(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);

        if is_visible && !is_minimized {
            // Window is visible and not minimized — hide it
            let _ = window.hide();
        } else {
            // Window is hidden or minimized — show and focus
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}
