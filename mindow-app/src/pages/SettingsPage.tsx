import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
import { showToast } from "../components/Toast";
import { Eye, EyeOff } from "../components/icons";

export function SettingsPage() {
  const { t } = useTranslation();
  const {
    theme, language, autostart, shortcut,
    aiProvider, aiModel, aiBaseUrl, aiApiKey,
    notificationsEnabled,
    loaded,
    loadSettings, setTheme, setLanguage, setAutostart,
    setShortcut, setAiProvider, setAiModel, setAiBaseUrl, setAiApiKey,
    setNotificationsEnabled,
  } = useSettingsStore();

  const [localProvider, setLocalProvider] = useState(aiProvider);
  const [localModel, setLocalModel] = useState(aiModel);
  const [localBaseUrl, setLocalBaseUrl] = useState(aiBaseUrl);
  const [localApiKey, setLocalApiKey] = useState(aiApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => { if (!loaded) loadSettings(); }, [loaded, loadSettings]);
  useEffect(() => {
    setLocalProvider(aiProvider);
    setLocalModel(aiModel);
    setLocalBaseUrl(aiBaseUrl);
    setLocalApiKey(aiApiKey);
  }, [aiProvider, aiModel, aiBaseUrl, aiApiKey]);

  const handleSaveAiConfig = async () => {
    // Update store with local values
    setAiProvider(localProvider);
    setAiModel(localModel);
    setAiBaseUrl(localBaseUrl);
    setAiApiKey(localApiKey);

    // Directly invoke the backend command with current local values
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_ai_config", {
        config: {
          provider: localProvider,
          model: localModel,
          base_url: localBaseUrl,
          api_key: localApiKey,
        },
      });
      showToast("success", t("settings.saveAiConfigSuccess"));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      showToast("error", t("settings.saveAiConfigError", { message }));
    }
  };

  const handleTestConnection = async () => {
    // Update store fields
    setAiProvider(localProvider);
    setAiModel(localModel);
    setAiBaseUrl(localBaseUrl);
    setAiApiKey(localApiKey);

    setIsTesting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<string>("test_ai_connection", {
        config: {
          provider: localProvider,
          model: localModel,
          base_url: localBaseUrl,
          api_key: localApiKey,
        },
      });
      showToast("success", t("settings.testConnectionSuccess"));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      showToast("error", t("settings.testConnectionError", { message }));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-base font-semibold text-text-primary mb-5">{t("settings.title")}</h1>

      <div className="space-y-4 max-w-2xl">
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
          <SettingRow label={t("settings.notifications")} description={t("settings.notificationsDesc")}>
            <SwitchToggle checked={notificationsEnabled} onChange={(v) => setNotificationsEnabled(v)} />
          </SettingRow>
          <div className="border-t border-border my-2" />
          <SettingRow label={t("settings.shortcut")} description={t("settings.shortcutHint")}>
            <input
              type="text"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              className="px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                focus:border-accent-info focus:outline-none w-36 text-center select-text focus-ring"
            />
          </SettingRow>
        </SettingCard>

        {/* AI Configuration */}
        <SettingCard>
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-text-primary">{t("settings.aiConfig")}</h3>

            {/* Provider */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiProvider")}</label>
              <select
                value={localProvider}
                onChange={(e) => setLocalProvider(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none focus-ring"
              >
                <option value="openai">OpenAI</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {/* Model */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiModel")}</label>
              <input
                type="text"
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none select-text focus-ring"
                placeholder="gpt-4o / claude-sonnet-4-20250514"
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiBaseUrl")}</label>
              <input
                type="text"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs bg-tertiary text-text-primary border border-border
                  focus:border-accent-info focus:outline-none select-text focus-ring"
                placeholder="https://api.openai.com/v1"
              />
            </div>

            {/* API Key with show/hide toggle */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">{t("settings.aiApiKey")}</label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  className="w-full px-2.5 py-1.5 pr-9 rounded text-xs bg-tertiary text-text-primary border border-border
                    focus:border-accent-info focus:outline-none select-text focus-ring"
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-secondary hover:text-text-primary transition-colors focus-ring"
                  aria-label={showApiKey ? t("settings.aiApiKeyHide") : t("settings.aiApiKeyShow")}
                  title={showApiKey ? t("settings.aiApiKeyHide") : t("settings.aiApiKeyShow")}
                >
                  {showApiKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveAiConfig}
                className="px-3 py-1.5 rounded text-xs font-medium bg-accent-info/15 text-accent-info
                  border border-accent-info/40 hover:bg-accent-info/25 transition-colors focus-ring"
              >
                {t("settings.saveAiConfig")}
              </button>
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-1.5 rounded text-xs font-medium bg-tertiary text-text-secondary
                  border border-border hover:text-text-primary hover:border-text-secondary
                  transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
              >
                {isTesting ? t("settings.testConnectionTesting") : t("settings.testConnection")}
              </button>
            </div>
          </div>
        </SettingCard>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors focus-ring ${
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
      className={`relative w-10 h-5 rounded-full transition-colors focus-ring ${
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

// (Lucide icons imported at top)
