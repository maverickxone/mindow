import { create } from "zustand";
import type { PerformanceHistory } from "../types";

interface PerformanceState {
  /** CPU 使用率历史（最近 60 个数据点） */
  cpuHistory: number[];
  /** 内存使用率历史 */
  memoryHistory: number[];
  /** 磁盘读取速率历史 */
  diskReadHistory: number[];
  /** 磁盘写入速率历史 */
  diskWriteHistory: number[];
  /** 时间戳序列 */
  timestamps: number[];

  /** 用完整历史数据更新（从 get_performance_history 命令获取） */
  setHistory: (data: PerformanceHistory) => void;
  /** 追加单个数据点（从 snapshot-updated 事件中提取） */
  appendDataPoint: (cpu: number, memory: number, diskRead: number, diskWrite: number) => void;
}

const MAX_DATA_POINTS = 60;

export const usePerformanceStore = create<PerformanceState>((set) => ({
  cpuHistory: [],
  memoryHistory: [],
  diskReadHistory: [],
  diskWriteHistory: [],
  timestamps: [],

  setHistory: (data: PerformanceHistory) =>
    set({
      cpuHistory: data.cpu_history,
      memoryHistory: data.memory_history,
      diskReadHistory: data.disk_read_history,
      diskWriteHistory: data.disk_write_history,
      timestamps: data.timestamps,
    }),

  appendDataPoint: (cpu, memory, diskRead, diskWrite) =>
    set((state) => {
      const append = <T>(arr: T[], val: T) => {
        const next = [...arr, val];
        return next.length > MAX_DATA_POINTS ? next.slice(-MAX_DATA_POINTS) : next;
      };

      return {
        cpuHistory: append(state.cpuHistory, cpu),
        memoryHistory: append(state.memoryHistory, memory),
        diskReadHistory: append(state.diskReadHistory, diskRead),
        diskWriteHistory: append(state.diskWriteHistory, diskWrite),
        timestamps: append(state.timestamps, Date.now()),
      };
    }),
}));
