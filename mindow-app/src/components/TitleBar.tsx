import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useProcessStore } from "../stores/processStore";
import { showToast } from "./Toast";

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
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-accent-info pointer-events-none">
          <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
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
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            width="13" height="13" viewBox="0 0 16 16" fill="none"
          >
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
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
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2L10 10M10 2L2 10" />
              </svg>
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
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-text-primary">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center hover:bg-tertiary transition-colors focus-ring"
          aria-label="Maximize"
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-text-primary">
              <rect x="2" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="var(--bg-secondary)" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-text-primary">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-full flex items-center justify-center hover:bg-[#c42b1c] hover:text-white transition-colors group focus-ring"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
            className="text-text-primary group-hover:text-white">
            <path d="M1 1L9 9M9 1L1 9" />
          </svg>
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