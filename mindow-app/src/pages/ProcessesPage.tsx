import { useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useProcessStore, filterProcesses, sortProcesses } from "../stores/processStore";
import { ProcessTable } from "../components/ProcessTable";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { SidePanel } from "../components/SidePanel";
import { showToast } from "../components/Toast";
import type { ProcessInfo } from "../types";

const emptyContextMenu: ContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  targetProcess: null,
  selectedProcesses: [],
};

interface ProcessesPageProps {
  searchQuery: string;
}

export function ProcessesPage({ searchQuery }: ProcessesPageProps) {
  const { t } = useTranslation();
  const processes = useProcessStore((s) => s.processes);
  const system = useProcessStore((s) => s.system);
  const selectedPid = useProcessStore((s) => s.selectedPid);
  const selectedPids = useProcessStore((s) => s.selectedPids);
  const selectProcess = useProcessStore((s) => s.selectProcess);
  const toggleProcessSelection = useProcessStore((s) => s.toggleProcessSelection);
  const rangeSelectProcess = useProcessStore((s) => s.rangeSelectProcess);
  const sortColumn = useProcessStore((s) => s.sortColumn);
  const sortDirection = useProcessStore((s) => s.sortDirection);
  const toggleSort = useProcessStore((s) => s.toggleSort);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(emptyContextMenu);

  // Filter and sort processes
  const filteredAndSortedProcesses = useMemo(() => {
    const filtered = filterProcesses(processes, searchQuery);
    return sortProcesses(filtered, sortColumn, sortDirection);
  }, [processes, searchQuery, sortColumn, sortDirection]);

  // Context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, process: ProcessInfo) => {
      e.preventDefault();
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

  const handleClosePanel = useCallback(() => {
    selectProcess(null);
  }, [selectProcess]);

  // End task button handler
  const handleEndTask = useCallback(async () => {
    if (selectedPids.size === 0) return;
    const pids = Array.from(selectedPids);
    if (pids.length === 1) {
      const proc = processes.find((p) => p.pid === pids[0]);
      try {
        await invoke("kill_process", { pid: pids[0] });
        showToast("success", t("processes.toast.killSuccess", { name: proc?.name || pids[0] }));
      } catch (err) {
        showToast("error", t("processes.toast.killError", { message: String(err) }));
      }
    } else {
      let success = 0, fail = 0;
      for (const pid of pids) {
        try {
          await invoke("kill_process", { pid });
          success++;
        } catch { fail++; }
      }
      if (fail === 0) {
        showToast("success", t("processes.toast.killBatchSuccess", { success }));
      } else {
        showToast("error", t("processes.toast.killBatchPartial", { success, fail }));
      }
    }
  }, [selectedPids, processes, t]);

  return (
    <div className="flex flex-row h-full">
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar: title + actions */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0">
          <span className="text-sm font-medium text-text-primary">{t("tabs.processes")}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEndTask}
              disabled={selectedPids.size === 0}
              className="px-3 py-1 text-xs rounded border border-border text-text-primary
                hover:bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t("processes.endTask")}
            </button>
          </div>
        </div>

        {/* Summary row */}
        {system && (
          <div className="flex items-center px-4 py-1 bg-tertiary/50 border-b border-border text-[11px] text-text-secondary shrink-0">
            <div className="flex-[2] px-1"></div>
            <div className="w-16 px-1 text-right font-medium">
              {system.cpu_avg.toFixed(0)}%
            </div>
            <div className="w-24 px-1 text-right font-medium">
              {Math.round((system.used_memory / system.total_memory) * 100)}%
            </div>
            <div className="w-20 px-1 text-right font-medium">
              0 MB/s
            </div>
          </div>
        )}

        {/* Process table */}
        {processes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <svg className="animate-spin h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-xs text-text-muted">Loading processes...</p>
            </div>
          </div>
        ) : (
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
        )}
      </div>

      {/* Side panel */}
      <SidePanel selectedPid={selectedPid} onClose={handleClosePanel} />
      <ContextMenu state={contextMenu} onClose={handleCloseContextMenu} />
    </div>
  );
}
