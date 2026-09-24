import type { StateStorage } from "zustand/middleware";
import {
  assertAllowedStorageKey,
  STORAGE_PREFIX,
} from "@/lib/storage";

/**
 * Zustand 持久化后端。
 * 键经 `ga:` 前缀写入，禁止读写 goose-note / gn: 命名空间。
 * - uTools：`window.gooseAgent.storage*`（preload 已加 ga:）
 * - Web 预览：localStorage `ga:<name>`
 *
 * 逻辑键示例：`settings` → 物理键 `ga:settings`。
 */
export const gaStateStorage: StateStorage = {
  getItem(name) {
    assertAllowedStorageKey(name);
    if (typeof window !== "undefined" && window.gooseAgent?.storageGet) {
      const value = window.gooseAgent.storageGet(name);
      if (value == null) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    }
    try {
      return localStorage.getItem(`${STORAGE_PREFIX}${name}`);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    assertAllowedStorageKey(name);
    // zustand createJSONStorage 传入的 value 已是 JSON 字符串
    if (typeof window !== "undefined" && window.gooseAgent?.storageSet) {
      try {
        window.gooseAgent.storageSet(name, JSON.parse(value));
      } catch {
        window.gooseAgent.storageSet(name, value);
      }
      return;
    }
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${name}`, value);
    } catch {
      // ignore quota / private mode
    }
  },
  removeItem(name) {
    assertAllowedStorageKey(name);
    if (typeof window !== "undefined" && window.gooseAgent?.storageRemove) {
      window.gooseAgent.storageRemove(name);
      return;
    }
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${name}`);
    } catch {
      // ignore
    }
  },
};
