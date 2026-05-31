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
  data: uPlot.AlignedData;
  series: ChartSeries[];
  height?: number;
  yRange?: [number, number];
  yFormat?: (val: number) => string;
  smooth?: boolean;
  gradientFill?: boolean;
  showLegend?: boolean;
  syncKey?: string;
  spanLabel?: string;
  maxLabel?: string;
  compact?: boolean;
}

/**
 * Solid uniform fill — Win11 style: one flat opacity beneath the curve.
 * No gradient. The fill color matches the stroke but at ~35% opacity.
 */
function makeSolidFill(strokeColor: string) {
  return (u: uPlot, _seriesIdx: number) => {
    // Guard
    const plotTop = u.bbox.top / devicePixelRatio;
    const plotBottom = (u.bbox.top + u.bbox.height) / devicePixelRatio;
    if (!isFinite(plotTop) || !isFinite(plotBottom) || plotTop === plotBottom) {
      return strokeColor;
    }

    let resolved = strokeColor;
    if (strokeColor.startsWith("var(")) {
      const varName = strokeColor.slice(4, -1).trim();
      const computed = getComputedStyle(u.root).getPropertyValue(varName).trim();
      if (computed) resolved = computed;
    }

    return withAlpha(resolved, 0.10);
  };
}

/** Append alpha to a CSS color string. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return color + a;
  }
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  return color;
}

/** Hover tooltip plugin */
function tooltipPlugin(yFormat?: (v: number) => string): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;

  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.style.cssText = `
          position:absolute;z-index:100;pointer-events:none;
          background:var(--surface-4);color:var(--text-primary);
          border:1px solid var(--border-color);border-radius:4px;
          padding:3px 7px;font-size:11px;line-height:1.4;
          box-shadow:0 2px 6px rgba(0,0,0,0.12);white-space:nowrap;display:none;
        `;
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
        if (!tip) return;
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0) { tip.style.display = "none"; return; }
        const ts = u.data[0][idx];
        if (ts == null) { tip.style.display = "none"; return; }
        const d = new Date((ts as number) * 1000);
        const time = `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
        let html = `<div style="color:var(--text-muted);margin-bottom:2px">${time}</div>`;
        for (let si = 1; si < u.series.length; si++) {
          const s = u.series[si];
          const val = u.data[si][idx];
          if (val == null) continue;
          const c = typeof s.stroke === "function" ? "#666" : (s.stroke as string);
          const f = yFormat ? yFormat(val as number) : String(val);
          html += `<div style="display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:2px;background:${c};display:inline-block"></span>${s.label}: <b>${f}</b></div>`;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
        const tw = tip.offsetWidth;
        tip.style.left = `${left + 12 + tw > u.over.clientWidth ? left - tw - 12 : left + 12}px`;
        tip.style.top = `${Math.max(0, (top ?? 0) - 8)}px`;
      },
      destroy: () => { tip?.remove(); tip = null; },
    },
  };
}

export function PerformanceChart({
  data, series, height = 180, yRange, yFormat,
  smooth = false, gradientFill = true, showLegend = false,
  syncKey, spanLabel, maxLabel, compact = false,
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const buildOpts = useCallback((width: number): uPlot.Options => ({
    width,
    height,
    scales: {
      x: { time: true },
      y: yRange
        ? { range: () => yRange as uPlot.Range.MinMax }
        : {},
    },
    cursor: {
      show: false,
    },
    legend: { show: showLegend },
    axes: [
      {
        // X-axis
        stroke: "var(--text-muted)",
        grid: { show: true, stroke: "rgba(128,128,128,0.18)", width: 1 },
        ticks: { show: false },
        size: compact ? 0 : 0,
        show: !compact,
        values: () => [], // Empty values to hide text
      },
      {
        // Y-axis
        stroke: "var(--text-muted)",
        grid: { show: true, stroke: "rgba(128,128,128,0.18)", width: 1 },
        ticks: { show: false },
        size: compact ? 0 : 0,
        show: !compact,
        values: () => [], // Empty values to hide text
      },
    ],
    series: [
      { label: "Time" },
      ...series.map((s) => ({
        label: s.label,
        stroke: s.stroke,
        width: s.width ?? 1,
        fill: gradientFill ? makeSolidFill(s.stroke) : s.fill,
        points: { show: false },
        paths: smooth
          ? (u: uPlot, si: number, i0: number, i1: number) => uPlot.paths.spline!()(u, si, i0, i1)
          : undefined,
      })),
    ],
  }), [height, series, yRange, yFormat, smooth, gradientFill, showLegend, syncKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w === 0) return;

    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    chartRef.current = new uPlot(buildOpts(w), data, el);

    if (roRef.current) roRef.current.disconnect();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const nw = e.contentRect.width;
        if (nw > 0 && chartRef.current) chartRef.current.setSize({ width: nw, height });
      }
    });
    ro.observe(el);
    roRef.current = ro;

    return () => { ro.disconnect(); chartRef.current?.destroy(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildOpts]);

  useEffect(() => {
    if (chartRef.current && data[0].length > 0) chartRef.current.setData(data);
  }, [data]);

  return (
    <div className="relative w-full" style={{ minHeight: height }}>
      <div className={`chart-frame ${compact ? 'border-none p-0' : ''}`}>
        <div ref={containerRef} className="w-full" style={{ minHeight: height }} />
      </div>
      {maxLabel && !compact && (
        <span className="absolute top-1 right-2 text-[10px] text-text-muted pointer-events-none tabular-nums">
          {maxLabel}
        </span>
      )}
      {!compact && (
        <div className="flex justify-between px-2 pt-1">
          <span className="text-[10px] text-text-muted">60 秒</span>
          <span className="text-[10px] text-text-muted">0</span>
        </div>
      )}
    </div>
  );
}
