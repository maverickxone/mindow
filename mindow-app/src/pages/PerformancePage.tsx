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

const cpuSeries: ChartSeries[] = [{ label: "CPU", stroke: "var(--color-cpu)" }];
const memorySeries: ChartSeries[] = [{ label: "Memory", stroke: "var(--color-memory)" }];
const diskSeries: ChartSeries[] = [
  { label: "Read", stroke: "var(--color-disk)" },
  { label: "Write", stroke: "var(--color-disk-write)" },
];

export function PerformancePage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<MetricId>("memory");
  const timestamps = usePerformanceStore((s) => s.timestamps);
  const cpuHistory = usePerformanceStore((s) => s.cpuHistory);
  const memoryHistory = usePerformanceStore((s) => s.memoryHistory);
  const diskReadHistory = usePerformanceStore((s) => s.diskReadHistory);
  const diskWriteHistory = usePerformanceStore((s) => s.diskWriteHistory);
  const batteryHistory = usePerformanceStore((s) => s.batteryHistory);
  const setHistory = usePerformanceStore((s) => s.setHistory);
  const system = useProcessStore((s) => s.system);

  useEffect(() => {
    invoke<PerformanceHistory>("get_performance_history")
      .then((h) => { if (h && h.timestamps.length > 0) setHistory(h); })
      .catch(() => {});
  }, [setHistory]);

  const tsSeconds = useMemo(() => timestamps.map((t) => t / 1000), [timestamps]);
  const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : 0;
  const currentMem = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : 0;
  const currentDiskRead = diskReadHistory.length > 0 ? diskReadHistory[diskReadHistory.length - 1] : 0;
  const currentDiskWrite = diskWriteHistory.length > 0 ? diskWriteHistory[diskWriteHistory.length - 1] : 0;
  const totalMemGB = system ? system.total_memory / (1024 ** 3) : 0;
  const usedMemGB = system ? system.used_memory / (1024 ** 3) : 0;
  const availMemGB = Math.max(0, totalMemGB - usedMemGB);
  const perCoreCpu = system?.per_core_cpu ?? [];
  const batteryLevel = system?.battery_level ?? null;
  const batteryCharging = system?.battery_charging ?? null;

  const cpuData: uPlot.AlignedData = useMemo(() => tsSeconds.length ? [tsSeconds, cpuHistory] : [[], []], [tsSeconds, cpuHistory]);
  const memoryData: uPlot.AlignedData = useMemo(() => tsSeconds.length ? [tsSeconds, memoryHistory] : [[], []], [tsSeconds, memoryHistory]);
  const diskData: uPlot.AlignedData = useMemo(() => tsSeconds.length ? [tsSeconds, diskReadHistory, diskWriteHistory] : [[], [], []], [tsSeconds, diskReadHistory, diskWriteHistory]);
  const batteryData: uPlot.AlignedData = useMemo(() => {
    if (!tsSeconds.length || !batteryHistory.length) return [[], []];
    const len = Math.min(tsSeconds.length, batteryHistory.length);
    return [tsSeconds.slice(-len), batteryHistory.slice(-len)];
  }, [tsSeconds, batteryHistory]);

  const batterySeries: ChartSeries[] = useMemo(() => [
    { label: t("performance.battery"), stroke: "var(--color-battery)" },
  ], [t]);

  // Left panel metrics
  const metrics: { id: MetricId; title: string; sub1: string; sub2: string; color: string; sparkData: number[]; fixedMax?: number }[] = [
    {
      id: "cpu", title: "CPU",
      sub1: `${formatPercent(currentCpu)} ${(system?.per_core_cpu?.length || 0)} 核心`,
      sub2: "",
      color: "var(--color-cpu)", sparkData: cpuHistory, fixedMax: 100,
    },
    {
      id: "memory", title: t("performance.memory"),
      sub1: `${usedMemGB.toFixed(1)}/${totalMemGB.toFixed(1)} GB (${Math.round(currentMem)}%)`,
      sub2: "",
      color: "var(--color-memory)", sparkData: memoryHistory, fixedMax: 100,
    },
    {
      id: "disk", title: `磁盘 0 (C: D:)`,
      sub1: "SSD (NVMe)",
      sub2: formatRate(currentDiskRead + currentDiskWrite),
      color: "var(--color-disk)", sparkData: diskReadHistory,
    },
    ...(batteryLevel != null ? [{
      id: "battery" as MetricId, title: t("performance.battery"),
      sub1: `${batteryLevel.toFixed(0)}%`,
      sub2: batteryCharging === "Charging" ? t("performance.charging") : t("performance.batteryOnBattery"),
      color: "var(--color-battery)",
      sparkData: batteryHistory.length >= 2 ? batteryHistory : [batteryLevel, batteryLevel],
      fixedMax: 100,
    }] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-surface-0">
      {/* ═══ Top Header (spans across both left list and right details) ═══ */}
      <div className="h-[52px] shrink-0 px-6 flex items-center">
        <span className="text-[18px] font-normal text-text-primary">{t("performance.title", "性能")}</span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ═══ Left: metric selection (Win11: white bg, ~280px, thin right border) ═══ */}
      <div className="w-[280px] shrink-0 border-r border-border overflow-y-auto py-0 flex flex-col gap-0">
        {metrics.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            className={`flex items-start gap-4 px-4 py-3 text-left w-full border-l-[3px]
              ${selected === m.id ? "bg-[rgba(0,0,0,0.04)] dark:bg-[rgba(255,255,255,0.06)] border-transparent" : "bg-transparent hover:bg-[rgba(0,0,0,0.02)] border-transparent"}`}
          >
            {/* Sparkline thumbnail */}
            <div className="w-[84px] h-[54px] shrink-0 overflow-hidden border border-[#d0d0d0] bg-white">
              <MiniSparkline data={m.sparkData} color={m.color} maxValue={m.fixedMax} />
            </div>
            {/* Text info */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[18px] text-text-primary leading-tight mb-1">{m.title}</div>
              <div className="text-[12px] text-text-secondary leading-tight">{m.sub1}</div>
              {m.sub2 && <div className="text-[12px] text-text-secondary leading-tight mt-0.5">{m.sub2}</div>}
            </div>
          </button>
        ))}
        </div>

        {/* ═══ Right: main detail area (Win11: white bg, padded) ═══ */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {tsSeconds.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="text-sm text-text-muted">{t("performance.loading")}</p>
          </div>
        ) : (
          <>
            {selected === "cpu" && <CpuDetail cpuData={cpuData} currentCpu={currentCpu} perCoreCpu={perCoreCpu} cpuHistory={cpuHistory} t={t} />}
            {selected === "memory" && <MemoryDetail memoryData={memoryData} currentMem={currentMem} totalMemGB={totalMemGB} usedMemGB={usedMemGB} availMemGB={availMemGB} memoryHistory={memoryHistory} system={system} t={t} />}
            {selected === "disk" && <DiskDetail diskData={diskData} currentDiskRead={currentDiskRead} currentDiskWrite={currentDiskWrite} diskReadHistory={diskReadHistory} t={t} />}
            {selected === "battery" && batteryLevel != null && <BatteryDetail batteryData={batteryData} batterySeries={batterySeries} batteryLevel={batteryLevel} batteryCharging={batteryCharging} batteryHistory={batteryHistory} t={t} />}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Detail Views — each matches Win11 layout exactly
   ═══════════════════════════════════════════════════════════════════ */

function CpuDetail({ cpuData, currentCpu, perCoreCpu, cpuHistory: _cpuHistory, t }: { cpuData: uPlot.AlignedData; currentCpu: number; perCoreCpu: number[]; cpuHistory: number[]; t: any }) {
  const [view, setView] = useState<"overall" | "logical">("overall");
  const coresHistory = usePerformanceStore((s) => s.coresHistory);
  const tsSeconds = useMemo(() => {
    const ts = [];
    const len = coresHistory[0]?.length || 0;
    for(let i=0; i<len; i++) ts.push(i);
    return ts;
  }, [coresHistory]);

  return (
    <>
      <PageHeader title="CPU" rightTop={formatPercent(currentCpu)} rightBottom={t("performance.logicalProcessors", { count: perCoreCpu.length })} />
      <div className="flex justify-between items-center mt-1 mb-1">
        <ChartSubtitle text={t("performance.cpuUsage")} rightText="100%" />
        <select value={view} onChange={(e) => setView(e.target.value as any)} className="text-[11px] bg-transparent border-none text-text-secondary outline-none cursor-pointer hover:text-text-primary">
          <option value="overall">{t("performance.overallUtilization", "总体利用率")}</option>
          <option value="logical">{t("performance.logicalProcessors", "逻辑处理器")}</option>
        </select>
      </div>
      <ChartBox>
        {view === "overall" ? (
          <PerformanceChart data={cpuData} series={cpuSeries} height={400} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} />
        ) : (
          <div className="grid grid-cols-4 lg:grid-cols-8 gap-[1px] bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.06)] border border-transparent">
            {coresHistory.map((history, i) => (
              <div key={i} className="bg-white dark:bg-surface-0 w-full">
                <PerformanceChart data={[tsSeconds, history]} series={cpuSeries} height={80} yRange={[0, 100]} compact />
              </div>
            ))}
          </div>
        )}
      </ChartBox>
      <div className="flex flex-wrap md:flex-nowrap gap-[80px] border-t border-border pt-4 mt-6">
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">利用率</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{formatPercent(currentCpu)}</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">进程</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">正常运行时间</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
        </div>
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">速度</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">线程</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[12px] min-w-[200px]">
          <div className="flex justify-between"><span className="text-text-secondary">基本速度:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">插槽:</span><span className="text-text-primary tabular-nums">1</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">内核:</span><span className="text-text-primary tabular-nums">{perCoreCpu.length}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">逻辑处理器:</span><span className="text-text-primary tabular-nums">{perCoreCpu.length}</span></div>
          <div className="flex justify-between mt-2"><span className="text-text-secondary">虚拟化:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">L1 缓存:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">L2 缓存:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">L3 缓存:</span><span className="text-text-primary tabular-nums">—</span></div>
        </div>
      </div>
    </>
  );
}

function MemoryDetail({ memoryData, currentMem: _currentMem, totalMemGB, usedMemGB, availMemGB, memoryHistory: _memoryHistory, system: _system, t }: { memoryData: uPlot.AlignedData; currentMem: number; totalMemGB: number; usedMemGB: number; availMemGB: number; memoryHistory: number[]; system: any; t: any }) {
  return (
    <>
      <PageHeader title={t("performance.memory", "内存")} rightTop={`${totalMemGB.toFixed(1)} GB`} rightBottom={`${availMemGB.toFixed(1)} GB`} />
      <ChartSubtitle text={t("performance.memoryUsage", "内存使用量")} />
      <ChartBox>
        <PerformanceChart data={memoryData} series={memorySeries} height={400} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} />
      </ChartBox>

      {/* Memory composition bar */}
      <div className="mt-4 mb-1 text-[11px] text-text-muted">{t("performance.memoryComposition", "内存组合")}</div>
      <div className="w-full h-[18px] flex border border-[#1d70b8] bg-transparent mb-6">
        <div className="h-full border-r border-[#1d70b8] bg-[#d5e8fb]" style={{ width: `${(usedMemGB / totalMemGB) * 100}%` }} />
      </div>

      <div className="flex flex-wrap md:flex-nowrap gap-[80px] border-t border-border pt-4">
        {/* Column 1 */}
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">使用中(已压缩)</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{usedMemGB.toFixed(1)} GB</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">已提交</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">分页缓冲池</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
        </div>

        {/* Column 2 */}
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">可用</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{availMemGB.toFixed(1)} GB</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">已缓存</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">非分页缓冲池</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">—</div>
          </div>
        </div>

        {/* Column 3 */}
        <div className="flex flex-col gap-1 text-[12px] min-w-[200px]">
          <div className="flex justify-between"><span className="text-text-secondary">速度:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">已使用的插槽:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">外形规格:</span><span className="text-text-primary">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">为硬件保留的内存:</span><span className="text-text-primary tabular-nums">—</span></div>
        </div>
      </div>
    </>
  );
}


