import { describe, it, expect } from "vitest";
import { filterProcesses } from "./processStore";
import type { ProcessInfo } from "../types";

/** Helper to create a minimal ProcessInfo for testing */
function makeProcess(name: string, pid: number): ProcessInfo {
  return {
    name,
    pid,
    cpu_percent: 0,
    memory_bytes: 0,
    disk_read_bytes: 0,
    disk_write_bytes: 0,
    path_status: "User",
    instance_count: 1,
    baseline_deviation: null,
    exe_path: null,
    parent_pid: null,
  };
}

describe("filterProcesses", () => {
  const processes: ProcessInfo[] = [
    makeProcess("chrome", 1234),
    makeProcess("firefox", 5678),
    makeProcess("node", 8080),
    makeProcess("code", 9999),
    makeProcess("process1234", 100),
  ];

  it("returns all processes when query is empty", () => {
    expect(filterProcesses(processes, "")).toEqual(processes);
    expect(filterProcesses(processes, "   ")).toEqual(processes);
  });

  it("filters by name (case-insensitive) for non-numeric query", () => {
    const result = filterProcesses(processes, "Chrome");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("chrome");
  });

  it("filters by partial name match for non-numeric query", () => {
    const result = filterProcesses(processes, "re");
    // "re" is in "firefox" (fi-re-fox) only; "chrome" has "me" not "re" at position chro-me
    // Actually: "chrome" → c-h-r-o-m-e (no "re"), "firefox" → f-i-r-e-f-o-x (has "re")
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("firefox");
  });

  it("matches PID exactly for numeric query", () => {
    const result = filterProcesses(processes, "1234");
    // Should match pid 1234 ("chrome") AND name "process1234" (contains "1234")
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toContain("chrome");
    expect(result.map((p) => p.name)).toContain("process1234");
  });

  it("matches PID exactly (no partial PID match) for numeric query", () => {
    const result = filterProcesses(processes, "123");
    // "123" does NOT match pid 1234 (not exact), but matches name "process1234" (contains "123")
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("process1234");
  });

  it("matches only by name when query contains non-digit characters", () => {
    const result = filterProcesses(processes, "80");
    // "80" is numeric → matches pid 8080? No, "8080" !== "80"
    // But "80" is in name? No process has "80" in name
    // Actually "80" is numeric, so we check name.includes("80") OR pid === "80"
    // node has pid 8080 (not exact match), no name contains "80"
    expect(result).toHaveLength(0);
  });

  it("returns exact PID match for numeric query", () => {
    const result = filterProcesses(processes, "8080");
    // pid 8080 is "node"
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("node");
  });

  it("handles non-numeric query that looks partially numeric", () => {
    const result = filterProcesses(processes, "code");
    // Non-numeric → name match only
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("code");
  });
});
