/**
 * Property test for textarea auto-grow bounds.
 * Feature: mindow-ui-overhaul, Property 11: Textarea auto-grow bounds
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeRows } from "../../pages/AIPage";

describe("Property 11: Textarea auto-grow bounds", () => {
  it("rows = min(newlineCount + 1, 5) for any input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const newlineCount = (text.match(/\n/g) || []).length;
        const expected = Math.min(newlineCount + 1, 5);
        const result = computeRows(text);
        expect(result).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it("result is always >= 1", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        expect(computeRows(text)).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });

  it("result is always <= 5", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        expect(computeRows(text)).toBeLessThanOrEqual(5);
      }),
      { numRuns: 200 }
    );
  });

  it("text with exactly N newlines gives N+1 rows (when N < 5)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (n) => {
        const text = "hello" + "\n".repeat(n);
        expect(computeRows(text)).toBe(n + 1);
      }),
      { numRuns: 100 }
    );
  });

  it("text with >= 4 newlines always gives 5 rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 50 }), (n) => {
        const text = "x\n".repeat(n);
        expect(computeRows(text)).toBe(5);
      }),
      { numRuns: 100 }
    );
  });
});