function DiskDetail({ diskData, currentDiskRead, currentDiskWrite, diskReadHistory: _diskReadHistory, t }: { diskData: uPlot.AlignedData; currentDiskRead: number; currentDiskWrite: number; diskReadHistory: number[]; t: any }) {
  return (
    <>
      <PageHeader title={t("performance.diskIO")} rightTop={formatRate(currentDiskRead + currentDiskWrite)} rightBottom={t("performance.diskType")} />
      <ChartSubtitle text={`${t("performance.diskRead")} / ${t("performance.diskWrite")}`} />
      <ChartBox>
        <PerformanceChart data={diskData} series={diskSeries} height={400} yFormat={(v) => formatRate(v)} showLegend smooth={false} />
      </ChartBox>
      
      <div className="flex flex-wrap md:flex-nowrap gap-[80px] border-t border-border pt-4 mt-6">
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">活动时间</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">0%</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">平均响应时间</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">0.0 ms</div>
          </div>
        </div>
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">读取速度</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{formatRate(currentDiskRead)}</div>
          </div>
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">写入速度</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{formatRate(currentDiskWrite)}</div>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[12px] min-w-[200px]">
          <div className="flex justify-between"><span className="text-text-secondary">容量:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">已格式化:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">系统磁盘:</span><span className="text-text-primary tabular-nums">—</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">页面文件:</span><span className="text-text-primary tabular-nums">—</span></div>
        </div>
      </div>
    </>
  );
}

