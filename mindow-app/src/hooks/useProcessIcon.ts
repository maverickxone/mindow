import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Global icon cache — shared across all component instances */
const iconCache = new Map<string, string>();
/** Pending promises for in-flight requests — avoids duplicate fetches and polling */
const pendingPromises = new Map<string, Promise<string>>();

/**
 * Fetch or retrieve a cached icon. Returns a Promise that resolves to the
 * base64 data URL (or "" if no icon available). Multiple callers for the
 * same exePath share a single in-flight request via the pendingPromises map.
 */
function getIconAsync(exePath: string): Promise<string> {
  const cached = iconCache.get(exePath);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingPromises.get(exePath);
  if (pending) return pending;

  const promise = invoke<string | null>("get_process_icon", { exePath })
    .then((result) => {
      const value = result ?? "";
      iconCache.set(exePath, value);
      return value;
    })
    .catch(() => {
      iconCache.set(exePath, "");
      return "";
    })
    .finally(() => {
      pendingPromises.delete(exePath);
    });

  pendingPromises.set(exePath, promise);
  return promise;
}

/**
 * Hook to get a process icon by exe_path.
 * Returns a data URL (base64 BMP) or null if unavailable/loading.
 * Results are cached globally — same exe_path returns instantly after first fetch.
 */
export function useProcessIcon(exePath: string | null): string | null {
  const [icon, setIcon] = useState<string | null>(
    exePath ? iconCache.get(exePath) ?? null : null
  );

  useEffect(() => {
    if (!exePath) {
      setIcon(null);
      return;
    }

    // Check synchronous cache first
    const cached = iconCache.get(exePath);
    if (cached !== undefined) {
      setIcon(cached || null);
      return;
    }

    // Fetch asynchronously (shares promise with other callers for same path)
    let cancelled = false;
    getIconAsync(exePath).then((result) => {
      if (!cancelled) setIcon(result || null);
    });
    return () => { cancelled = true; };
  }, [exePath]);

  return icon || null;
}
