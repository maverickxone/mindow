import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";

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

const ProcessesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="2" y="2" width="12" height="3" rx="0.5" />
    <rect x="2" y="6.5" width="12" height="3" rx="0.5" />
    <rect x="2" y="11" width="12" height="3" rx="0.5" />
  </svg>
);

const PerformanceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <polyline points="1,12 4,8 7,10 10,4 14,6" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="1" y1="14" x2="15" y2="14" />
  </svg>
);

const AIIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="6" r="4" />
    <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" strokeLinecap="round" />
    <circle cx="6.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" strokeLinecap="round" />
  </svg>
);

const navItems: NavItem[] = [
  { id: "processes", labelKey: "tabs.processes", icon: <ProcessesIcon /> },
  { id: "performance", labelKey: "tabs.performance", icon: <PerformanceIcon /> },
  { id: "ai", labelKey: "tabs.ai", icon: <AIIcon /> },
  { id: "settings", labelKey: "tabs.settings", icon: <SettingsIcon /> },
];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const expanded = useSettingsStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = useSettingsStore((s) => s.setSidebarExpanded);

  return (
    <nav
      className={`h-full flex flex-col bg-surface-1 border-r border-border shrink-0 overflow-hidden
        transition-[width] duration-200 ease-in-out
        ${expanded ? "w-[160px]" : "w-[48px]"}`}
    >
      {/* Toggle button */}
      <button
        onClick={() => setSidebarExpanded(!expanded)}
        className="flex items-center justify-center w-full h-9 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0 focus-ring"
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          {expanded ? (
            <><line x1="9" y1="3" x2="5" y2="7" /><line x1="5" y1="7" x2="9" y2="11" /></>
          ) : (
            <><line x1="2" y1="3.5" x2="12" y2="3.5" /><line x1="2" y1="7" x2="12" y2="7" /><line x1="2" y1="10.5" x2="12" y2="10.5" /></>
          )}
        </svg>
      </button>

      {/* Nav items — top-aligned with comfortable spacing */}
      <div className="flex flex-col gap-0.5 px-2 pt-1">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <div key={item.id} className="relative group/navitem">
              <button
                onClick={() => onNavigate(item.id)}
                className={`
                  flex items-center gap-3 rounded-md text-[13px] font-medium w-full
                  transition-colors duration-150 whitespace-nowrap h-9 focus-ring
                  ${expanded ? "px-2.5" : "px-0 justify-center"}
                  ${isActive
                    ? "bg-accent/10 text-accent"
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
                    group-hover/navitem:opacity-100 transition-opacity duration-150
                    z-30 shadow-md"
                  role="tooltip"
                >
                  {t(item.labelKey)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
