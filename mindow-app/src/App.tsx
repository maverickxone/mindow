import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { useProcessStore } from "./stores/processStore";
import { usePerformanceStore } from "./stores/performanceStore";
import { ProcessesPage } from "./pages/ProcessesPage";
import { PerformancePage } from "./pages/PerformancePage";
import { AIPage } from "./pages/AIPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToastContainer } from "./components/Toast";
import type { SnapshotData } from "./types";

type TabId = "processes" | "performance" | "ai" | "settings";

interface TabConfig {
  id: TabId;
  labelKey: string;
  icon: string;
}

const tabs: TabConfig[] = [
  { id: "processes", labelKey: "tabs.processes", icon: "📋" },
  { id: "performance", labelKey: "tabs.performance", icon: "📈" },
  { id: "ai", labelKey: "tabs.ai", icon: "🤖" },
  { id: "settings", labelKey: "tabs.settings", icon: "⚙️" },
];

function App() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("processes");
  const updateSnapshot = useProcessStore((s) => s.updateSnapshot);
  const appendDataPoint = usePerformanceStore((s) => s.appendDataPoint);

  // 监听后端 snapshot-updated 事件，自动更新 stores
  const handleSnapshotUpdate = useCallback(
    (data: SnapshotData) => {
      updateSnapshot(data);

      // 从系统信息中提取性能数据点追加到历史
      if (data.system) {
        const totalMem = data.system.total_memory || 1;
        const memPercent = (data.system.used_memory / totalMem) * 100;

        // 从进程列表汇总磁盘 IO
        const diskRead = data.processes.reduce((sum, p) => sum + p.disk_read_bytes, 0);
        const diskWrite = data.processes.reduce((sum, p) => sum + p.disk_write_bytes, 0);

        appendDataPoint(data.system.cpu_avg, memPercent, diskRead, diskWrite);
      }
    },
    [updateSnapshot, appendDataPoint]
  );

  useTauriEvent<SnapshotData>("snapshot-updated", handleSnapshotUpdate);

  const renderPage = () => {
    switch (activeTab) {
      case "processes":
        return <ProcessesPage />;
      case "performance":
        return <PerformancePage />;
      case "ai":
        return <AIPage />;
      case "settings":
        return <SettingsPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-primary" style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
      {/* Tab 导航栏 */}
      <nav className="flex items-center bg-secondary border-b border-border px-2" data-tauri-drag-region>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium
              border-b-2 transition-colors duration-200
              ${
                activeTab === tab.id
                  ? "border-tab-active text-tab-active"
                  : "border-transparent text-tab-inactive hover:text-text-primary"
              }
            `}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            <span className="text-base">{tab.icon}</span>
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </nav>

      {/* 页面内容区 */}
      <main className="flex-1 overflow-hidden" role="tabpanel">
        {renderPage()}
      </main>

      {/* Toast 全局通知 */}
      <ToastContainer />
    </div>
  );
}

export default App;
