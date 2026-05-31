/**
 * Backend sampling interval in seconds.
 *
 * Must stay in sync with `SAMPLING_INTERVAL_SECS` in
 * `src-tauri/src/sampling.rs`. Per-interval byte counts (disk I/O) are
 * divided by this value to convert them into per-second rates for display.
 */
export const SAMPLING_INTERVAL_SECS = 1;
