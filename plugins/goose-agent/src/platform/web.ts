import { STORAGE_PREFIX, assertAllowedStorageKey } from "@/lib/storage";
import type { PlatformAdapter } from "./types";

/** Web 兜底适配器，全部使用浏览器 API（开发预览）；物理键 `ga:*` */
export function createWebAdapter(): PlatformAdapter {
  return {
    storageGet<T = unknown>(key: string): T | null {
      assertAllowedStorageKey(key);
      try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
        if (raw == null) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    storageSet(key: string, value: unknown): boolean {
      assertAllowedStorageKey(key);
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },

    storageRemove(key: string): boolean {
      assertAllowedStorageKey(key);
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
        return true;
      } catch {
        return false;
      }
    },

    async copyText(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },

    showNotification(text: string): void {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(text);
      }
    },

    hideWindow(): void {
      // Web 环境无窗口管理
    },

    showWindow(): void {
      // Web 环境无窗口管理
    },
  };
}
