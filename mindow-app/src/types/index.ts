/** 进程信息 — 对应 Rust 后端 ProcessInfo 序列化结构 */
export interface ProcessInfo {
  name: string;
  pid: number;
  cpu_percent: number;
  memory_bytes: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
  path_status: "System" | "User" | "Unknown";
  instance_count: number;
  baseline_deviation: number | null;
  exe_path: string | null;
  parent_pid: number | null;
}

/** 系统信息概览 */
export interface SystemInfo {
  total_memory: number;
  used_memory: number;
  cpu_avg: number;
  per_core_cpu: number[];
  battery_level: number | null;
  battery_charging: "Charging" | "Discharging" | "Full" | null;
}

/** 告警信息 */
export interface AlertInfo {
  type: "MemoryLeak" | "HighCpu" | "MemoryPressure" | "BatteryWarning";
  severity: "Critical" | "Warning";
  message: string;
  process_name: string | null;
  pid: number | null;
}

/** 性能历史数据（最近 60 个数据点） */
export interface PerformanceHistory {
  cpu_history: number[];
  memory_history: number[];
  disk_read_history: number[];
  disk_write_history: number[];
  timestamps: number[];
}

/** 快照数据 — snapshot-updated 事件的 payload */
export interface SnapshotData {
  processes: ProcessInfo[];
  system: SystemInfo;
  alerts: AlertInfo[];
}

/** 单进程趋势数据 */
export interface ProcessTrend {
  memory_trend: number[];
  cpu_trend: number[];
}

/** 进程树节点 — 包含进程信息、子节点和汇总资源 */
export interface ProcessTreeNode {
  process: ProcessInfo;
  children: ProcessTreeNode[];
  /** 汇总 CPU（自身 + 所有子进程） */
  aggregated_cpu: number;
  /** 汇总内存（自身 + 所有子进程） */
  aggregated_memory: number;
}
