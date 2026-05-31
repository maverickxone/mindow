import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { usePerformanceStore } from "../stores/performanceStore";
import { useProcessStore } from "../stores/processStore";
import { PerformanceChart, type ChartSeries } from "../components/PerformanceChart";
import type uPlot from "uplot";
import type { PerformanceHistory } from "../types";

import { formatRate, formatPercent } from "../lib/format";

type MetricId = "cpu" | "memory" | "disk" | "battery";
type ViewMode = MetricId | "overview";

// Chart series use CSS custom property references for token-driven colors
const cpuSeries: ChartSeries[] = [
  { label: "CPU", stroke: "var(--color-cpu)", width: 1.5 },
];

const memorySeries: ChartSeries[] = [
  { label: "Memory", stroke: "var(--color-memory)", width: 1.5 },
];

const diskSeries: ChartSeries[] = [
  { label: "Read", stroke: "var(--color-disk)", width: 1.5 },
  { label: "Write", stroke: "var(--color-disk-write)", width: 1.5 },
];

export function PerformancePage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ViewMode>("overview");
  const timestamps = usePerformanceStore((s) => s.timestamps);
  const cpuHistory = usePerformanceStore((s) => s.cpuHistory);
  const memoryHistory = usePerformanceStore((s) => s.memoryHistory);
  const diskReadHistory = usePerformanceStore((s) => s.diskReadHistory);
  const diskWriteHistory = usePerformanceStore((s) => s.diskWriteHistory);
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
          color: batteryLevel <= 20 ? "var(--heat-extreme)" : "var(--heat-safe)",
        }]
      : []),
  ];

  return (
    <div className="flex h-full">
      {/* Left: metric selection */}
      <div className="w-56 border-r border-border flex flex-col shrink-0 overflow-y-auto p-2 gap-1.5">
        {/* Overview button */}
        <button
          onClick={() => setSelected("overview")}
          className={`flex items-center gap-3 px-2.5 py-2.5 text-left rounded-lg transition-colors focus-ring
            ${selected === "overview" ? "bg-state-info/15" : "hover:bg-surface-2"}`}
        >
          <div className="w-16 h-10 shrink-0 rounded-md overflow-hidden bg-surface-0 border border-border/60 flex items-center justify-center">
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
            className={`flex items-center gap-3 px-2.5 py-2.5 text-left rounded-lg transition-colors focus-ring
              ${selected === m.id ? "bg-state-info/15" : "hover:bg-surface-2"}`}
          >
            {/* Mini chart thumbnail — real sparkline with fill + resource color */}
            <div className="w-16 h-10 shrink-0 rounded-md overflow-hidden bg-surface-0 border border-border/60">
              {m.id === "battery" ? (
                <MiniBatteryIcon level={batteryLevel ?? 0} charging={batteryCharging === "Charging"} />
              ) : (
                <MiniChart
                  data={m.id === "cpu" ? cpuHistory : m.id === "memory" ? memoryHistory : diskReadHistory}
                  color={m.color}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[13px] font-semibold text-text-primary truncate">{m.label}</span>
              </div>
              <div className="text-[15px] font-bold tabular-nums leading-tight" style={{ color: m.color }}>{m.value}</div>
              <div className="text-[11px] text-text-muted truncate">{m.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Right: main chart */}
      <div className="flex-1 flex flex-col p-5 overflow-y-auto">
        {tsSeconds.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-text-muted">{t("performance.loading")}</p>
          </div>
        ) : selected === "overview" ? (
          /* Overview mode: all three metrics stacked vertically with cursor sync */
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
                <div className="flex-1 min-h-[300px]">
                  <PerformanceChart data={cpuData} series={cpuSeries} height={320} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} spanLabel={spanLabel} maxLabel="100%" />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.cpuUsage")} value={formatPercent(currentCpu)} />
                  <StatItem label={t("performance.cores", { count: perCoreCpu.length })} value={`${perCoreCpu.length}`} />
                  <StatItem label={t("performance.highest")} value={perCoreCpu.length > 0 ? formatPercent(Math.max(...perCoreCpu)) : "—"} />
                </div>
              </>
            )}
            {selected === "memory" && (
              <>
                <DetailHeader title={t("performance.memory")} right={`${totalMemGB.toFixed(1)} GB`} value={`${usedMemGB.toFixed(1)} GB`} color="var(--color-memory)" />
                <div className="flex-1 min-h-[280px]">
                  <PerformanceChart data={memoryData} series={memorySeries} height={300} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} spanLabel={spanLabel} maxLabel="100%" />
                </div>
                {/* Memory composition bar */}
                <div className="mt-4">
                  <div className="text-[11px] text-text-muted mb-1.5">{t("performance.memoryComposition")}</div>
                  <MemoryCompositionBar usedGB={usedMemGB} totalGB={totalMemGB} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.used")} value={`${usedMemGB.toFixed(1)} GB`} />
                  <StatItem label={t("performance.memAvailable")} value={`${availMemGB.toFixed(1)} GB`} />
                  <StatItem label={t("performance.memoryUsage")} value={formatPercent(currentMem)} />
                </div>
              </>
            )}
            {selected === "disk" && (
              <>
                <DetailHeader title={t("performance.diskIO")} right={t("performance.diskType")} value={formatRate(currentDiskRead + currentDiskWrite)} color="var(--color-disk)" />
                <div className="flex-1 min-h-[300px]">
                  <PerformanceChart data={diskData} series={diskSeries} height={320} yFormat={(v) => formatRate(v)} showLegend smooth={false} spanLabel={spanLabel} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.diskRead")} value={formatRate(currentDiskRead)} color="var(--color-disk)" />
                  <StatItem label={t("performance.diskWrite")} value={formatRate(currentDiskWrite)} color="var(--color-disk-write)" />
                </div>
              </>
            )}
            {selected === "battery" && batteryLevel != null && (
              <>
                <DetailHeader
                  title={t("performance.battery")}
                  right={batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryOnBattery")}
                  value={`${batteryLevel.toFixed(0)}%`}
                  color={batteryLevel <= 20 ? "var(--heat-extreme)" : "var(--heat-safe)"}
                />
                <div className="flex-1 flex flex-col items-center justify-center min-h-[280px]">
                  <BatteryGauge level={batteryLevel} charging={batteryCharging === "Charging"} />
                  <div className="mt-4 text-3xl font-bold text-text-primary tabular-nums">{batteryLevel.toFixed(0)}%</div>
                  <div className="mt-1 text-sm text-text-muted">
                    {batteryCharging === "Charging" && `⚡ ${t("performance.charging")}`}
                    {batteryCharging === "Discharging" && `🔋 ${t("performance.batteryOnBattery")}`}
                    {batteryCharging === "Full" && `✓ ${t("performance.batteryFullyCharged")}`}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4">
                  <StatItem label={t("performance.battery")} value={`${batteryLevel.toFixed(0)}%`} />
                  <StatItem label={t("performance.batteryStatus")} value={batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryDischarging")} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Big detail header: large title + colored current value + right-aligned spec */
function DetailHeader({ title, right, value, color }: { title: string; right: string; value: string; color: string }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
        <span className="text-lg font-semibold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <span className="text-[13px] text-text-secondary">{right}</span>
    </div>
  );
}

/** Overview card: chart wrapped with title + current value in a surface card */
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
      <PerformanceChart
        data={data} series={series} height={170}
        yRange={yRange} yFormat={yFormat} showLegend={showLegend}
        smooth={smooth} spanLabel={spanLabel} maxLabel={maxLabel}
      />
    </div>
  );
}

/** Stat item with clear hierarchy: large bold value + small muted label */
function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="text-[18px] font-bold tabular-nums mt-0.5" style={color ? { color } : { color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

/** Memory composition bar — used vs available segments (Task-Manager style) */
function MemoryCompositionBar({ usedGB, totalGB }: { usedGB: number; totalGB: number }) {
  const usedPct = totalGB > 0 ? (usedGB / totalGB) * 100 : 0;
  return (
    <div className="w-full h-7 rounded-md overflow-hidden border border-border flex bg-surface-2">
      <div
        className="h-full flex items-center justify-center text-[10px] text-white/90 font-medium transition-[width] duration-normal"
        style={{ width: `${usedPct}%`, backgroundColor: "var(--color-memory)" }}
        title={`${usedGB.toFixed(1)} GB`}
      />
      <div className="flex-1 h-full" />
    </div>
  );
}

/** Tiny sparkline with area fill + resource color (real preview, Task-Manager style) */
function MiniChart({ data, color }: { data: number[]; color: string }) {
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
  const max = Math.max(...slice, 1);
  const points = slice.map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - (v / max) * (h - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M${points.join(" L")}`;
  const fillD = `${pathD} L${w},${h} L0,${h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <path d={fillD} fill={color} opacity="0.35" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Compact battery icon for left panel thumbnail area */
function MiniBatteryIcon({ level, charging }: { level: number; charging: boolean }) {
  const fillWidth = (Math.max(0, Math.min(100, level)) / 100) * 36;
  const fillColor = level <= 20 ? "var(--heat-extreme)" : level <= 50 ? "var(--heat-moderate)" : "var(--heat-safe)";

  return (
    <svg width="100%" height="100%" viewBox="0 0 64 40" preserveAspectRatio="xMidYMid meet" className="block">
      <rect x="12" y="12" width="40" height="16" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" className="text-text-muted" />
      <rect x="52" y="16" width="2" height="8" rx="1" fill="currentColor" className="text-text-muted" />
      <rect x="14" y="14" width={fillWidth} height="12" rx="1" fill={fillColor} opacity="0.85" />
      {charging && <path d="M32 15 L29 20 L32 20 L30 25 L35 19 L32 19 Z" fill="var(--accent)" />}
    </svg>
  );
}

/** Large battery gauge for detail view */
function BatteryGauge({ level, charging }: { level: number; charging: boolean }) {
  const fillWidth = (Math.max(0, Math.min(100, level)) / 100) * 160;
  const fillColor = level <= 20 ? "var(--heat-extreme)" : level <= 50 ? "var(--heat-moderate)" : "var(--heat-safe)";

  return (
    <svg width={200} height={100} viewBox="0 0 200 100" className="block">
      <rect x="10" y="20" width="170" height="60" rx="8" stroke="currentColor" strokeWidth="2.5" fill="none" className="text-text-muted" />
      <rect x="180" y="35" width="8" height="30" rx="4" fill="currentColor" className="text-text-muted" />
      <rect x="15" y="25" width={fillWidth} height="50" rx="5" fill={fillColor} opacity="0.7" />
      {charging && <path d="M100 30 L88 52 L98 52 L92 70 L112 46 L102 46 Z" fill="var(--accent)" opacity="0.9" />}
    </svg>
  );
}
