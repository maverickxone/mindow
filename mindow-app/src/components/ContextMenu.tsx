import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./Toast";
import type { ProcessInfo } from "../types";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  /** 右键点击的进程 */
  targetProcess: ProcessInfo | null;
  /** 当前选中的所有进程（多选时） */
  selectedProcesses: ProcessInfo[];
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  /** 进程被终止后的回调（可用于刷新列表等） */
  onProcessKilled?: () => void;
}

export function ContextMenu({ state, onClose, onProcessKilled }: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!state.visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // 延迟绑定，避免触发右键的 mousedown 立刻关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [state.visible, onClose]);

  if (!state.visible || !state.targetProcess) return null;

  const isMultiSelect = state.selectedProcesses.length > 1;
  const processCount = state.selectedProcesses.length;
  const hasExePath = state.targetProcess.exe_path != null;

  const handleKillProcess = async () => {
    onClose();

    if (isMultiSelect) {
      // 批量结束
      const processes = state.selectedProcesses;
      let successCount = 0;
      let failCount = 0;

      for (const proc of processes) {
        try {
          await invoke("kill_process", { pid: proc.pid });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        showToast("success", t("processes.toast.killBatchSuccess", { success: successCount }));
      } else {
        showToast("error", t("processes.toast.killBatchPartial", { success: successCount, fail: failCount }));
      }
    } else {
      // 单个结束
      try {
        await invoke("kill_process", { pid: state.targetProcess!.pid });
        showToast("success", t("processes.toast.killSuccess", { name: state.targetProcess!.name }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast("error", t("processes.toast.killError", { message }));
      }
    }

    onProcessKilled?.();
  };

  const handleOpenFileLocation = async () => {
    onClose();

    if (!state.targetProcess?.exe_path) return;

    try {
      await invoke("open_file_location", { path: state.targetProcess.exe_path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("error", t("processes.toast.openLocationError", { message }));
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-secondary border border-border rounded-lg shadow-xl py-1 text-sm"
      style={{ left: state.x, top: state.y }}
    >
      <button
        className="w-full text-left px-4 py-2 hover:bg-tertiary text-text-primary transition-colors"
        onClick={handleKillProcess}
      >
        {isMultiSelect ? t("processes.contextMenu.killMultiple", { count: processCount }) : t("processes.contextMenu.kill")}
      </button>
      <button
        className={`w-full text-left px-4 py-2 transition-colors ${
          hasExePath
            ? "hover:bg-tertiary text-text-primary"
            : "text-text-muted cursor-not-allowed"
        }`}
        onClick={handleOpenFileLocation}
        disabled={!hasExePath}
      >
        {t("processes.contextMenu.openLocation")}
      </button>
    </div>
  );
}
