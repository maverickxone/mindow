import { SAMPLING_INTERVAL_SECS } from "./constants";

/**
 * Unified byte formatter used across ALL components.
 * Rules:
 * - B < 1024 → integer bytes "N B"
 * - KB range [1024, 1024²) → 1 decimal "N.N KB"
 * - MB range [1024², 1024³) → 1 decimal "N.N MB"
 * - GB range [≥ 1024³) → 2 decimals "N.NN GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format CPU/memory percentage with consistent 1 decimal precision.
 * Returns "0%" for values < 0.05.
 */
export function formatPercent(value: number): string {
  if (value < 0.05) return "0%";
  return `${value.toFixed(1)}%`;
}

/**
 * Format bytes per second as rate string with appropriate unit.
 */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Format a per-interval byte count as a per-second I/O rate.
 * The backend reports bytes accumulated over one sampling interval, so we
 * divide by the interval to get bytes/second before formatting.
 * Returns "—" (em-dash) for zero values.
 */
export function formatDiskRate(bytesPerInterval: number): string {
  const bytesPerSec = bytesPerInterval / SAMPLING_INTERVAL_SECS;
  if (bytesPerSec < 1) return "—";
  return formatRate(bytesPerSec);
}
