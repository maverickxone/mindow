import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPage } from "../pages/SettingsPage";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "settings.title": "设置",
        "settings.theme": "主题",
        "settings.themeDark": "深色",
        "settings.themeLight": "浅色",
        "settings.language": "语言",
        "settings.languageZh": "中文",
        "settings.languageEn": "English",
        "settings.autoStart": "开机自启",
        "settings.autoStartDesc": "系统启动时自动运行 Mindow",
        "settings.shortcut": "全局快捷键",
        "settings.shortcutHint": "按键组合",
        "settings.aiConfig": "AI 配置",
        "settings.aiProvider": "服务商",
        "settings.aiModel": "模型",
        "settings.aiBaseUrl": "API 基础地址",
        "settings.aiEndpoint": "API 端点",
        "settings.aiApiKey": "API 密钥",
        "settings.aiApiKeyShow": "显示密钥",
        "settings.aiApiKeyHide": "隐藏密钥",
        "settings.saveAiConfig": "保存",
        "settings.saveAiConfigSuccess": "AI 配置保存成功",
        "settings.saveAiConfigError": "AI 配置保存失败",
        "settings.testConnection": "测试连接",
        "settings.testConnectionSuccess": "连接成功",
        "settings.testConnectionError": "连接失败",
        "settings.testConnectionTesting": "测试中...",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the settingsStore
const mockSetTheme = vi.fn();
const mockSetLanguage = vi.fn();
const mockLoadSettings = vi.fn();
const mockSaveSettings = vi.fn();
const mockSetAutostart = vi.fn();
const mockSetShortcut = vi.fn();
const mockSetAiEndpoint = vi.fn();
const mockSetAiApiKey = vi.fn();
const mockSetAiProvider = vi.fn();
const mockSetAiModel = vi.fn();
const mockSetAiBaseUrl = vi.fn();
const mockSaveAiConfig = vi.fn().mockResolvedValue(undefined);
const mockTestAiConnection = vi.fn().mockResolvedValue("Connection successful");

let currentTheme = "dark";

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    theme: currentTheme,
    language: "zh",
    autostart: false,
    shortcut: "Ctrl+Shift+M",
    aiEndpoint: "",
    aiApiKey: "",
    aiProvider: "openai",
    aiModel: "",
    aiBaseUrl: "https://api.openai.com/v1",
    loaded: true,
    loadSettings: mockLoadSettings,
    setTheme: (theme: string) => {
      currentTheme = theme;
      mockSetTheme(theme);
      // Simulate the real applyTheme behavior
      if (theme === "light") {
        document.documentElement.dataset.theme = "light";
      } else {
        delete document.documentElement.dataset.theme;
      }
    },
    setLanguage: mockSetLanguage,
    setAutostart: mockSetAutostart,
    setShortcut: mockSetShortcut,
    setAiEndpoint: mockSetAiEndpoint,
    setAiApiKey: mockSetAiApiKey,
    setAiProvider: mockSetAiProvider,
    setAiModel: mockSetAiModel,
    setAiBaseUrl: mockSetAiBaseUrl,
    saveSettings: mockSaveSettings,
    saveAiConfig: mockSaveAiConfig,
    testAiConnection: mockTestAiConnection,
  }),
}));

/**
 * SettingsPage 主题切换测试
 * Validates: Requirements 9.2
 */
describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTheme = "dark";
    delete document.documentElement.dataset.theme;
  });

  it("渲染设置页面标题", () => {
    render(<SettingsPage />);
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("渲染主题切换按钮", () => {
    render(<SettingsPage />);
    expect(screen.getByText("深色")).toBeInTheDocument();
    expect(screen.getByText("浅色")).toBeInTheDocument();
  });

  it("点击浅色按钮时切换主题并修改 data-theme", () => {
    render(<SettingsPage />);

    const lightButton = screen.getByText("浅色");
    fireEvent.click(lightButton);

    expect(mockSetTheme).toHaveBeenCalledWith("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("点击深色按钮时切换回深色主题", () => {
    // Start with light theme
    currentTheme = "light";
    document.documentElement.dataset.theme = "light";

    render(<SettingsPage />);

    const darkButton = screen.getByText("深色");
    fireEvent.click(darkButton);

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("主题切换不需要重启应用（同步生效）", () => {
    render(<SettingsPage />);

    // Click light theme
    fireEvent.click(screen.getByText("浅色"));
    expect(document.documentElement.dataset.theme).toBe("light");

    // Click dark theme back
    fireEvent.click(screen.getByText("深色"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
