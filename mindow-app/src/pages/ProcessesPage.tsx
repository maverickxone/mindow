import { useMemo, useCallback, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useProcessStore, filterProcesses, sortProcesses } from "../stores/processStore";
import { ProcessTable } from "../components/ProcessTable";
import { ProcessTree } from "../components/ProcessTree";
import { SearchBar } from "../components/SearchBar";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { SidePanel } from "../components/SidePanel";
import type { ProcessInfo } from "../types";

type ViewMode = "list" | "tree";

const emptyContextMenu: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  targetProcess: null,
  selectedProcesses: [],
};

export function ProcessesPage() {
  const { t } = useTranslation();
  const processes = useProcessStore((s) => s.processes);
  const selectedPid = useProcessStore((s) => s.selectedPid);
  const selectedPids = useProcessStore((s) => s.selectedPids);
  const selectProcess = useProcessStore((s) => s.selectProcess);
  const toggleProcessSelection = useProcessStore((s) => s.toggleProcessSelection);
  const rangeSelectProcess = useProcessStore((s) => s.rangeSelectProcess);
  const searchQuery = useProcessStore((s) => s.searchQuery);
  const setSearchQuery = useProcessStore((s) => s.setSearchQuery);
  const sortColumn = useProcessStore((s) => s.sortColumn);
  const sortDirection = useProcessStore((s) => s.sortDirection);
  const toggleSort = useProcessStore((s) => s.toggleSort);

  // 防抖后的搜索词（由 SearchBar 内部防抖后回调设置）
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);

  // 视图模式：列表 or 树形
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(emptyContextMenu);

  // SearchBar 的 onSearch 回调 — 防抖已在 SearchBar 内部完成
  const handleSearch = useCallback(
    (query: string) => {
      setDebouncedQuery(query);
      setSearchQuery(query);
    },
    [setSearchQuery]
  );

  // 同步 store 的 searchQuery（若外部修改）
  useEffect(() => {
    setDebouncedQuery(searchQuery);
  }, [searchQuery]);

  // 先过滤再排序 — useMemo 确保高性能
  const filteredAndSortedProcesses = useMemo(() => {
    const filtered = filterProcesses(processes, debouncedQuery);
    return sortProcesses(filtered, sortColumn, sortDirection);
  }, [processes, debouncedQuery, sortColumn, sortDirection]);

  // 右键菜单处理
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, process: ProcessInfo) => {
      e.preventDefault();

      // 如果右键的进程不在当前选中集合中，则仅选中它
      let selected: ProcessInfo[];
      if (selectedPids.has(process.pid)) {
        selected = filteredAndSortedProcesses.filter((p) => selectedPids.has(p.pid));
      } else {
        selected = [process];
      }

      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        targetProcess: process,
        selectedProcesses: selected,
      });
    },
    [selectedPids, filteredAndSortedProcesses]
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(emptyContextMenu);
  }, []);

  // 关闭侧边面板
  const handleClosePanel = useCallback(() => {
    selectProcess(null);
  }, [selectProcess]);

  return (
    <div className="flex flex-row h-full">
      {/* 主内容区：工具栏 + 进程表格/树 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 工具栏：搜索 + 视图切换 */}
        <div className="flex items-center gap-2 shrink-0 pr-3">
          <div className="flex-1">
            <SearchBar onSearch={handleSearch} debounceMs={100} />
          </div>
          <div className="flex items-center bg-tertiary border border-border rounded text-xs shrink-0">
            <button
              className={`px-3 py-1.5 rounded-l transition-colors ${
                viewMode === "list"
                  ? "bg-accent-info/20 text-accent-info"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setViewMode("list")}
              aria-label={t("processes.viewList")}
            >
              {t("processes.viewList")}
            </button>
            <button
              className={`px-3 py-1.5 rounded-r transition-colors ${
                viewMode === "tree"
                  ? "bg-accent-info/20 text-accent-info"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setViewMode("tree")}
              aria-label={t("processes.viewTree")}
            >
              {t("processes.viewTree")}
            </button>
          </div>
        </div>

        {/* 视图内容 */}
        {viewMode === "list" ? (
          <ProcessTable
            processes={filteredAndSortedProcesses}
            selectedPid={selectedPid}
            selectedPids={selectedPids}
            onSelectProcess={selectProcess}
            onToggleSelection={toggleProcessSelection}
            onRangeSelect={rangeSelectProcess}
            onContextMenu={handleContextMenu}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onToggleSort={toggleSort}
          />
        ) : (
          <ProcessTree
            processes={filteredAndSortedProcesses}
            selectedPid={selectedPid}
            onSelectProcess={selectProcess}
          />
        )}
      </div>

      {/* 侧边详情面板 */}
      <SidePanel selectedPid={selectedPid} onClose={handleClosePanel} />

      <ContextMenu state={contextMenu} onClose={handleCloseContextMenu} />
    </div>
  );
}
