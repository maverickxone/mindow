import { useRef, useEffect, useCallback } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface ChartSeries {
  label: string;
  stroke: string;
  width?: number;
  fill?: string;
}

interface PerformanceChartProps {
  /** uPlot data: [timestamps, ...series] */
  data: uPlot.AlignedData;
  /** Series config (excluding the x-axis timestamp series) */
  series: ChartSeries[];
  /** Chart height in pixels */
  height?: number;
  /** Y-axis range [min, max]; if omitted, auto-scales */
  yRange?: [number, number];
  /** Format function for y-axis values */
  yFormat?: (val: number) => string;
  /** Enable spline interpolation for smooth curves (default: true).
   *  Set false for spiky data (disk/network) to preserve peaks. */
  smooth?: boolean;
  /** Enable area gradient fill from curve to baseline (default: true) */
  gradientFill?: boolean;
  /** Show legend (default: false, true for disk chart with read/write labels) */
  showLegend?: boolean;
  /** Cursor sync group key for overview mode */
  syncKey?: string;
  /** Time span label shown at bottom-left (e.g. "60 秒") */
  spanLabel?: string;
  /** Max-scale label shown at top-right (e.g. "100%" or "32.0 GB") */
  maxLabel?: string;
}

/**
 * Creates a richer vertical gradient fill — fuller near the curve (Task-Manager
 * style), fading toward the baseline. Higher opacity than before for a more
 * substantial "area" feel rather than a thin line.
 */
function makeGradientFill(strokeColor: string) {
  return (u: uPlot, _seriesIdx: number) => {
    const plotTop = u.bbox.top / devicePixelRatio;
    const plotBottom = (u.bbox.top + u.bbox.height) / devicePixelRatio;
    // Guard against non-finite values when container has zero dimensions
    if (!isFinite(plotTop) || !isFinite(plotBottom) || plotTop === plotBottom) {
      return strokeColor;
    }
    const ctx = u.ctx;

    let resolvedColor = strokeColor;
    if (strokeColor.startsWith("var(")) {
      const varName = strokeColor.slice(4, -1).trim();
      const computed = getComputedStyle(u.root).getPropertyValue(varName).trim();
      if (computed) resolvedColor = computed;
    }

    const grad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
    grad.addColorStop(0, hexishWithAlpha(resolvedColor, 0.55)); // fuller at top
    grad.addColorStop(0.7, hexishWithAlpha(resolvedColor, 0.18));
    grad.addColorStop(1, hexishWithAlpha(resolvedColor, 0.04)); // subtle at baseline
    return grad;
  };
}

/** Append an alpha to a color string (supports hsl()/hex). */
function hexishWithAlpha(color: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  if (color.startsWith("#")) {
    // #rrggbb → #rrggbbaa
    if (color.length === 7) return color + a;
    return color;
  }
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  return color;
}

/**
 * Tooltip plugin: shows a vertical guide line and a small box with the value(s)
 * and time at the hovered data point.
 */
