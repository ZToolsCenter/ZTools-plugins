import { getUToolsApi } from "./env";
import type { LocalFolderOpenAppCandidate } from "@/lib/local-folder-open-apps";

type GooseFsShellBridge = {
  listAvailableOpenApps?: <T extends LocalFolderOpenAppCandidate>(candidates: T[]) => Promise<T[]>;
  openWithApp?: (path: string, app: string) => Promise<boolean>;
  openTerminalAtPath?: (path: string, terminal?: string) => Promise<boolean>;
};

const getGooseFsShellBridge = (): GooseFsShellBridge | null =>
  typeof window !== "undefined"
    ? (window as Window & { gooseFs?: GooseFsShellBridge }).gooseFs ?? null
    : null;

const listAvailableOpenAppsResolvedCache = new Map<string, LocalFolderOpenAppCandidate[]>();
const listAvailableOpenAppsPendingCache = new Map<string, Promise<LocalFolderOpenAppCandidate[]>>();

const getCandidatesSignature = (candidates: LocalFolderOpenAppCandidate[]): string =>
  candidates
    .map((c) =>
      [
        c.id,
        c.appName,
        (c.aliases || []).join("|"),
        (c.commands || []).join("|"),
        c.kind,
      ].join("~"),
    )
    .join(";;");

export const getCachedAvailableOpenApps = <T extends LocalFolderOpenAppCandidate>(
  candidates: T[],
): T[] | null => {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const cached = listAvailableOpenAppsResolvedCache.get(getCandidatesSignature(candidates));
  return cached ? (cached as T[]) : null;
};


export const shell = {
  copyText: (text: string): void => {
    const utools = getUToolsApi();
    if (!utools) return;
    utools.copyText?.(text);
  },

  copyImage: (dataUrl: string): void => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.copyImage !== "function") return;
    utools.copyImage(dataUrl);
  },

  showNotification: (body: string): void => {
    const utools = getUToolsApi();
    if (!utools) return;
    utools.showNotification?.(body);
  },

  openUrl: (url: string, useInternalBrowser = true): void => {
    const utools = getUToolsApi();
    if (!utools) return;
    if (useInternalBrowser && typeof utools?.ubrowser?.goto === "function") {
      utools.ubrowser.goto(url).run();
      return;
    }
    utools.shellOpenExternal?.(url);
  },

  openPath: async (targetPath: string): Promise<boolean> => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.shellOpenPath !== "function") return false;
    try {
      const result = await Promise.resolve(utools.shellOpenPath(targetPath));
      if (typeof result === "string") return result.length === 0;
      return result !== false;
    } catch {
      return false;
    }
  },

  showItemInFolder: async (targetPath: string): Promise<boolean> => {
    const utools = getUToolsApi();
    if (!utools) return false;
    if (typeof utools.shellShowItemInFolder === "function") {
      try {
        await Promise.resolve(utools.shellShowItemInFolder(targetPath));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },

  openWithEditor: async (filePath: string, editor: string): Promise<boolean> => {
    const gooseFs = getGooseFsShellBridge();
    if (editor && gooseFs?.openWithApp) {
      try {
        return await gooseFs.openWithApp(filePath, editor);
      } catch {
        return false;
      }
    }
    return shell.openPath(filePath);
  },

  openWithApp: async (targetPath: string, app: string): Promise<boolean> => {
    const gooseFs = getGooseFsShellBridge();
    if (!app.trim() || !gooseFs?.openWithApp) return false;
    try {
      return await gooseFs.openWithApp(targetPath, app.trim());
    } catch {
      return false;
    }
  },

  openTerminalAtPath: async (targetPath: string, terminal: string): Promise<boolean> => {
    const gooseFs = getGooseFsShellBridge();
    if (!gooseFs?.openTerminalAtPath) return false;
    try {
      return await gooseFs.openTerminalAtPath(targetPath, terminal.trim() || undefined);
    } catch {
      return false;
    }
  },

  listAvailableOpenApps: async <T extends LocalFolderOpenAppCandidate>(
    candidates: T[],
  ): Promise<T[]> => {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const key = getCandidatesSignature(candidates);
    const resolved = listAvailableOpenAppsResolvedCache.get(key);
    if (resolved) {
      return resolved as T[];
    }

    const pendingCached = listAvailableOpenAppsPendingCache.get(key);
    if (pendingCached) {
      return (await pendingCached) as T[];
    }

    const gooseFs = getGooseFsShellBridge();
    if (!gooseFs?.listAvailableOpenApps) return [];

    const pending = (async () => {
      try {
        const result = await gooseFs.listAvailableOpenApps!(candidates);
        listAvailableOpenAppsResolvedCache.set(key, result);
        return result;
      } catch {
        return [];
      } finally {
        listAvailableOpenAppsPendingCache.delete(key);
      }
    })();

    listAvailableOpenAppsPendingCache.set(key, pending);
    return (await pending) as T[];
  },

  getDownloadsPath: (): string | null => {
    const utools = getUToolsApi();
    if (!utools?.getPath) return null;
    try {
      return utools.getPath("downloads") ?? null;
    } catch {
      return null;
    }
  },
};

export const warmLocalFolderOpenApps = async (
  candidateGroups: LocalFolderOpenAppCandidate[][],
): Promise<void> => {
  await Promise.all(
    candidateGroups.map((candidates) => shell.listAvailableOpenApps(candidates)),
  );
};
