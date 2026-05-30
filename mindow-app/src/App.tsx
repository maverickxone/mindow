import { useState, useEffect, useCallback } from "react";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { useProcessStore } from "./stores/processStore";
import { usePerformanceStore } from "./stores/performanceStore";
import { useSettingsStore } from "./stores/settingsStore";
import { SAMPLING_INTERVAL_SECS } from "./lib/constants";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, type PageId } from "./components/Sidebar";
import { ProcessesPage } from "./pages/ProcessesPage";
import { PerformancePage } from "./pages/PerformancePage";
import { AIPage } from "./pages/AIPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToastContainer } from "./components/Toast";
import type { SnapshotData } from "./types";

function App() {
  const [activePage, setActivePage] = useState<PageId>("processes");
  const [searchQuery, setSearchQuery] = useState("");
  const updateSnapshot = useProcessStore((s) => s.updateSnapshot);
  const appendDataPoint = usePerformanceStore((s) => s.appendDataPoint);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  // Load persisted settings (theme, language, AI config) once on startup so a
  // returning user's choices apply immediately — not only after opening Settings.
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Listen to backend snapshot-updated events
  const handleSnapshotUpdate = useCallback(
    (data: SnapshotData) => {
      updateSnapshot(data);

      if (data.system) {
        const totalMem = data.system.total_memory || 1;
        const memPercent = (data.system.used_memory / totalMem) * 100;
        // Disk counters are per-sampling-interval deltas; divide by the
        // interval to store a per-second rate.
        const diskRead = data.processes.reduce((sum, p) => sum + p.disk_read_bytes, 0) / SAMPLING_INTERVAL_SECS;
        const diskWrite = data.processes.reduce((sum, p) => sum + p.disk_write_bytes, 0) / SAMPLING_INTERVAL_SECS;
        appendDataPoint(data.system.cpu_avg, memPercent, diskRead, diskWrite);
      }
    },
    [updateSnapshot, appendDataPoint]
  );

  useTauriEvent<SnapshotData>("snapshot-updated", handleSnapshotUpdate);

  const renderPage = () => {
    switch (activePage) {
      case "processes":
        return <ProcessesPage searchQuery={searchQuery} />;
      case "performance":
        return <PerformancePage />;
      case "ai":
        return <AIPage />;
      case "settings":
        return <SettingsPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-primary">
      {/* Custom title bar */}
      <TitleBar searchQuery={searchQuery} onSearch={setSearchQuery} />

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <main className="flex-1 overflow-hidden">
          {renderPage()}
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}

export default App;
