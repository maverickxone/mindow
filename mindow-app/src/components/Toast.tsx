import { useEffect, useState, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  dismissible: boolean;
  duration: number;
}

// ─── Internal state ──────────────────────────────────────────────────────────

let toastId = 0;
let listeners: Array<(toast: Toast) => void> = [];

const MAX_VISIBLE = 3;
const MAX_QUEUE = 10;
const DEFAULT_DURATION = 4000;

// ─── Public API ──────────────────────────────────────────────────────────────

/** Global toast trigger function — backward compatible with previous API */
export function showToast(
  type: ToastType,
  text: string,
  options?: { duration?: number; dismissible?: boolean }
) {
  const toast: Toast = {
    id: ++toastId,
    type,
    message: text,
    dismissible: options?.dismissible ?? true,
    duration: options?.duration ?? DEFAULT_DURATION,
  };
  for (const listener of listeners) {
    listener(toast);
  }
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function SuccessIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 8l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6 6l4 4M10 6l-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d="M8 1.5l6.93 12H1.07L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 6v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 7v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function getToastIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <SuccessIcon />;
    case "error":
      return <ErrorIcon />;
    case "warning":
      return <WarningIcon />;
    case "info":
      return <InfoIcon />;
  }
}

// ─── Toast Container ─────────────────────────────────────────────────────────

/** Toast container component — renders at bottom-right, max 3 visible with queue */
export function ToastContainer() {
  const [visible, setVisible] = useState<Toast[]>([]);
  const queueRef = useRef<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setVisible((prev) => {
      const next = prev.filter((t) => t.id !== id);
      // Promote from queue if there's space
      if (next.length < MAX_VISIBLE && queueRef.current.length > 0) {
        const promoted = queueRef.current.shift()!;
        return [...next, promoted];
      }
      return next;
    });
  }, []);

  const addToast = useCallback((toast: Toast) => {
    setVisible((prev) => {
      if (prev.length < MAX_VISIBLE) {
        return [...prev, toast];
      }
      // Queue the toast
      queueRef.current.push(toast);
      // Drop oldest if queue exceeds limit
      if (queueRef.current.length > MAX_QUEUE) {
        queueRef.current.shift();
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    listeners.push(addToast);
    return () => {
      listeners = listeners.filter((l) => l !== addToast);
    };
  }, [addToast]);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {visible.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

// ─── Toast Item ──────────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: number) => void;
}

/** Duration of the fade-out exit animation (matches CSS --duration-slow: 300ms) */
const EXIT_ANIMATION_MS = 300;

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);

  // Auto-dismiss after duration
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => {
      setExiting(true);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration]);

  // Remove from DOM after exit animation completes
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [exiting, toast.id, onDismiss]);

  const handleClose = () => {
    setExiting(true);
  };

  const colorClasses = getColorClasses(toast.type);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-md shadow-lg text-sm font-medium
        ${colorClasses}
        ${exiting ? "animate-fade-out" : "animate-slide-in"}`}
      role="alert"
      aria-live="assertive"
    >
      {getToastIcon(toast.type)}
      <span className="flex-1 min-w-0 break-words">{toast.message}</span>
      {toast.dismissible && (
        <button
          onClick={handleClose}
          className="shrink-0 ml-1 p-0.5 rounded hover:bg-white/20 transition-colors duration-fast focus-ring"
          aria-label="Close notification"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Styling helpers ─────────────────────────────────────────────────────────

function getColorClasses(type: ToastType): string {
  switch (type) {
    case "success":
      return "bg-state-success text-white";
    case "error":
      return "bg-state-danger text-white";
    case "warning":
      return "bg-state-warning text-white";
    case "info":
      return "bg-accent text-white";
  }
}
