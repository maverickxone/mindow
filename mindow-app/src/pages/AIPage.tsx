import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/useTauriEvent";
import { useProcessStore } from "../stores/processStore";
import { formatBytes, formatPercent } from "../lib/format";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { showToast } from "../components/Toast";
import { Bot, Send, Check, Clipboard } from "../components/icons";

/** 对话消息类型 */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number; // epoch ms when message was received/sent
}

/** AI 流式增量事件 payload */
interface AiDeltaPayload {
  request_id: string;
  delta: string;
}

/** AI 完成事件 payload */
interface AiDonePayload {
  request_id: string;
  success: boolean;
  error: string | null;
}

/** Format time as HH:MM */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** Compute textarea rows based on newline count: min(N+1, 5) */
export function computeRows(text: string): number {
  const newlineCount = (text.match(/\n/g) || []).length;
  return Math.min(newlineCount + 1, 5);
}

export function AIPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  // 当前请求 ID，用于过滤掉非本次请求（陈旧/其他流）的事件
  const requestIdRef = useRef("");

  const system = useProcessStore((s) => s.system);

  // Textarea auto-grow rows
  const textareaRows = useMemo(() => computeRows(input), [input]);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 监听 AI 流式增量
  useTauriEvent<AiDeltaPayload>("ai-delta", (payload) => {
    if (payload.request_id !== requestIdRef.current) return;
    streamingContentRef.current += payload.delta;
    setMessages((prev) => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        updated[updated.length - 1] = {
          ...lastMsg,
          content: streamingContentRef.current,
        };
      }
      return updated;
    });
  });

  // 监听 AI 完成事件
  useTauriEvent<AiDonePayload>("ai-done", (payload) => {
    if (payload.request_id !== requestIdRef.current) return;
    setIsStreaming(false);
    // Update timestamp on the final assistant message
    setMessages((prev) => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        updated[updated.length - 1] = {
          ...lastMsg,
          timestamp: Date.now(),
        };
      }
      return updated;
    });
    if (!payload.success) {
      setError(payload.error || t("ai.errorDefault"));
    }
  });

  // Stop streaming — cancels the current response
  const handleStop = useCallback(() => {
    setIsStreaming(false);
    requestIdRef.current = ""; // invalidate so future deltas are ignored
    // Update timestamp on whatever content was received
    setMessages((prev) => {
      const updated = [...prev];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        updated[updated.length - 1] = {
          ...lastMsg,
          timestamp: Date.now(),
        };
      }
      return updated;
    });
  }, []);

  // 发送消息
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    setInput("");
    setIsStreaming(true);
    streamingContentRef.current = "";
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;

    // 添加用户消息和空的助手消息占位
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed, timestamp: Date.now() },
      { role: "assistant", content: "" },
    ]);

    try {
      await invoke("ai_chat", { requestId, userMessage: trimmed });
    } catch (e) {
      setIsStreaming(false);
      setError(typeof e === "string" ? e : t("ai.errorInvoke"));
    }
  };

  // 回车发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 系统上下文信息 */}
      <div className="border-b border-border px-4 py-2">
        <button
          onClick={() => setShowContext(!showContext)}
          className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors focus-ring"
        >
          <span className={`transition-transform duration-200 ${showContext ? "rotate-90" : ""}`}>
            ▶
          </span>
          <span>{t("ai.systemContext")}</span>
          {system && (
            <span className="text-text-muted">
              — CPU {formatPercent(system.cpu_avg)} | {t("processes.columns.memory")} {formatBytes(system.used_memory)}/{formatBytes(system.total_memory)}
            </span>
          )}
        </button>
        {showContext && system && (
          <div className="mt-2 p-2 bg-tertiary rounded text-xs text-text-secondary grid grid-cols-2 gap-2">
            <div>{t("ai.cpuAverage")}: <span className="text-accent-info">{formatPercent(system.cpu_avg)}</span></div>
            <div>{t("ai.cpuCores")}: <span className="text-text-primary">{system.per_core_cpu.length}</span></div>
            <div>{t("ai.memoryUsed")}: <span className="text-accent-safe">{formatBytes(system.used_memory)}</span></div>
            <div>{t("ai.memoryTotal")}: <span className="text-text-primary">{formatBytes(system.total_memory)}</span></div>
            {system.battery_level != null && (
              <div>{t("ai.battery")}: <span className="text-text-primary">{system.battery_level}% {system.battery_charging === "Charging" ? "⚡" : ""}</span></div>
            )}
          </div>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Bot size={32} strokeWidth={1} className="mb-3 text-text-secondary" />
            <p className="text-sm">{t("ai.greeting")}</p>
            <p className="text-xs mt-1">{t("ai.greetingHint")}</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <MessageBubble
            key={idx}
            message={msg}
            isStreaming={isStreaming && idx === messages.length - 1}
            showLabel={shouldShowLabel(messages, idx)}
          />
        ))}
        {error && (
          <div className="flex justify-center">
            <div className="bg-accent-danger/10 border border-accent-danger/30 rounded-lg px-3 py-2 text-xs text-accent-danger max-w-md">
              ⚠️ {error}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.inputPlaceholder")}
            disabled={isStreaming}
            rows={textareaRows}
            className="flex-1 resize-none bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-info transition-colors disabled:opacity-50 select-text focus-ring"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 bg-accent-danger/15 text-accent-danger font-medium text-sm rounded-lg hover:bg-accent-danger/25 transition-colors flex items-center gap-1.5 focus-ring"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
              <span>{t("ai.stop")}</span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-accent-info text-white font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 focus-ring"
            >
              <Send size={14} strokeWidth={2} />
              <span>{t("ai.send")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Determine whether to show the "AI 助手" label on an assistant message.
 * Only show on first assistant message or when there's a context switch (previous message is from user).
 */
function shouldShowLabel(messages: ChatMessage[], idx: number): boolean {
  const msg = messages[idx];
  if (msg.role !== "assistant") return false;
  // First message in the list
  if (idx === 0) return true;
  // Previous message is from user (context switch)
  if (messages[idx - 1].role === "user") return true;
  // Consecutive assistant messages — no label
  return false;
}

/** 消息气泡组件 */
function MessageBubble({
  message,
  isStreaming,
  showLabel,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  showLabel: boolean;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      showToast("success", t("ai.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silently
    }
  }, [message.content, t]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm break-words ${
          isUser
            ? "bg-accent-info/20 text-text-primary whitespace-pre-wrap"
            : "bg-secondary border border-border text-text-primary"
        }`}
      >
        {/* Show "AI 助手" label only when appropriate */}
        {!isUser && showLabel && (
          <div className="text-xs text-text-muted mb-1 font-medium">{t("ai.assistant")}</div>
        )}
        <div>
          {isUser ? (
            <span className="select-text">{message.content}</span>
          ) : (
            message.content ? (
              <MarkdownRenderer content={message.content} className="text-sm" />
            ) : (
              isStreaming ? "" : ""
            )
          )}
        </div>
        {isStreaming && !message.content && (
          <span className="inline-flex items-center gap-0.5 text-text-muted">
            <TypingDots />
          </span>
        )}
        {isStreaming && message.content && (
          <span className="inline-block w-0.5 h-4 bg-accent-info animate-pulse ml-0.5 align-middle" />
        )}
        {/* Footer: timestamp + copy button for assistant messages */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-border/50">
            {/* Timestamp */}
            {message.timestamp && (
              <span className="text-[10px] text-text-muted">
                {formatTime(message.timestamp)}
              </span>
            )}
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors ml-auto focus-ring"
              title={t("ai.copy")}
            >
              {copied ? (
                <Check size={12} strokeWidth={1.5} />
              ) : (
                <Clipboard size={12} strokeWidth={1.5} />
              )}
              <span>{t("ai.copy")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 打字动画指示器 */
function TypingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}
