import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface SearchBarProps {
  onSearch: (query: string) => void;
  /** 防抖延迟 (ms)，默认 100ms */
  debounceMs?: number;
}

/**
 * 搜索输入组件 — 带防抖的实时过滤搜索框
 * 用于在进程列表中按名称过滤进程
 */
export function SearchBar({ onSearch, debounceMs = 100 }: SearchBarProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onSearch(inputValue);
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [inputValue, debounceMs, onSearch]);

  return (
    <div className="px-3 py-2 shrink-0">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={t("search.placeholder")}
        className="w-full px-3 py-1.5 text-xs rounded
          bg-tertiary border border-border text-text-primary
          placeholder:text-text-muted
          focus:outline-none focus:border-accent-info
          transition-colors"
      />
    </div>
  );
}
