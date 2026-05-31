import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useProcessStore } from "../stores/processStore";
import { showToast } from "./Toast";
import { Minus, Square, Copy, X, Search } from "./icons";

interface TitleBarProps {
  searchQuery: string;
  onSearch: (query: string) => void;
}

export function TitleBar({ searchQuery, onSearch }: TitleBarProps) {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();
  const system = useProcessStore((s) => s.system);
  const batteryLevel = system?.battery_level ?? null;
  const batteryCharging = system?.battery_charging ?? null;

  // Session-level flag: show tray notification only on first close per session (Req 22.1, 22.2)
  const hasShownTrayNotice = useRef(false);

  // Sync maximized state on mount
  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
  }, []);

  /** Start window drag on mousedown in the title bar area */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't drag if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("input") ||
        target.closest("a") ||
        target.closest("select")
      ) {
        return;
      }
      e.preventDefault();
      appWindow.startDragging();
    },
    [appWindow]
  );

  /** Double-click to maximize/restore */
  const handleDoubleClick = useCallback(
    async (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("input")) return;
      const maximized = await appWindow.isMaximized();
      if (maximized) {
        await appWindow.unmaximize();
        setIsMaximized(false);
      } else {
        await appWindow.maximize();
        setIsMaximized(true);
      }
    },
    [appWindow]
  );

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      await appWindow.unmaximize();
      setIsMaximized(false);
    } else {
      await appWindow.maximize();
      setIsMaximized(true);
    }
  };

  const handleClose = async () => {
    if (!hasShownTrayNotice.current) {
      showToast("info", t("common.minimizedToTray"));
      hasShownTrayNotice.current = true;
      // Allow toast to render before hiding window
      await new Promise((r) => setTimeout(r, 100));
    }
    await appWindow.hide();
  };

  return (
    <div
      className="flex items-center h-9 bg-secondary border-b border-border select-none shrink-0"
      onMouseDown={handleDragStart}
      onDoubleClick={handleDoubleClick}
    >
      {/* Left: App icon + name */}
      <div className="flex items-center gap-2 px-3">
        <MindowLogo />
        <span className="text-xs font-medium text-text-primary pointer-events-none">Mindow</span>
        {/* Compact battery indicator (Req 23.2) */}
        {batteryLevel != null && (
          <div className="flex items-center gap-1 ml-2 pointer-events-none" title={`${t("performance.battery")}: ${batteryLevel.toFixed(0)}%${batteryCharging === "Charging" ? ` (${t("performance.charging")})` : ""}`}>
            <TitleBarBatteryIcon level={batteryLevel} charging={batteryCharging === "Charging"} />
            <span className="text-[10px] text-text-muted tabular-nums">{batteryLevel.toFixed(0)}%</span>
          </div>
        )}
      </div>

      {/* Center: Search bar */}
      <div className="flex-1 flex justify-center px-4">
        <div className="relative w-full max-w-sm">
          <Search
            size={13}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("search.placeholder")}
            className="w-full h-7 pl-8 pr-7 text-xs bg-tertiary border border-border rounded
              text-text-primary placeholder:text-text-muted
              focus:outline-none focus:border-accent-info transition-colors focus-ring"
          />
          {searchQuery && (
            <button
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors focus-ring"
              aria-label="Clear search"
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Right: Window control buttons — NO data-tauri-drag-region here */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="w-11 h-full flex items-center justify-center hover:bg-tertiary transition-colors focus-ring"
          aria-label="Minimize"
        >
          <Minus size={12} strokeWidth={2} className="text-text-primary" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center hover:bg-tertiary transition-colors focus-ring"
          aria-label="Maximize"
        >
          {isMaximized ? (
            <Copy size={11} strokeWidth={1.5} className="text-text-primary" />
          ) : (
            <Square size={11} strokeWidth={1.5} className="text-text-primary" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-full flex items-center justify-center hover:bg-[#c42b1c] hover:text-white transition-colors group focus-ring"
          aria-label="Close"
        >
          <X size={12} strokeWidth={2} className="text-text-primary group-hover:text-white" />
        </button>
      </div>
    </div>
  );
}

/** Compact battery icon for the title bar area */
function TitleBarBatteryIcon({ level, charging }: { level: number; charging: boolean }) {
  const fillColor = level <= 20 ? "var(--heat-extreme)" : level <= 50 ? "var(--heat-moderate)" : "var(--heat-safe)";
  const fillWidth = Math.max(0, Math.min(100, level)) / 100 * 9;

  return (
    <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="block">
      {/* Battery body */}
      <rect x="0.5" y="1" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" className="text-text-muted" />
      {/* Battery terminal */}
      <rect x="13" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" className="text-text-muted" />
      {/* Fill */}
      <rect x="2" y="2.5" width={fillWidth} height="5" rx="0.5" fill={fillColor} />
      {/* Charging bolt */}
      {charging && (
        <path d="M7 2 L5.5 5 L7 5 L6 8 L9 4.5 L7.5 4.5 Z" fill="var(--accent)" />
      )}
    </svg>
  );
}

/**
 * Mindow brand logo — a stylized window frame with an activity pulse line.
 * Represents "mind" (intelligence) + "window" (system insight).
 */
function MindowLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="pointer-events-none shrink-0">
      {/* Window frame */}
      <rect x="2" y="3" width="20" height="18" rx="3" stroke="var(--accent)" strokeWidth="1.8" />
      {/* Title bar divider */}
      <line x1="2" y1="8" x2="22" y2="8" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5" />
      {/* Activity pulse line inside the window — monitoring heartbeat */}
      <polyline
        points="5,15 8,13 10,16 13,11 16,14 19,12"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Dot accents in title bar */}
      <circle cx="5" cy="5.5" r="1" fill="var(--accent)" opacity="0.6" />
      <circle cx="8" cy="5.5" r="1" fill="var(--accent)" opacity="0.4" />
    </svg>
  );
}