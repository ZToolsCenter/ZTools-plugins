// 宿主 dbStorage 与本地存储的通用键值读写：有 dbStorage 时优先使用它，否则退回本地存储。
// 大古截图与大古快传共用（大古快传目录内是同步副本）。

function parseStoredValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function getLocalStorage(win) {
  try {
    return win?.localStorage || globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// window 与 localStorage 通过参数注入，测试里可以替换；不传时取当前全局环境。
export function createKvStore({ win, localStorage } = {}) {
  const host = win || globalThis.window || globalThis;
  const local = localStorage || getLocalStorage(host);

  const dbStorage = () => host?.ztools?.dbStorage || host?.utools?.dbStorage || null;

  return {
    get dbStorage() {
      return dbStorage();
    },

    hasDbStorage() {
      const storage = dbStorage();
      return Boolean(
        storage && (
          typeof storage.getItem === 'function' ||
          typeof storage.get === 'function' ||
          typeof storage.setItem === 'function' ||
          typeof storage.set === 'function'
        )
      );
    },

    async readDb(key) {
      const storage = dbStorage();
      if (!storage) return null;
      if (typeof storage.getItem === 'function') return parseStoredValue(await storage.getItem(key));
      if (typeof storage.get === 'function') return parseStoredValue(await storage.get(key));
      return null;
    },

    async writeDb(key, value) {
      const storage = dbStorage();
      if (!storage) return false;
      if (typeof storage.setItem === 'function') {
        await storage.setItem(key, value);
        return true;
      }
      if (typeof storage.set === 'function') {
        await storage.set(key, value);
        return true;
      }
      return false;
    },

    async removeDb(key) {
      const storage = dbStorage();
      if (!storage) return false;
      if (typeof storage.removeItem === 'function') {
        await storage.removeItem(key);
        return true;
      }
      if (typeof storage.delete === 'function') {
        await storage.delete(key);
        return true;
      }
      return false;
    },

    readLocal(key) {
      try {
        return parseStoredValue(local?.getItem(key));
      } catch {
        return null;
      }
    },

    writeLocal(key, value) {
      try {
        local?.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },

    removeLocal(key) {
      try {
        local?.removeItem?.(key);
      } catch {
        // Storage can be unavailable in private browser contexts.
      }
    },

    // 同一个键：先读 dbStorage，读不到再读本地存储。
    async load(key) {
      const stored = this.hasDbStorage() ? await this.readDb(key) : null;
      return stored ?? this.readLocal(key);
    },

    // 写入当前可用的存储，返回是否写入成功。
    async save(key, value) {
      return this.hasDbStorage() ? this.writeDb(key, value) : this.writeLocal(key, value);
    }
  };
}
