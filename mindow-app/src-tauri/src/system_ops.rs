// Windows system operations: process termination, file location, and autostart registry.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ,
};
use windows::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_TERMINATE,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Registry path for autostart entries.
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// Registry value name for our application.
const APP_VALUE_NAME: &str = "Mindow";

/// Convert a Rust string to a null-terminated wide string (UTF-16).
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Terminate a process by PID.
///
/// First attempts normal termination. If access is denied, returns an error
/// indicating elevation is needed, and attempts a UAC-elevated kill via runas.
pub fn kill_process(pid: u32) -> Result<String, String> {
    unsafe {
        // Try to open the process with PROCESS_TERMINATE access
        let handle_result = OpenProcess(PROCESS_TERMINATE, false, pid);

        match handle_result {
            Ok(handle) => {
                // Successfully opened, attempt to terminate
                let result = TerminateProcess(handle, 1);
                let _ = CloseHandle(handle);

                match result {
                    Ok(()) => Ok(format!("进程 {} 已成功终止", pid)),
                    Err(_) => {
                        let err = GetLastError();
                        if err == ERROR_ACCESS_DENIED {
                            // Attempt UAC elevation via runas
                            attempt_elevated_kill(pid)
                        } else {
                            Err(format!("终止进程失败，错误码: {:?}", err))
                        }
                    }
                }
            }
            Err(_) => {
                let err = GetLastError();
                if err == ERROR_ACCESS_DENIED {
                    // Attempt UAC elevation via runas
                    attempt_elevated_kill(pid)
                } else {
                    Err(format!("无法打开进程 {}，错误码: {:?}", pid, err))
                }
            }
        }
    }
}

/// Attempt to kill a process via UAC elevation using ShellExecuteW with "runas" verb.
/// This launches `taskkill /F /PID <pid>` as administrator.
fn attempt_elevated_kill(pid: u32) -> Result<String, String> {
    let verb = to_wide("runas");
    let file = to_wide("taskkill");
    let params = to_wide(&format!("/F /PID {}", pid));
    let dir = to_wide("");

    unsafe {
        let result = ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(params.as_ptr()),
            PCWSTR(dir.as_ptr()),
            SW_SHOWNORMAL,
        );

        // ShellExecuteW returns an HINSTANCE; values > 32 indicate success
        let instance_value = result.0 as usize;
        if instance_value > 32 {
            Ok(format!(
                "已请求管理员权限终止进程 {}，请在 UAC 弹窗中确认",
                pid
            ))
        } else {
            Err(format!(
                "需要管理员权限才能终止进程 {}，提权请求失败",
                pid
            ))
        }
    }
}

/// Open Windows Explorer and select the specified file path.
pub fn open_file_location(path: &str) -> Result<(), String> {
    let verb = to_wide("open");
    let file = to_wide("explorer.exe");
    let params = to_wide(&format!("/select,{}", path));
    let dir = to_wide("");

    unsafe {
        let result = ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(params.as_ptr()),
            PCWSTR(dir.as_ptr()),
            SW_SHOWNORMAL,
        );

        let instance_value = result.0 as usize;
        if instance_value > 32 {
            Ok(())
        } else {
            Err(format!("打开文件位置失败，错误码: {}", instance_value))
        }
    }
}

/// Enable or disable autostart by writing/removing the registry Run key.
pub fn set_autostart(enable: bool) -> Result<(), String> {
    let run_key_wide = to_wide(RUN_KEY);
    let value_name_wide = to_wide(APP_VALUE_NAME);

    unsafe {
        let mut hkey = HKEY::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(run_key_wide.as_ptr()),
            0,
            KEY_WRITE,
            &mut hkey,
        );

        if status.is_err() {
            return Err(format!("无法打开注册表 Run 键: {:?}", status));
        }

        let result = if enable {
            // Get current executable path
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("无法获取应用路径: {}", e))?;
            let exe_path_str = exe_path.to_string_lossy().to_string();
            let exe_path_wide = to_wide(&exe_path_str);

            // Write the value (size in bytes, excluding null terminator from byte count
            // but including the null in the data)
            let data_bytes: &[u8] = std::slice::from_raw_parts(
                exe_path_wide.as_ptr() as *const u8,
                exe_path_wide.len() * 2,
            );

            let s = RegSetValueExW(
                hkey,
                PCWSTR(value_name_wide.as_ptr()),
                0,
                REG_SZ,
                Some(data_bytes),
            );
            if s.is_err() {
                Err(format!("写入注册表失败: {:?}", s))
            } else {
                Ok(())
            }
        } else {
            // Remove the value
            let s = RegDeleteValueW(hkey, PCWSTR(value_name_wide.as_ptr()));
            if s.is_err() {
                // If the value doesn't exist, that's fine
                Ok(())
            } else {
                Ok(())
            }
        };

        let _ = RegCloseKey(hkey);
        result
    }
}

