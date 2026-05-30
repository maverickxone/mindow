// Property: Path Classification
//
// For any process with an executable path:
// - If path starts with a system directory (C:\Windows\, C:\Program Files\WindowsApps\)
//   → PathStatus::System
// - If path is absent (None) → PathStatus::Unknown
// - Otherwise → PathStatus::User

use proptest::prelude::*;
use mindow_core::filter::classify_path;
use mindow_core::types::PathStatus;

/// System directory prefixes (lowercase for comparison).
const SYSTEM_PREFIXES: &[&str] = &[
    r"C:\Windows\",
    r"C:\Program Files\WindowsApps\",
];

/// Strategy that generates arbitrary Option<String> paths.
fn arbitrary_path() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        "[a-zA-Z0-9_\\\\/:. ()\\-]{0,200}".prop_map(Some),
    ]
}

/// Strategy that generates paths starting with a system prefix (with random case).
fn system_path_strategy() -> impl Strategy<Value = String> {
    let prefix_strategy = prop_oneof![
        Just(r"C:\Windows\".to_string()),
        Just(r"C:\Program Files\WindowsApps\".to_string()),
        Just(r"c:\windows\".to_string()),
        Just(r"c:\WINDOWS\".to_string()),
        Just(r"C:\WINDOWS\".to_string()),
        Just(r"c:\program files\windowsapps\".to_string()),
        Just(r"C:\PROGRAM FILES\WINDOWSAPPS\".to_string()),
    ];
    let suffix_strategy = "[a-zA-Z0-9_\\\\/.]{0,100}";
    (prefix_strategy, suffix_strategy).prop_map(|(prefix, suffix)| format!("{}{}", prefix, suffix))
}

/// Strategy that generates paths NOT starting with any system prefix.
fn user_path_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        // Paths on other drives
        "[D-Z]:\\\\[a-zA-Z0-9_\\\\/.]{1,100}".prop_map(|s| s),
        // Paths in Program Files (not WindowsApps)
        Just(r"C:\Program Files\".to_string())
            .prop_flat_map(|prefix| "[a-zA-Z0-9_\\\\/.]{1,80}".prop_map(move |s| format!("{}{}", prefix, s))),
        // Paths in user directories
        Just(r"C:\Users\".to_string())
            .prop_flat_map(|prefix| "[a-zA-Z0-9_\\\\/.]{1,80}".prop_map(move |s| format!("{}{}", prefix, s))),
        // Random paths
        "/[a-z]{1,50}/[a-z]{1,50}".prop_map(|s| s),
    ]
}

/// Helper: check if a path starts with a system prefix (case-insensitive).
fn starts_with_system_prefix(path: &str) -> bool {
    let lower = path.to_lowercase();
    SYSTEM_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(&prefix.to_lowercase()))
}

proptest! {
    /// For arbitrary Option<String> paths, classify_path produces
    /// the correct PathStatus according to the classification rules.
    #[test]
    fn prop_path_classification_arbitrary(path in arbitrary_path()) {
        let result = classify_path(&path);
        match &path {
            None => {
                prop_assert_eq!(result, PathStatus::Unknown,
                    "None path should be classified as Unknown");
            }
            Some(p) => {
                if starts_with_system_prefix(p) {
                    prop_assert_eq!(result, PathStatus::System,
                        "Path {:?} starts with a system prefix, should be System", p);
                } else {
                    prop_assert_eq!(result, PathStatus::User,
                        "Path {:?} does not start with a system prefix, should be User", p);
                }
            }
        }
    }

    /// Paths with system prefixes (including case variations) are always System.
    #[test]
    fn prop_system_paths_classified_as_system(path in system_path_strategy()) {
        let result = classify_path(&Some(path.clone()));
        prop_assert_eq!(result, PathStatus::System,
            "Path {:?} with system prefix should be classified as System", path);
    }

    /// Paths that do NOT start with any system prefix are always User.
    #[test]
    fn prop_non_system_paths_classified_as_user(path in user_path_strategy()) {
        let result = classify_path(&Some(path.clone()));
        prop_assert_eq!(result, PathStatus::User,
            "Path {:?} without system prefix should be classified as User", path);
    }

    /// None is always classified as Unknown.
    #[test]
    fn prop_none_path_always_unknown(_dummy in 0..100u32) {
        let result = classify_path(&None);
        prop_assert_eq!(result, PathStatus::Unknown,
            "None path must always be classified as Unknown");
    }

    /// Classification is case-insensitive for system prefixes.
    #[test]
    fn prop_case_insensitive_system_prefix(
        prefix_idx in 0usize..2,
        suffix in "[a-zA-Z0-9_\\\\/.]{1,50}",
        seed in any::<u64>(),
    ) {
        let prefixes = [
            r"C:\Windows\",
            r"C:\Program Files\WindowsApps\",
        ];
        let base_prefix = prefixes[prefix_idx];

        let randomized: String = base_prefix
            .chars()
            .enumerate()
            .map(|(i, c)| {
                if (seed >> (i % 64)) & 1 == 1 {
                    c.to_uppercase().next().unwrap_or(c)
                } else {
                    c.to_lowercase().next().unwrap_or(c)
                }
            })
            .collect();

        let path = format!("{}{}", randomized, suffix);
        let result = classify_path(&Some(path.clone()));
        prop_assert_eq!(result, PathStatus::System,
            "Path {:?} (case-randomized system prefix) should be System", path);
    }
}
