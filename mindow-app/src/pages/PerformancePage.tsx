import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePerformanceStore } from "../stores/performanceStore";
import { useProcessStore } from "../stores/processStore";
import { PerformanceChart, type ChartSeries } from "../components/PerformanceChart";
import type uPlot from "uplot";

/** 格式化字节为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化字节速率 */
function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** CPU 曲线系列配置 */
const cpuSeriesConfig: ChartSeries[] = [
  { label: "CPU", stroke: "var(--accent-info)", width: 2, fill: "rgba(34,211,238,0.08)" },
];

/** 内存曲线系列配置 */
const memorySeriesConfig: ChartSeries[] = [
  { label: "Memory", stroke: "var(--accent-safe)", width: 2, fill: "rgba(74,222,128,0.08)" },
];

/** 磁盘 IO 曲线系列配置 */
const diskSeriesConfig: ChartSeries[] = [
  { label: "Read", stroke: "var(--accent-warning)", width: 1.5 },
  { label: "Write", stroke: "var(--accent-danger)", width: 1.5 },
];

/** 每核 CPU 生成颜色 */
function getCoreColor(index: number, total: number): string {
  const hue = (index / total) * 300; // spread across hue range
  return `hsl(${hue}, 70%, 60%)`;
}

export function PerformancePage() {
  const { t } = useTranslation();
  const timestamps = usePerformanceStore((s) => s.timestamps);
  const cpuHistory = usePerformanceStore((s) => s.cpuHistory);
  const memoryHistory = usePerformanceStore((s) => s.memoryHistory);
  const diskReadHistory = usePerformanceStore((s) => s.diskReadHistory);
  const diskWriteHistory = usePerformanceStore((s) => s.diskWriteHistory);

  const system = useProcessStore((s) => s.system);

  // Convert timestamps to seconds (uPlot expects seconds)
  const tsSeconds = useMemo(
    () => timestamps.map((t) => t / 1000),
    [timestamps]
  );

  // CPU data: average + per-core
  const perCoreCpu = system?.per_core_cpu ?? [];
  const coreCount = perCoreCpu.length;

  const cpuCoreSeries: ChartSeries[] = useMemo(() => {
    const series: ChartSeries[] = [
      { label: t("performance.cpuAverageSeries"), stroke: "var(--accent-info)", width: 2, fill: "rgba(34,211,238,0.08)" },
    ];
    for (let i = 0; i < coreCount; i++) {
      series.push({
        label: t("performance.core", { index: i }),
        stroke: getCoreColor(i, coreCount),
        width: 1,
      });
    }
    return series;
  }, [coreCount, t]);

  // Build CPU chart data — we only have overall CPU history, per-core is latest snapshot only
  // For per-core we show lines at the latest value (flat line) or just omit historical per-core
  // Best approach: show average as main line. Per-core as reference in the summary.
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

  // Current values
  const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : 0;
  const currentMem = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : 0;
  const currentDiskRead = diskReadHistory.length > 0 ? diskReadHistory[diskReadHistory.length - 1] : 0;
  const currentDiskWrite = diskWriteHistory.length > 0 ? diskWriteHistory[diskWriteHistory.length - 1] : 0;

  const totalMemGB = system ? system.total_memory / (1024 * 1024 * 1024) : 0;
  const usedMemGB = system ? system.used_memory / (1024 * 1024 * 1024) : 0;

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="grid grid-cols-2 gap-2 h-full">
        {/* CPU Chart */}
        <ChartCard title={t("performance.cpu")}>
          <PerformanceChart
            data={cpuData}
            series={coreCount > 0 ? cpuCoreSeries.slice(0, 1) : cpuSeriesConfig}
            height={160}
            yLabel="%"
            yRange={[0, 100]}
            yFormat={(v) => `${v.toFixed(0)}%`}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary data-transition">
            <span>
              {t("performance.cpuAverage")}: <span className="text-accent-info font-medium">{currentCpu.toFixed(1)}%</span>
            </span>
            {perCoreCpu.length > 0 && perCoreCpu.length <= 16 && (
              <>
                {perCoreCpu.map((val, i) => (
                  <span key={i}>
                    {t("performance.core", { index: i })}: <span className="font-medium" style={{ color: getCoreColor(i, coreCount) }}>{val.toFixed(0)}%</span>
                  </span>
                ))}
              </>
            )}
            {perCoreCpu.length > 16 && (
              <span>
                {t("performance.cores", { count: coreCount })} | {t("performance.highest")}: {Math.max(...perCoreCpu).toFixed(0)}%
              </span>
            )}
          </div>
        </ChartCard>

        {/* Memory Chart */}
        <ChartCard title={t("performance.memory")}>
          <PerformanceChart
            data={memoryData}
            series={memorySeriesConfig}
            height={160}
            yLabel="%"
            yRange={[0, 100]}
            yFormat={(v) => `${v.toFixed(0)}%`}
          />
          <div className="mt-2 text-xs text-text-secondary data-transition">
            <span>
              {t("performance.used")}: <span className="text-accent-safe font-medium">{usedMemGB.toFixed(1)} GB</span>
              {" / "}
              {totalMemGB.toFixed(1)} GB
              {" ("}
              <span className="font-medium">{currentMem.toFixed(1)}%</span>
              {")"}
            </span>
          </div>
        </ChartCard>

        {/* Disk IO Chart */}
        <ChartCard title={t("performance.diskIO")}>
          <PerformanceChart
            data={diskData}
            series={diskSeriesConfig}
            height={160}
            yFormat={(v) => formatRate(v)}
          />
          <div className="mt-2 flex gap-4 text-xs text-text-secondary data-transition">
            <span>
              {t("performance.read")}: <span className="text-accent-warning font-medium">{formatRate(currentDiskRead)}</span>
            </span>
            <span>
              {t("performance.write")}: <span className="text-accent-danger font-medium">{formatRate(currentDiskWrite)}</span>
            </span>
          </div>
        </ChartCard>

        {/* Network / System Summary */}
        <ChartCard title={t("performance.systemOverview")}>
          <div className="flex flex-col justify-center h-[160px] gap-3 text-sm">
            <SummaryRow label={t("performance.cpuUsage")} value={`${currentCpu.toFixed(1)}%`} color="text-accent-info" />
            <SummaryRow
              label={t("performance.memoryUsage")}
              value={`${usedMemGB.toFixed(1)} / ${totalMemGB.toFixed(1)} GB`}
              color="text-accent-safe"
            />
            <SummaryRow label={t("performance.diskRead")} value={formatRate(currentDiskRead)} color="text-accent-warning" />
            <SummaryRow label={t("performance.diskWrite")} value={formatRate(currentDiskWrite)} color="text-accent-danger" />
            {system?.battery_level != null && (
              <SummaryRow
                label={t("performance.battery")}
                value={`${system.battery_level}% ${system.battery_charging === "Charging" ? "⚡ " + t("performance.charging") : ""}`}
                color="text-text-primary"
              />
            )}
          </div>
          <div className="mt-2 text-xs text-text-muted">
            {t("performance.dataPoints")}: {timestamps.length} / 60 | {t("performance.samplingInterval")}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

/** 图表卡片容器 */
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-lg p-3 flex flex-col">
      <h3 className="text-sm font-medium text-text-primary mb-2">{title}</h3>
      {children}
    </div>
  );
}

/** 摘要信息行 */
function SummaryRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className={`${color} font-medium data-transition`}>{value}</span>
    </div>
  );
}
