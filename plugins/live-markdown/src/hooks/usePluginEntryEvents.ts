import { useEffect } from "react";
import { TyporaBridgeApi } from "../types/typora";

export interface PluginEntryEventsOptions {
  bridge: TyporaBridgeApi | null;
  newDocument: () => void;
  loadSampleDoc: (which: "quickstart" | "reference") => void;
  openPreferences: () => void;
  openFolder: (path: string | string[]) => void;
  openLocalFile: (path: string) => void;
}

export function usePluginEntryEvents(options: PluginEntryEventsOptions): void {
  const { bridge, newDocument, loadSampleDoc, openPreferences, openFolder, openLocalFile } = options;
  useEffect(() => {
    if (!bridge?.subscribePluginEnter) return;
    const unsubscribe = bridge.subscribePluginEnter((action) => {
      const code = action?.code || "";
      const payload = action?.payload as
        | Array<{ path?: string; isDirectory?: boolean }>
        | { path?: string; isDirectory?: boolean }
        | string
        | undefined;

      if (code === "typora-new-note" || code === "typora-new-doc") {
        newDocument();
        return;
      }
      if (code === "typora-quickstart") {
        loadSampleDoc("quickstart");
        return;
      }
      if (code === "typora-theme-gallery") {
        openPreferences();
        return;
      }

      const entries: Array<{ path: string; isDirectory: boolean }> = [];
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item && typeof item.path === "string" && item.path) {
            entries.push({ path: item.path, isDirectory: Boolean(item.isDirectory) });
          }
        }
      } else if (
        payload &&
        typeof payload === "object" &&
        "path" in payload &&
        typeof payload.path === "string" &&
        payload.path
      ) {
        entries.push({ path: payload.path, isDirectory: Boolean(payload.isDirectory) });
      } else if (typeof payload === "string" && /^([\\/]|\\\\|[a-zA-Z]:[\\/])/.test(payload)) {
        entries.push({ path: payload, isDirectory: false });
      }

      if (entries.length === 0) return;

      const dirPaths: string[] = [];
      const filePaths: string[] = [];
      for (const entry of entries) {
        const isDir =
          code === "typora-open-folder" ||
          action?.type === "directory" ||
          entry.isDirectory ||
          Boolean(bridge.isDirectory?.(entry.path));
        if (isDir) {
          dirPaths.push(entry.path);
        } else {
          filePaths.push(entry.path);
        }
      }

      if (dirPaths.length > 0) {
        openFolder(dirPaths);
      }
      if (filePaths.length > 0) {
        openLocalFile(filePaths[0]);
      }
    });
    return unsubscribe;
  }, [bridge, loadSampleDoc, newDocument, openFolder, openPreferences, openLocalFile]);

}
