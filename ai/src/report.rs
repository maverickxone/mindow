use std::fs;
use std::path::PathBuf;

use chrono::Local;
use mindow_core::types::{Alert, BatteryStatus, ChargingState, SystemSample};

/// Report file directory: ~/.mindow/reports/
pub fn reports_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mindow").join("reports")
}

/// Generate report filename: YYYY-MM-DD_HH-MM-SS.md
pub fn report_filename() -> String {
    Local::now().format("%Y-%m-%d_%H-%M-%S.md").to_string()
}

/// Build report file header with system metadata
pub fn build_report_header(system: &SystemSample, alerts: &[Alert]) -> String {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S");

    let mem_pct = if system.total_memory > 0 {
        (system.used_memory as f64 / system.total_memory as f64) * 100.0
    } else {
        0.0
    };
    let mem_used_gb = system.used_memory as f64 / 1024.0 / 1024.0 / 1024.0;
    let mem_total_gb = system.total_memory as f64 / 1024.0 / 1024.0 / 1024.0;

    let avg_cpu = if system.per_core_cpu.is_empty() {
        0.0
    } else {
        system.per_core_cpu.iter().sum::<f32>() / system.per_core_cpu.len() as f32
    };

    let battery_str = match &system.battery {
        BatteryStatus::Available { level, charging } => {
            let state = match charging {
                ChargingState::Charging => "Charging",
                ChargingState::Discharging => "Discharging",
                ChargingState::Full => "Full",
                ChargingState::Unknown => "Unknown",
            };
            format!("{:.0}% ({})", level, state)
        }
        BatteryStatus::Unavailable => "N/A".to_string(),
    };

    let mut header = format!(
        "# Mindow System Analysis Report\n\n\
         **Generated**: {}\n\
         **Memory**: {:.1}/{:.1} GB ({:.1}%)\n\
         **CPU Average**: {:.1}%\n\
         **Battery**: {}\n\n",
        now, mem_used_gb, mem_total_gb, mem_pct, avg_cpu, battery_str
    );

    if !alerts.is_empty() {
        header.push_str(&format!("## Active Alerts ({})\n\n", alerts.len()));
        for alert in alerts {
            header.push_str(&format!("- {:?}\n", alert));
        }
        header.push('\n');
    }

    header.push_str("---\n\n");
    header
}

/// Save complete report to file (header + AI analysis content).
/// Automatically creates the reports directory if it doesn't exist.
pub fn save_report(header: &str, ai_content: &str) -> Result<PathBuf, std::io::Error> {
    let dir = reports_dir();
    fs::create_dir_all(&dir)?;
    let path = dir.join(report_filename());
    let content = format!("{}{}", header, ai_content);
    fs::write(&path, &content)?;
    Ok(path)
}

