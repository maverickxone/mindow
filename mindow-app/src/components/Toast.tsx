import { useEffect, useState, useCallback } from "react";

export interface ToastMessage {
  id: number;
  type: "success" | "error";
  text: string;
}

let toastId = 0;
let listeners: Array<(msg: ToastMessage) => void> = [];

/** 全局 toast 触发函数 */
export function showToast(type: "success" | "error", text: string) {
  const msg: ToastMessage = { id: ++toastId, type, text };
  for (const listener of listeners) {
    listener(msg);
  }
}

/** Toast 容器组件 — 放置在 App 顶层，显示在右下角 */
export function ToastContainer() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addMessage = useCallback((msg: ToastMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    listeners.push(addMessage);
    return () => {
      listeners = listeners.filter((l) => l !== addMessage);
    };
  }, [addMessage]);

  const removeMessage = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={removeMessage} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  message: ToastMessage;
  onDismiss: (id: number) => void;
}

function ToastItem({ message, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(message.id);
    }, 3000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const bgColor =
    message.type === "success"
      ? "bg-accent-safe/90 text-white"
      : "bg-accent-danger/90 text-white";

  return (
    <div
      className={`pointer-events-auto px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-slide-in ${bgColor}`}
    >
      {message.text}
    </div>
  );
}
