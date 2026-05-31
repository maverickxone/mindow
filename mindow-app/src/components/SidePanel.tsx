import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { PerformanceChart } from "./PerformanceChart";
import { AIChat } from "./AIChat";
import { useTauriEvent } from "../hooks/useTauriEvent";
import { useProcessStore } from "../stores/processStore";
import type { ProcessInfo, ProcessTrend, SnapshotData, AlertInfo } from "../types";
import { formatBytes, formatPercent } from "../lib/format";

/** 趋势数据缓冲区最大点数 */
const MAX_TREND_POINTS = 60;

/** Strip common executable extensions for display-friendly names */
function friendlyName(name: string): string {
  return name.replace(/\.(exe|EXE|Exe)$/, "");
}

/** Truncate a long path in the middle, keeping start and end visible */
function middleTruncate(str: string, max = 48): string {
  if (str.length <= max) return str;
  const keep = Math.floor((max - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(str.length - keep)}`;
}

// Panel width constraints
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;

interface SidePanelProps {
  /** 选中的进程 PID，null 表示未选中 */
  selectedPid: number | null;
  /** 关闭面板回调 */
  onClose: () => void;
}

/**
 * 单进程详情侧边面板。
 * 展示进程基本信息、内存和 CPU 历史曲线，并标注告警时间点。
 * 持续接收新采样数据追加到曲线。宽度可拖拽调节。
 */
export function SidePanel({ selectedPid, onClose }: SidePanelProps) {
  const { t } = useTranslation();
  const processes = useProcessStore((s) => s.processes);
  const alerts = useProcessStore((s) => s.alerts);

  // 本地趋势数据状态
  const [memoryTrend, setMemoryTrend] = useState<number[]>([]);
  const [cpuTrend, setCpuTrend] = useState<number[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 面板宽度（可拖拽调节，持久化到 localStorage）
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("sidePanelWidth"));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const resizingRef = useRef(false);

  // 用 ref 跟踪当前 pid，防止异步回调使用过期值
  const pidRef = useRef<number | null>(selectedPid);
  pidRef.current = selectedPid;

  // 获取当前选中的进程信息
  const selectedProcess = useMemo<ProcessInfo | undefined>(
    () => processes.find((p) => p.pid === selectedPid),
    [processes, selectedPid]
  );

  // 获取当前进程的活跃告警
  const processAlerts = useMemo<AlertInfo[]>(
    () => alerts.filter((a) => a.pid === selectedPid),
    [alerts, selectedPid]
  );

  // 拖拽调节宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      // Panel is anchored to the right edge: width = (viewport right) - cursorX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPanelWidth((w) => {
        localStorage.setItem("sidePanelWidth", String(w));
        return w;
      });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // 当选中进程变化时，加载历史趋势数据
  useEffect(() => {
    if (selectedPid === null) {
      setMemoryTrend([]);
      setCpuTrend([]);
      setTimestamps([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<ProcessTrend>("get_process_trend", { pid: selectedPid })
      .then((trend) => {
        if (cancelled || pidRef.current !== selectedPid) return;

        const now = Math.floor(Date.now() / 1000);
        const len = trend.memory_trend.length;
        // 生成时间戳（假设每 2 秒一个数据点，从过去推算）
        const ts = Array.from({ length: len }, (_, i) => now - (len - 1 - i) * 2);

        setMemoryTrend(trend.memory_trend);
        setCpuTrend(trend.cpu_trend);
        setTimestamps(ts);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || pidRef.current !== selectedPid) return;
        setError(String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPid]);

  // 监听 snapshot-updated 事件，追加新数据点到趋势曲线
  const handleSnapshotUpdate = useCallback(
    (data: SnapshotData) => {
      if (pidRef.current === null) return;

      const proc = data.processes.find((p) => p.pid === pidRef.current);
      if (!proc) return;

      const now = Math.floor(Date.now() / 1000);

      setMemoryTrend((prev) => {
        const next = [...prev, proc.memory_bytes];
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next;
      });

      setCpuTrend((prev) => {
        const next = [...prev, proc.cpu_percent];
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next;
      });

      setTimestamps((prev) => {
        const next = [...prev, now];
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next;
      });
    },
    []
  );

  useTauriEvent<SnapshotData>("snapshot-updated", handleSnapshotUpdate);

  // 构建 uPlot 数据
  const memoryChartData = useMemo((): [number[], number[]] => [timestamps, memoryTrend], [timestamps, memoryTrend]);
  const cpuChartData = useMemo((): [number[], number[]] => [timestamps, cpuTrend], [timestamps, cpuTrend]);

  // 面板开关状态
  const isOpen = selectedPid !== null && selectedProcess !== undefined;
  if (!isOpen) return null;

  return (
    <>
      {/* Semi-transparent backdrop for visual separation (click to close) */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0, 0, 0, 0.15)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Overlay drawer panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full bg-surface-1 border-l border-border
          overflow-y-auto shadow-[-4px_0_16px_rgba(0,0,0,0.12)] animate-panel-in"
        style={{ width: panelWidth }}
      >
        {/* Resize handle on the left edge */}
        <div
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize z-10 hover:bg-accent/30 transition-colors"
          onMouseDown={handleResizeStart}
          aria-label="Resize panel"
        />

        <div className="p-4">
          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-text-primary text-[15px] font-semibold truncate select-text" title={selectedProcess.name}>
              {friendlyName(selectedProcess.name)}
            </h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0 focus-ring"
              aria-label={t("processes.detail.close")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2L12 12M12 2L2 12" />
              </svg>
            </button>
          </div>

          {/* 基本信息卡片 */}
          <div className="bg-surface-2 rounded-md p-3 mb-4 space-y-2 text-[13px]">
            <InfoRow label="PID" value={String(selectedProcess.pid)} />
            <InfoRow label="CPU" value={formatPercent(selectedProcess.cpu_percent)} />
            <InfoRow label={t("processes.detail.infoMemory")} value={formatBytes(selectedProcess.memory_bytes)} />
            {selectedProcess.exe_path && (
              <InfoRow
                label={t("processes.detail.infoPath")}
                value={middleTruncate(selectedProcess.exe_path)}
                fullValue={selectedProcess.exe_path}
              />
            )}
          </div>

          {/* 告警标注 */}
          {processAlerts.length > 0 && (
            <div className="mb-4">
              <h3 className="text-text-secondary text-[13px] font-medium mb-1.5">
                {t("processes.detail.activeAlerts")}
              </h3>
              <div className="space-y-1">
                {processAlerts.map((alert, i) => (
                  <div
                    key={i}
                    className={`text-[12px] px-2 py-1.5 rounded-md ${
                      alert.severity === "Critical"
                        ? "bg-state-danger/10 text-state-danger"
                        : "bg-state-warning/10 text-state-warning"
                    }`}
                  >
                    {alert.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 加载/错误状态 */}
          {loading && (
            <div className="text-text-secondary text-[13px] text-center py-4">
              {t("processes.detail.loadingHistory")}
            </div>
          )}
          {error && (
            <div className="text-state-danger text-[13px] text-center py-4">
              {t("processes.detail.loadError", { error })}
            </div>
          )}

          {/* CPU 历史曲线 */}
          {!loading && !error && cpuChartData[0].length > 1 && (
            <div className="mb-4 bg-surface-2 rounded-md p-3">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-text-primary text-[13px] font-medium">
                  {t("processes.detail.cpuTrend")}
                </h3>
                <span className="text-[12px] text-color-cpu font-semibold tabular-nums">
                  {formatPercent(selectedProcess.cpu_percent)}
                </span>
              </div>
              <PerformanceChart
                data={cpuChartData}
                series={[{ label: "CPU%", stroke: "var(--color-cpu)", width: 1.5 }]}
                height={130}
                yRange={[0, 100]}
                yFormat={(v) => `${v.toFixed(0)}%`}
                spanLabel={t("performance.timeSpan")}
                maxLabel="100%"
              />
            </div>
          )}

          {/* 内存历史曲线 */}
          {!loading && !error && memoryChartData[0].length > 1 && (
            <div className="mb-4 bg-surface-2 rounded-md p-3">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-text-primary text-[13px] font-medium">
                  {t("processes.detail.memoryTrend")}
                </h3>
                <span className="text-[12px] text-color-memory font-semibold tabular-nums">
                  {formatBytes(selectedProcess.memory_bytes)}
                </span>
              </div>
              <PerformanceChart
                data={memoryChartData}
                series={[{ label: t("processes.columns.memory"), stroke: "var(--color-memory)", width: 1.5 }]}
                height={130}
                yFormat={(v) => formatBytes(v)}
                spanLabel={t("performance.timeSpan")}
              />
            </div>
          )}

          {/* 无数据时的提示 */}
          {!loading &&
            !error &&
            cpuChartData[0].length <= 1 &&
            memoryChartData[0].length <= 1 && (
              <div className="text-text-muted text-[13px] text-center py-4">
                {t("processes.detail.noData")}
              </div>
            )}

          {/* AI 分析区域 */}
          <AIChat processName={selectedProcess.name} pid={selectedProcess.pid} />
        </div>
      </div>
    </>
  );
}

/** 信息行组件 */
function InfoRow({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className="text-text-muted shrink-0 w-12">{label}</span>
      <span className="text-text-primary break-all select-text" title={fullValue}>{value}</span>
    </div>
  );
}