function BatteryDetail({ batteryData, batterySeries, batteryLevel, batteryCharging, batteryHistory, t }: { batteryData: uPlot.AlignedData; batterySeries: ChartSeries[]; batteryLevel: number; batteryCharging: string | null; batteryHistory: number[]; t: any }) {
  const statusText = batteryCharging === "Charging" ? t("performance.charging") : batteryCharging === "Full" ? t("performance.batteryFull") : t("performance.batteryOnBattery");
  return (
    <>
      <PageHeader title={t("performance.battery")} rightTop={`${batteryLevel.toFixed(0)}%`} rightBottom={statusText} />
      <ChartSubtitle text={`${t("performance.battery")} %`} rightText="100%" />
      <ChartBox>
        <PerformanceChart data={batteryData} series={batterySeries} height={320} yRange={[0, 100]} yFormat={(v) => `${v.toFixed(0)}%`} />
      </ChartBox>
      
      <div className="flex flex-wrap md:flex-nowrap gap-[80px] border-t border-border pt-4 mt-6">
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">剩余电量</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{batteryLevel.toFixed(0)}%</div>
          </div>
        </div>
        <div className="flex flex-col gap-5 min-w-[140px]">
          <div>
            <div className="text-[12px] text-text-secondary leading-tight">状态</div>
            <div className="text-[30px] font-normal text-text-primary tabular-nums leading-none mt-0.5">{statusText}</div>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[12px] min-w-[200px]">
          <div className="flex justify-between"><span className="text-text-secondary">数据点数:</span><span className="text-text-primary tabular-nums">{batteryHistory.length}</span></div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Shared sub-components
   ═══════════════════════════════════════════════════════════════════ */

/** Win11 page header */
function PageHeader({ title, rightTop, rightBottom }: { title: string; rightTop?: string; rightBottom?: string }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <h2 className="text-[34px] font-medium text-text-primary leading-none tracking-tight">{title}</h2>
      <div className="flex flex-col items-end">
        {rightTop && <span className="text-[15px] font-semibold text-text-primary tabular-nums leading-tight">{rightTop}</span>}
        {rightBottom && <span className="text-[12px] text-text-muted tabular-nums leading-tight mt-0.5">{rightBottom}</span>}
      </div>
    </div>
  );
}

/** Small subtitle above chart: "内存使用量" left + "31.4 GB" right */
function ChartSubtitle({ text, rightText }: { text: string; rightText?: string }) {
  return (
    <div className="flex justify-between items-center mt-1 mb-1">
      <span className="text-[11px] text-text-muted">{text}</span>
      {rightText && <span className="text-[11px] text-text-muted tabular-nums">{rightText}</span>}
    </div>
  );
}

/**
 * Chart wrapper with Win11's barely-visible border
 * Kept for generic container styling
 */
function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.06)] rounded-[2px]">
      {children}
    </div>
  );
}

function MiniSparkline({ data, color, maxValue }: { data: number[]; color: string; maxValue?: number }) {
  const h = 54, w = 84;
  if (data.length < 2) {
    return <div className="w-full h-full bg-surface-1 animate-pulse" />;
  }
  const slice = data.slice(-30);
  const max = maxValue ?? Math.max(...slice, 1);
  const pts = slice.map((v, i, a) => {
    const x = (i / (a.length - 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block bg-transparent">
      <path d={area} fill={color} opacity="0.15" />
      <path d={line} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
