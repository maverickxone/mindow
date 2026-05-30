import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/useTauriEvent";

/** ai-delta 事件 payload */
interface AiDeltaPayload {
  delta: string;
}

/** ai-done 事件 payload */
interface AiDonePayload {
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

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [response]);

  // 监听 ai-delta 事件 — 逐字累加
  const handleDelta = useCallback((payload: AiDeltaPayload) => {
    if (!streamingRef.current) return;
    responseRef.current += payload.delta;
    setResponse(responseRef.current);
  }, []);

  // 监听 ai-done 事件 — 完成或错误
  const handleDone = useCallback((payload: AiDonePayload) => {
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

    try {
      await invoke("ai_analyze_process", {
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

  return (
    <div className="mt-4">
      {/* AI 分析按钮 */}
      <button
        onClick={startAnalysis}
        disabled={isStreaming}
        className={`
          w-full px-3 py-2 rounded text-xs font-medium transition-all duration-200
          ${
            isStreaming
              ? "bg-accent-info/20 text-accent-info cursor-wait"
              : "bg-accent-info/10 text-accent-info hover:bg-accent-info/20 active:bg-accent-info/30"
          }
        `}
        aria-label={t("ai.analyzeLabel")}
      >
        {isStreaming ? (
          <span className="flex items-center justify-center gap-2">
            <StreamingDot />
            {t("ai.analyzing")}
          </span>
        ) : (
          t("ai.analyze")
        )}
      </button>

      {/* AI 响应区域 */}
      {(response || isStreaming || error) && (
        <div
          ref={containerRef}
          className="mt-3 p-3 rounded bg-tertiary border border-border max-h-48 overflow-y-auto"
        >
          {/* 流式文本 */}
          {response && (
            <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap break-words">
              {response}
              {isStreaming && <TypingCursor />}
            </p>
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
