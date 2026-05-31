import { describe, it, expect } from "vitest";
import { getHeatColor, getHeatHue, getResourceHeatBg } from "./heat";

describe("getHeatColor", () => {
  it("returns green hue at 0%", () => {
    const color = getHeatColor(0);
    expect(color).toMatch(/^hsl\(142,/);
  });

  it("returns yellow hue around 50%", () => {
    const color = getHeatColor(50);
    expect(color).toMatch(/^hsl\(60,/);
  });

  it("returns orange hue around 75%", () => {
    const color = getHeatColor(75);
    expect(color).toMatch(/^hsl\(30,/);
  });

  it("returns red hue at 100%", () => {
    const color = getHeatColor(100);
    expect(color).toMatch(/^hsl\(0,/);
  });

  it("clamps values below 0 to green", () => {
    expect(getHeatColor(-10)).toBe(getHeatColor(0));
  });

  it("clamps values above 100 to red", () => {
    expect(getHeatColor(150)).toBe(getHeatColor(100));
  });

  it("returns valid hsl string format", () => {
    const color = getHeatColor(42);
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });
});

describe("getHeatHue", () => {
  it("returns 142 at 0%", () => {
    expect(getHeatHue(0)).toBe(142);
  });

  it("returns 60 at 50%", () => {
    expect(getHeatHue(50)).toBe(60);
  });

  it("returns 30 at 75%", () => {
    expect(getHeatHue(75)).toBe(30);
  });

  it("returns 0 at 100%", () => {
    expect(getHeatHue(100)).toBe(0);
  });

  it("monotonically decreases — lower percent always has higher hue", () => {
    const samples = [0, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 100];
    for (let i = 0; i < samples.length - 1; i++) {
      expect(getHeatHue(samples[i])).toBeGreaterThanOrEqual(getHeatHue(samples[i + 1]));
    }
  });
});

describe("getResourceHeatBg", () => {
  it("returns transparent for values below 5%", () => {
    expect(getResourceHeatBg(0, "cpu")).toBe("transparent");
    expect(getResourceHeatBg(4, "memory")).toBe("transparent");
  });

  it("returns hsla with CPU hue (168) for cpu resource", () => {
    const bg = getResourceHeatBg(50, "cpu");
    expect(bg).toMatch(/^hsla\(168,/);
  });

  it("returns hsla with Memory hue (230) for memory resource", () => {
    const bg = getResourceHeatBg(50, "memory");
    expect(bg).toMatch(/^hsla\(230,/);
  });

  it("opacity increases with percentage", () => {
    const low = getResourceHeatBg(20, "cpu");
    const high = getResourceHeatBg(80, "cpu");
    // Extract opacity values
    const opacityLow = parseFloat(low.match(/[\d.]+\)$/)?.[0] ?? "0");
    const opacityHigh = parseFloat(high.match(/[\d.]+\)$/)?.[0] ?? "0");
    expect(opacityHigh).toBeGreaterThan(opacityLow);
  });

  it("returns valid hsla string format for non-trivial values", () => {
    const bg = getResourceHeatBg(60, "memory");
    expect(bg).toMatch(/^hsla\(\d+, \d+%, \d+%, [\d.]+\)$/);
  });

  it("clamps values to 0-100 range", () => {
    expect(getResourceHeatBg(-10, "cpu")).toBe("transparent");
    const over = getResourceHeatBg(150, "memory");
    expect(over).toMatch(/^hsla\(230,/);
  });
});
