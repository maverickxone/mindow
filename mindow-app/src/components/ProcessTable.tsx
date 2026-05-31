import { useRef, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useProcessStore } from "../stores/processStore";
import { BaselineTag } from "./BaselineTag";
import { ProcessIcon } from "./ProcessIcon";
import { formatBytes, formatPercent, formatDiskRate } from "../lib/format";
import { getResourceHeatBg } from "../lib/heat";
import type { ProcessInfo, AlertInfo } from "../types";
import type { SortColumn, SortDirection } from "../stores/processStore";

/* ─── SVG Icons ─── */

/** Chevron icon for expand/collapse (points right, rotates 90° when expanded) */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-150"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M3.5 2 L6.5 5 L3.5 8" />
    </svg>
  );
}

/** Sort arrow icon (�?or �? */
function SortArrowIcon({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="currentColor"
      className="inline-block ml-0.5 text-accent-info shrink-0"
    >
      {direction === "asc" ? (
        <path d="M4 1 L7 6 L1 6 Z" />
      ) : (
        <path d="M4 7 L1 2 L7 2 Z" />
      )}
    </svg>
  );
}

/** Merged process group */
interface ProcessGroup {
  name: string;
  processes: ProcessInfo[];
  totalCpu: number;
  totalMemory: number;
  totalDiskRead: number;
  totalDiskWrite: number;
  pathStatus: ProcessInfo["path_status"];
  primaryPid: number;
  baselineDeviation: number | null;
  exePath: string | null;
  hasAlert: boolean;
}

type RowItem =
  | { type: "group-header"; label: string; count: number }
  | { type: "group"; group: ProcessGroup }
  | { type: "child"; process: ProcessInfo; parentName: string };

/**
 * Sort merged groups GLOBALLY by the active column using each group's aggregate
 * (displayed) value. Sorting operates across all groups regardless of section
 * (apps/background/system) so that the entire list is ordered uniformly.
 */
function sortGroupsGlobal(
  groups: ProcessGroup[],
  column: SortColumn | null,
  direction: SortDirection
): ProcessGroup[] {
  if (!column) return groups;
  const m = direction === "asc" ? 1 : -1;
  const sorted = [...groups];
  sorted.sort((a, b) => {
    switch (column) {
      case "name":
        return m * a.name.localeCompare(b.name);
      case "pid":
        return m * (a.primaryPid - b.primaryPid);
      case "cpu":
        return m * (a.totalCpu - b.totalCpu);
      case "memory":
        return m * (a.totalMemory - b.totalMemory);
      case "diskRead":
        return m * (a.totalDiskRead + a.totalDiskWrite - (b.totalDiskRead + b.totalDiskWrite));
      case "diskWrite":
        return m * (a.totalDiskWrite - b.totalDiskWrite);
      default:
        return 0;
    }
  });
  return sorted;
}

/** Strip common executable extensions for display-friendly names */
function friendlyName(name: string): string {
  return name.replace(/\.(exe|EXE|Exe)$/, "");
}

