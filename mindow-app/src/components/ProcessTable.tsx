import { useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProcessInfo } from "../types";
import type { SortColumn, SortDirection } from "../stores/processStore";

/** 格式化字节为人类可读格式 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化 CPU 百分比 */
function formatCpu(percent: number): string {
  return percent < 0.1 ? "0" : percent.toFixed(1);
}

interface ProcessGroupProps {
  label: string;
  count: number;
}

/** 分组标题行 */
function GroupHeader({ label, count }: ProcessGroupProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-tertiary border-b border-border sticky top-0 z-10">
      <span className="text-text-primary text-xs font-semibold">{label}</span>
      <span className="text-text-muted text-xs">({count})</span>
    </div>
  );
}

/** 表格列定义 */
const columnDefs: { key: SortColumn; labelKey: string; width: string }[] = [
  { key: "name", labelKey: "processes.columns.name", width: "flex-[2]" },
  { key: "pid", labelKey: "processes.columns.pid", width: "w-20" },
  { key: "cpu", labelKey: "processes.columns.cpu", width: "w-20" },
  { key: "memory", labelKey: "processes.columns.memory", width: "w-24" },
  { key: "diskRead", labelKey: "performance.read", width: "w-24" },
  { key: "diskWrite", labelKey: "performance.write", width: "w-24" },
];

/** 用于虚拟列表的行类型 */
type RowItem =
  | { type: "header"; label: string; count: number }
  | { type: "process"; process: ProcessInfo };

interface ProcessTableProps {
  processes: ProcessInfo[];
  selectedPid: number | null;
  selectedPids: Set<number>;
  onSelectProcess: (pid: number | null) => void;
  onToggleSelection: (pid: number) => void;
  onRangeSelect: (pid: number, visiblePids: number[]) => void;
  onContextMenu: (e: React.MouseEvent, process: ProcessInfo) => void;
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
  onToggleSort: (column: SortColumn) => void;
}

export function ProcessTable({
  processes,
  selectedPid,
  selectedPids,
  onSelectProcess,
  onToggleSelection,
  onRangeSelect,
  onContextMenu,
  sortColumn,
  sortDirection,
  onToggleSort,
}: ProcessTableProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);

  // 按 path_status 分组并构建行数据
  const rows = useMemo<RowItem[]>(() => {
    const userProcesses = processes.filter((p) => p.path_status === "User");
    const unknownProcesses = processes.filter((p) => p.path_status === "Unknown");
    const systemProcesses = processes.filter((p) => p.path_status === "System");

    const result: RowItem[] = [];

    if (userProcesses.length > 0) {
      result.push({ type: "header", label: t("processes.groups.apps"), count: userProcesses.length });
      for (const p of userProcesses) {
        result.push({ type: "process", process: p });
      }
    }

    if (unknownProcesses.length > 0) {
      result.push({ type: "header", label: t("processes.groups.background"), count: unknownProcesses.length });
      for (const p of unknownProcesses) {
        result.push({ type: "process", process: p });
      }
    }

    if (systemProcesses.length > 0) {
      result.push({ type: "header", label: t("processes.groups.system"), count: systemProcesses.length });
      for (const p of systemProcesses) {
        result.push({ type: "process", process: p });
      }
    }

    return result;
  }, [processes, t]);

  // 获取可见进程的 PID 列表（用于范围选择）
  const visiblePids = useMemo(() => {
    return rows
      .filter((r): r is Extract<RowItem, { type: "process" }> => r.type === "process")
      .map((r) => r.process.pid);
  }, [rows]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, process: ProcessInfo) => {
      if (e.ctrlKey || e.metaKey) {
        onToggleSelection(process.pid);
      } else if (e.shiftKey) {
        onRangeSelect(process.pid, visiblePids);
      } else {
        onSelectProcess(process.pid === selectedPid ? null : process.pid);
      }
    },
    [onToggleSelection, onRangeSelect, onSelectProcess, selectedPid, visiblePids]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index].type === "header" ? 28 : 32),
    overscan: 10,
  });

  return (
    <div className="flex flex-col h-full">
      {/* 表头 — 点击列标题可排序 */}
      <div className="flex items-center px-3 py-2 bg-secondary border-b border-border text-text-secondary text-xs font-medium shrink-0">
        {columnDefs.map((col) => (
          <div
            key={col.key}
            className={`${col.width} px-1 cursor-pointer select-none hover:text-text-primary transition-colors`}
            onClick={() => onToggleSort(col.key)}
          >
            {t(col.labelKey)}
            {sortColumn === col.key && (
              <span className="ml-1 text-accent-info">
                {sortDirection === "asc" ? "▲" : "▼"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 虚拟滚动区域 */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.type === "header" ? (
                  <GroupHeader label={row.label} count={row.count} />
                ) : (
                  <ProcessRow
                    process={row.process}
                    isSelected={selectedPids.has(row.process.pid)}
                    onClick={handleRowClick}
                    onContextMenu={onContextMenu}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ProcessRowProps {
  process: ProcessInfo;
  isSelected: boolean;
  onClick: (e: React.MouseEvent, process: ProcessInfo) => void;
  onContextMenu: (e: React.MouseEvent, process: ProcessInfo) => void;
}

/** PathStatus 安全标记配置 */
function getStatusMark(pathStatus: ProcessInfo["path_status"]): { label: string; color: string } {
  switch (pathStatus) {
    case "System":
      return { label: "安全", color: "var(--status-safe)" };
    case "User":
      return { label: "安全", color: "var(--status-safe)" };
    case "Unknown":
      return { label: "注意", color: "var(--status-caution)" };
  }
}

function ProcessRow({ process, isSelected, onClick, onContextMenu }: ProcessRowProps) {
  const statusMark = getStatusMark(process.path_status);

  return (
    <div
      className={`flex items-center px-3 h-full text-xs cursor-pointer border-b border-border/50 data-transition
        ${isSelected ? "bg-accent-info/10 text-accent-info" : "hover:bg-tertiary text-text-primary"}`}
      onClick={(e) => onClick(e, process)}
      onContextMenu={(e) => onContextMenu(e, process)}
    >
      <div className="flex-[2] px-1 truncate flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: statusMark.color }}
          title={statusMark.label}
        />
        {process.name}
      </div>
      <div className="w-20 px-1 text-text-secondary data-transition">{process.pid}</div>
      <div className="w-20 px-1 text-text-secondary data-transition">{formatCpu(process.cpu_percent)}</div>
      <div className="w-24 px-1 text-text-secondary data-transition">{formatBytes(process.memory_bytes)}</div>
      <div className="w-24 px-1 text-text-secondary data-transition">{formatBytes(process.disk_read_bytes)}</div>
      <div className="w-24 px-1 text-text-secondary data-transition">{formatBytes(process.disk_write_bytes)}</div>
    </div>
  );
}
