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
  sidebarExpanded: boolean;
  notificationsEnabled: boolean;
}

export interface AiConfig {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
}

interface SettingsState extends AppSettings {
  /** Extended AI config fields (stored locally, written to config.toml via save_ai_config) */
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;

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
  /** Set sidebar expanded state and persist */
  setSidebarExpanded: (expanded: boolean) => void;
  /** Set notifications enabled state and persist immediately */
  setNotificationsEnabled: (enabled: boolean) => void;
  /** Set AI provider */
  setAiProvider: (provider: string) => void;
  /** Set AI model */
  setAiModel: (model: string) => void;
  /** Set AI base URL */
  setAiBaseUrl: (baseUrl: string) => void;
  /** Save AI config to config.toml via dedicated backend command */
  saveAiConfig: () => Promise<void>;
  /** Test AI connection with current config */
  testAiConnection: () => Promise<string>;
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
  sidebarExpanded: true,
  notificationsEnabled: false,
  aiProvider: "openai",
  aiModel: "",
  aiBaseUrl: "https://api.openai.com/v1",
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      set({ ...settings, loaded: true });
      applyTheme(settings.theme);
      if (settings.language && settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }
      // Also load aiEndpoint into aiBaseUrl for backward compatibility
      if (settings.aiEndpoint) {
        set({ aiBaseUrl: settings.aiEndpoint });
      }
      if (settings.aiApiKey) {
        set({ aiApiKey: settings.aiApiKey });
      }
    } catch {
      // If backend command fails, use defaults
      set({ loaded: true });
    }
  },

  saveSettings: async () => {
    const { theme, language, autostart, shortcut, aiEndpoint, aiApiKey, sidebarExpanded, notificationsEnabled } = get();
    const settings: AppSettings = { theme, language, autostart, shortcut, aiEndpoint, aiApiKey, sidebarExpanded, notificationsEnabled };
    try {
      await invoke("save_settings", { settings });
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  },

  setTheme: (theme: ThemeMode) => {
    // Add transition attribute for smooth color switch (Req 20.1)
    document.documentElement.setAttribute("data-theme-transition", "");
    applyTheme(theme);
    set({ theme });
    // Remove transition attribute after animation completes
    setTimeout(() => {
      document.documentElement.removeAttribute("data-theme-transition");
    }, 250);
    // Persist in background
    const state = get();
    const settings: AppSettings = {
      theme,
      language: state.language,
      autostart: state.autostart,
      shortcut: state.shortcut,
      aiEndpoint: state.aiEndpoint,
      aiApiKey: state.aiApiKey,
      sidebarExpanded: state.sidebarExpanded,
      notificationsEnabled: state.notificationsEnabled,
    };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setLanguage: (lang: Language) => {
    i18n.changeLanguage(lang);
    set({ language: lang });
    // Persist in background
    const state = get();
    const settings: AppSettings = {
      theme: state.theme,
      language: lang,
      autostart: state.autostart,
      shortcut: state.shortcut,
      aiEndpoint: state.aiEndpoint,
      aiApiKey: state.aiApiKey,
      sidebarExpanded: state.sidebarExpanded,
      notificationsEnabled: state.notificationsEnabled,
    };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setAutostart: async (enabled: boolean) => {
    try {
      await invoke("toggle_autostart", { enable: enabled });
      set({ autostart: enabled });
      // Persist in background
      const state = get();
      const settings: AppSettings = {
        theme: state.theme,
        language: state.language,
        autostart: enabled,
        shortcut: state.shortcut,
        aiEndpoint: state.aiEndpoint,
        aiApiKey: state.aiApiKey,
        sidebarExpanded: state.sidebarExpanded,
        notificationsEnabled: state.notificationsEnabled,
      };
      invoke("save_settings", { settings }).catch(() => {});
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    }
  },

  setShortcut: (shortcut: string) => {
    set({ shortcut });
    // Persist in background
    const state = get();
    const settings: AppSettings = {
      theme: state.theme,
      language: state.language,
      autostart: state.autostart,
      shortcut,
      aiEndpoint: state.aiEndpoint,
      aiApiKey: state.aiApiKey,
      sidebarExpanded: state.sidebarExpanded,
      notificationsEnabled: state.notificationsEnabled,
    };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setAiEndpoint: (endpoint: string) => {
    set({ aiEndpoint: endpoint });
  },

  setAiApiKey: (key: string) => {
    set({ aiApiKey: key });
  },

  setSidebarExpanded: (expanded: boolean) => {
    set({ sidebarExpanded: expanded });
    // Persist in background
    const state = get();
    const settings: AppSettings = {
      theme: state.theme,
      language: state.language,
      autostart: state.autostart,
      shortcut: state.shortcut,
      aiEndpoint: state.aiEndpoint,
      aiApiKey: state.aiApiKey,
      sidebarExpanded: expanded,
      notificationsEnabled: state.notificationsEnabled,
    };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setNotificationsEnabled: (enabled: boolean) => {
    set({ notificationsEnabled: enabled });
    // Persist immediately (Requirement 16.2)
    const state = get();
    const settings: AppSettings = {
      theme: state.theme,
      language: state.language,
      autostart: state.autostart,
      shortcut: state.shortcut,
      aiEndpoint: state.aiEndpoint,
      aiApiKey: state.aiApiKey,
      sidebarExpanded: state.sidebarExpanded,
      notificationsEnabled: enabled,
    };
    invoke("save_settings", { settings }).catch(() => {});
  },

  setAiProvider: (provider: string) => {
    set({ aiProvider: provider });
  },

  setAiModel: (model: string) => {
    set({ aiModel: model });
  },

  setAiBaseUrl: (baseUrl: string) => {
    set({ aiBaseUrl: baseUrl });
  },

  saveAiConfig: async () => {
    const { aiProvider, aiModel, aiBaseUrl, aiApiKey } = get();
    const config: AiConfig = {
      provider: aiProvider,
      model: aiModel,
      base_url: aiBaseUrl,
      api_key: aiApiKey,
    };
    await invoke("save_ai_config", { config });
    // Also sync aiEndpoint for backward compat
    set({ aiEndpoint: aiBaseUrl });
  },

  testAiConnection: async () => {
    const { aiProvider, aiModel, aiBaseUrl, aiApiKey } = get();
    const config: AiConfig = {
      provider: aiProvider,
      model: aiModel,
      base_url: aiBaseUrl,
      api_key: aiApiKey,
    };
    const result = await invoke<string>("test_ai_connection", { config });
    return result;
  },
}));
