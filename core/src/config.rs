// Configuration and validation for Mindow

/// Default values for configuration fields.
const DEFAULT_TOP_N: usize = 25;
const DEFAULT_INTERVAL_SECS: u64 = 10;
const DEFAULT_CPU_THRESHOLD: f32 = 80.0;
const DEFAULT_MEM_SAMPLES: usize = 15;
const DEFAULT_CPU_SAMPLES: usize = 10;

/// Validated configuration for Mindow.
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub top_n: usize,
    pub interval_secs: u64,
    pub cpu_threshold: f32,
    pub mem_samples: usize,
    pub cpu_samples: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            top_n: DEFAULT_TOP_N,
            interval_secs: DEFAULT_INTERVAL_SECS,
            cpu_threshold: DEFAULT_CPU_THRESHOLD,
            mem_samples: DEFAULT_MEM_SAMPLES,
            cpu_samples: DEFAULT_CPU_SAMPLES,
        }
    }
}

/// Raw configuration input that may contain invalid values.
/// Fields are `Option` to represent user-provided or absent values.
#[derive(Debug, Clone, Default)]
pub struct RawConfig {
    pub top_n: Option<usize>,
    pub interval_secs: Option<u64>,
    pub cpu_threshold: Option<f32>,
    pub mem_samples: Option<usize>,
    pub cpu_samples: Option<usize>,
}

/// Result of config validation: a valid config plus any warnings generated.
#[derive(Debug, Clone)]
pub struct ConfigValidationResult {
    pub config: Config,
    pub warnings: Vec<String>,
}

