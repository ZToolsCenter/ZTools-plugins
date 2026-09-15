import { getUToolsApi } from "./env";

const getGooseFs = (): GooseFs | null =>
  typeof window !== "undefined" ? (window as any).gooseFs ?? null : null;

export const dialogs = {
  showSaveDialog: (options?: Record<string, unknown>): string | null => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.showSaveDialog !== "function") return null;
    try {
      const result = utools.showSaveDialog(options ?? {});
      return typeof result === "string" ? result : null;
    } catch {
      return null;
    }
  },

  showOpenDialog: (options?: Record<string, unknown>): string[] | null => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.showOpenDialog !== "function") return null;
    try {
      return utools.showOpenDialog(options ?? {}) ?? null;
    } catch {
      return null;
    }
  },

  selectDirectory: async (): Promise<string | null> => {
    const gooseFs = getGooseFs();
    if (!gooseFs?.selectDirectory) return null;
    try {
      return await gooseFs.selectDirectory();
    } catch {
      return null;
    }
  },

  restoreLastDirectory: async (): Promise<string | null> => {
    const gooseFs = getGooseFs();
    if (!gooseFs?.restoreLastDirectory) return null;
    try {
      return await gooseFs.restoreLastDirectory();
    } catch {
      return null;
    }
  },
};
