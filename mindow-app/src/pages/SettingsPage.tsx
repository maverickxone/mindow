import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * 设置页面 — 主题切换、语言切换、开机自启、全局快捷键、AI API 配置
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const {
    theme,
    language,
    autostart,
    shortcut,
    aiEndpoint,
    aiApiKey,
    loaded,
    loadSettings,
    setTheme,
    setLanguage,
    setAutostart,
    setShortcut,
    setAiEndpoint,
    setAiApiKey,
    saveSettings,
  } = useSettingsStore();

  // Local state for AI config (save on blur to avoid excessive IPC)
  const [localEndpoint, setLocalEndpoint] = useState(aiEndpoint);
  const [localApiKey, setLocalApiKey] = useState(aiApiKey);

  useEffect(() => {
    if (!loaded) {
      loadSettings();
    }
  }, [loaded, loadSettings]);

  // Sync local state when store loads
  useEffect(() => {
    setLocalEndpoint(aiEndpoint);
    setLocalApiKey(aiApiKey);
  }, [aiEndpoint, aiApiKey]);

  const handleSaveAiConfig = () => {
    setAiEndpoint(localEndpoint);
    setAiApiKey(localApiKey);
    saveSettings();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-text-primary mb-6">
        {t("settings.title")}
      </h1>

      <div className="space-y-8 max-w-lg">
        {/* 主题设置 */}
        <SettingSection title={t("settings.theme")}>
          <div className="flex gap-3">
            <ToggleButton
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              label={t("settings.themeDark")}
            />
            <ToggleButton
              active={theme === "light"}
              onClick={() => setTheme("light")}
              label={t("settings.themeLight")}
            />
          </div>
        </SettingSection>

        {/* 语言设置 */}
        <SettingSection title={t("settings.language")}>
          <div className="flex gap-3">
            <ToggleButton
              active={language === "zh"}
              onClick={() => setLanguage("zh")}
              label={t("settings.languageZh")}
            />
            <ToggleButton
              active={language === "en"}
              onClick={() => setLanguage("en")}
              label={t("settings.languageEn")}
            />
          </div>
        </SettingSection>

        {/* 开机自启 */}
        <SettingSection title={t("settings.autoStart")}>
          <SwitchToggle
            checked={autostart}
            onChange={(checked) => setAutostart(checked)}
            label={t("settings.autoStartDesc")}
          />
        </SettingSection>

        {/* 全局快捷键 */}
        <SettingSection title={t("settings.shortcut")}>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm bg-tertiary text-text-primary border border-border
                focus:border-accent-info focus:outline-none w-48"
              placeholder="Ctrl+Shift+M"
            />
            <span className="text-xs text-text-secondary">
              {t("settings.shortcutHint")}
            </span>
          </div>
        </SettingSection>

        {/* AI API 配置 */}
        <SettingSection title={t("settings.aiConfig")}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t("settings.aiEndpoint")}
              </label>
              <input
                type="text"
                value={localEndpoint}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                onBlur={handleSaveAiConfig}
                className="w-full px-3 py-2 rounded-lg text-sm bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t("settings.aiApiKey")}
              </label>
              <input
                type="password"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                onBlur={handleSaveAiConfig}
                className="w-full px-3 py-2 rounded-lg text-sm bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none"
                placeholder="sk-..."
              />
            </div>
            <button
              onClick={handleSaveAiConfig}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-info/20 text-accent-info
                border border-accent-info/50 hover:bg-accent-info/30 transition-colors"
            >
              {t("settings.saveAiConfig")}
            </button>
          </div>
        </SettingSection>
      </div>
    </div>
  );
}

/** 设置分组区块 */
function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-text-primary mb-3">{title}</h2>
      {children}
    </section>
  );
}

/** 切换按钮（用于主题、语言选择） */
function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-accent-info/20 text-accent-info border border-accent-info/50"
          : "bg-tertiary text-text-secondary border border-border hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

/** 开关组件 */
function SwitchToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-accent-info" : "bg-tertiary border border-border"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </div>
      {label && <span className="text-sm text-text-secondary">{label}</span>}
    </label>
  );
}
