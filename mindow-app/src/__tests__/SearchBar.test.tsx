import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar } from "../components/SearchBar";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "search.placeholder": "搜索进程...",
      };
      return translations[key] || key;
    },
  }),
}));

/**
 * SearchBar 过滤逻辑测试
 * Validates: Requirements 1.3
 */
describe("SearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("渲染搜索输入框", () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} />);
    expect(screen.getByPlaceholderText("搜索进程...")).toBeInTheDocument();
  });

  it("输入文本后在防抖延迟后调用 onSearch", () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} debounceMs={100} />);

    const input = screen.getByPlaceholderText("搜索进程...");

    // Use fireEvent.change which properly triggers React's onChange
    fireEvent.change(input, { target: { value: "chrome" } });

    // onSearch should not be called immediately with "chrome"
    // (it may have been called with "" from initial render)
    const chromeCallsBefore = onSearch.mock.calls.filter(
      (call) => call[0] === "chrome"
    );
    expect(chromeCallsBefore.length).toBe(0);

    // Advance timers past debounce delay
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onSearch).toHaveBeenCalledWith("chrome");
  });

  it("快速连续输入只触发最后一次的值", () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} debounceMs={100} />);

    const input = screen.getByPlaceholderText("搜索进程...");

    // Clear initial timer first
    act(() => {
      vi.advanceTimersByTime(100);
    });
    onSearch.mockClear();

    // Type "a"
    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Type "ab"
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Type "abc"
    fireEvent.change(input, { target: { value: "abc" } });

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The last call should be "abc"
    const lastCall = onSearch.mock.calls[onSearch.mock.calls.length - 1];
    expect(lastCall[0]).toBe("abc");
  });

  it("初始渲染时触发空字符串的 onSearch", () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} debounceMs={100} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onSearch).toHaveBeenCalledWith("");
  });
});
