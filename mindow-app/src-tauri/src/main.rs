// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_bridge;
mod commands;
mod global_shortcut;
mod icons;
mod notifications;
mod sampling;
mod state;
mod system_ops;
mod window_state;

use std::sync::Arc;

use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn main() {
    let app_state = Arc::new(AppState::new());

    // Clone for the Tauri setup closure
    let state_for_setup = app_state.clone();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_performance_history,
            commands::get_process_trend,
            commands::get_process_tree,
            commands::kill_process,
            commands::open_file_location,
            commands::toggle_autostart,
            commands::get_autostart_status,
            commands::ai_analyze_process,
            commands::ai_chat,
            commands::get_settings,
            commands::save_settings,
            commands::save_ai_config,
            commands::test_ai_connection,
            commands::get_process_icon,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // --- System Tray Setup ---
            let open_item = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open_item, &hide_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Mindow")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Double-click to restore window (Windows only)
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // --- Register global shortcuts ---
            global_shortcut::register_global_shortcuts(&app_handle);

            // --- Initialize notification start time ---
            notifications::init_start_time();

            // --- Restore saved window state (position + size) ---
            window_state::restore_window_state(&app_handle);

            // --- Start sampling loop ---
            let config = mindow_core::config::Config {
                interval_secs: 2,
                ..mindow_core::config::Config::default()
            };
            sampling::start_sampling_loop(app_handle, state_for_setup, config);

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // Intercept window close: save state and minimize to tray instead of quitting
                WindowEvent::CloseRequested { api, .. } => {
                    window_state::save_window_state(&window.app_handle());
                    let _ = window.hide();
                    api.prevent_close();
                }
                // Save state on move or resize
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    window_state::save_window_state(&window.app_handle());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
