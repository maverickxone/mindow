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

/** 告警信息 — 字段名与 Rust 后端 AlertInfo 序列化结构保持一致 */
export interface AlertInfo {
  alert_type: "MemoryLeak" | "HighCpu" | "MemoryPressure" | "BatteryWarning";
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
  battery_history: number[];
  per_core_cpu: number[];
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
