import { useRef, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useProcessStore } from "../stores/processStore";
import { BaselineTag } from "./BaselineTag";
import { ProcessIcon } from "./ProcessIcon";
import type { ProcessInfo, AlertInfo } from "../types";
import type { SortColumn, SortDirection } from "../stores/processStore";

/** Format bytes with thousands separator */
function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} MB`;
}

function formatCpu(percent: number): string {
  if (percent < 0.05) return "0%";
  return `${percent.toFixed(1)}%`;
}

function formatDiskRate(bytes: number): string {
  if (bytes === 0) return "0 MB/s";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${mb.toFixed(1)} MB/s`;
}

/** Get heat background color based on usage percentage (0-100) */
function getHeatBg(percent: number): string {
  if (percent < 15) return "transparent";
  if (percent < 40) return "var(--heat-low)";
  if (percent < 70) return "var(--heat-med)";
  if (percent < 90) return "var(--heat-high)";
  return "var(--heat-extreme)";
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
  const alerts = useProcessStore((s) => s.alerts);
  const system = useProcessStore((s) => s.system);
  const totalMemory = system?.total_memory ?? 1;

  const toggleExpand = useCallback((name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const rows = useMemo<RowItem[]>(() => {
    const groups = mergeProcesses(processes, alerts);
    const userGroups = groups.filter(g => g.pathStatus === "User");
    const unknownGroups = groups.filter(g => g.pathStatus === "Unknown");
    const systemGroups = groups.filter(g => g.pathStatus === "System");

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
  }, [processes, alerts, expandedGroups, t]);

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
    estimateSize: (index) => (rows[index].type === "group-header" ? 26 : 30),
    overscan: 15,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="flex items-center px-3 py-1.5 border-b border-border text-[11px] text-text-secondary font-medium shrink-0 bg-tertiary">
        <div className="flex-[2.5] px-1 text-left cursor-pointer select-none hover:text-text-primary" onClick={() => onToggleSort("name")}>
          {t("processes.columns.name")}
          {sortColumn === "name" && <span className="ml-0.5 text-accent-info">{sortDirection === "asc" ? "▲" : "▼"}</span>}
        </div>
        <div className="w-16 px-1 text-right cursor-pointer select-none hover:text-text-primary" onClick={() => onToggleSort("cpu")}>
          {t("processes.columns.cpu")}
          {sortColumn === "cpu" && <span className="ml-0.5 text-accent-info">{sortDirection === "asc" ? "▲" : "▼"}</span>}
        </div>
        <div className="w-24 px-1 text-right cursor-pointer select-none hover:text-text-primary" onClick={() => onToggleSort("memory")}>
          {t("processes.columns.memory")}
          {sortColumn === "memory" && <span className="ml-0.5 text-accent-info">{sortDirection === "asc" ? "▲" : "▼"}</span>}
        </div>
        <div className="w-24 px-1 text-right cursor-pointer select-none hover:text-text-primary" onClick={() => onToggleSort("diskRead")}>
          {t("processes.columns.disk")}
          {sortColumn === "diskRead" && <span className="ml-0.5 text-accent-info">{sortDirection === "asc" ? "▲" : "▼"}</span>}
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
    ? "bg-[#0078d4]/12"
    : group.hasAlert
      ? "bg-[var(--row-warning)]"
      : "hover:bg-tertiary";

  return (
    <div
      className={`flex items-center px-3 h-full text-[12px] cursor-pointer border-b border-border/40 ${rowBg} text-text-primary`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* Name */}
      <div className="flex-[2.5] px-1 flex items-center gap-1.5 truncate">
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-secondary hover:text-text-primary shrink-0"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          >
            <span className="text-[8px] leading-none" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}>
              ▶
            </span>
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <ProcessIcon exePath={group.exePath} size={16} />
        <span className="truncate font-medium">{group.name}</span>
        {hasChildren && <span className="text-text-muted text-[10px] ml-0.5">({group.processes.length})</span>}
        <BaselineTag deviation={group.baselineDeviation} />
      </div>
      {/* CPU with heat */}
      <div className="w-16 px-1 text-right text-[11px]" style={{ backgroundColor: getHeatBg(cpuPercent) }}>
        {formatCpu(cpuPercent)}
      </div>
      {/* Memory with heat */}
      <div className="w-24 px-1 text-right text-[11px]" style={{ backgroundColor: getHeatBg(memPercent) }}>
        {formatMemory(group.totalMemory)}
      </div>
      {/* Disk */}
      <div className="w-24 px-1 text-right text-[11px] text-text-secondary">
        {formatDiskRate(group.totalDiskRead + group.totalDiskWrite)}
      </div>
    </div>
  );
}

interface ChildRowProps {
  process: ProcessInfo;
  totalMemory: number;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ChildRow({ process, totalMemory, isSelected, onClick, onContextMenu }: ChildRowProps) {
  const memPercent = (process.memory_bytes / totalMemory) * 100;

  return (
    <div
      className={`flex items-center px-3 h-full text-[11px] cursor-pointer border-b border-border/20
        ${isSelected ? "bg-[#0078d4]/12" : "hover:bg-tertiary"} text-text-secondary`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="flex-[2.5] px-1 flex items-center truncate">
        <span className="w-8 shrink-0" />
        <span className="truncate">PID {process.pid}</span>
      </div>
      <div className="w-16 px-1 text-right" style={{ backgroundColor: getHeatBg(process.cpu_percent) }}>
        {formatCpu(process.cpu_percent)}
      </div>
      <div className="w-24 px-1 text-right" style={{ backgroundColor: getHeatBg(memPercent) }}>
        {formatMemory(process.memory_bytes)}
      </div>
      <div className="w-24 px-1 text-right">
        {formatDiskRate(process.disk_read_bytes + process.disk_write_bytes)}
      </div>
    </div>
  );
}
