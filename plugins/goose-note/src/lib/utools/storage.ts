import { getUToolsApi } from "./env";

const WEB_DB_STORAGE_KEY = "goose-note:web-db";

interface HostDoc<T> {
  _id: string;
  _rev?: string;
  data: T;
}

interface PutResult {
  id: string;
  ok: boolean;
  rev?: string;
  error?: unknown;
}

interface RemoveResult {
  id: string;
  ok: boolean;
  error?: unknown;
}

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
  } catch {}
};

const nextWebRev = (current?: string): string => {
  const rev = Number(String(current || "0").split("-")[0] || 0) + 1;
  return `${rev}-${Date.now().toString(36)}`;
};

export const storage = {
  dbStorage: {
    getItem: (key: string): string | null => {
      const utools = getUToolsApi();
      if (!utools?.dbStorage?.getItem) return null;
      try {
        const value = utools.dbStorage.getItem(key);
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string): void => {
      const utools = getUToolsApi();
      if (!utools?.dbStorage?.setItem) return;
      try {
        utools.dbStorage.setItem(key, value);
      } catch {}
    },
    removeItem: (key: string): void => {
      const utools = getUToolsApi();
      if (!utools?.dbStorage?.removeItem) return;
      try {
        utools.dbStorage.removeItem(key);
      } catch {}
    },
  },

  db: {
    put: <T>(id: string, data: T, rev?: string): PutResult => {
      const utools = getUToolsApi();
      if (!utools) {
        const db = readWebDb();
        const nextRev = nextWebRev(rev || (db[id] as HostDoc<unknown> | undefined)?._rev);
        db[id] = { _id: id, _rev: nextRev, data };
        writeWebDb(db);
        return { id, ok: true, rev: nextRev };
      }
      try {
        return utools.db.put({ _id: id, _rev: rev, data });
      } catch (error) {
        return { id, ok: false, error };
      }
    },

    get: <T>(id: string): HostDoc<T> | null => {
      const utools = getUToolsApi();
      if (!utools) return (readWebDb()[id] as HostDoc<T> | undefined) ?? null;
      try {
        return utools.db.get(id);
      } catch {
        return null;
      }
    },

    remove: (id: string): RemoveResult => {
      const utools = getUToolsApi();
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
      const utools = getUToolsApi();
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

    postAttachment: (id: string, data: Uint8Array, type: string): PutResult => {
      const utools = getUToolsApi();
      if (!utools) return { id, ok: false, error: "uTools 环境不可用" };
      try {
        return utools.db.postAttachment(id, data, type);
      } catch (error) {
        return { id, ok: false, error };
      }
    },

    getAttachment: (id: string): Uint8Array | null => {
      const utools = getUToolsApi();
      if (!utools) return null;
      try {
        return utools.db.getAttachment(id);
      } catch {
        return null;
      }
    },

    getAttachmentType: (id: string): string | null => {
      const utools = getUToolsApi();
      if (!utools) return null;
      try {
        return utools.db.getAttachmentType(id);
      } catch {
        return null;
      }
    },
  },
};
