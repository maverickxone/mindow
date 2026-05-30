//! Integration tests for the `mindow` CLI binary.
//!
//! These tests invoke the compiled binary via `assert_cmd` and verify:
//! - Exit codes (success/failure)
//! - Stdout/stderr content
//! - Argument parsing behavior
//!
//! Requirements validated: 9.1, 10.1, 11.1, 11.2

use assert_cmd::Command;
use predicates::prelude::*;

/// Helper to get a Command for the mindow binary.
fn mindow_cmd() -> Command {
    Command::cargo_bin("mindow").unwrap()
}

// --- Test 1: `mindow status` exits with code 0 and produces non-empty stdout ---

#[test]
fn status_exits_ok_with_output() {
    mindow_cmd()
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

// --- Test 2: `mindow status --top 5` accepts the flag and exits 0 ---

#[test]
fn status_with_top_flag_exits_ok() {
    mindow_cmd()
        .args(["status", "--top", "5"])
        .assert()
        .success();
}

// --- Test 3: `mindow status --top 0` exits 0 but stderr contains a warning about top_n ---

#[test]
fn status_top_zero_produces_warning() {
    mindow_cmd()
        .args(["status", "--top", "0"])
        .assert()
        .success()
        .stderr(predicate::str::contains("top_n"));
}

// --- Test 4: `mindow status --cpu-threshold 200` exits 0 but stderr warns about cpu_threshold ---

#[test]
fn status_cpu_threshold_out_of_range_produces_warning() {
    mindow_cmd()
        .args(["status", "--cpu-threshold", "200"])
        .assert()
        .success()
        .stderr(predicate::str::contains("cpu_threshold"));
}

// --- Test 5: `mindow status --interval 0` exits 0 but stderr warns about interval_secs ---

#[test]
fn status_interval_zero_produces_warning() {
    mindow_cmd()
        .args(["status", "--interval", "0"])
        .assert()
        .success()
        .stderr(predicate::str::contains("interval_secs"));
}

// --- Test 6: All flags together accepted ---

#[test]
fn status_all_flags_together_exits_ok() {
    mindow_cmd()
        .args([
            "status",
            "--top", "5",
            "--interval", "5",
            "--cpu-threshold", "90",
            "--mem-samples", "3",
            "--cpu-samples", "3",
        ])
        .assert()
        .success();
}

// --- Test 7: Unknown flag exits non-zero (clap rejects it) ---

#[test]
fn unknown_flag_exits_with_error() {
    mindow_cmd()
        .args(["status", "--unknown-flag"])
        .assert()
        .failure();
}

// --- Test 8: No subcommand enters interactive mode and exits cleanly ---

#[test]
fn no_subcommand_enters_interactive_mode() {
    mindow_cmd()
        .assert()
        .success();
}
