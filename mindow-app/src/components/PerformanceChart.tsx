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
  /** Y-axis label */
  yLabel?: string;
  /** Y-axis range [min, max]; if omitted, auto-scales */
  yRange?: [number, number];
  /** Format function for y-axis values */
  yFormat?: (val: number) => string;
}

/**
 * uPlot 图表封装组件。
 * 负责初始化 uPlot 实例并在 data 变化时平滑更新。
 */
export function PerformanceChart({
  data,
  series,
  height = 180,
  yLabel,
  yRange,
  yFormat,
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const buildOpts = useCallback(
    (width: number): uPlot.Options => ({
      width,
      height,
      cursor: { show: true, drag: { x: false, y: false } },
      legend: { show: false },
      axes: [
        {
          stroke: "var(--text-secondary)",
          grid: { stroke: "var(--border-color)", width: 1 },
          ticks: { stroke: "var(--border-color)", width: 1 },
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => {
              const d = new Date(v * 1000);
              const m = d.getMinutes().toString().padStart(2, "0");
              const s = d.getSeconds().toString().padStart(2, "0");
              return `${m}:${s}`;
            }),
        },
        {
          stroke: "var(--text-secondary)",
          grid: { stroke: "var(--border-color)", width: 1 },
          ticks: { stroke: "var(--border-color)", width: 1 },
          label: yLabel,
          size: 50,
          values: yFormat
            ? (_u: uPlot, vals: number[]) => vals.map(yFormat)
            : undefined,
          ...(yRange
            ? { range: () => yRange as uPlot.Range.MinMax }
            : {}),
        },
      ],
      series: [
        { label: "Time" },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.stroke,
          width: s.width ?? 1.5,
          fill: s.fill,
        })),
      ],
    }),
    [height, series, yLabel, yRange, yFormat]
  );

  // Initialize or rebuild chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    if (width === 0) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const opts = buildOpts(width);
    const chart = new uPlot(opts, data, container);
    chartRef.current = chart;

    // Handle resize
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
    // Only rebuild when series config or height changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildOpts]);

  // Update data without recreating the chart (smooth transition)
  useEffect(() => {
    if (chartRef.current && data[0].length > 0) {
      chartRef.current.setData(data);
    }
  }, [data]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ minHeight: height }}
    />
  );
}
