/**
 * Heat color utilities for resource usage visualization.
 *
 * getHeatColor(percent) — returns a CSS hsl() color on the green→yellow→red
 * pressure gradient. Hue smoothly interpolates from 142° (green/safe) at 0%
 * through 60° (yellow/moderate) and 30° (orange/high) to 0° (red/extreme) at 100%.
 *
 * getResourceHeatBg(percent, resource) — returns a CSS background color string
 * using a resource-specific hue (CPU=teal 168°, Memory=blue 230°) with opacity
 * proportional to the usage percentage.
 */

/**
 * Smoothly interpolate hue from green (142°) at 0% to red (0°) at 100%.
 *
 * The interpolation uses three linear segments matching the design token heat scale:
 * - 0% → 50%:  hue 142° → 60°   (safe green → moderate yellow)
 * - 50% → 75%: hue 60° → 30°    (moderate yellow → high orange)
 * - 75% → 100%: hue 30° → 0°    (high orange → extreme red)
 *
 * Property: for any p1 < p2, hue(p1) >= hue(p2) (monotonically decreasing).
 */
export function getHeatColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));

  let hue: number;
  if (p <= 50) {
    // 0% → 50%: hue goes from 142 to 60
    hue = 142 - (142 - 60) * (p / 50);
  } else if (p <= 75) {
    // 50% → 75%: hue goes from 60 to 30
    hue = 60 - (60 - 30) * ((p - 50) / 25);
  } else {
    // 75% → 100%: hue goes from 30 to 0
    hue = 30 - 30 * ((p - 75) / 25);
  }

  // Saturation and lightness follow the heat scale design tokens:
  // safe=60%/45%, moderate=70%/45%, high=80%/50%, extreme=75%/50%
  // Interpolate saturation: 60 → 70 → 80 → 75
  let saturation: number;
  let lightness: number;
  if (p <= 50) {
    saturation = 60 + (70 - 60) * (p / 50);
    lightness = 45;
  } else if (p <= 75) {
    saturation = 70 + (80 - 70) * ((p - 50) / 25);
    lightness = 45 + (50 - 45) * ((p - 50) / 25);
  } else {
    saturation = 80 - (80 - 75) * ((p - 75) / 25);
    lightness = 50;
  }

  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

/**
 * Extract the hue value from a getHeatColor result (for testing purposes).
 */
export function getHeatHue(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));

  if (p <= 50) {
    return 142 - (142 - 60) * (p / 50);
  } else if (p <= 75) {
    return 60 - (60 - 30) * ((p - 50) / 25);
  } else {
    return 30 - 30 * ((p - 75) / 25);
  }
}

export type ResourceType = "cpu" | "memory";

/**
 * Resource-specific hue mapping:
 * - CPU  → teal (hsl 168°)
 * - Memory → blue (hsl 230°)
 */
const RESOURCE_HUE: Record<ResourceType, number> = {
  cpu: 168,
  memory: 230,
};

/**
 * Returns a CSS background color using the resource-specific hue and an opacity
 * proportional to the usage percentage. Returns transparent for very low values.
 *
 * The opacity ramps from 0 at 0% to a maximum of 0.25 at 100%, providing a
 * subtle heat indicator that doesn't overpower the text content.
 */
export function getResourceHeatBg(percent: number, resource: ResourceType): string {
  const p = Math.max(0, Math.min(100, percent));

  // Below 5% — no visible background
  if (p < 5) return "transparent";

  const hue = RESOURCE_HUE[resource];

  // Opacity scales linearly from 0.05 at low values to 0.25 at 100%
  const opacity = 0.05 + (p / 100) * 0.20;

  return `hsla(${hue}, 60%, 50%, ${opacity.toFixed(3)})`;
}
