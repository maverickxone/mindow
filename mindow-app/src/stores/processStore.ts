import { create } from "zustand";
import type { ProcessInfo, SystemInfo, AlertInfo, SnapshotData } from "../types";

export type SortColumn = "name" | "pid" | "cpu" | "memory" | "diskRead" | "diskWrite";
export type SortDirection = "asc" | "desc";

interface ProcessState {
  /** 当前进程列表 */
  processes: ProcessInfo[];
  /** 系统概览信息 */
  system: SystemInfo | null;
  /** 当前活跃告警 */
  alerts: AlertInfo[];
  /** 当前选中的进程 PID */
  selectedPid: number | null;
  /** 多选的进程 PID 集合 */
  selectedPids: Set<number>;
  /** 最后更新时间戳 */
  lastUpdated: number | null;
  /** 搜索关键词 */
  searchQuery: string;
  /** 排序列 */
  sortColumn: SortColumn | null;
  /** 排序方向 */
  sortDirection: SortDirection;

  /** 更新完整快照数据（由 snapshot-updated 事件触发） */
  updateSnapshot: (data: SnapshotData) => void;
  /** 设置选中进程 */
  selectProcess: (pid: number | null) => void;
  /** 多选：切换进程选中状态（Ctrl+Click） */
  toggleProcessSelection: (pid: number) => void;
  /** 多选：范围选择（Shift+Click） */
  rangeSelectProcess: (pid: number, visiblePids: number[]) => void;
  /** 清除多选 */
  clearMultiSelect: () => void;
  /** 设置搜索关键词 */
  setSearchQuery: (query: string) => void;
  /** 设置排序列和方向 */
  toggleSort: (column: SortColumn) => void;
}

export const useProcessStore = create<ProcessState>((set) => ({
  processes: [],
  system: null,
  alerts: [],
  selectedPid: null,
  selectedPids: new Set<number>(),
  lastUpdated: null,
  searchQuery: "",
  sortColumn: null,
  sortDirection: "desc",

  updateSnapshot: (data: SnapshotData) =>
    set({
      processes: data.processes,
      system: data.system,
      alerts: data.alerts,
      lastUpdated: Date.now(),
    }),

  selectProcess: (pid: number | null) =>
    set({ selectedPid: pid, selectedPids: pid != null ? new Set([pid]) : new Set() }),

  toggleProcessSelection: (pid: number) =>
    set((state) => {
      const newSet = new Set(state.selectedPids);
      if (newSet.has(pid)) {
        newSet.delete(pid);
      } else {
        newSet.add(pid);
      }
      // selectedPid 跟随最新点击
      return { selectedPids: newSet, selectedPid: pid };
    }),

  rangeSelectProcess: (pid: number, visiblePids: number[]) =>
    set((state) => {
      const anchorPid = state.selectedPid;
      if (anchorPid == null) {
        return { selectedPid: pid, selectedPids: new Set([pid]) };
      }
      const anchorIdx = visiblePids.indexOf(anchorPid);
      const targetIdx = visiblePids.indexOf(pid);
      if (anchorIdx === -1 || targetIdx === -1) {
        return { selectedPid: pid, selectedPids: new Set([pid]) };
      }
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      const rangePids = visiblePids.slice(start, end + 1);
      return { selectedPid: pid, selectedPids: new Set(rangePids) };
    }),

  clearMultiSelect: () => set({ selectedPids: new Set(), selectedPid: null }),

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  toggleSort: (column: SortColumn) =>
    set((state) => {
      if (state.sortColumn === column) {
        return { sortDirection: state.sortDirection === "asc" ? "desc" : "asc" };
      }
      return { sortColumn: column, sortDirection: "desc" };
    }),
}));

/** 根据搜索关键词过滤进程列表 */
export function filterProcesses(processes: ProcessInfo[], query: string): ProcessInfo[] {
  const trimmed = query.trim();
  if (!trimmed) return processes;
  const lowerQuery = trimmed.toLowerCase();
  const isNumeric = /^\d+$/.test(trimmed);

  return processes.filter((p) => {
    if (isNumeric) {
      return p.name.toLowerCase().includes(lowerQuery) || p.pid.toString() === trimmed;
    }
    return p.name.toLowerCase().includes(lowerQuery);
  });
}

/** 根据列和方向排序进程列表 */
export function sortProcesses(
  processes: ProcessInfo[],
  column: SortColumn | null,
  direction: SortDirection
): ProcessInfo[] {
  if (!column) return processes;

  const sorted = [...processes];
  const multiplier = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (column) {
      case "name":
        return multiplier * a.name.localeCompare(b.name);
      case "pid":
        return multiplier * (a.pid - b.pid);
      case "cpu":
        return multiplier * (a.cpu_percent - b.cpu_percent);
      case "memory":
        return multiplier * (a.memory_bytes - b.memory_bytes);
      case "diskRead":
        return multiplier * (a.disk_read_bytes - b.disk_read_bytes);
      case "diskWrite":
        return multiplier * (a.disk_write_bytes - b.disk_write_bytes);
      default:
        return 0;
    }
  });

  return sorted;
}
