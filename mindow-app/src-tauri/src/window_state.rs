use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

/// Persisted window state (position + size).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Get the path to the window state JSON file.
/// Uses Tauri's app config directory: <AppConfigDir>/window_state.json
fn state_file_path(app_handle: &AppHandle) -> Option<PathBuf> {
    let config_dir = app_handle.path().app_config_dir().ok()?;
    Some(config_dir.join("window_state.json"))
}

/// Save the current window state to a JSON file.
pub fn save_window_state(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };

    let position = match window.outer_position() {
        Ok(pos) => pos,
        Err(_) => return,
    };
    let size = match window.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };

    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let Some(path) = state_file_path(app_handle) else {
        return;
    };

    // Ensure the config directory exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(&path, json);
    }
}

/// Load the saved window state from the JSON file.
pub fn load_window_state(app_handle: &AppHandle) -> Option<WindowState> {
    let path = state_file_path(app_handle)?;
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Restore window state on startup. If the saved position is out of screen bounds,
/// reset to center.
pub fn restore_window_state(app_handle: &AppHandle) {
    let Some(state) = load_window_state(app_handle) else {
        return;
    };

    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };

    // Validate size (minimum reasonable values)
    let width = state.width.max(400);
    let height = state.height.max(300);

    // Apply size first
    let _ = window.set_size(PhysicalSize::new(width, height));

    // Check if the saved position is within any available monitor's bounds
    if is_position_within_screens(app_handle, &state) {
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    } else {
        // Position is out of bounds — center the window
        let _ = window.center();
    }
}

/// A screen rectangle for overlap checking.
#[derive(Debug, Clone)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Minimum visible overlap (in pixels) required on at least one screen.
pub const OVERLAP_MARGIN: i32 = 50;

/// Minimum window dimensions enforced during restore.
#[allow(dead_code)]
pub const MIN_WIDTH: u32 = 400;
#[allow(dead_code)]
pub const MIN_HEIGHT: u32 = 300;

/// Pure function: check whether the window state overlaps with any of the given screens
/// by at least `OVERLAP_MARGIN` pixels in both dimensions.
/// Returns true if visible on at least one screen.
pub fn is_within_screens(state: &WindowState, screens: &[ScreenRect]) -> bool {
    if screens.is_empty() {
        return false;
    }

    let win_right = state.x.saturating_add(state.width as i32);
    let win_bottom = state.y.saturating_add(state.height as i32);

    for screen in screens {
        let mon_left = screen.x;
        let mon_top = screen.y;
        let mon_right = mon_left.saturating_add(screen.width as i32);
        let mon_bottom = mon_top.saturating_add(screen.height as i32);

        let overlap_left = state.x.max(mon_left);
        let overlap_top = state.y.max(mon_top);
        let overlap_right = win_right.min(mon_right);
        let overlap_bottom = win_bottom.min(mon_bottom);

        let overlap_width = overlap_right - overlap_left;
        let overlap_height = overlap_bottom - overlap_top;

        if overlap_width >= OVERLAP_MARGIN && overlap_height >= OVERLAP_MARGIN {
            return true;
        }
    }

    false
}

/// Validate and clamp window dimensions to minimum values.
#[allow(dead_code)]
pub fn validate_size(width: u32, height: u32) -> (u32, u32) {
    (width.max(MIN_WIDTH), height.max(MIN_HEIGHT))
}

/// Check whether the saved window position is within the bounds of any available monitor.
/// Returns true if at least part of the window title bar area (top 32px) is visible
/// on some monitor.
fn is_position_within_screens(app_handle: &AppHandle, state: &WindowState) -> bool {
    let Some(window) = app_handle.get_webview_window("main") else {
        return false;
    };

    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return false,
    };

    if monitors.is_empty() {
        return false;
    }

    let screens: Vec<ScreenRect> = monitors
        .iter()
        .map(|m| ScreenRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();

    is_within_screens(state, &screens)
}


