import type { PlatformAdapter } from "@/platform/types";
import { assertAllowedStorageKey, STORAGE_PREFIX } from "./prefix";

/**
 * 基于 PlatformAdapter 的 JSON 读写（逻辑键，无 `ga:` 前缀；platform 内部加前缀）。
 */
export function createKeyedStorage(platform: PlatformAdapter) {
  return {
    get<T = unknown>(key: string): T | null | Promise<T | null> {
      assertAllowedStorageKey(key);
      assertAllowedStorageKey(`${STORAGE_PREFIX}${key}`);
      return platform.storageGet<T>(key);
    },
    set(key: string, value: unknown): boolean | Promise<boolean> {
      assertAllowedStorageKey(key);
      return platform.storageSet(key, value);
    },
    remove(key: string): boolean | Promise<boolean> {
      assertAllowedStorageKey(key);
      return platform.storageRemove(key);
    },
  };
}

/**
 * zustand `persist` 用 StateStorage 形状。
 * platform 已做 JSON 编解码，此处对 zustand 的 string 契约做一层转换。
 */
export interface ZustandStateStorage {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => unknown;
  removeItem: (name: string) => unknown;
}

export function createZustandStorage(
  platform: PlatformAdapter,
): ZustandStateStorage {
  return {
    getItem: (name) => {
      assertAllowedStorageKey(name);
      const data = platform.storageGet(name);
      if (data == null) return null;
      if (typeof data === "string") return data;
      try {
        return JSON.stringify(data);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      assertAllowedStorageKey(name);
      try {
        platform.storageSet(name, JSON.parse(value) as unknown);
      } catch {
        platform.storageSet(name, value);
      }
    },
    removeItem: (name) => {
      assertAllowedStorageKey(name);
      platform.storageRemove(name);
    },
  };
}
