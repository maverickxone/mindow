import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 通用 Tauri 事件监听 hook
 *
 * 在组件挂载时订阅指定事件，卸载时自动取消订阅。
 * 监听器始终调用最新的 handler（通过 ref 持有），因此调用方传入内联函数
 * 也不会捕获到陈旧闭包。
 *
 * @param eventName - Tauri 事件名称
 * @param handler - 事件处理回调
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void
): void {
  // Hold the latest handler in a ref so the subscription (which only runs on
  // mount / eventName change) always invokes the current callback.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<T>(eventName, (event) => {
      if (!cancelled) {
        handlerRef.current(event.payload);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName]);
}
