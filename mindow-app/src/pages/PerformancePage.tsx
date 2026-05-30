import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePerformanceStore } from "../stores/performanceStore";
import { useProcessStore } from "../stores/processStore";
import { PerformanceChart, type ChartSeries } from "../components/PerformanceChart";
import type uPlot from "uplot";

type MetricId = "cpu" | "memory" | "disk";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRate(bytes: number): string {
  return `${formatBytes(bytes)}/s`;
}

const cpuSeries: ChartSeries[] = [
  { label: "CPU", stroke: "#0078d4", width: 1.5, fill: "rgba(0, 120, 212, 0.12)" },
];

const memorySeries: ChartSeries[] = [
  { label: "Memory", stroke: "#0078d4", width: 1.5, fill: "rgba(0, 120, 212, 0.12)" },
];

const diskSeries: ChartSeries[] = [
  { label: "Read", stroke: "#0078d4", width: 1.5, fill: "rgba(0, 120, 212, 0.08)" },
  { label: "Write", stroke: "#d97706", width: 1.5 },
];

export function PerformancePage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<MetricId>("cpu");
  const timestamps = usePerformanceStore((s) => s.timestamps);
  const cpuHistory = usePerformanceStore((s) => s.cpuHistory);
  const memoryHistory = usePerformanceStore((s) => s.memoryHistory);
  const diskReadHistory = usePerformanceStore((s) => s.diskReadHistory);
  const diskWriteHistory = usePerformanceStore((s) => s.diskWriteHistory);
  const system = useProcessStore((s) => s.system);

  const tsSeconds = useMemo(() => timestamps.map((t) => t / 1000), [timestamps]);

  const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : 0;
  const currentMem = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : 0;
  const currentDiskRead = diskReadHistory.length > 0 ? diskReadHistory[diskReadHistory.length - 1] : 0;
  const currentDiskWrite = diskWriteHistory.length > 0 ? diskWriteHistory[diskWriteHistory.length - 1] : 0;
  const totalMemGB = system ? system.total_memory / (1024 * 1024 * 1024) : 0;
  const usedMemGB = system ? system.used_memory / (1024 * 1024 * 1024) : 0;
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

  const metrics: { id: MetricId; label: string; value: string; sub: string }[] = [
    { id: "cpu", label: "CPU", value: `${currentCpu.toFixed(0)}%`, sub: `${perCoreCpu.length} ${t("performance.cores", { count: perCoreCpu.length })}` },
    { id: "memory", label: t("performance.memory"), value: `${currentMem.toFixed(0)}%`, sub: `${usedMemGB.toFixed(1)}/${totalMemGB.toFixed(1)} GB` },
    { id: "disk", label: t("performance.diskIO"), value: formatRate(currentDiskRead + currentDiskWrite), sub: "SSD" },
  ];

  return (
    <div className="flex h-full">
      {/* Left: metric selection */}
      <div className="w-52 border-r border-border flex flex-col shrink-0 overflow-y-auto">
        {metrics.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            className={`flex items-center gap-3 px-3 py-3 text-left border-b border-border/50 transition-colors
              ${selected === m.id ? "bg-accent-info/8 border-l-2 border-l-accent-info" : "hover:bg-tertiary border-l-2 border-l-transparent"}`}
          >
            {/* Mini chart thumbnail */}
            <div className="w-14 h-8 shrink-0 border border-border/50 rounded-sm overflow-hidden bg-primary">
              <MiniChart
                data={m.id === "cpu" ? cpuHistory : m.id === "memory" ? memoryHistory : diskReadHistory}
                color={selected === m.id ? "#0078d4" : "var(--text-muted)"}
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-text-primary">{m.label}</div>
              <div className="text-sm font-semibold text-accent-info">{m.value}</div>
              <div className="text-[10px] text-text-muted truncate">{m.sub}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Right: main chart */}
      <div className="flex-1 flex flex-col p-5 overflow-y-auto">
        {tsSeconds.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-text-muted">{t("performance.samplingInterval")}</p>
          </div>
        ) : (
          <>
            {selected === "cpu" && (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-medium text-text-primary">CPU</h2>
                  <span className="text-sm text-text-secondary">{perCoreCpu.length} logical processors</span>
                </div>
                <div className="flex-1 min-h-[300px]">
                  <PerformanceChart data={cpuData} series={cpuSeries} height={320} yLabel="%" yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-text-secondary border-t border-border pt-3">
                  <InfoItem label={t("performance.cpuUsage")} value={`${currentCpu.toFixed(1)}%`} />
                  <InfoItem label={t("performance.cores", { count: perCoreCpu.length })} value={`${perCoreCpu.length}`} />
                  <InfoItem label={t("performance.highest")} value={perCoreCpu.length > 0 ? `${Math.max(...perCoreCpu).toFixed(0)}%` : "—"} />
                </div>
              </>
            )}
            {selected === "memory" && (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-medium text-text-primary">{t("performance.memory")}</h2>
                  <span className="text-sm text-text-secondary">{totalMemGB.toFixed(1)} GB</span>
                </div>
                <div className="flex-1 min-h-[300px]">
                  <PerformanceChart data={memoryData} series={memorySeries} height={320} yLabel="%" yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-text-secondary border-t border-border pt-3">
                  <InfoItem label={t("performance.used")} value={`${usedMemGB.toFixed(1)} GB`} />
                  <InfoItem label={t("performance.memoryTotal")} value={`${totalMemGB.toFixed(1)} GB`} />
                  <InfoItem label={t("performance.memoryUsage")} value={`${currentMem.toFixed(1)}%`} />
                </div>
              </>
            )}
            {selected === "disk" && (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-medium text-text-primary">{t("performance.diskIO")}</h2>
                </div>
                <div className="flex-1 min-h-[300px]">
                  <PerformanceChart data={diskData} series={diskSeries} height={320} yFormat={(v) => formatRate(v)} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-text-secondary border-t border-border pt-3">
                  <InfoItem label={t("performance.diskRead")} value={formatRate(currentDiskRead)} />
                  <InfoItem label={t("performance.diskWrite")} value={formatRate(currentDiskWrite)} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-muted">{label}</div>
      <div className="text-text-primary font-medium mt-0.5">{value}</div>
    </div>
  );
}

/** Tiny sparkline chart for the left panel thumbnails */
function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const h = 32;
  const w = 56;
  const points = data.slice(-30).map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x},${y}`;
  });
  const pathD = `M${points.join(" L")}`;
  const fillD = `${pathD} L${w},${h} L0,${h} Z`;

  return (
    <svg width={w} height={h} className="block">
      <path d={fillD} fill={color} opacity="0.15" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}
