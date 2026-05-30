import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="2" y="2" width="12" height="3" rx="0.5" />
    <rect x="2" y="6.5" width="12" height="3" rx="0.5" />
    <rect x="2" y="11" width="12" height="3" rx="0.5" />
  </svg>
);

const PerformanceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <polyline points="1,12 4,8 7,10 10,4 14,6" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="1" y1="14" x2="15" y2="14" />
  </svg>
);

const AIIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="6" r="4" />
    <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" strokeLinecap="round" />
    <circle cx="6.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
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
  const [expanded, setExpanded] = useState(false);

  return (
    <nav
      className={`flex flex-col bg-secondary border-r border-border transition-all duration-200 overflow-hidden shrink-0
        ${expanded ? "w-40" : "w-11 hover:w-40 group/sidebar"}`}
    >
      {/* Collapse/Expand button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center w-full h-8 text-text-secondary hover:text-text-primary hover:bg-tertiary transition-colors shrink-0"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          {expanded ? (
            // Left arrow (collapse)
            <><line x1="9" y1="3" x2="5" y2="7" /><line x1="5" y1="7" x2="9" y2="11" /></>
          ) : (
            // Hamburger menu (expand)
            <><line x1="2" y1="3.5" x2="12" y2="3.5" /><line x1="2" y1="7" x2="12" y2="7" /><line x1="2" y1="10.5" x2="12" y2="10.5" /></>
          )}
        </svg>
      </button>

      {/* Navigation items */}
      <div className="flex flex-col gap-0.5 px-1.5">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`
                flex items-center gap-3 px-2 py-2 rounded-md text-xs font-medium
                transition-colors duration-150 whitespace-nowrap min-h-[32px]
                ${isActive
                  ? "bg-accent-info/12 text-accent-info"
                  : "text-text-secondary hover:text-text-primary hover:bg-tertiary"
                }
              `}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className={`${expanded ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100"} transition-opacity duration-200`}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
