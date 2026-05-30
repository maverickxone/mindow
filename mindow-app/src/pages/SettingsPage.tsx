import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";

export function SettingsPage() {
  const { t } = useTranslation();
  const {
    theme, language, autostart, shortcut,
    aiEndpoint, aiApiKey, loaded,
    loadSettings, setTheme, setLanguage, setAutostart,
    setShortcut, setAiEndpoint, setAiApiKey, saveSettings,
  } = useSettingsStore();

  const [localEndpoint, setLocalEndpoint] = useState(aiEndpoint);
  const [localApiKey, setLocalApiKey] = useState(aiApiKey);

  useEffect(() => { if (!loaded) loadSettings(); }, [loaded, loadSettings]);
  useEffect(() => { setLocalEndpoint(aiEndpoint); setLocalApiKey(aiApiKey); }, [aiEndpoint, aiApiKey]);

  const handleSaveAiConfig = () => {
    setAiEndpoint(localEndpoint);
    setAiApiKey(localApiKey);
    saveSettings();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-base font-semibold text-text-primary mb-5">{t("settings.title")}</h1>

      <div className="space-y-4 max-w-lg">
        {/* Theme */}
        <SettingCard>
          <SettingRow label={t("settings.theme")}>
            <div className="flex gap-2">
              <PillButton active={theme === "dark"} onClick={() => setTheme("dark")} label={t("settings.themeDark")} />
              <PillButton active={theme === "light"} onClick={() => setTheme("light")} label={t("settings.themeLight")} />
            </div>
          </SettingRow>
        </SettingCard>

        {/* Language */}
        <SettingCard>
          <SettingRow label={t("settings.language")}>
            <div className="flex gap-2">
              <PillButton active={language === "zh"} onClick={() => setLanguage("zh")} label={t("settings.languageZh")} />
              <PillButton active={language === "en"} onClick={() => setLanguage("en")} label={t("settings.languageEn")} />
            </div>
          </SettingRow>
        </SettingCard>

        {/* System */}
        <SettingCard>
          <SettingRow label={t("settings.autoStart")} description={t("settings.autoStartDesc")}>
            <SwitchToggle checked={autostart} onChange={(v) => setAutostart(v)} />
          </SettingRow>
          <div className="border-t border-border my-2" />
          <SettingRow label={t("settings.shortcut")} description={t("settings.shortcutHint")}>
            <input
              type="text"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              className="px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                focus:border-accent-info focus:outline-none w-36 text-center"
            />
          </SettingRow>
        </SettingCard>

        {/* AI */}
        <SettingCard>
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-text-primary">{t("settings.aiConfig")}</h3>
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiEndpoint")}</label>
              <input
                type="text"
                value={localEndpoint}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiApiKey")}</label>
              <input
                type="password"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none"
                placeholder="sk-..."
              />
            </div>
            <button
              onClick={handleSaveAiConfig}
              className="px-3 py-1.5 rounded text-xs font-medium bg-accent-info/15 text-accent-info
                border border-accent-info/40 hover:bg-accent-info/25 transition-colors"
            >
              {t("settings.saveAiConfig")}
            </button>
          </div>
        </SettingCard>
      </div>
    </div>
  );
}

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-secondary border border-border rounded-lg p-4">
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs font-medium text-text-primary">{label}</span>
        {description && <p className="text-[11px] text-text-secondary mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function PillButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        active
          ? "bg-accent-info/15 text-accent-info border border-accent-info/40"
          : "bg-tertiary text-text-secondary border border-border hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function SwitchToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? "bg-accent-info" : "bg-tertiary border border-border"
      }`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
