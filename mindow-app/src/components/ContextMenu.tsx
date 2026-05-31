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

/* ── Inline SVG Icons (lucide-style, stroke-width: var(--stroke-icon)) ── */

function IconXCircle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function IconFolderOpen({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function IconHash({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
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
      showToast("success", t("processes.toast.copyNameSuccess"));
    }
  };

  const handleCopyPid = () => {
    onClose();
    if (state.targetProcess) {
      navigator.clipboard.writeText(String(state.targetProcess.pid));
      showToast("success", t("processes.toast.copyPidSuccess"));
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[180px] bg-surface-3 border border-border rounded-md shadow-xl py-1 text-xs"
      style={{ left: pos.left, top: pos.top }}
    >
      <MenuItem
        icon={<IconXCircle />}
        label={isMultiSelect ? t("processes.contextMenu.killMultiple", { count: processCount }) : t("processes.contextMenu.kill")}
        onClick={handleKillProcess}
        danger
      />
      <MenuItem
        icon={<IconFolderOpen />}
        label={t("processes.contextMenu.openLocation")}
        onClick={handleOpenFileLocation}
        disabled={!hasExePath}
      />
      <div className="my-1 border-t border-border" />
      <MenuItem icon={<IconCopy />} label={t("processes.contextMenu.copyName")} onClick={handleCopyName} />
      <MenuItem icon={<IconHash />} label={t("processes.contextMenu.copyPid")} onClick={handleCopyPid} />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const baseClasses = "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors focus-ring";
  const stateClasses = disabled
    ? "text-text-muted cursor-not-allowed"
    : danger
      ? "text-state-danger hover:bg-surface-2"
      : "text-text-primary hover:bg-surface-2";

  return (
    <button
      role="menuitem"
      className={`${baseClasses} ${stateClasses}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex-shrink-0 opacity-80">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
