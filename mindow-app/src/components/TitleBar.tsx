import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  searchQuery: string;
  onSearch: (query: string) => void;
}

export function TitleBar({ searchQuery, onSearch }: TitleBarProps) {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  // Sync maximized state on mount
  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
  }, []);

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
    await appWindow.hide();
  };

  return (
    <div className="flex items-center h-9 bg-secondary border-b border-border select-none shrink-0">
      {/* Left: App icon + name (draggable) */}
      <div className="flex items-center gap-2 px-3" data-tauri-drag-region>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-accent-info pointer-events-none">
          <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="text-xs font-medium text-text-primary pointer-events-none">Mindow</span>
      </div>

      {/* Center: Search bar (draggable area around it, but input is interactive) */}
      <div className="flex-1 flex justify-center px-4" data-tauri-drag-region>
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
            className="w-full h-7 pl-8 pr-3 text-xs bg-tertiary border border-border rounded
              text-text-primary placeholder:text-text-muted
              focus:outline-none focus:border-accent-info transition-colors"
          />
        </div>
      </div>

      {/* Right: Window control buttons — NO data-tauri-drag-region here */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="w-11 h-full flex items-center justify-center hover:bg-tertiary transition-colors"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-text-primary">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center hover:bg-tertiary transition-colors"
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
          className="w-11 h-full flex items-center justify-center hover:bg-[#c42b1c] hover:text-white transition-colors group"
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
