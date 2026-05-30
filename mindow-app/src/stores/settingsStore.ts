import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";

export type ThemeMode = "dark" | "light";
export type Language = "zh" | "en";

export interface AppSettings {
  theme: ThemeMode;
  language: Language;
  autostart: boolean;
  shortcut: string;
  aiEndpoint: string;
  aiApiKey: string;
}

interface SettingsState extends AppSettings {
  /** Whether settings have been loaded from backend */
  loaded: boolean;

  /** Load settings from backend */
  loadSettings: () => Promise<void>;
  /** Save all settings to backend */
  saveSettings: () => Promise<void>;

  /** Set theme and apply CSS variable immediately */
  setTheme: (theme: ThemeMode) => void;
  /** Set language and apply via i18next */
  setLanguage: (lang: Language) => void;
  /** Toggle autostart and persist to registry */
  setAutostart: (enabled: boolean) => Promise<void>;
  /** Set shortcut key combination */
  setShortcut: (shortcut: string) => void;
  /** Set AI endpoint URL */
  setAiEndpoint: (endpoint: string) => void;
  /** Set AI API key */
  setAiApiKey: (key: string) => void;
}

/** Apply theme to document root via data-theme attribute */
function applyTheme(theme: ThemeMode) {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "light",
  language: "zh",
  autostart: false,
  shortcut: "Ctrl+Shift+M",
  aiEndpoint: "",
  aiApiKey: "",
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      set({ ...settings, loaded: true });
      applyTheme(settings.theme);
      if (settings.language && settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }
    } catch {
      // If backend command fails, use defaults
      set({ loaded: true });
    }
  },

  saveSettings: async () => {
    const { theme, language, autostart, shortcut, aiEndpoint, aiApiKey } = get();
    const settings: AppSettings = { theme, language, autostart, shortcut, aiEndpoint, aiApiKey };
    try {
      await invoke("save_settings", { settings });
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },

  setTheme: (theme: ThemeMode) => {
    applyTheme(theme);
    set({ theme });
    // Persist in background
    const state = get();
    const settings: AppSettings = { ...state, theme };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setLanguage: (lang: Language) => {
    i18n.changeLanguage(lang);
    set({ language: lang });
    // Persist in background
    const state = get();
    const settings: AppSettings = { ...state, language: lang };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setAutostart: async (enabled: boolean) => {
    try {
      await invoke("toggle_autostart", { enable: enabled });
      set({ autostart: enabled });
      // Persist in background
      const state = get();
      const settings: AppSettings = { ...state, autostart: enabled };
      invoke("save_settings", { settings }).catch(() => {});
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    }
  },

  setShortcut: (shortcut: string) => {
    set({ shortcut });
    // Persist in background
    const state = get();
    const settings: AppSettings = { ...state, shortcut };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setAiEndpoint: (endpoint: string) => {
    set({ aiEndpoint: endpoint });
  },

  setAiApiKey: (key: string) => {
    set({ aiApiKey: key });
  },
}));
