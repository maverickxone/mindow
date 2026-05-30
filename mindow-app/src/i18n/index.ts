import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./zh.json";
import en from "./en.json";

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: "zh", // 默认简体中文
  fallbackLng: "zh",
  interpolation: {
    escapeValue: false, // React 已有 XSS 防护
  },
});

export default i18n;
