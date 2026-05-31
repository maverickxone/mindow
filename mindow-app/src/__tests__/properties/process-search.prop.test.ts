/**
 * Property tests for process table logic.
 * Feature: mindow-ui-overhaul, Property 6: Process search filter correctness
 * Feature: mindow-ui-overhaul, Property 8: Global sort order
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { filterProcesses, sortProcesses } from "../../stores/processStore";
import type { ProcessInfo } from "../../types";

/** Minimal ProcessInfo factory for testing */
function makeProcess(name: string, pid: number): ProcessInfo {
  return {
    pid,
    name,
    cpu_percent: Math.random() * 100,
    memory_bytes: Math.floor(Math.random() * 1024 * 1024 * 1024),
    disk_read_bytes: 0,
    disk_write_bytes: 0,
    path_status: "User",
    exe_path: null,
    baseline_deviation: null,
  } as ProcessInfo;
}

// ─── Property 6: Process search filter correctness ───────────────────────────

describe("Property 6: Process search filter correctness", () => {
  const processArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    pid: fc.integer({ min: 1, max: 99999 }),
  });

  it("numeric query matches PID exactly OR name containing the digits", () => {
    fc.assert(
      fc.property(
        fc.array(processArb, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 99999 }),
        (procs, queryPid) => {
          const processes = procs.map((p) => makeProcess(p.name, p.pid));
          const query = queryPid.toString();
          const result = filterProcesses(processes, query);

          // Every returned process must match the criteria
          for (const p of result) {
            const matchesName = p.name.toLowerCase().includes(query.toLowerCase());
            const matchesPid = p.pid.toString() === query;
            expect(matchesName || matchesPid).toBe(true);
          }

          // No matching process should be excluded
          for (const p of processes) {
            const matchesName = p.name.toLowerCase().includes(query.toLowerCase());
            const matchesPid = p.pid.toString() === query;
            if (matchesName || matchesPid) {
              expect(result).toContain(p);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("non-numeric query matches name case-insensitively", () => {
    fc.assert(
      fc.property(
        fc.array(processArb, { minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !/^\d+$/.test(s.trim()) && s.trim().length > 0),
        (procs, query) => {
          const processes = procs.map((p) => makeProcess(p.name, p.pid));
          const result = filterProcesses(processes, query);
          const lowerQuery = query.trim().toLowerCase();

          // Every returned process must match
          for (const p of result) {
            expect(p.name.toLowerCase()).toContain(lowerQuery);
          }

          // No matching process should be excluded
          for (const p of processes) {
            if (p.name.toLowerCase().includes(lowerQuery)) {
              expect(result).toContain(p);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("empty query returns all processes", () => {
    fc.assert(
      fc.property(
        fc.array(processArb, { minLength: 0, maxLength: 20 }),
        (procs) => {
          const processes = procs.map((p) => makeProcess(p.name, p.pid));
          const result = filterProcesses(processes, "");
          expect(result.length).toBe(processes.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 8: Global sort order ───────────────────────────────────────────

describe("Property 8: Global sort order", () => {
  const processArb2 = fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    pid: fc.integer({ min: 1, max: 99999 }),
  });

  it("sorted by cpu desc maintains global ordering", () => {
    fc.assert(
      fc.property(
        fc.array(processArb2, { minLength: 2, maxLength: 30 }),
        (procs) => {
          const processes = procs.map((p) => makeProcess(p.name, p.pid));
          // Give each process a distinct CPU value
          processes.forEach((p, i) => {
            p.cpu_percent = (i + 1) * 3.7;
          });

          const sorted = sortProcesses(processes, "cpu", "desc");

          // Verify global ordering: each element's cpu should be >= next
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].cpu_percent).toBeGreaterThanOrEqual(sorted[i + 1].cpu_percent);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sorted by memory asc maintains global ordering", () => {
    fc.assert(
      fc.property(
        fc.array(processArb2, { minLength: 2, maxLength: 30 }),
        (procs) => {
          const processes = procs.map((p) => makeProcess(p.name, p.pid));
          processes.forEach((p, i) => {
            p.memory_bytes = (i + 1) * 1024 * 1024;
          });

          const sorted = sortProcesses(processes, "memory", "asc");

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].memory_bytes).toBeLessThanOrEqual(sorted[i + 1].memory_bytes);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
