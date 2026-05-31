/**
 * Property test for heat gradient monotonicity.
 * Feature: mindow-ui-overhaul, Property 1: Heat gradient monotonicity
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getHeatHue } from "../../lib/heat";

describe("Property 1: Heat gradient monotonicity", () => {
  it("for any p1 < p2 in [0,100], hue(p1) >= hue(p2)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        fc.float({ min: 0, max: 100, noNaN: true }),
        (a, b) => {
          const p1 = Math.min(a, b);
          const p2 = Math.max(a, b);
          if (p1 === p2) return; // skip equal values
          const hue1 = getHeatHue(p1);
          const hue2 = getHeatHue(p2);
          expect(hue1).toBeGreaterThanOrEqual(hue2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("hue at 0% is 142 (green)", () => {
    expect(getHeatHue(0)).toBe(142);
  });

  it("hue at 100% is 0 (red)", () => {
    expect(getHeatHue(100)).toBe(0);
  });

  it("hue is always in [0, 142] range for any input in [0, 100]", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 100, noNaN: true }), (p) => {
        const hue = getHeatHue(p);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(142);
      }),
      { numRuns: 200 }
    );
  });
});
