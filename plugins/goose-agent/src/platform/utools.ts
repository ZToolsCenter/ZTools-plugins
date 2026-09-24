import { assertAllowedStorageKey } from "@/lib/storage";
import type { PlatformAdapter } from "./types";

/** uTools 适配器，委托 window.gooseAgent（preload 内加 `ga:` 前缀） */
export function createUToolsAdapter(): PlatformAdapter {
  const api = window.gooseAgent!;

  return {
    storageGet<T = unknown>(key: string): T | null {
      assertAllowedStorageKey(key);
      return (api.storageGet(key) as T | null) ?? null;
    },

    storageSet(key: string, value: unknown): boolean {
      assertAllowedStorageKey(key);
      return api.storageSet(key, value);
    },

    storageRemove(key: string): boolean {
      assertAllowedStorageKey(key);
      return api.storageRemove(key);
    },

    copyText(text: string): void {
      api.copyText(text);
    },

    showNotification(text: string): void {
      api.showNotification(text);
    },

    hideWindow(): void {
      api.hideWindow();
    },

    showWindow(): void {
      api.showWindow();
    },

    outPlugin(): void {
      api.outPlugin?.();
    },
  };
}
