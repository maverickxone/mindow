// Feature: mindow-v05, Property 12: Config Validation Fallback
//
// For any raw configuration value that is outside its valid range
// (interval < 1, threshold > 100, top < 1, samples < 1), the validated
// config SHALL use the default value for that field and SHALL produce
// a non-empty warning message describing the invalid input.
//
// Validates: Requirements 11.2

use proptest::prelude::*;
use mindow_core::config::{validate_config, Config, RawConfig};

proptest! {
    /// Property 12: When top_n is 0 (out of range), the validated config uses
    /// the default and a warning is produced. When top_n >= 1, it passes through
    /// unchanged with no warning for that field.
    #[test]
    fn prop_top_n_validation(top_n in 0usize..1000) {
        let raw = RawConfig {
            top_n: Some(top_n),
            ..Default::default()
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        if top_n < 1 {
            // Out of range: must use default and produce warning
            prop_assert_eq!(result.config.top_n, defaults.top_n);
            prop_assert!(
                result.warnings.iter().any(|w| w.contains("top_n")),
                "Expected a warning mentioning 'top_n' for invalid value {}",
                top_n
            );
        } else {
            // In range: pass through unchanged, no warning for this field
            prop_assert_eq!(result.config.top_n, top_n);
            prop_assert!(
                !result.warnings.iter().any(|w| w.contains("top_n")),
                "Expected no warning for valid top_n value {}",
                top_n
            );
        }
    }

    /// Property 12: When interval_secs is 0 (out of range), the validated config
    /// uses the default and a warning is produced. When interval_secs >= 1, it
    /// passes through unchanged.
    #[test]
    fn prop_interval_secs_validation(interval_secs in 0u64..1000) {
        let raw = RawConfig {
            interval_secs: Some(interval_secs),
            ..Default::default()
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        if interval_secs < 1 {
            prop_assert_eq!(result.config.interval_secs, defaults.interval_secs);
            prop_assert!(
                result.warnings.iter().any(|w| w.contains("interval_secs")),
                "Expected a warning mentioning 'interval_secs' for invalid value {}",
                interval_secs
            );
        } else {
            prop_assert_eq!(result.config.interval_secs, interval_secs);
            prop_assert!(
                !result.warnings.iter().any(|w| w.contains("interval_secs")),
                "Expected no warning for valid interval_secs value {}",
                interval_secs
            );
        }
    }

    /// Property 12: When cpu_threshold is <= 0 or > 100 (out of range), the
    /// validated config uses the default and a warning is produced. When
    /// cpu_threshold is in (0, 100], it passes through unchanged.
    #[test]
    fn prop_cpu_threshold_validation(cpu_threshold in -200.0f32..300.0) {
        let raw = RawConfig {
            cpu_threshold: Some(cpu_threshold),
            ..Default::default()
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        if cpu_threshold <= 0.0 || cpu_threshold > 100.0 {
            prop_assert_eq!(result.config.cpu_threshold, defaults.cpu_threshold);
            prop_assert!(
                result.warnings.iter().any(|w| w.contains("cpu_threshold")),
                "Expected a warning mentioning 'cpu_threshold' for invalid value {}",
                cpu_threshold
            );
        } else {
            prop_assert_eq!(result.config.cpu_threshold, cpu_threshold);
            prop_assert!(
                !result.warnings.iter().any(|w| w.contains("cpu_threshold")),
                "Expected no warning for valid cpu_threshold value {}",
                cpu_threshold
            );
        }
    }

    /// Property 12: When mem_samples is 0 (out of range), the validated config
    /// uses the default and a warning is produced. When mem_samples >= 1, it
    /// passes through unchanged.
    #[test]
    fn prop_mem_samples_validation(mem_samples in 0usize..1000) {
        let raw = RawConfig {
            mem_samples: Some(mem_samples),
            ..Default::default()
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        if mem_samples < 1 {
            prop_assert_eq!(result.config.mem_samples, defaults.mem_samples);
            prop_assert!(
                result.warnings.iter().any(|w| w.contains("mem_samples")),
                "Expected a warning mentioning 'mem_samples' for invalid value {}",
                mem_samples
            );
        } else {
            prop_assert_eq!(result.config.mem_samples, mem_samples);
            prop_assert!(
                !result.warnings.iter().any(|w| w.contains("mem_samples")),
                "Expected no warning for valid mem_samples value {}",
                mem_samples
            );
        }
    }

    /// Property 12: When cpu_samples is 0 (out of range), the validated config
    /// uses the default and a warning is produced. When cpu_samples >= 1, it
    /// passes through unchanged.
    #[test]
    fn prop_cpu_samples_validation(cpu_samples in 0usize..1000) {
        let raw = RawConfig {
            cpu_samples: Some(cpu_samples),
            ..Default::default()
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        if cpu_samples < 1 {
            prop_assert_eq!(result.config.cpu_samples, defaults.cpu_samples);
            prop_assert!(
                result.warnings.iter().any(|w| w.contains("cpu_samples")),
                "Expected a warning mentioning 'cpu_samples' for invalid value {}",
                cpu_samples
            );
        } else {
            prop_assert_eq!(result.config.cpu_samples, cpu_samples);
            prop_assert!(
                !result.warnings.iter().any(|w| w.contains("cpu_samples")),
                "Expected no warning for valid cpu_samples value {}",
                cpu_samples
            );
        }
    }

    /// Property 12: Combined test — for any arbitrary RawConfig with all fields
    /// set, each invalid field uses its default and produces a warning, while
    /// valid fields pass through unchanged.
    #[test]
    fn prop_combined_config_validation(
        top_n in 0usize..100,
        interval_secs in 0u64..100,
        cpu_threshold in -50.0f32..200.0,
        mem_samples in 0usize..100,
        cpu_samples in 0usize..100,
    ) {
        let raw = RawConfig {
            top_n: Some(top_n),
            interval_secs: Some(interval_secs),
            cpu_threshold: Some(cpu_threshold),
            mem_samples: Some(mem_samples),
            cpu_samples: Some(cpu_samples),
        };
        let result = validate_config(raw);
        let defaults = Config::default();

        // Count expected warnings
        let mut expected_warnings = 0;

        // top_n
        if top_n < 1 {
            prop_assert_eq!(result.config.top_n, defaults.top_n);
            expected_warnings += 1;
        } else {
            prop_assert_eq!(result.config.top_n, top_n);
        }

        // interval_secs
        if interval_secs < 1 {
            prop_assert_eq!(result.config.interval_secs, defaults.interval_secs);
            expected_warnings += 1;
        } else {
            prop_assert_eq!(result.config.interval_secs, interval_secs);
        }

        // cpu_threshold
        if cpu_threshold <= 0.0 || cpu_threshold > 100.0 {
            prop_assert_eq!(result.config.cpu_threshold, defaults.cpu_threshold);
            expected_warnings += 1;
        } else {
            prop_assert_eq!(result.config.cpu_threshold, cpu_threshold);
        }

        // mem_samples
        if mem_samples < 1 {
            prop_assert_eq!(result.config.mem_samples, defaults.mem_samples);
            expected_warnings += 1;
        } else {
            prop_assert_eq!(result.config.mem_samples, mem_samples);
        }

        // cpu_samples
        if cpu_samples < 1 {
            prop_assert_eq!(result.config.cpu_samples, defaults.cpu_samples);
            expected_warnings += 1;
        } else {
            prop_assert_eq!(result.config.cpu_samples, cpu_samples);
        }

        // Total warnings should match
        prop_assert_eq!(
            result.warnings.len(),
            expected_warnings,
            "Expected {} warnings but got {}: {:?}",
            expected_warnings,
            result.warnings.len(),
            result.warnings
        );
    }

    /// Property 12: When a field is None (not provided), the config uses the
    /// default with no warning — None is not "out of range."
    #[test]
    fn prop_none_fields_use_defaults_no_warnings(
        has_top in any::<bool>(),
        has_interval in any::<bool>(),
        has_threshold in any::<bool>(),
        has_mem in any::<bool>(),
        has_cpu in any::<bool>(),
    ) {
        let raw = RawConfig {
            top_n: if has_top { Some(5) } else { None },
            interval_secs: if has_interval { Some(5) } else { None },
            cpu_threshold: if has_threshold { Some(50.0) } else { None },
            mem_samples: if has_mem { Some(3) } else { None },
            cpu_samples: if has_cpu { Some(3) } else { None },
        };
        let result = validate_config(raw);

        // All provided values are valid, so no warnings should be produced
        prop_assert!(
            result.warnings.is_empty(),
            "Expected no warnings for valid/None inputs, got: {:?}",
            result.warnings
        );

        // None fields should use defaults
        let defaults = Config::default();
        if !has_top { prop_assert_eq!(result.config.top_n, defaults.top_n); }
        if !has_interval { prop_assert_eq!(result.config.interval_secs, defaults.interval_secs); }
        if !has_threshold { prop_assert_eq!(result.config.cpu_threshold, defaults.cpu_threshold); }
        if !has_mem { prop_assert_eq!(result.config.mem_samples, defaults.mem_samples); }
        if !has_cpu { prop_assert_eq!(result.config.cpu_samples, defaults.cpu_samples); }
    }
}
