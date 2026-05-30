import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Global icon cache — shared across all component instances */
const iconCache = new Map<string, string>();
/** Set of paths currently being fetched (prevent duplicate requests) */
const pendingRequests = new Set<string>();

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

    // Check cache
    const cached = iconCache.get(exePath);
    if (cached) {
      setIcon(cached);
      return;
    }

    // If already fetching this path, wait for it
    if (pendingRequests.has(exePath)) {
      // Poll for cache completion
      const interval = setInterval(() => {
        const result = iconCache.get(exePath);
        if (result) {
          setIcon(result);
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }

    // Fetch icon
    pendingRequests.add(exePath);
    invoke<string | null>("get_process_icon", { exePath })
      .then((result) => {
        if (result) {
          iconCache.set(exePath, result);
          setIcon(result);
        } else {
          // Mark as "no icon" so we don't retry
          iconCache.set(exePath, "");
          setIcon("");
        }
      })
      .catch(() => {
        iconCache.set(exePath, "");
        setIcon("");
      })
      .finally(() => {
        pendingRequests.delete(exePath);
      });
  }, [exePath]);

  return icon || null;
}