#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // --- Generators ---

    /// Generate arbitrary window state with reasonable ranges.
    fn arb_window_state() -> impl Strategy<Value = WindowState> {
        (
            -10000i32..10000,   // x position
            -10000i32..10000,   // y position
            1u32..5000,         // width
            1u32..5000,         // height
        )
            .prop_map(|(x, y, width, height)| WindowState { x, y, width, height })
    }

    /// Generate a screen rectangle with typical monitor dimensions.
    fn arb_screen_rect() -> impl Strategy<Value = ScreenRect> {
        (
            -5000i32..5000,     // screen x
            -5000i32..5000,     // screen y
            800u32..7680,       // screen width (from 800 to 8K)
            600u32..4320,       // screen height
        )
            .prop_map(|(x, y, width, height)| ScreenRect { x, y, width, height })
    }

    /// Generate a vector of 1-4 screens.
    fn arb_screens() -> impl Strategy<Value = Vec<ScreenRect>> {
        prop::collection::vec(arb_screen_rect(), 1..=4)
    }

    // **Validates: Requirements 13.1, 13.2**
    //
    // Property 6: 窗口状态持久
    // Serialization roundtrip: save → load produces identical state.
    proptest! {
        #[test]
        fn prop_serialization_roundtrip(state in arb_window_state()) {
            // Serialize to JSON
            let json = serde_json::to_string(&state).unwrap();
            // Deserialize back
            let restored: WindowState = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(state.x, restored.x, "x mismatch");
            prop_assert_eq!(state.y, restored.y, "y mismatch");
            prop_assert_eq!(state.width, restored.width, "width mismatch");
            prop_assert_eq!(state.height, restored.height, "height mismatch");
        }

        // **Validates: Requirements 13.2**
        //
        // Property 6: 窗口状态持久
        // Size validation always produces dimensions >= MIN_WIDTH x MIN_HEIGHT.
        #[test]
        fn prop_validate_size_enforces_minimum(width in 0u32..10000, height in 0u32..10000) {
            let (w, h) = validate_size(width, height);
            prop_assert!(w >= MIN_WIDTH, "width {} should be >= {}", w, MIN_WIDTH);
            prop_assert!(h >= MIN_HEIGHT, "height {} should be >= {}", h, MIN_HEIGHT);
        }

        // **Validates: Requirements 13.3**
        //
        // Property 6: 窗口状态持久
        // A window fully inside a screen is always detected as within screens.
        #[test]
        fn prop_window_inside_screen_is_within(screen in arb_screen_rect()) {
            // Place a window well inside the screen (inset by OVERLAP_MARGIN from each edge)
            let inset = OVERLAP_MARGIN as u32 + 10;
            // Ensure screen is large enough to fit a window with inset
            prop_assume!(screen.width > inset * 2);
            prop_assume!(screen.height > inset * 2);

            let state = WindowState {
                x: screen.x + inset as i32,
                y: screen.y + inset as i32,
                width: screen.width - inset * 2,
                height: screen.height - inset * 2,
            };

            let result = is_within_screens(&state, &[screen]);
            prop_assert!(result, "Window fully inside screen should be within screens");
        }

        // **Validates: Requirements 13.3**
        //
        // Property 6: 窗口状态持久
        // A window positioned far outside all screens is detected as out of bounds.
        #[test]
        fn prop_window_far_outside_screens_is_not_within(screens in arb_screens()) {
            // Place window far to the right of all screens where there's no overlap
            let max_right: i32 = screens.iter()
                .map(|s| s.x.saturating_add(s.width as i32))
                .max()
                .unwrap_or(0);

            let state = WindowState {
                x: max_right + 10000,  // Far beyond all screens
                y: 0,
                width: 800,
                height: 600,
            };

            let result = is_within_screens(&state, &screens);
            prop_assert!(!result, "Window far outside all screens should not be within screens");
        }

        // **Validates: Requirements 13.3**
        //
        // Property 6: 窗口状态持久
        // Empty screen list always returns false (triggers center reset).
        #[test]
        fn prop_empty_screens_always_resets(state in arb_window_state()) {
            let result = is_within_screens(&state, &[]);
            prop_assert!(!result, "Empty screens should always return false (reset to center)");
        }
    }

    // Unit tests for specific edge cases

    #[test]
    fn test_serialization_preserves_negative_positions() {
        let state = WindowState {
            x: -100,
            y: -50,
            width: 1920,
            height: 1080,
        };
        let json = serde_json::to_string(&state).unwrap();
        let restored: WindowState = serde_json::from_str(&json).unwrap();
        assert_eq!(state.x, restored.x);
        assert_eq!(state.y, restored.y);
        assert_eq!(state.width, restored.width);
        assert_eq!(state.height, restored.height);
    }

    #[test]
    fn test_validate_size_clamps_below_minimum() {
        assert_eq!(validate_size(100, 100), (400, 300));
        assert_eq!(validate_size(0, 0), (400, 300));
        assert_eq!(validate_size(399, 299), (400, 300));
    }

    #[test]
    fn test_validate_size_preserves_above_minimum() {
        assert_eq!(validate_size(1920, 1080), (1920, 1080));
        assert_eq!(validate_size(400, 300), (400, 300));
    }

    #[test]
    fn test_window_barely_overlapping_screen() {
        let screen = ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };

        // Window overlaps by exactly OVERLAP_MARGIN in both dimensions
        let state = WindowState {
            x: 1920 - OVERLAP_MARGIN,
            y: 1080 - OVERLAP_MARGIN,
            width: 800,
            height: 600,
        };
        assert!(is_within_screens(&state, &[screen.clone()]));

        // Window overlaps by less than OVERLAP_MARGIN in x (not enough)
        let state2 = WindowState {
            x: 1920 - OVERLAP_MARGIN + 1,
            y: 1080 - OVERLAP_MARGIN,
            width: 800,
            height: 600,
        };
        assert!(!is_within_screens(&state2, &[screen]));
    }

    #[test]
    fn test_multi_monitor_second_screen_detects_overlap() {
        let screens = vec![
            ScreenRect { x: 0, y: 0, width: 1920, height: 1080 },
            ScreenRect { x: 1920, y: 0, width: 1920, height: 1080 },
        ];

        // Window on the second monitor
        let state = WindowState {
            x: 2000,
            y: 100,
            width: 800,
            height: 600,
        };
        assert!(is_within_screens(&state, &screens));
    }
}
