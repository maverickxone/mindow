import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { usePerformanceStore } from "../stores/performanceStore";
import { useProcessStore } from "../stores/processStore";
import { PerformanceChart, type ChartSeries } from "../components/PerformanceChart";
import type uPlot from "uplot";
import type { PerformanceHistory } from "../types";

import { formatRate, formatPercent, formatBytes } from "../lib/format";

type MetricId = "cpu" | "memory" | "disk" | "battery";
type ViewMode = MetricId | "overview";

// Chart series — resource-colored with visible line weight
const cpuSeries: ChartSeries[] = [
  { label: "CPU", stroke: "var(--color-cpu)" },
];

const memorySeries: ChartSeries[] = [
  { label: "Memory", stroke: "var(--color-memory)" },
];

const diskSeries: ChartSeries[] = [
  { label: "Read", stroke: "var(--color-disk)" },
  { label: "Write", stroke: "var(--color-disk-write)" },
];

export function PerformancePage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ViewMode>("cpu");
  const timestamps = usePerformanceStore((s) => s.timestamps);
  const cpuHistory = usePerformanceStore((s) => s.cpuHistory);
  const memoryHistory = usePerformanceStore((s) => s.memoryHistory);
  const diskReadHistory = usePerformanceStore((s) => s.diskReadHistory);
  const diskWriteHistory = usePerformanceStore((s) => s.diskWriteHistory);
  const batteryHistory = usePerformanceStore((s) => s.batteryHistory);
  const setHistory = usePerformanceStore((s) => s.setHistory);
  const system = useProcessStore((s) => s.system);

  // Preload 60 historical data points on mount
  useEffect(() => {
    invoke<PerformanceHistory>("get_performance_history")
      .then((history) => {
        if (history && history.timestamps.length > 0) {
          setHistory(history);
        }
      })
      .catch((err) => {
        console.warn("Failed to load performance history:", err);
      });
  }, [setHistory]);

  const tsSeconds = useMemo(() => timestamps.map((t) => t / 1000), [timestamps]);

  const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : 0;
  const currentMem = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : 0;
  const currentDiskRead = diskReadHistory.length > 0 ? diskReadHistory[diskReadHistory.length - 1] : 0;
  const currentDiskWrite = diskWriteHistory.length > 0 ? diskWriteHistory[diskWriteHistory.length - 1] : 0;
  const totalMemGB = system ? system.total_memory / (1024 * 1024 * 1024) : 0;
  const usedMemGB = system ? system.used_memory / (1024 * 1024 * 1024) : 0;
  const availMemGB = Math.max(0, totalMemGB - usedMemGB);
  const perCoreCpu = system?.per_core_cpu ?? [];

  const cpuData: uPlot.AlignedData = useMemo(() => {
    if (tsSeconds.length === 0) return [[], []];
    return [tsSeconds, cpuHistory];
  }, [tsSeconds, cpuHistory]);

  const memoryData: uPlot.AlignedData = useMemo(() => {
    if (tsSeconds.length === 0) return [[], []];
    return [tsSeconds, memoryHistory];
  }, [tsSeconds, memoryHistory]);

  const diskData: uPlot.AlignedData = useMemo(() => {
    if (tsSeconds.length === 0) return [[], [], []];
    return [tsSeconds, diskReadHistory, diskWriteHistory];
  }, [tsSeconds, diskReadHistory, diskWriteHistory]);

  const batteryLevel = system?.battery_level ?? null;
  const batteryCharging = system?.battery_charging ?? null;
  const spanLabel = t("performance.timeSpan");

  const batteryData: uPlot.AlignedData = useMemo(() => {
    if (tsSeconds.length === 0 || batteryHistory.length === 0) return [[], []];
    // batteryHistory may be shorter than tsSeconds if battery appeared later
    const len = Math.min(tsSeconds.length, batteryHistory.length);
    return [tsSeconds.slice(-len), batteryHistory.slice(-len)];
  }, [tsSeconds, batteryHistory]);

  const batterySeries: ChartSeries[] = useMemo(() => [
    { label: t("performance.battery"), stroke: "var(--color-battery)", width: 1.5 },
  ], [t]);

  const metrics: { id: MetricId; label: string; value: string; sub: string; color: string }[] = [
    { id: "cpu", label: "CPU", value: formatPercent(currentCpu), sub: `${perCoreCpu.length} ${t("performance.cores", { count: perCoreCpu.length })}`, color: "var(--color-cpu)" },
    { id: "memory", label: t("performance.memory"), value: formatPercent(currentMem), sub: `${usedMemGB.toFixed(1)}/${totalMemGB.toFixed(1)} GB`, color: "var(--color-memory)" },
    { id: "disk", label: t("performance.diskIO"), value: formatRate(currentDiskRead + currentDiskWrite), sub: t("performance.diskType"), color: "var(--color-disk)" },
    ...(batteryLevel != null
      ? [{
          id: "battery" as MetricId,
          label: t("performance.battery"),
          value: `${batteryLevel.toFixed(0)}%${batteryCharging === "Charging" ? " ⚡" : ""}`,
          sub: batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryOnBattery"),
          color: batteryLevel <= 20 ? "var(--heat-extreme)" : "var(--color-battery)",
        }]
      : []),
  ];

  return (
    <div className="flex h-full">
      {/* Left: metric selection panel */}
      <div className="w-56 border-r border-border flex flex-col shrink-0 overflow-y-auto p-2 gap-1">
        {/* Overview button */}
        <button
          onClick={() => setSelected("overview")}
          className={`flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors focus-ring
            ${selected === "overview" ? "metric-card-selected" : "hover:bg-surface-2"}`}
        >
          <div className={`w-16 h-10 shrink-0 rounded-md overflow-hidden bg-surface-0 flex items-center justify-center
            ${selected === "overview" ? "border-2 border-accent/60" : "border border-border/60"}`}>
            <svg width="44" height="28" viewBox="0 0 44 28" className="block">
              <rect x="2" y="2" width="40" height="6" rx="1.5" fill="var(--color-cpu)" opacity="0.55" />
              <rect x="2" y="11" width="40" height="6" rx="1.5" fill="var(--color-memory)" opacity="0.55" />
              <rect x="2" y="20" width="40" height="6" rx="1.5" fill="var(--color-disk)" opacity="0.55" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary">{t("performance.overview")}</div>
            <div className="text-[11px] text-text-muted">{t("performance.overviewDesc")}</div>
          </div>
        </button>

        {/* Individual metric buttons */}
        {metrics.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            className={`flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors focus-ring
              ${selected === m.id ? "metric-card-selected" : "hover:bg-surface-2"}`}
          >
            {/* Mini chart thumbnail */}
            <div className={`w-16 h-10 shrink-0 rounded-md overflow-hidden bg-surface-0
              ${selected === m.id ? "border-2 border-accent/60" : "border border-border/60"}`}>
              {m.id === "battery" ? (
                <MiniChart
                  data={batteryHistory.length >= 2 ? batteryHistory : [batteryLevel ?? 0, batteryLevel ?? 0]}
                  color={m.color}
                  maxValue={100}
                />
              ) : (
                <MiniChart
                  data={m.id === "cpu" ? cpuHistory : m.id === "memory" ? memoryHistory : diskReadHistory}
                  color={m.color}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-primary truncate">{m.label}</div>
              <div className="text-[15px] font-bold tabular-nums leading-tight" style={{ color: m.color }}>{m.value}</div>
              <div className="text-[11px] text-text-muted truncate">{m.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Right: main chart area */}
      <div className="flex-1 flex flex-col p-5 overflow-y-auto">
        {tsSeconds.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-text-muted">{t("performance.loading")}</p>
          </div>
        ) : selected === "overview" ? (
          /* Overview mode: all three metrics stacked */
          <div className="flex flex-col gap-4 flex-1">
            <OverviewCard
              title="CPU" valueText={formatPercent(currentCpu)} color="var(--color-cpu)"
              data={cpuData} series={cpuSeries} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`}
              spanLabel={spanLabel} maxLabel="100%"
            />
            <OverviewCard
              title={t("performance.memory")} valueText={`${formatPercent(currentMem)} · ${usedMemGB.toFixed(1)}/${totalMemGB.toFixed(1)} GB`} color="var(--color-memory)"
              data={memoryData} series={memorySeries} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`}
              spanLabel={spanLabel} maxLabel="100%"
            />
            <OverviewCard
              title={t("performance.diskIO")} valueText={formatRate(currentDiskRead + currentDiskWrite)} color="var(--color-disk)"
              data={diskData} series={diskSeries} yFormat={(v) => formatRate(v)} showLegend
              smooth={false} spanLabel={spanLabel}
            />
          </div>
        ) : (
          /* Single-metric detail view */
          <>
            {selected === "cpu" && (
              <>
                <DetailHeader title="CPU" right={t("performance.logicalProcessors", { count: perCoreCpu.length })} value={formatPercent(currentCpu)} color="var(--color-cpu)" />
                <div className="text-[11px] text-text-muted mb-2">{t("performance.cpuUsage")}</div>
                <div className="chart-frame flex-1 min-h-[300px]">
                  <PerformanceChart data={cpuData} series={cpuSeries} height={300} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} spanLabel={spanLabel} maxLabel="100%" />
                </div>
                <div className="mt-5 grid grid-cols-4 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.cpuUsage")} value={formatPercent(currentCpu)} />
                  <StatItem label={t("performance.cores", { count: perCoreCpu.length })} value={`${perCoreCpu.length}`} />
                  <StatItem label={t("performance.highest")} value={perCoreCpu.length > 0 ? formatPercent(Math.max(...perCoreCpu)) : "—"} />
                  <StatItem label={t("performance.dataPoints")} value={`${cpuHistory.length}`} />
                </div>
              </>
            )}
            {selected === "memory" && (
              <>
                <DetailHeader title={t("performance.memory")} right={`${totalMemGB.toFixed(1)} GB`} value={`${usedMemGB.toFixed(1)} GB`} color="var(--color-memory)" />
                <div className="text-[11px] text-text-muted mb-2">{t("performance.memoryUsage")}</div>
                <div className="chart-frame flex-1 min-h-[280px]">
                  <PerformanceChart data={memoryData} series={memorySeries} height={280} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} spanLabel={spanLabel} maxLabel={`${totalMemGB.toFixed(1)} GB`} />
                </div>
                {/* Memory composition bar with labels */}
                <div className="mt-4">
                  <div className="text-[11px] text-text-muted mb-1.5">{t("performance.memoryComposition")}</div>
                  <MemoryCompositionBar usedGB={usedMemGB} totalGB={totalMemGB} />
                  <div className="flex justify-between mt-1.5 text-[10px] text-text-muted">
                    <span>{t("performance.used")}: {usedMemGB.toFixed(1)} GB</span>
                    <span>{t("performance.memAvailable")}: {availMemGB.toFixed(1)} GB</span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-x-5 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.used")} value={`${usedMemGB.toFixed(1)} GB`} />
                  <StatItem label={t("performance.memAvailable")} value={`${availMemGB.toFixed(1)} GB`} />
                  <StatItem label={t("performance.memoryUsage")} value={formatPercent(currentMem)} />
                  <StatItem label={t("performance.memoryTotal")} value={`${totalMemGB.toFixed(1)} GB`} />
                  <StatItem label={t("performance.memCommitted")} value={formatBytes(system?.used_memory ?? 0)} />
                  <StatItem label={t("performance.dataPoints")} value={`${memoryHistory.length}`} />
                </div>
              </>
            )}
            {selected === "disk" && (
              <>
                <DetailHeader title={t("performance.diskIO")} right={t("performance.diskType")} value={formatRate(currentDiskRead + currentDiskWrite)} color="var(--color-disk)" />
                <div className="text-[11px] text-text-muted mb-2">{t("performance.diskRead")} / {t("performance.diskWrite")}</div>
                <div className="chart-frame flex-1 min-h-[300px]">
                  <PerformanceChart data={diskData} series={diskSeries} height={300} yFormat={(v) => formatRate(v)} showLegend smooth={false} spanLabel={spanLabel} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.diskRead")} value={formatRate(currentDiskRead)} color="var(--color-disk)" />
                  <StatItem label={t("performance.diskWrite")} value={formatRate(currentDiskWrite)} color="var(--color-disk-write)" />
                  <StatItem label={t("performance.dataPoints")} value={`${diskReadHistory.length}`} />
                </div>
              </>
            )}
            {selected === "battery" && batteryLevel != null && (
              <>
                <DetailHeader
                  title={t("performance.battery")}
                  right={batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryOnBattery")}
                  value={`${batteryLevel.toFixed(0)}%`}
                  color={batteryLevel <= 20 ? "var(--heat-extreme)" : "var(--color-battery)"}
                />
                <div className="text-[11px] text-text-muted mb-2">{t("performance.battery")} %</div>
                <div className="chart-frame flex-1 min-h-[280px]">
                  <PerformanceChart
                    data={batteryData}
                    series={batterySeries}
                    height={260}
                    yRange={[0, 100]}
                    yFormat={(v) => `${v.toFixed(0)}%`}
                    spanLabel={spanLabel}
                    maxLabel="100%"
                  />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.battery")} value={`${batteryLevel.toFixed(0)}%`} color="var(--color-battery)" />
                  <StatItem label={t("performance.batteryStatus")} value={batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryDischarging")} />
                  <StatItem label={t("performance.dataPoints")} value={`${batteryHistory.length}`} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Big detail header: large title + colored current value + right-aligned spec (Win11 style) */
function DetailHeader({ title, right, value, color }: { title: string; right: string; value: string; color: string }) {
  return (
    <div className="flex items-end justify-between mb-1">
      <div className="flex items-baseline gap-3">
        <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
        <span className="text-lg font-semibold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <span className="text-[13px] text-text-secondary">{right}</span>
    </div>
  );
}

/** Overview card with chart frame border */
function OverviewCard({
  title, valueText, color, data, series, yRange, yFormat, showLegend, smooth, spanLabel, maxLabel,
}: {
  title: string; valueText: string; color: string;
  data: uPlot.AlignedData; series: ChartSeries[];
  yRange?: [number, number]; yFormat?: (v: number) => string;
  showLegend?: boolean; smooth?: boolean; spanLabel?: string; maxLabel?: string;
}) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[14px] font-semibold text-text-primary">{title}</h3>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>{valueText}</span>
      </div>
      <div className="chart-frame">
        <PerformanceChart
          data={data} series={series} height={150}
          yRange={yRange} yFormat={yFormat} showLegend={showLegend}
          smooth={smooth} spanLabel={spanLabel} maxLabel={maxLabel}
        />
      </div>
    </div>
  );
}

/** Stat item with clear hierarchy: large bold value + small muted label */
function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-[16px] font-bold tabular-nums mt-0.5" style={color ? { color } : { color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

/** Memory composition bar — used vs available segments with Win11-style labels */
function MemoryCompositionBar({ usedGB, totalGB }: { usedGB: number; totalGB: number }) {
  const usedPct = totalGB > 0 ? (usedGB / totalGB) * 100 : 0;
  return (
    <div className="w-full h-6 rounded overflow-hidden border border-border flex bg-surface-2">
      <div
        className="h-full transition-[width] duration-normal"
        style={{ width: `${usedPct}%`, backgroundColor: "var(--color-memory)" }}
        title={`${usedGB.toFixed(1)} GB`}
      />
      <div className="flex-1 h-full" />
    </div>
  );
}

/** Tiny sparkline with area fill + resource color */
function MiniChart({ data, color, maxValue }: { data: number[]; color: string; maxValue?: number }) {
  const h = 40;
  const w = 64;

  if (data.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full h-full bg-border/20 animate-pulse" />
      </div>
    );
  }

  const slice = data.slice(-40);
  const max = maxValue ?? Math.max(...slice, 1);
  const points = slice.map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - (v / max) * (h - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M${points.join(" L")}`;
  const fillD = `${pathD} L${w},${h} L0,${h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <path d={fillD} fill={color} opacity="0.38" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Compact battery icon for left panel thumbnail area */
// MiniBatteryIcon and BatteryGauge removed — battery now uses MiniChart + PerformanceChart
