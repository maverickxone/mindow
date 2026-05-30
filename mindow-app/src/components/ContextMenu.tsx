import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./Toast";
import type { ProcessInfo } from "../types";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetProcess: ProcessInfo | null;
  selectedProcesses: ProcessInfo[];
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onProcessKilled?: () => void;
}

export function ContextMenu({ state, onClose, onProcessKilled }: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Clamp the menu inside the viewport so it never overflows off-screen when
  // opened near the right or bottom edge. Runs before paint to avoid flicker.
  useLayoutEffect(() => {
    if (!state.visible) return;
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(pad, Math.min(state.x, window.innerWidth - width - pad));
    const top = Math.max(pad, Math.min(state.y, window.innerHeight - height - pad));
    setPos({ left, top });
  }, [state.visible, state.x, state.y]);

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
      let successCount = 0, failCount = 0;
      for (const proc of state.selectedProcesses) {
        try { await invoke("kill_process", { pid: proc.pid }); successCount++; } catch { failCount++; }
      }
      if (failCount === 0) {
        showToast("success", t("processes.toast.killBatchSuccess", { success: successCount }));
      } else {
        showToast("error", t("processes.toast.killBatchPartial", { success: successCount, fail: failCount }));
      }
    } else {
      try {
        await invoke("kill_process", { pid: state.targetProcess!.pid });
        showToast("success", t("processes.toast.killSuccess", { name: state.targetProcess!.name }));
      } catch (err) {
        showToast("error", t("processes.toast.killError", { message: String(err) }));
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
      showToast("error", t("processes.toast.openLocationError", { message: String(err) }));
    }
  };

  const handleCopyName = () => {
    onClose();
    if (state.targetProcess) {
      navigator.clipboard.writeText(state.targetProcess.name);
    }
  };

  const handleCopyPid = () => {
    onClose();
    if (state.targetProcess) {
      navigator.clipboard.writeText(String(state.targetProcess.pid));
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[180px] bg-secondary border border-border rounded-md shadow-xl py-1 text-xs"
      style={{ left: pos.left, top: pos.top }}
    >
      <MenuItem
        label={isMultiSelect ? t("processes.contextMenu.killMultiple", { count: processCount }) : t("processes.contextMenu.kill")}
        onClick={handleKillProcess}
      />
      <MenuItem
        label={t("processes.contextMenu.openLocation")}
        onClick={handleOpenFileLocation}
        disabled={!hasExePath}
      />
      <div className="my-1 border-t border-border" />
      <MenuItem label={t("processes.contextMenu.copyName")} onClick={handleCopyName} />
      <MenuItem label={t("processes.contextMenu.copyPid")} onClick={handleCopyPid} />
    </div>
  );
}

function MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      role="menuitem"
      className={`w-full text-left px-4 py-1.5 transition-colors ${
        disabled
          ? "text-text-muted cursor-not-allowed"
          : "hover:bg-tertiary text-text-primary"
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