/// Save partial report when stream is interrupted.
/// Automatically creates the reports directory if it doesn't exist.
pub fn save_partial_report(
    header: &str,
    partial_content: &str,
) -> Result<PathBuf, std::io::Error> {
    let dir = reports_dir();
    fs::create_dir_all(&dir)?;
    let filename = format!("partial_{}", report_filename());
    let path = dir.join(filename);
    let content = format!(
        "{}\n\n[Report incomplete - stream was interrupted]\n\n{}",
        header, partial_content
    );
    fs::write(&path, &content)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mindow_core::types::{BatteryStatus, ChargingState, SystemSample};

    fn sample_system() -> SystemSample {
        SystemSample {
            total_memory: 16 * 1024 * 1024 * 1024, // 16 GB
            used_memory: 12 * 1024 * 1024 * 1024,  // 12 GB
            per_core_cpu: vec![45.0, 50.0, 35.0, 60.0],
            battery: BatteryStatus::Available {
                level: 85.0,
                charging: ChargingState::Charging,
            },
        }
    }

    #[test]
    fn test_reports_dir_ends_with_reports() {
        let dir = reports_dir();
        assert!(dir.ends_with(".mindow/reports") || dir.ends_with(".mindow\\reports"));
    }

    #[test]
    fn test_report_filename_format() {
        let filename = report_filename();
        // Should match YYYY-MM-DD_HH-MM-SS.md pattern
        assert!(filename.ends_with(".md"));
        assert_eq!(filename.len(), "2024-01-15_14-30-25.md".len());
        // Verify date separators
        assert_eq!(&filename[4..5], "-");
        assert_eq!(&filename[7..8], "-");
        assert_eq!(&filename[10..11], "_");
        assert_eq!(&filename[13..14], "-");
        assert_eq!(&filename[16..17], "-");
    }

    #[test]
    fn test_build_report_header_contains_metadata() {
        let system = sample_system();
        let alerts = vec![Alert::HighCpu {
            process_name: "chrome.exe".to_string(),
            pid: 1234,
            average_cpu: 92.3,
            duration_secs: 50,
        }];

        let header = build_report_header(&system, &alerts);

        assert!(header.contains("# Mindow System Analysis Report"));
        assert!(header.contains("**Generated**:"));
        assert!(header.contains("**Memory**:"));
        assert!(header.contains("**CPU Average**:"));
        assert!(header.contains("**Battery**: 85% (Charging)"));
        assert!(header.contains("## Active Alerts (1)"));
        assert!(header.contains("chrome.exe"));
        assert!(header.contains("---"));
    }

    #[test]
    fn test_build_report_header_no_alerts() {
        let system = sample_system();
        let alerts: Vec<Alert> = vec![];

        let header = build_report_header(&system, &alerts);

        assert!(!header.contains("## Active Alerts"));
        assert!(header.contains("---"));
    }

    #[test]
    fn test_build_report_header_battery_unavailable() {
        let system = SystemSample {
            total_memory: 8 * 1024 * 1024 * 1024,
            used_memory: 4 * 1024 * 1024 * 1024,
            per_core_cpu: vec![20.0, 30.0],
            battery: BatteryStatus::Unavailable,
        };

        let header = build_report_header(&system, &[]);
        assert!(header.contains("**Battery**: N/A"));
    }

    #[test]
    fn test_build_report_header_empty_cpu() {
        let system = SystemSample {
            total_memory: 8 * 1024 * 1024 * 1024,
            used_memory: 4 * 1024 * 1024 * 1024,
            per_core_cpu: vec![],
            battery: BatteryStatus::Unavailable,
        };

        let header = build_report_header(&system, &[]);
        assert!(header.contains("**CPU Average**: 0.0%"));
    }

    #[test]
    fn test_build_report_header_zero_memory() {
        let system = SystemSample {
            total_memory: 0,
            used_memory: 0,
            per_core_cpu: vec![50.0],
            battery: BatteryStatus::Unavailable,
        };

        let header = build_report_header(&system, &[]);
        assert!(header.contains("**Memory**: 0.0/0.0 GB (0.0%)"));
    }

    #[test]
    fn test_save_report_creates_file() {
        let dir = tempfile::tempdir().unwrap();
        let reports_path = dir.path().join("reports");

        // We test using a custom path to avoid writing to user's home
        fs::create_dir_all(&reports_path).unwrap();
        let filename = report_filename();
        let path = reports_path.join(&filename);

        let header = "# Test Report\n\n";
        let ai_content = "This is AI analysis content.";
        let content = format!("{}{}", header, ai_content);
        fs::write(&path, &content).unwrap();

        let saved = fs::read_to_string(&path).unwrap();
        assert!(saved.contains("# Test Report"));
        assert!(saved.contains("This is AI analysis content."));
    }

    #[test]
    fn test_save_partial_report_contains_interruption_marker() {
        let dir = tempfile::tempdir().unwrap();
        let reports_path = dir.path().join("reports");
        fs::create_dir_all(&reports_path).unwrap();

        let filename = format!("partial_{}", report_filename());
        let path = reports_path.join(&filename);

        let header = "# Test Report\n\n";
        let partial = "Partial content here";
        let content = format!(
            "{}\n\n[Report incomplete - stream was interrupted]\n\n{}",
            header, partial
        );
        fs::write(&path, &content).unwrap();

        let saved = fs::read_to_string(&path).unwrap();
        assert!(saved.contains("[Report incomplete - stream was interrupted]"));
        assert!(saved.contains("Partial content here"));
    }
}