/// Validates raw configuration values, clamping out-of-range values to defaults
/// and collecting descriptive warning messages.
///
/// Validation rules:
/// - `top_n < 1` → use default (10), emit warning
/// - `interval_secs < 1` → use default (10), emit warning
/// - `cpu_threshold > 100.0` or `cpu_threshold <= 0.0` → use default (80.0), emit warning
/// - `mem_samples < 1` → use default (5), emit warning
/// - `cpu_samples < 1` → use default (5), emit warning
pub fn validate_config(raw: RawConfig) -> ConfigValidationResult {
    let mut warnings = Vec::new();
    let defaults = Config::default();

    let top_n = match raw.top_n {
        Some(0) => {
            warnings.push(format!(
                "top_n value 0 is out of range (must be >= 1), using default {}",
                defaults.top_n
            ));
            defaults.top_n
        }
        Some(v) => v,
        None => defaults.top_n,
    };

    let interval_secs = match raw.interval_secs {
        Some(0) => {
            warnings.push(format!(
                "interval_secs value 0 is out of range (must be >= 1), using default {}",
                defaults.interval_secs
            ));
            defaults.interval_secs
        }
        Some(v) => v,
        None => defaults.interval_secs,
    };

    let cpu_threshold = match raw.cpu_threshold {
        Some(v) if v <= 0.0 || v > 100.0 => {
            warnings.push(format!(
                "cpu_threshold value {} is out of range (must be > 0 and <= 100), using default {}",
                v, defaults.cpu_threshold
            ));
            defaults.cpu_threshold
        }
        Some(v) => v,
        None => defaults.cpu_threshold,
    };

    let mem_samples = match raw.mem_samples {
        Some(0) => {
            warnings.push(format!(
                "mem_samples value 0 is out of range (must be >= 1), using default {}",
                defaults.mem_samples
            ));
            defaults.mem_samples
        }
        Some(v) => v,
        None => defaults.mem_samples,
    };

    let cpu_samples = match raw.cpu_samples {
        Some(0) => {
            warnings.push(format!(
                "cpu_samples value 0 is out of range (must be >= 1), using default {}",
                defaults.cpu_samples
            ));
            defaults.cpu_samples
        }
        Some(v) => v,
        None => defaults.cpu_samples,
    };

    ConfigValidationResult {
        config: Config {
            top_n,
            interval_secs,
            cpu_threshold,
            mem_samples,
            cpu_samples,
        },
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.top_n, 25);
        assert_eq!(config.interval_secs, 10);
        assert_eq!(config.cpu_threshold, 80.0);
        assert_eq!(config.mem_samples, 15);
        assert_eq!(config.cpu_samples, 10);
    }

    #[test]
    fn test_validate_all_none_uses_defaults() {
        let raw = RawConfig::default();
        let result = validate_config(raw);
        assert_eq!(result.config, Config::default());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_valid_values_pass_through() {
        let raw = RawConfig {
            top_n: Some(20),
            interval_secs: Some(5),
            cpu_threshold: Some(90.0),
            mem_samples: Some(10),
            cpu_samples: Some(8),
        };
        let result = validate_config(raw);
        assert_eq!(result.config.top_n, 20);
        assert_eq!(result.config.interval_secs, 5);
        assert_eq!(result.config.cpu_threshold, 90.0);
        assert_eq!(result.config.mem_samples, 10);
        assert_eq!(result.config.cpu_samples, 8);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_top_n_zero_uses_default() {
        let raw = RawConfig {
            top_n: Some(0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.top_n, 25);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("top_n"));
    }

    #[test]
    fn test_validate_interval_zero_uses_default() {
        let raw = RawConfig {
            interval_secs: Some(0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.interval_secs, 10);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("interval_secs"));
    }

    #[test]
    fn test_validate_cpu_threshold_above_100_uses_default() {
        let raw = RawConfig {
            cpu_threshold: Some(101.0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.cpu_threshold, 80.0);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("cpu_threshold"));
    }

    #[test]
    fn test_validate_cpu_threshold_zero_uses_default() {
        let raw = RawConfig {
            cpu_threshold: Some(0.0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.cpu_threshold, 80.0);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("cpu_threshold"));
    }

    #[test]
    fn test_validate_cpu_threshold_negative_uses_default() {
        let raw = RawConfig {
            cpu_threshold: Some(-5.0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.cpu_threshold, 80.0);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("cpu_threshold"));
    }

    #[test]
    fn test_validate_mem_samples_zero_uses_default() {
        let raw = RawConfig {
            mem_samples: Some(0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.mem_samples, 15);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("mem_samples"));
    }

    #[test]
    fn test_validate_cpu_samples_zero_uses_default() {
        let raw = RawConfig {
            cpu_samples: Some(0),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.cpu_samples, 10);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("cpu_samples"));
    }

    #[test]
    fn test_validate_multiple_invalid_produces_multiple_warnings() {
        let raw = RawConfig {
            top_n: Some(0),
            interval_secs: Some(0),
            cpu_threshold: Some(200.0),
            mem_samples: Some(0),
            cpu_samples: Some(0),
        };
        let result = validate_config(raw);
        assert_eq!(result.config, Config::default());
        assert_eq!(result.warnings.len(), 5);
    }

    #[test]
    fn test_validate_boundary_values_are_valid() {
        let raw = RawConfig {
            top_n: Some(1),
            interval_secs: Some(1),
            cpu_threshold: Some(100.0),
            mem_samples: Some(1),
            cpu_samples: Some(1),
        };
        let result = validate_config(raw);
        assert_eq!(result.config.top_n, 1);
        assert_eq!(result.config.interval_secs, 1);
        assert_eq!(result.config.cpu_threshold, 100.0);
        assert_eq!(result.config.mem_samples, 1);
        assert_eq!(result.config.cpu_samples, 1);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_cpu_threshold_smallest_valid() {
        // Just above 0 should be valid
        let raw = RawConfig {
            cpu_threshold: Some(0.1),
            ..Default::default()
        };
        let result = validate_config(raw);
        assert_eq!(result.config.cpu_threshold, 0.1);
        assert!(result.warnings.is_empty());
    }
}
