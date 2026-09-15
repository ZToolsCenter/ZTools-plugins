export const PLUGIN_ACTIVITY_EVENT = "gomoku:plugin-activity";

const FALLBACK_PREFIX = "gomoku-ztools:";

interface ZToolsStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
  removeItem?(key: string): void;
}

interface ZToolsApi {
  dbStorage?: ZToolsStorage;
  onPluginEnter?(callback: (action: { code?: string }) => void): void;
  onPluginOut?(callback: () => void): void;
}

interface GomokuBridge {
  saveTextFile(input: {
    format: "sgf" | "json" | "txt";
    suggestedName: string;
    text: string;
  }): { cancelled: boolean; path?: string } | Promise<{ cancelled: boolean; path?: string }>;
}

declare global {
  interface Window {
    ztools?: ZToolsApi;
    gomokuBridge?: GomokuBridge;
    __gomokuPluginActive?: boolean;
  }
}

/**
 * 从 ZTools 插件存储读取设置，浏览器预览时回退到 localStorage。
 * @param key 设置键。
 * @param fallback 设置不存在或损坏时的默认值。
 * @returns 已保存且可解析的设置值。
 */
export function readPersistent<T>(key: string, fallback: T): T {
  try {
    const hostValue = window.ztools?.dbStorage?.getItem(key);
    if (hostValue !== undefined && hostValue !== null) return hostValue as T;
    const raw = window.localStorage.getItem(FALLBACK_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * 将设置写入 ZTools 插件存储，浏览器预览时同时写入 localStorage。
 * @param key 设置键。
 * @param value 可序列化的设置值。
 * @returns 无返回值。
 */
export function writePersistent<T>(key: string, value: T): void {
  try {
    if (window.ztools?.dbStorage) {
      window.ztools.dbStorage.setItem(key, value);
      return;
    }
    window.localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(value));
  } catch {
    // 存储不可用不应阻断游戏。
  }
}

/**
 * 删除持久化设置。
 * @param key 设置键。
 * @returns 无返回值。
 */
export function removePersistent(key: string): void {
  try {
    if (window.ztools?.dbStorage?.removeItem) {
      window.ztools.dbStorage.removeItem(key);
      return;
    }
    window.localStorage.removeItem(FALLBACK_PREFIX + key);
  } catch {
    // 存储不可用不应阻断游戏。
  }
}

/**
 * 更新插件激活状态并广播给游戏逻辑。
 * @param active 插件当前是否处于前台。
 * @returns 无返回值。
 */
function publishActivity(active: boolean): void {
  window.__gomokuPluginActive = active;
  window.dispatchEvent(new CustomEvent<boolean>(PLUGIN_ACTIVITY_EVENT, { detail: active }));
}

/**
 * 注册 ZTools 进入/退出生命周期，并提供浏览器可见性降级。
 * @returns 无返回值。
 */
export function setupPluginLifecycle(): void {
  publishActivity(!document.hidden);
  window.ztools?.onPluginEnter?.((action) => {
    if (!action.code || action.code === "gomoku-3d") publishActivity(true);
  });
  window.ztools?.onPluginOut?.(() => publishActivity(false));
  document.addEventListener("visibilitychange", () => publishActivity(!document.hidden));
}
