import type { StateStorage } from "zustand/middleware";
import { UToolsAdapter } from "../utools";

const STORAGE_DOC_PREFIX = "gn:storage:";

interface PersistedStorageDoc {
  value: string;
  updatedAt: number;
}

type RawDbStorage = {
  getItem: (key: string) => unknown;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const getStorageDocId = (name: string) => `${STORAGE_DOC_PREFIX}${name}`;

const getRawDbStorage = (): RawDbStorage | null => {
  if (typeof window === "undefined") return null;

  const dbStorage = (
    window as Window & { utools?: { dbStorage?: RawDbStorage } }
  ).utools?.dbStorage;

  if (
    !dbStorage ||
    typeof dbStorage.getItem !== "function" ||
    typeof dbStorage.setItem !== "function" ||
    typeof dbStorage.removeItem !== "function"
  ) {
    return null;
  }

  return dbStorage;
};

const isWebStorageAvailable = () => {
  if (typeof window === "undefined") return false;

  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
};

const readLocalStorageValue = (name: string): string | null => {
  if (!isWebStorageAvailable()) return null;

  try {
    return window.localStorage.getItem(name);
  } catch (error) {
    console.error("[uToolsDbStorage] localStorage getItem failed", name, error);
    return null;
  }
};

const writeLocalStorageValue = (name: string, value: string): boolean => {
  if (!isWebStorageAvailable()) return false;

  try {
    window.localStorage.setItem(name, value);
    return true;
  } catch (error) {
    console.error("[uToolsDbStorage] localStorage setItem failed", name, error);
    return false;
  }
};

const deleteLocalStorageValue = (name: string): void => {
  if (!isWebStorageAvailable()) return;

  try {
    window.localStorage.removeItem(name);
  } catch (error) {
    console.error(
      "[uToolsDbStorage] localStorage removeItem failed",
      name,
      error,
    );
  }
};

const putStorageDoc = (name: string, value: string): boolean => {
  const id = getStorageDocId(name);
  const current = UToolsAdapter.db.get<PersistedStorageDoc>(id);
  const result = UToolsAdapter.db.put<PersistedStorageDoc>(
    id,
    {
      value,
      updatedAt: Date.now(),
    },
    current?._rev,
  );

  if (result.ok !== false) return true;

  const latest = UToolsAdapter.db.get<PersistedStorageDoc>(id);
  const retry = UToolsAdapter.db.put<PersistedStorageDoc>(
    id,
    {
      value,
      updatedAt: Date.now(),
    },
    latest?._rev,
  );

  if (retry.ok === false) {
    console.error("[uToolsDbStorage] storage doc put failed", name, retry.error);
    return false;
  }

  return true;
};

const removeStorageDoc = (name: string): boolean => {
  const id = getStorageDocId(name);
  const current = UToolsAdapter.db.get(id);
  if (!current) return true;

  const result = UToolsAdapter.db.remove(id);
  if (result.ok === false) {
    console.error("[uToolsDbStorage] storage doc remove failed", name, result.error);
    return false;
  }
  return true;
};

const readCanonicalValue = (name: string): string | null => {
  if (UToolsAdapter.isUTools) {
    const doc = UToolsAdapter.db.get<PersistedStorageDoc | string>(
      getStorageDocId(name),
    );
    const data = doc?.data;

    if (typeof data === "string") return data;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as PersistedStorageDoc).value === "string"
    ) {
      return (data as PersistedStorageDoc).value;
    }

    return null;
  }

  return readLocalStorageValue(name);
};

const writeCanonicalValue = (name: string, value: string): boolean => {
  if (UToolsAdapter.isUTools) {
    return putStorageDoc(name, value);
  }

  return writeLocalStorageValue(name, value);
};

const deleteCanonicalValue = (name: string): boolean => {
  if (UToolsAdapter.isUTools) {
    return removeStorageDoc(name);
  }

  deleteLocalStorageValue(name);
  return true;
};

const readPrimaryValue = (name: string): string | null => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return null;

  try {
    const value = dbStorage.getItem(name);
    return typeof value === "string" ? value : null;
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage getItem failed", name, error);
    return null;
  }
};

const writePrimaryValue = (name: string, value: string): boolean => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return false;

  try {
    dbStorage.setItem(name, value);
    return dbStorage.getItem(name) === value;
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage setItem failed", name, error);
    return false;
  }
};

const deletePrimaryValue = (name: string): void => {
  const dbStorage = getRawDbStorage();
  if (!dbStorage) return;

  try {
    dbStorage.removeItem(name);
  } catch (error) {
    console.error("[uToolsDbStorage] dbStorage removeItem failed", name, error);
  }
};

const readStorageValue = (name: string): string | null => {
  const canonicalValue = readCanonicalValue(name);
  if (canonicalValue !== null) return canonicalValue;

  const legacyDbStorageValue = readPrimaryValue(name);
  if (legacyDbStorageValue !== null) {
    if (writeCanonicalValue(name, legacyDbStorageValue)) {
      deletePrimaryValue(name);
    }
    return legacyDbStorageValue;
  }

  return null;
};

const writeStorageValue = (name: string, value: string): boolean => {
  if (writeCanonicalValue(name, value)) {
    deletePrimaryValue(name);
    return true;
  }
  return false;
};

const deleteStorageValue = (name: string): boolean => {
  const removed = deleteCanonicalValue(name);
  deletePrimaryValue(name);
  return removed;
};

export const uToolsStorage: StateStorage = {
  getItem: (name: string) => readStorageValue(name),
  setItem: (name: string, value: string) => writeStorageValue(name, value),
  removeItem: (name: string) => deleteStorageValue(name),
};

export const flushUToolsStorageWrites = async (): Promise<void> => {};

export const getDbStorageItem = (name: string): string | null => {
  return readStorageValue(name);
};

export const setDbStorageItem = (name: string, value: string): boolean => {
  return writeStorageValue(name, value);
};

export const removeDbStorageItem = (name: string): boolean => {
  return deleteStorageValue(name);
};

export const readDbStorageJSON = <T>(name: string, fallback: T): T => {
  const raw = readStorageValue(name);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("[uToolsDbStorage] parse JSON failed", name, error);
    return fallback;
  }
};

export const writeDbStorageJSON = <T>(name: string, value: T): boolean => {
  return writeStorageValue(name, JSON.stringify(value));
};
