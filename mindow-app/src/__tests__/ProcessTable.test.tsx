import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessTable } from "../components/ProcessTable";
import type { ProcessInfo } from "../types";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "processes.columns.name": "名称",
        "processes.columns.pid": "PID",
        "processes.columns.cpu": "CPU",
        "processes.columns.memory": "内存",
        "processes.columns.disk": "磁盘",
        "performance.read": "读取",
        "performance.write": "写入",
        "processes.groups.apps": "应用",
        "processes.groups.background": "后台进程",
        "processes.groups.system": "系统进程",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock @tanstack/react-virtual to simplify testing
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        start: i * 36,
        size: 36,
      })),
  }),
}));

function createProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    name: "test.exe",
    pid: 1234,
    cpu_percent: 5.0,
    memory_bytes: 1024 * 1024 * 100, // 100 MB
    disk_read_bytes: 1024 * 1024,
    disk_write_bytes: 512 * 1024,
    path_status: "User",
    instance_count: 1,
    baseline_deviation: null,
    exe_path: "C:\\Program Files\\test.exe",
    parent_pid: null,
    ...overrides,
  };
}

/**
 * ProcessTable 虚拟滚动渲染测试
 * Validates: Requirements 1.3
 */
describe("ProcessTable", () => {
  const defaultProps = {
    selectedPid: null,
    selectedPids: new Set<number>(),
    onSelectProcess: vi.fn(),
    onToggleSelection: vi.fn(),
    onRangeSelect: vi.fn(),
    onContextMenu: vi.fn(),
    sortColumn: null as null,
    sortDirection: "desc" as const,
    onToggleSort: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染进程名称", () => {
    const processes = [
      createProcess({ name: "chrome.exe", pid: 100 }),
      createProcess({ name: "firefox.exe", pid: 200 }),
    ];

    render(<ProcessTable processes={processes} {...defaultProps} />);

    // Display strips the .exe suffix for a cleaner look (full name in tooltip)
    expect(screen.getByText("chrome")).toBeInTheDocument();
    expect(screen.getByText("firefox")).toBeInTheDocument();
  });

  it("按 path_status 分组显示进程", () => {
    const processes = [
      createProcess({ name: "vscode.exe", pid: 1, path_status: "User" }),
      createProcess({ name: "svchost.exe", pid: 2, path_status: "System" }),
      createProcess({ name: "unknown.exe", pid: 3, path_status: "Unknown" }),
    ];

    render(<ProcessTable processes={processes} {...defaultProps} />);

    // Group headers are rendered with their group count, e.g. "应用 (1)"
    expect(screen.getByText("应用 (1)")).toBeInTheDocument();
    expect(screen.getByText("系统进程 (1)")).toBeInTheDocument();
    expect(screen.getByText("后台进程 (1)")).toBeInTheDocument();
  });

  it("空进程列表时不崩溃", () => {
    const { container } = render(
      <ProcessTable processes={[]} {...defaultProps} />
    );
    // Should render the header row at minimum
    expect(container).toBeTruthy();
    expect(screen.getByText("名称")).toBeInTheDocument();
  });

  it("渲染表头列名", () => {
    render(<ProcessTable processes={[]} {...defaultProps} />);

    // Columns: Name / CPU / Memory / Disk (no standalone PID column —
    // processes are grouped by name, PID shows on expanded child rows).
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("内存")).toBeInTheDocument();
    expect(screen.getByText("磁盘")).toBeInTheDocument();
  });

  it("渲染单实例进程组（显示进程名）", () => {
    const processes = [createProcess({ name: "app.exe", pid: 9876 })];
    render(<ProcessTable processes={processes} {...defaultProps} />);
    // .exe suffix stripped for display
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("仅有 User 进程时只显示应用分组", () => {
    const processes = [
      createProcess({ name: "app1.exe", pid: 1, path_status: "User" }),
      createProcess({ name: "app2.exe", pid: 2, path_status: "User" }),
    ];

    render(<ProcessTable processes={processes} {...defaultProps} />);

    expect(screen.getByText("应用 (2)")).toBeInTheDocument();
    expect(screen.queryByText(/系统进程/)).not.toBeInTheDocument();
    expect(screen.queryByText(/后台进程/)).not.toBeInTheDocument();
  });
});
