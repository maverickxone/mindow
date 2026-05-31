import { describe, it, expect } from "vitest";
import { formatBytes, formatPercent, formatRate, formatDiskRate } from "./format";

describe("formatBytes", () => {
  it("formats values < 1024 as integer bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB range with 1 decimal place", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1023)).toBe("1023.0 KB");
  });

  it("formats MB range with 1 decimal place", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(1024 * 1024 * 999)).toBe("999.0 MB");
  });

  it("formats GB range with 2 decimal places", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 16)).toBe("16.00 GB");
  });
});

describe("formatPercent", () => {
  it("returns '0%' for values < 0.05", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.04)).toBe("0%");
    expect(formatPercent(0.049)).toBe("0%");
  });

  it("formats values >= 0.05 with 1 decimal place", () => {
    expect(formatPercent(0.05)).toBe("0.1%");
    expect(formatPercent(0.1)).toBe("0.1%");
    expect(formatPercent(50.0)).toBe("50.0%");
    expect(formatPercent(99.9)).toBe("99.9%");
    expect(formatPercent(100)).toBe("100.0%");
  });
});

describe("formatRate", () => {
  it("formats bytes per second as rate string", () => {
    expect(formatRate(0)).toBe("0 B/s");
    expect(formatRate(1024)).toBe("1.0 KB/s");
    expect(formatRate(1024 * 1024)).toBe("1.0 MB/s");
    expect(formatRate(1024 * 1024 * 1024)).toBe("1.00 GB/s");
  });
});

describe("formatDiskRate", () => {
  it("returns em-dash for zero values", () => {
    expect(formatDiskRate(0)).toBe("—");
  });

  it("returns em-dash for very small values that result in < 1 byte/sec", () => {
    // SAMPLING_INTERVAL_SECS is 2, so 1 byte per interval = 0.5 bytes/sec < 1
    expect(formatDiskRate(1)).toBe("—");
  });

  it("formats non-zero values as rate", () => {
    // 2048 bytes per interval / 2s = 1024 bytes/sec = 1.0 KB/s
    expect(formatDiskRate(2048)).toBe("1.0 KB/s");
    // 2 * 1024 * 1024 per interval / 2s = 1024*1024 bytes/sec = 1.0 MB/s
    expect(formatDiskRate(2 * 1024 * 1024)).toBe("1.0 MB/s");
  });
});
