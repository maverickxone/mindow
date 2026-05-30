import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { PerformanceChart } from "./PerformanceChart";
import { AIChat } from "./AIChat";
import { useTauriEvent } from "../hooks/useTauriEvent";
import { useProcessStore } from "../stores/processStore";
import type { ProcessInfo, ProcessTrend, SnapshotData, AlertInfo } from "../types";

/** 趋势数据缓冲区最大点数 */
const MAX_TREND_POINTS = 60;

/** 格式化字节为可读格式 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SidePanelProps {
  /** 选中的进程 PID，null 表示未选中 */
  selectedPid: number | null;
  /** 关闭面板回调 */
  onClose: () => void;
}

/**
 * 单进程详情侧边面板。
 * 展示进程基本信息、内存和 CPU 历史曲线，并标注告警时间点。
 * 持续接收新采样数据追加到曲线。
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

  // 构建 uPlot 数据：内存曲线
  const memoryChartData = useMemo((): [number[], number[]] => {
    return [timestamps, memoryTrend];
  }, [timestamps, memoryTrend]);

  // 构建 uPlot 数据：CPU 曲线
  const cpuChartData = useMemo((): [number[], number[]] => {
    return [timestamps, cpuTrend];
  }, [timestamps, cpuTrend]);

  // 面板滑入/滑出
  const isOpen = selectedPid !== null;

  return (
    <div
      className={`
        shrink-0 border-l border-border bg-secondary overflow-y-auto
        transition-all duration-200 ease-in-out
        ${isOpen ? "w-72 opacity-100 animate-panel-in" : "w-0 opacity-0 overflow-hidden"}
      `}
    >
      {isOpen && selectedProcess && (
        <div className="p-3 min-w-[288px]">
          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text-primary text-xs font-semibold truncate">
              {selectedProcess.name}
            </h2>
            <button
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-tertiary transition-colors"
              aria-label={t("processes.detail.close")}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1L9 9M9 1L1 9" />
              </svg>
            </button>
          </div>

          {/* 基本信息 */}
          <div className="space-y-1.5 mb-3 text-[11px]">
            <InfoRow label="PID" value={String(selectedProcess.pid)} />
            <InfoRow label="CPU" value={`${selectedProcess.cpu_percent.toFixed(1)}%`} />
            <InfoRow label={t("processes.detail.infoMemory")} value={formatBytes(selectedProcess.memory_bytes)} />
            {selectedProcess.exe_path && (
              <InfoRow label={t("processes.detail.infoPath")} value={selectedProcess.exe_path} />
            )}
          </div>

          {/* 告警标注 */}
          {processAlerts.length > 0 && (
            <div className="mb-3">
              <h3 className="text-text-secondary text-[11px] font-medium mb-1">
                {t("processes.detail.activeAlerts")}
              </h3>
              <div className="space-y-1">
                {processAlerts.map((alert, i) => (
                  <div
                    key={i}
                    className={`text-[11px] px-2 py-1 rounded ${
                      alert.severity === "Critical"
                        ? "bg-accent-danger/10 text-accent-danger"
                        : "bg-accent-warning/10 text-accent-warning"
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
            <div className="text-text-secondary text-xs text-center py-4">
              {t("processes.detail.loadingHistory")}
            </div>
          )}
          {error && (
            <div className="text-accent-danger text-xs text-center py-4">
              {t("processes.detail.loadError", { error })}
            </div>
          )}

          {/* CPU 历史曲线 */}
          {!loading && !error && cpuChartData[0].length > 1 && (
            <div className="mb-4">
              <h3 className="text-text-secondary text-xs font-medium mb-2">
                {t("processes.detail.cpuTrend")}
              </h3>
              <PerformanceChart
                data={cpuChartData}
                series={[
                  { label: "CPU%", stroke: "var(--accent-info)", width: 1.5 },
                ]}
                height={120}
                yLabel="%"
                yRange={[0, 100]}
                yFormat={(v) => `${v.toFixed(0)}%`}
              />
            </div>
          )}

          {/* 内存历史曲线 */}
          {!loading && !error && memoryChartData[0].length > 1 && (
            <div className="mb-4">
              <h3 className="text-text-secondary text-xs font-medium mb-2">
                {t("processes.detail.memoryTrend")}
              </h3>
              <PerformanceChart
                data={memoryChartData}
                series={[
                  {
                    label: "内存",
                    stroke: "var(--accent-safe)",
                    width: 1.5,
                    fill: "rgba(74, 222, 128, 0.1)",
                  },
                ]}
                height={120}
                yFormat={(v) => formatBytes(v)}
              />
            </div>
          )}

          {/* 无数据时的提示 */}
          {!loading &&
            !error &&
            cpuChartData[0].length <= 1 &&
            memoryChartData[0].length <= 1 && (
              <div className="text-text-muted text-xs text-center py-4">
                {t("processes.detail.noData")}
              </div>
            )}

          {/* AI 分析区域 */}
          <AIChat processName={selectedProcess.name} pid={selectedProcess.pid} />
        </div>
      )}
    </div>
  );
}

/** 信息行组件 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-text-muted shrink-0 w-10">{label}</span>
      <span className="text-text-primary break-all">{value}</span>
    </div>
  );
}