function tooltipPlugin(yFormat?: (v: number) => string): uPlot.Plugin {
  let tooltip: HTMLDivElement | null = null;

  function fmtTime(ts: number): string {
    const d = new Date(ts * 1000);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    const s = d.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  return {
    hooks: {
      init: (u) => {
        tooltip = document.createElement("div");
        tooltip.className = "uplot-tooltip";
        tooltip.style.cssText = `
          position: absolute; z-index: 100; pointer-events: none;
          background: var(--surface-4); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px;
          padding: 4px 8px; font-size: 11px; line-height: 1.4;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18); white-space: nowrap;
          display: none; transition: none;
        `;
        u.over.appendChild(tooltip);
      },
      setCursor: (u) => {
        if (!tooltip) return;
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0) {
          tooltip.style.display = "none";
          return;
        }
        const ts = u.data[0][idx];
        if (ts == null) {
          tooltip.style.display = "none";
          return;
        }
        let html = `<div style="color: var(--text-muted); margin-bottom: 2px;">${fmtTime(ts as number)}</div>`;
        for (let si = 1; si < u.series.length; si++) {
          const s = u.series[si];
          const val = u.data[si][idx];
          if (val == null) continue;
          const color = typeof s.stroke === "function" ? "currentColor" : (s.stroke as string);
          const formatted = yFormat ? yFormat(val as number) : String(val);
          html += `<div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:2px;background:${color};display:inline-block;"></span>
            <span>${s.label}: <b>${formatted}</b></span>
          </div>`;
        }
        tooltip.innerHTML = html;
        tooltip.style.display = "block";
        // Position tooltip near cursor, clamped within plot
        const tw = tooltip.offsetWidth;
        const px = left + 12 + tw > u.over.clientWidth ? left - tw - 12 : left + 12;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${Math.max(0, (top ?? 0) - 8)}px`;
      },
      destroy: () => {
        tooltip?.remove();
        tooltip = null;
      },
    },
  };
}

/**
 * uPlot 图表封装组件。
 * Task-Manager-style: fuller area fill, light grid, hover tooltip,
 * peak-preserving for spiky data, max-scale + time-span labels.
 */
export function PerformanceChart({
  data,
  series,
  height = 180,
  yRange,
  yFormat,
  smooth = true,
  gradientFill = true,
  showLegend = false,
  syncKey,
  spanLabel,
  maxLabel,
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const buildOpts = useCallback(
    (width: number): uPlot.Options => ({
      width,
      height,
      cursor: {
        show: true,
        points: { show: true, size: 6 },
        drag: { x: false, y: false },
        sync: syncKey ? { key: syncKey, setSeries: false } : undefined,
      },
      legend: { show: showLegend },
      plugins: [tooltipPlugin(yFormat)],
      axes: [
        {
          stroke: "var(--text-muted)",
          // Lighter grid — barely-there horizontal/vertical guides
          grid: { stroke: "var(--border-color)", width: 1, dash: [] },
          ticks: { stroke: "var(--border-color)", width: 0, size: 0 },
          font: "10px 'Segoe UI', sans-serif",
          gap: 4,
          size: 24,
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => {
              const d = new Date(v * 1000);
              const m = d.getMinutes().toString().padStart(2, "0");
              const s = d.getSeconds().toString().padStart(2, "0");
              return `${m}:${s}`;
            }),
        },
        {
          stroke: "var(--text-muted)",
          grid: { stroke: "var(--border-color)", width: 1 },
          ticks: { stroke: "var(--border-color)", width: 0, size: 0 },
          font: "10px 'Segoe UI', sans-serif",
          gap: 4,
          size: 44,
          values: yFormat
            ? (_u: uPlot, vals: number[]) => vals.map(yFormat)
            : undefined,
          ...(yRange ? { range: () => yRange as uPlot.Range.MinMax } : {}),
        },
      ],
      series: [
        { label: "Time" },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.stroke,
          width: Math.max(s.width ?? 2, 1.5),
          fill: gradientFill ? makeGradientFill(s.stroke) : s.fill,
          points: { show: false },
          paths: smooth
            ? (u: uPlot, seriesIdx: number, idx0: number, idx1: number) =>
                uPlot.paths.spline!()(u, seriesIdx, idx0, idx1)
            : undefined,
        })),
      ],
    }),
    [height, series, yRange, yFormat, smooth, gradientFill, showLegend, syncKey]
  );

  // Initialize or rebuild chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    if (width === 0) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const opts = buildOpts(width);
    const chart = new uPlot(opts, data, container);
    chartRef.current = chart;

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0 && chartRef.current) {
          chartRef.current.setSize({ width: newWidth, height });
        }
      }
    });
    ro.observe(container);
    resizeObserverRef.current = ro;

    return () => {
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildOpts]);

  // Update data without recreating the chart
  useEffect(() => {
    if (chartRef.current && data[0].length > 0) {
      chartRef.current.setData(data);
    }
  }, [data]);

  return (
    <div className="relative w-full" style={{ minHeight: height }}>
      <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
      {/* Max-scale label (top-right) */}
      {maxLabel && (
        <span className="absolute top-0 right-1 text-[10px] text-text-muted pointer-events-none tabular-nums">
          {maxLabel}
        </span>
      )}
      {/* Time-span label (bottom-left) */}
      {spanLabel && (
        <span className="absolute bottom-5 left-12 text-[10px] text-text-muted pointer-events-none">
          {spanLabel}
        </span>
      )}
    </div>
  );
}
