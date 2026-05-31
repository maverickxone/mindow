import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
import { LayoutList, Activity, Sparkles, Settings, PanelLeftClose, Menu } from "./icons";

export type PageId = "processes" | "performance" | "ai" | "settings";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

interface NavItem {
  id: PageId;
  labelKey: string;
  icon: React.ReactNode;
}

/** Top navigation items (main pages) */
const topNavItems: NavItem[] = [
  { id: "processes", labelKey: "tabs.processes", icon: <LayoutList size={20} strokeWidth={1.75} /> },
  { id: "performance", labelKey: "tabs.performance", icon: <Activity size={20} strokeWidth={1.75} /> },
  { id: "ai", labelKey: "tabs.ai", icon: <Sparkles size={20} strokeWidth={1.75} /> },
];

/** Bottom navigation item (settings, pushed to bottom like Win11) */
const bottomNavItem: NavItem = {
  id: "settings", labelKey: "tabs.settings", icon: <Settings size={20} strokeWidth={1.75} />,
};

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const expanded = useSettingsStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = useSettingsStore((s) => s.setSidebarExpanded);
  const [sidebarWidth, setSidebarWidth] = useState(230); // 1.8x original 160px * 80%
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      let newWidth = e.clientX;
      if (newWidth < 160) newWidth = 160;
      if (newWidth > 600) newWidth = 600;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        setIsResizing(false);
        document.body.style.cursor = "default";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <nav
      className={`h-full flex flex-col bg-surface-1 border-r border-border shrink-0 overflow-hidden relative
        ${!isResizing ? "transition-[width] duration-200 ease-in-out" : ""}`}
      style={{ width: expanded ? sidebarWidth : 48 }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setSidebarExpanded(!expanded)}
        className="flex items-center justify-center w-full h-9 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0 focus-ring"
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        {expanded ? <PanelLeftClose size={16} strokeWidth={1.5} /> : <Menu size={16} strokeWidth={1.5} />}
      </button>

      {/* Top nav items */}
      <div className="flex flex-col gap-0.5 px-2 pt-1">
        {topNavItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activePage === item.id}
            expanded={expanded}
            onNavigate={onNavigate}
            t={t}
          />
        ))}
      </div>

      {/* Spacer to push settings to bottom */}
      <div className="flex-1" />

      {/* Bottom: Settings */}
      <div className="px-2 pb-2">
        <NavButton
          item={bottomNavItem}
          isActive={activePage === bottomNavItem.id}
          expanded={expanded}
          onNavigate={onNavigate}
          t={t}
        />
      </div>

      {/* Drag to resize handle */}
      {expanded && (
        <div
          className="absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize hover:bg-accent/30 z-50 transition-colors"
          onMouseDown={startResizing}
        />
      )}
    </nav>
  );
}

/** Individual nav button with Win11-style pill indicator */
function NavButton({
  item,
  isActive,
  expanded,
  onNavigate,
  t,
}: {
  item: NavItem;
  isActive: boolean;
  expanded: boolean;
  onNavigate: (page: PageId) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="relative group/navitem">
      <button
        onClick={() => onNavigate(item.id)}
        className={`
          flex items-center gap-3 rounded-md text-[13px] font-medium w-full
          transition-colors duration-150 whitespace-nowrap h-10 focus-ring
          ${expanded ? "px-3" : "px-0 justify-center"}
          ${isActive
            ? "nav-pill-active bg-accent/8 text-accent"
            : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
          }
        `}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="shrink-0">{item.icon}</span>
        {expanded && <span>{t(item.labelKey)}</span>}
      </button>

      {/* Tooltip when collapsed */}
      {!expanded && (
        <span
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2
            px-2 py-1 rounded bg-surface-4 text-text-primary text-[12px]
            whitespace-nowrap opacity-0 pointer-events-none
            group-hover/navitem:opacity-100 transition-opacity duration-150 delay-300
            z-30 shadow-md"
          role="tooltip"
        >
          {t(item.labelKey)}
        </span>
      )}
    </div>
  );
}
