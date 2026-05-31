/**
 * Property tests for format utilities.
 * Feature: mindow-ui-overhaul, Property 12: Format utility precision consistency
 * Feature: mindow-ui-overhaul, Property 7: Zero disk I/O display
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatBytes, formatPercent, formatDiskRate } from "../../lib/format";

// ─── Property 12: Format utility precision consistency ───────────────────────

describe("Property 12: Format utility precision consistency", () => {
  it("bytes < 1024 are formatted as integer with 'B' suffix", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1023 }), (bytes) => {
        const result = formatBytes(bytes);
        expect(result).toMatch(/^\d+ B$/);
      }),
      { numRuns: 100 }
    );
  });

  it("KB range [1024, 1024²) has exactly 1 decimal place", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1024, max: 1024 * 1024 - 1 }), (bytes) => {
        const result = formatBytes(bytes);
        expect(result).toMatch(/^\d+\.\d KB$/);
      }),
      { numRuns: 100 }
    );
  });

  it("MB range [1024², 1024³) has exactly 1 decimal place", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1024 * 1024, max: 1024 * 1024 * 1024 - 1 }),
        (bytes) => {
          const result = formatBytes(bytes);
          expect(result).toMatch(/^\d+\.\d MB$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("GB range [≥1024³] has exactly 2 decimal places", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1024 * 1024 * 1024, max: 1024 * 1024 * 1024 * 100 }),
        (bytes) => {
          const result = formatBytes(bytes);
          expect(result).toMatch(/^\d+\.\d{2} GB$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatPercent returns '0%' for values < 0.05", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: Math.fround(0.049), noNaN: true }), (value) => {
        expect(formatPercent(value)).toBe("0%");
      }),
      { numRuns: 100 }
    );
  });

  it("formatPercent returns exactly 1 decimal digit for values >= 0.05", () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0.05), max: 100, noNaN: true }), (value) => {
        const result = formatPercent(value);
        expect(result).toMatch(/^\d+\.\d%$/);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 7: Zero disk I/O display ───────────────────────────────────────

describe("Property 7: Zero disk I/O display", () => {
  it("formatDiskRate returns '—' for zero byte values", () => {
    fc.assert(
      fc.property(fc.constant(0), (bytes) => {
        expect(formatDiskRate(bytes)).toBe("—");
      }),
      { numRuns: 100 }
    );
  });

  it("formatDiskRate returns '—' for values that result in < 1 byte/sec", () => {
    // SAMPLING_INTERVAL_SECS = 2, so values 0 and 1 both give < 1 byte/sec
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 }), (bytes) => {
        expect(formatDiskRate(bytes)).toBe("—");
      }),
      { numRuns: 100 }
    );
  });

  it("formatDiskRate returns a rate string for non-trivial values", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2048, max: 1024 * 1024 * 1024 }), (bytes) => {
        const result = formatDiskRate(bytes);
        expect(result).not.toBe("—");
        expect(result).toMatch(/\/s$/);
      }),
      { numRuns: 100 }
    );
  });
});
