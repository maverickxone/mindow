// Feature: mindow-v05, Property 4: Path Classification
//
// For any process with an executable path, if the path does not begin with any
// Standard_Directory prefix (C:\Windows\, C:\Program Files\, C:\Program Files (x86)\),
// the classification SHALL be Suspicious. If the path is absent (None), the
// classification SHALL be Unknown. Otherwise, the classification SHALL be Standard.
//
// **Validates: Requirements 4.1, 4.2**

use proptest::prelude::*;
use mindow_core::filter::classify_path;
use mindow_core::types::PathStatus;

/// Standard directory prefixes (lowercase for comparison).
const STANDARD_PREFIXES: &[&str] = &[
    r"C:\Windows\",
    r"C:\Program Files\",
    r"C:\Program Files (x86)\",
];

/// Strategy that generates arbitrary Option<String> paths.
fn arbitrary_path() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        // None path
        Just(None),
        // Random arbitrary string path
        "[a-zA-Z0-9_\\\\/:. ()\\-]{0,200}".prop_map(Some),
    ]
}

/// Strategy that generates paths starting with a standard prefix (with random case).
fn standard_path_strategy() -> impl Strategy<Value = String> {
    let prefix_strategy = prop_oneof![
        Just(r"C:\Windows\".to_string()),
        Just(r"C:\Program Files\".to_string()),
        Just(r"C:\Program Files (x86)\".to_string()),
        // Case variations
        Just(r"c:\windows\".to_string()),
        Just(r"c:\WINDOWS\".to_string()),
        Just(r"C:\WINDOWS\".to_string()),
        Just(r"c:\program files\".to_string()),
        Just(r"C:\PROGRAM FILES\".to_string()),
        Just(r"c:\Program Files (x86)\".to_string()),
        Just(r"C:\PROGRAM FILES (X86)\".to_string()),
    ];
    let suffix_strategy = "[a-zA-Z0-9_\\\\/.]{0,100}";
    (prefix_strategy, suffix_strategy).prop_map(|(prefix, suffix)| format!("{}{}", prefix, suffix))
}

/// Strategy that generates paths NOT starting with any standard prefix.
fn suspicious_path_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        // Paths on other drives
        "[D-Z]:\\\\[a-zA-Z0-9_\\\\/.]{1,100}".prop_map(|s| s),
        // Paths in user directories
        Just(r"C:\Users\".to_string())
            .prop_flat_map(|prefix| "[a-zA-Z0-9_\\\\/.]{1,80}".prop_map(move |s| format!("{}{}", prefix, s))),
        // Paths in C:\Temp
        Just(r"C:\Temp\".to_string())
            .prop_flat_map(|prefix| "[a-zA-Z0-9_\\\\/.]{1,80}".prop_map(move |s| format!("{}{}", prefix, s))),
        // Random strings that definitely don't start with standard prefixes
        "/[a-z]{1,50}/[a-z]{1,50}".prop_map(|s| s),
        "\\\\\\\\server\\\\share\\\\[a-z]{1,30}".prop_map(|s| s),
    ]
}

/// Helper: check if a path starts with a standard prefix (case-insensitive).
fn starts_with_standard_prefix(path: &str) -> bool {
    let lower = path.to_lowercase();
    STANDARD_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(&prefix.to_lowercase()))
}

proptest! {
    /// Property 4: For arbitrary Option<String> paths, classify_path produces
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
                if starts_with_standard_prefix(p) {
                    prop_assert_eq!(result, PathStatus::Standard,
                        "Path {:?} starts with a standard prefix, should be Standard", p);
                } else {
                    prop_assert_eq!(result, PathStatus::Suspicious,
                        "Path {:?} does not start with a standard prefix, should be Suspicious", p);
                }
            }
        }
    }

    /// Property 4: Paths with standard prefixes (including case variations)
    /// are always classified as Standard.
    #[test]
    fn prop_standard_paths_classified_as_standard(path in standard_path_strategy()) {
        let result = classify_path(&Some(path.clone()));
        prop_assert_eq!(result, PathStatus::Standard,
            "Path {:?} with standard prefix should be classified as Standard", path);
    }

    /// Property 4: Paths that do NOT start with any standard prefix are always
    /// classified as Suspicious.
    #[test]
    fn prop_non_standard_paths_classified_as_suspicious(path in suspicious_path_strategy()) {
        let result = classify_path(&Some(path.clone()));
        prop_assert_eq!(result, PathStatus::Suspicious,
            "Path {:?} without standard prefix should be classified as Suspicious", path);
    }

    /// Property 4: None is always classified as Unknown.
    #[test]
    fn prop_none_path_always_unknown(_dummy in 0..100u32) {
        let result = classify_path(&None);
        prop_assert_eq!(result, PathStatus::Unknown,
            "None path must always be classified as Unknown");
    }

    /// Property 4: Classification is case-insensitive for standard prefixes.
    /// Generate a standard prefix with random casing and verify it's still Standard.
    #[test]
    fn prop_case_insensitive_standard_prefix(
        prefix_idx in 0usize..3,
        suffix in "[a-zA-Z0-9_\\\\/.]{1,50}",
        seed in any::<u64>(),
    ) {
        let prefixes = [
            r"C:\Windows\",
            r"C:\Program Files\",
            r"C:\Program Files (x86)\",
        ];
        let base_prefix = prefixes[prefix_idx];

        // Randomize casing of the prefix based on seed
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
        prop_assert_eq!(result, PathStatus::Standard,
            "Path {:?} (case-randomized standard prefix) should be Standard", path);
    }
}
