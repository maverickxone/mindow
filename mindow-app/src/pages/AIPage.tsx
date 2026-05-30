import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/useTauriEvent";
import { useProcessStore } from "../stores/processStore";

/** 对话消息类型 */
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** AI 流式增量事件 payload */
interface AiDeltaPayload {
  delta: string;
}

/** AI 完成事件 payload */
interface AiDonePayload {
  success: boolean;
  error: string | null;
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

  const system = useProcessStore((s) => s.system);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 监听 AI 流式增量
  useTauriEvent<AiDeltaPayload>("ai-delta", (payload) => {
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
    setIsStreaming(false);
    if (!payload.success) {
      setError(payload.error || t("ai.errorDefault"));
    }
  });

  // 发送消息
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    setInput("");
    setIsStreaming(true);
    streamingContentRef.current = "";

    // 添加用户消息和空的助手消息占位
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);

    try {
      await invoke("ai_chat", { userMessage: trimmed });
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

  // 格式化内存
  const formatMemory = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 系统上下文信息 */}
      <div className="border-b border-border px-4 py-2">
        <button
          onClick={() => setShowContext(!showContext)}
          className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <span className={`transition-transform duration-200 ${showContext ? "rotate-90" : ""}`}>
            ▶
          </span>
          <span>{t("ai.systemContext")}</span>
          {system && (
            <span className="text-text-muted">
              — CPU {system.cpu_avg.toFixed(1)}% | {t("processes.columns.memory")} {formatMemory(system.used_memory)}/{formatMemory(system.total_memory)}
            </span>
          )}
        </button>
        {showContext && system && (
          <div className="mt-2 p-2 bg-tertiary rounded text-xs text-text-secondary grid grid-cols-2 gap-2">
            <div>{t("ai.cpuAverage")}: <span className="text-accent-info">{system.cpu_avg.toFixed(1)}%</span></div>
            <div>{t("ai.cpuCores")}: <span className="text-text-primary">{system.per_core_cpu.length}</span></div>
            <div>{t("ai.memoryUsed")}: <span className="text-accent-safe">{formatMemory(system.used_memory)}</span></div>
            <div>{t("ai.memoryTotal")}: <span className="text-text-primary">{formatMemory(system.total_memory)}</span></div>
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
            <span className="text-4xl mb-3">🤖</span>
            <p className="text-sm">{t("ai.greeting")}</p>
            <p className="text-xs mt-1">{t("ai.greetingHint")}</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} isStreaming={isStreaming && idx === messages.length - 1} />
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
            rows={1}
            className="flex-1 resize-none bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-info transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="px-4 py-2 bg-accent-info text-primary font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {isStreaming ? (
              <>
                <TypingDots />
                <span>{t("ai.streaming")}</span>
              </>
            ) : (
              <span>{t("ai.send")}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 消息气泡组件 */
function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? "bg-accent-info/20 text-text-primary"
            : "bg-secondary border border-border text-text-primary"
        }`}
      >
        {!isUser && (
          <div className="text-xs text-text-muted mb-1 font-medium">🤖 {t("ai.assistant")}</div>
        )}
        <div>{message.content || (isStreaming ? "" : "")}</div>
        {isStreaming && !message.content && (
          <span className="inline-flex items-center gap-0.5 text-text-muted">
            <TypingDots />
          </span>
        )}
        {isStreaming && message.content && (
          <span className="inline-block w-0.5 h-4 bg-accent-info animate-pulse ml-0.5 align-middle" />
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