function mergeProcesses(processes: ProcessInfo[], alerts: AlertInfo[]): ProcessGroup[] {
  const alertPids = new Set(alerts.map(a => a.pid).filter((p): p is number => p !== null));
  const map = new Map<string, ProcessInfo[]>();
  for (const p of processes) {
    const list = map.get(p.name);
    if (list) list.push(p);
    else map.set(p.name, [p]);
  }
  const groups: ProcessGroup[] = [];
  for (const [name, procs] of map) {
    const totalCpu = procs.reduce((s, p) => s + p.cpu_percent, 0);
    const totalMemory = procs.reduce((s, p) => s + p.memory_bytes, 0);
    const totalDiskRead = procs.reduce((s, p) => s + p.disk_read_bytes, 0);
    const totalDiskWrite = procs.reduce((s, p) => s + p.disk_write_bytes, 0);
    const pathStatus = procs.find(p => p.path_status === "User")?.path_status
      ?? procs.find(p => p.path_status === "Unknown")?.path_status
      ?? procs[0].path_status;
    const hasAlert = procs.some(p => alertPids.has(p.pid));
    groups.push({
      name,
      processes: procs,
      totalCpu,
      totalMemory,
      totalDiskRead,
      totalDiskWrite,
      pathStatus,
      primaryPid: procs[0].pid,
      baselineDeviation: procs[0].baseline_deviation,
      exePath: procs[0].exe_path,
      hasAlert,
    });
  }
  return groups;
}

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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const recentlyExpandedRef = useRef<Set<string>>(new Set());
  const alerts = useProcessStore((s) => s.alerts);
  const system = useProcessStore((s) => s.system);
  const totalMemory = system?.total_memory ?? 1;

  const toggleExpand = useCallback((name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        recentlyExpandedRef.current.delete(name);
      } else {
        next.add(name);
        recentlyExpandedRef.current.add(name);
        // Clear the animation flag after the animation completes (200ms)
        setTimeout(() => {
          recentlyExpandedRef.current.delete(name);
        }, 200);
      }
      return next;
    });
  }, []);

  const rows = useMemo<RowItem[]>(() => {
    const allGroups = mergeProcesses(processes, alerts);

    // Sort ALL groups globally first, then partition into sections.
    // This ensures sort order is consistent across app/background/system.
    const sortedAll = sortGroupsGlobal(allGroups, sortColumn, sortDirection);

    const userGroups = sortedAll.filter(g => g.pathStatus === "User");
    const unknownGroups = sortedAll.filter(g => g.pathStatus === "Unknown");
    const systemGroups = sortedAll.filter(g => g.pathStatus === "System");

    const result: RowItem[] = [];
    const addSection = (label: string, sectionGroups: ProcessGroup[]) => {
      if (sectionGroups.length === 0) return;
      result.push({ type: "group-header", label, count: sectionGroups.length });
      for (const group of sectionGroups) {
        result.push({ type: "group", group });
        if (expandedGroups.has(group.name) && group.processes.length > 1) {
          for (const proc of group.processes) {
            result.push({ type: "child", process: proc, parentName: group.name });
          }
        }
      }
    };
    addSection(t("processes.groups.apps"), userGroups);
    addSection(t("processes.groups.background"), unknownGroups);
    addSection(t("processes.groups.system"), systemGroups);
    return result;
  }, [processes, alerts, expandedGroups, sortColumn, sortDirection, t]);

  const visiblePids = useMemo(() => {
    return rows
      .filter((r): r is Extract<RowItem, { type: "group" }> => r.type === "group")
      .map((r) => r.group.primaryPid);
  }, [rows]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, pid: number) => {
      if (e.ctrlKey || e.metaKey) onToggleSelection(pid);
      else if (e.shiftKey) onRangeSelect(pid, visiblePids);
      else onSelectProcess(pid === selectedPid ? null : pid);
    },
    [onToggleSelection, onRangeSelect, onSelectProcess, selectedPid, visiblePids]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index].type === "group-header" ? 26 : 34),
    overscan: 15,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex items-center px-3 py-1.5 border-b border-border text-[12px] text-text-secondary font-medium shrink-0 bg-tertiary">
        <div className="flex-[2] min-w-0 px-1 text-left cursor-pointer select-none hover:text-text-primary flex items-center" onClick={() => onToggleSort("name")}>
          {/* Spacer to align with row content: arrow(w-4=16px) + gap(6px) + icon(16px) + gap(6px) = 44px */}
          <span className="shrink-0 w-[44px]" />
          <span className="truncate">{t("processes.columns.name")}</span>
          {sortColumn === "name" && <SortArrowIcon direction={sortDirection} />}
        </div>
        <div className="flex-1 min-w-[64px] px-1 text-right cursor-pointer select-none hover:text-text-primary flex items-center justify-end" onClick={() => onToggleSort("cpu")}>
          {t("processes.columns.cpu")}
          {sortColumn === "cpu" && <SortArrowIcon direction={sortDirection} />}
        </div>
        <div className="flex-1 min-w-[80px] px-1 text-right cursor-pointer select-none hover:text-text-primary flex items-center justify-end" onClick={() => onToggleSort("memory")}>
          {t("processes.columns.memory")}
          {sortColumn === "memory" && <SortArrowIcon direction={sortDirection} />}
        </div>
        <div className="flex-1 min-w-[80px] px-1 text-right cursor-pointer select-none hover:text-text-primary flex items-center justify-end" onClick={() => onToggleSort("diskRead")}>
          {t("processes.columns.disk")}
          {sortColumn === "diskRead" && <SortArrowIcon direction={sortDirection} />}
        </div>
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="flex-1 overflow-auto bg-primary">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.type === "group-header" ? (
                  <div className="flex items-center px-3 h-full text-[11px] text-text-secondary font-semibold">
                    {row.label} ({row.count})
                  </div>
                ) : row.type === "group" ? (
                  <GroupRow
                    group={row.group}
                    totalMemory={totalMemory}
                    isExpanded={expandedGroups.has(row.group.name)}
                    isSelected={selectedPids.has(row.group.primaryPid)}
                    onToggleExpand={() => toggleExpand(row.group.name)}
                    onClick={(e) => handleRowClick(e, row.group.primaryPid)}
                    onContextMenu={(e) => onContextMenu(e, row.group.processes[0])}
                  />
                ) : (
                  <ChildRow
                    process={row.process}
                    totalMemory={totalMemory}
                    isSelected={selectedPids.has(row.process.pid)}
                    animate={recentlyExpandedRef.current.has(row.parentName)}
                    onClick={(e) => handleRowClick(e, row.process.pid)}
                    onContextMenu={(e) => onContextMenu(e, row.process)}
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

interface GroupRowProps {
  group: ProcessGroup;
  totalMemory: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function GroupRow({ group, totalMemory, isExpanded, isSelected, onToggleExpand, onClick, onContextMenu }: GroupRowProps) {
  const hasChildren = group.processes.length > 1;
  const cpuPercent = group.totalCpu;
  const memPercent = (group.totalMemory / totalMemory) * 100;

  const rowBg = isSelected
    ? "bg-[var(--state-selected)]"
    : group.hasAlert
      ? "bg-[var(--row-warning)]"
      : "hover:bg-tertiary";

  return (
    <div
      className={`flex items-center px-3 min-h-[34px] h-full text-[13px] cursor-pointer ${rowBg} text-text-primary focus-ring`}
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* Name */}
      <div className="flex-[2] min-w-0 px-1 flex items-center gap-1.5 overflow-hidden">
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-secondary hover:text-text-primary shrink-0 focus-ring"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          >
            <ChevronIcon expanded={isExpanded} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <ProcessIcon exePath={group.exePath} size={16} processName={group.name} />
        <span className="truncate font-medium select-text" title={group.name}>{friendlyName(group.name)}</span>
        {hasChildren && <span className="text-text-muted text-[10px] ml-0.5 shrink-0">({group.processes.length})</span>}
        <BaselineTag deviation={group.baselineDeviation} />
      </div>
      {/* CPU with heat + inline progress bar */}
      <div
        className="flex-1 min-w-[64px] px-1 text-right text-[12px] tabular-nums relative overflow-hidden"
        style={{ backgroundColor: getResourceHeatBg(cpuPercent, "cpu") }}
      >
        <div
          className="absolute inset-y-0 left-0 opacity-15 pointer-events-none"
          style={{
            width: `${Math.min(cpuPercent, 100)}%`,
            backgroundColor: "var(--color-cpu)",
          }}
        />
        <span className="relative">{formatPercent(cpuPercent)}</span>
      </div>
      {/* Memory with heat + inline progress bar */}
      <div
        className="flex-1 min-w-[80px] px-1 text-right text-[12px] tabular-nums relative overflow-hidden"
        style={{ backgroundColor: getResourceHeatBg(memPercent, "memory") }}
      >
        <div
          className="absolute inset-y-0 left-0 opacity-15 pointer-events-none"
          style={{
            width: `${Math.min(memPercent, 100)}%`,
            backgroundColor: "var(--color-memory)",
          }}
        />
        <span className="relative">{formatBytes(group.totalMemory)}</span>
      </div>
      {/* Disk */}
      <div className="flex-1 min-w-[80px] px-1 text-right text-[12px] text-text-secondary tabular-nums">
        {formatDiskRate(group.totalDiskRead + group.totalDiskWrite)}
      </div>
    </div>
  );
}

interface ChildRowProps {
  process: ProcessInfo;
  totalMemory: number;
  isSelected: boolean;
  animate: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ChildRow({ process, totalMemory, isSelected, animate, onClick, onContextMenu }: ChildRowProps) {
  const memPercent = (process.memory_bytes / totalMemory) * 100;

  return (
    <div
      className={`flex items-center px-3 min-h-[34px] h-full text-[12px] cursor-pointer
        ${isSelected ? "bg-[var(--state-selected)]" : "hover:bg-tertiary"} text-text-secondary
        ${animate ? "animate-child-row-enter" : ""} focus-ring`}
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* Indentation aligns with parent name text: arrow(w-4=16px) + gap(6px) + icon(16px) + gap(6px) = 44px offset */}
      <div className="flex-[2] min-w-0 px-1 flex items-center overflow-hidden">
        <span className="w-[44px] shrink-0" />
        <span className="truncate select-text" title={`PID ${process.pid}`}>PID {process.pid}</span>
      </div>
      <div
        className="flex-1 min-w-[64px] px-1 text-right tabular-nums relative overflow-hidden"
        style={{ backgroundColor: getResourceHeatBg(process.cpu_percent, "cpu") }}
      >
        <div
          className="absolute inset-y-0 left-0 opacity-15 pointer-events-none"
          style={{
            width: `${Math.min(process.cpu_percent, 100)}%`,
            backgroundColor: "var(--color-cpu)",
          }}
        />
        <span className="relative">{formatPercent(process.cpu_percent)}</span>
      </div>
      <div
        className="flex-1 min-w-[80px] px-1 text-right tabular-nums relative overflow-hidden"
        style={{ backgroundColor: getResourceHeatBg(memPercent, "memory") }}
      >
        <div
          className="absolute inset-y-0 left-0 opacity-15 pointer-events-none"
          style={{
            width: `${Math.min(memPercent, 100)}%`,
            backgroundColor: "var(--color-memory)",
          }}
        />
        <span className="relative">{formatBytes(process.memory_bytes)}</span>
      </div>
      <div className="flex-1 min-w-[80px] px-1 text-right tabular-nums">
        {formatDiskRate(process.disk_read_bytes + process.disk_write_bytes)}
      </div>
    </div>
  );
}