/// Check whether autostart is currently enabled by reading the registry Run key.
pub fn get_autostart() -> bool {
    let run_key_wide = to_wide(RUN_KEY);
    let value_name_wide = to_wide(APP_VALUE_NAME);

    unsafe {
        let mut hkey = HKEY::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(run_key_wide.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        );

        if status.is_err() {
            return false;
        }

        // Query if the value exists (we don't need the actual data)
        let result = RegQueryValueExW(
            hkey,
            PCWSTR(value_name_wide.as_ptr()),
            None,
            None,
            None,
            None,
        );

        let _ = RegCloseKey(hkey);
        result.is_ok()
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    /// **Validates: Requirements 2.2, 2.5**
    ///
    /// Property 5: 进程结束幂等
    /// Killing an already-terminated process should return Err gracefully (no panic).
    #[test]
    fn test_kill_already_terminated_process_does_not_panic() {
        // Spawn a child process that exits immediately, then try to kill it.
        let child = std::process::Command::new("cmd")
            .args(["/C", "exit 0"])
            .spawn()
            .expect("failed to spawn child process");

        let pid = child.id();

        // Wait for the child to finish
        let _ = std::process::Command::new("cmd")
            .args(["/C", "exit 0"])
            .status(); // small delay
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Now the child process has terminated. Calling kill_process should return Err, not panic.
        let result = kill_process(pid);

        // It should be an Err (process no longer exists), but the critical thing is: no panic.
        assert!(
            result.is_err(),
            "kill_process on already-terminated process should return Err, got: {:?}",
            result
        );
    }

    /// **Validates: Requirements 2.2, 2.5**
    ///
    /// Property 5: 进程结束幂等
    /// Killing a non-existent PID should return Err gracefully (no panic).
    #[test]
    fn test_kill_nonexistent_pid_returns_error_gracefully() {
        // PID 99999 is extremely unlikely to exist
        let result = kill_process(99999);

        // Should return an error, not panic
        assert!(
            result.is_err(),
            "kill_process with non-existent PID 99999 should return Err, got: {:?}",
            result
        );
    }

    /// **Validates: Requirements 2.2, 2.5**
    ///
    /// Property 5: 进程结束幂等
    /// Concurrent calls to kill_process on the same PID must not panic.
    /// Even if the process no longer exists, multiple threads calling kill simultaneously
    /// should all return gracefully (Ok or Err) without any panics.
    #[test]
    fn test_concurrent_kill_same_pid_no_panic() {
        // Spawn a short-lived child process
        let child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 2 127.0.0.1 >nul"])
            .spawn()
            .expect("failed to spawn child process");

        let pid = child.id();

        // Give the process a moment to start
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Spawn multiple threads that all try to kill the same PID simultaneously
        let mut handles = Vec::new();
        for _ in 0..10 {
            let handle = std::thread::spawn(move || {
                // Each thread calls kill_process — none should panic
                let _result = kill_process(pid);
                // We don't care about Ok vs Err here; what matters is no panic
            });
            handles.push(handle);
        }

        // Wait for all threads to complete — if any panicked, join will return Err
        for (i, handle) in handles.into_iter().enumerate() {
            assert!(
                handle.join().is_ok(),
                "Thread {} panicked during concurrent kill_process call",
                i
            );
        }
    }

    /// **Validates: Requirements 2.2, 2.5**
    ///
    /// Property 5: 进程结束幂等
    /// Double-kill: kill a process, wait for it to die, then kill again — should not panic.
    #[test]
    fn test_double_kill_same_process_no_panic() {
        // Spawn a child process that runs briefly
        let child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 3 127.0.0.1 >nul"])
            .spawn()
            .expect("failed to spawn child process");

        let pid = child.id();

        // Give the process a moment to start
        std::thread::sleep(std::time::Duration::from_millis(100));

        // First kill — should succeed
        let first_result = kill_process(pid);
        // First kill should succeed (Ok) since the process is running
        assert!(
            first_result.is_ok(),
            "First kill_process should succeed, got: {:?}",
            first_result
        );

        // Wait for the process to actually terminate
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Second kill — process is already dead. Should return Err gracefully, not panic.
        let second_result = kill_process(pid);
        assert!(
            second_result.is_err(),
            "Second kill_process on already-dead process should return Err, got: {:?}",
            second_result
        );
    }
}
