import type { HostDoc, HostRuntime, HostPutResult, HostRemoveResult } from "./types";

const WEB_DB_STORAGE_KEY = "goose-note:web-db";

const isUToolsEnv = () =>
  typeof window !== "undefined" && typeof window.utools !== "undefined";

const getUTools = () => (isUToolsEnv() ? (window as any).utools : null);

const readWebDb = (): Record<string, HostDoc<unknown>> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEB_DB_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeWebDb = (db: Record<string, HostDoc<unknown>>): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WEB_DB_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore local fallback write errors
  }
};

const nextWebRev = (current?: string): string => {
  const rev = Number(String(current || "0").split("-")[0] || 0) + 1;
  return `${rev}-${Date.now().toString(36)}`;
};

export const hostRuntime: HostRuntime = {
  kind: "utools",
  get isUTools() {
    return isUToolsEnv();
  },
  supportsSublist: false,
  supportsWakeHotkey: false,
  ensureGooseFs: async () => {},
  dbStorage: {
    getItem: (key: string) => {
      const utools = getUTools();
      if (!utools?.dbStorage || typeof utools.dbStorage.getItem !== "function") {
        return null;
      }
      try {
        const value = utools.dbStorage.getItem(key);
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      const utools = getUTools();
      if (!utools?.dbStorage || typeof utools.dbStorage.setItem !== "function") {
        return;
      }
      try {
        utools.dbStorage.setItem(key, value);
      } catch {
        // ignore dbStorage write errors and let callers decide fallback
      }
    },
    removeItem: (key: string) => {
      const utools = getUTools();
      if (!utools?.dbStorage || typeof utools.dbStorage.removeItem !== "function") {
        return;
      }
      try {
        utools.dbStorage.removeItem(key);
      } catch {
        // ignore dbStorage remove errors and let callers decide fallback
      }
    },
  },
  db: {
    put: <T>(id: string, data: T, rev?: string): HostPutResult => {
      const utools = getUTools();
      if (!utools) {
        const db = readWebDb();
        const nextRev = nextWebRev(rev || db[id]?._rev);
        db[id] = { _id: id, _rev: nextRev, data };
        writeWebDb(db);
        return { id, ok: true, rev: nextRev };
      }
      try {
        return utools.db.put({
          _id: id,
          _rev: rev,
          data,
        });
      } catch (error) {
        return { id, ok: false, error };
      }
    },
    get: <T>(id: string): HostDoc<T> | null => {
      const utools = getUTools();
      if (!utools) return (readWebDb()[id] as HostDoc<T> | undefined) ?? null;
      try {
        return utools.db.get(id);
      } catch {
        return null;
      }
    },
    remove: (id: string): HostRemoveResult => {
      const utools = getUTools();
      if (!utools) {
        const db = readWebDb();
        delete db[id];
        writeWebDb(db);
        return { id, ok: true };
      }
      try {
        return utools.db.remove(id);
      } catch (error) {
        return { id, ok: false, error };
      }
    },
    allDocs: <T>(prefix = ""): Array<HostDoc<T>> => {
      const utools = getUTools();
      if (!utools) {
        return Object.values(readWebDb()).filter((doc) =>
          doc._id.startsWith(prefix),
        ) as Array<HostDoc<T>>;
      }
      try {
        return utools.db.allDocs(prefix);
      } catch {
        return [];
      }
    },
    postAttachment: (id: string, data: Uint8Array, type: string) => {
      const utools = getUTools();
      if (!utools) {
        return { id, ok: false, error: "uTools 环境不可用" };
      }
      try {
        return utools.db.postAttachment(id, data, type);
      } catch (error) {
        return { id, ok: false, error };
      }
    },
    getAttachment: (id: string) => {
      const utools = getUTools();
      if (!utools) return null;
      try {
        return utools.db.getAttachment(id);
      } catch {
        return null;
      }
    },
    getAttachmentType: (id: string) => {
      const utools = getUTools();
      if (!utools) return null;
      try {
        return utools.db.getAttachmentType(id);
      } catch {
        return null;
      }
    },
  },
  getUser: () => {
    const utools = getUTools();
    if (!utools) return null;
    return utools.getUser();
  },
  copyToClipboard: (text: string) => {
    const utools = getUTools();
    if (!utools) return;
    utools.copyText(text);
  },
  showNotification: (body: string) => {
    const utools = getUTools();
    if (!utools) return;
    utools.showNotification(body);
  },
  openUrl: (url: string, useInternalBrowser = true) => {
    const utools = getUTools();
    if (!utools) return;
    if (useInternalBrowser && typeof utools?.ubrowser?.goto === "function") {
      utools.ubrowser.goto(url).run();
      return;
    }
    utools?.shellOpenExternal?.(url);
  },
  openPath: async (targetPath: string) => {
    const utools = getUTools();
    if (!utools || typeof utools?.shellOpenPath !== "function") {
      return false;
    }
    try {
      const result = await Promise.resolve(utools.shellOpenPath(targetPath));
      if (typeof result === "string") {
        return result.length === 0;
      }
      return result !== false;
    } catch {
      return false;
    }
  },
  setSublistFn: (callback) => {
    const utools = getUTools();
    if (!utools) return;
    if (typeof utools?.setSublistFn === "function") {
      utools.setSublistFn(callback);
    }
  },
  setExpendHeight: (height: number) => {
    const utools = getUTools();
    if (!utools) return false;
    if (typeof utools?.setExpendHeight !== "function") return false;
    try {
      // uTools 在窗口被移动到屏幕顶部附近时，若请求高度超出可用范围
      // 可能挂起调用线程；这里加保护，异常静默处理，避免 UI 卡死。
      return Boolean(utools.setExpendHeight(height));
    } catch (err) {
      console.warn("uTools setExpendHeight failed:", err);
      return false;
    }
  },
  redirect: (label, payload) => {
    const utools = getUTools();
    if (!utools) return false;
    if (typeof utools?.redirect === "function") {
      return utools.redirect(label, payload);
    }
    return false;
  },
  registerWakeHotkey: async () => ({
    ok: false,
    error: "uTools 版本不支持全局唤醒快捷键。",
  }),
  unregisterWakeHotkey: async () => {},
  registerSearchHotkey: async () => ({
    ok: false,
    error: "uTools 版本不支持全局搜索快捷键。",
  }),
  unregisterSearchHotkey: async () => {},
};
