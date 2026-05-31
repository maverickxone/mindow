import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/useTauriEvent";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { showToast } from "./Toast";

/** ai-delta 事件 payload */
interface AiDeltaPayload {
  request_id: string;
  delta: string;
}

/** ai-done 事件 payload */
interface AiDonePayload {
  request_id: string;
  success: boolean;
  error: string | null;
}

interface AIChatProps {
  /** 当前进程名称 */
  processName: string;
  /** 当前进程 PID */
  pid: number;
}

/**
 * AI 对话组件 — 流式渲染 AI 分析结果。
 *
 * 调用后端 `ai_analyze_process` 命令触发分析，
 * 然后监听 `ai-delta` 事件逐字累加响应文本，
 * `ai-done` 事件标记完成或错误。
 */
export function AIChat({ processName, pid }: AIChatProps) {
  const { t } = useTranslation();
  const [isStreaming, setIsStreaming] = useState(false);
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 用 ref 跟踪 streaming 状态，避免闭包问题
  const streamingRef = useRef(false);
  const responseRef = useRef("");
  const containerRef = useRef<HTMLDivElement>(null);
  // 当前请求 ID，用于过滤掉非本次请求（陈旧/其他流）的事件
  const requestIdRef = useRef("");

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [response]);

  // 监听 ai-delta 事件 — 逐字累加
  const handleDelta = useCallback((payload: AiDeltaPayload) => {
    if (payload.request_id !== requestIdRef.current) return;
    if (!streamingRef.current) return;
    responseRef.current += payload.delta;
    setResponse(responseRef.current);
  }, []);

  // 监听 ai-done 事件 — 完成或错误
  const handleDone = useCallback((payload: AiDonePayload) => {
    if (payload.request_id !== requestIdRef.current) return;
    if (!streamingRef.current) return;
    streamingRef.current = false;
    setIsStreaming(false);

    if (!payload.success) {
      setError(
        payload.error || t("ai.errorDefault")
      );
    }
  }, [t]);

  useTauriEvent<AiDeltaPayload>("ai-delta", handleDelta);
  useTauriEvent<AiDonePayload>("ai-done", handleDone);

  // 发起 AI 分析
  const startAnalysis = useCallback(async () => {
    // 清理之前的状态
    setResponse("");
    setError(null);
    responseRef.current = "";
    streamingRef.current = true;
    setIsStreaming(true);
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;

    try {
      await invoke("ai_analyze_process", {
        requestId,
        processName,
        pid,
      });
    } catch (err) {
      // invoke 本身失败（如命令不存在、序列化错误等）
      streamingRef.current = false;
      setIsStreaming(false);
      setError(t("ai.analyzeError", { error: String(err) }));
    }
  }, [processName, pid]);

  // Stop streaming — cancels the current response
  const stopStreaming = useCallback(() => {
    streamingRef.current = false;
    setIsStreaming(false);
    requestIdRef.current = ""; // invalidate so future deltas are ignored
  }, []);

  return (
    <div className="mt-4">
      {/* AI 分析按钮 */}
      <div className="flex gap-2">
        <button
          onClick={startAnalysis}
          disabled={isStreaming}
          className={`
            flex-1 px-3 py-2.5 rounded-md text-[13px] font-medium transition-all duration-200 focus-ring
            flex items-center justify-center gap-2
            ${
              isStreaming
                ? "bg-accent/15 text-accent cursor-wait"
                : "bg-accent text-white hover:opacity-90 active:opacity-80 shadow-sm"
            }
          `}
          aria-label={t("ai.analyzeLabel")}
        >
          {!isStreaming && (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1.5l1.6 3.9 3.9 1.6-3.9 1.6L8 12.5 6.4 8.6 2.5 7l3.9-1.6z" />
            </svg>
          )}
          {isStreaming ? (
            <span className="flex items-center justify-center gap-2">
              <StreamingDot />
              {t("ai.analyzing")}
            </span>
          ) : (
            t("ai.analyze")
          )}
        </button>
        {/* Stop button visible during streaming */}
        {isStreaming && (
          <button
            onClick={stopStreaming}
            className="px-3 py-2 rounded text-xs font-medium bg-accent-danger/15 text-accent-danger hover:bg-accent-danger/25 transition-colors flex items-center gap-1 focus-ring"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
            {t("ai.stop")}
          </button>
        )}
      </div>

      {/* AI 响应区域 */}
      {(response || isStreaming || error) && (
        <div
          ref={containerRef}
          className="mt-3 p-3 rounded bg-tertiary border border-border max-h-48 overflow-y-auto"
        >
          {/* 流式文本 — Markdown 渲染 */}
          {response && (
            <div className="text-text-primary text-xs leading-relaxed break-words">
              <MarkdownRenderer content={response} />
              {isStreaming && <TypingCursor />}
            </div>
          )}

          {/* Copy button — visible when streaming is done and response exists */}
          {response && !isStreaming && (
            <CopyButton text={response} t={t} />
          )}

          {/* 等待首字响应时的占位 */}
          {isStreaming && !response && (
            <p className="text-text-secondary text-xs flex items-center gap-1">
              <StreamingDot />
              {t("ai.waitingResponse")}
            </p>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="text-xs mt-2 p-2 rounded bg-accent-danger/10 text-accent-danger">
              <p className="font-medium mb-1">{t("ai.analysisFailed")}</p>
              <p>{error}</p>
              <p className="mt-1 text-text-muted">
                {t("ai.analysisSuggestion")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 打字光标动画 */
function TypingCursor() {
  return (
    <span className="inline-block w-[2px] h-3 bg-accent-info ml-0.5 animate-pulse align-middle" />
  );
}

/** Copy button for AI response */
function CopyButton({ text, t }: { text: string; t: (key: string) => string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast("success", t("ai.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silently
    }
  }, [text, t]);

  return (
    <div className="flex justify-end mt-1.5 pt-1 border-t border-border/50">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors focus-ring"
        title={t("ai.copy")}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="8" height="8" rx="1" />
            <path d="M3 11V3h8" />
          </svg>
        )}
        <span>{t("ai.copy")}</span>
      </button>
    </div>
  );
}

/** 流式加载点动画 */
function StreamingDot() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
    </span>
  );
}
