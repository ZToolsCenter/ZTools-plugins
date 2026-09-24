/* uTools bridge：调 preload.js 暴露的 window.gooseMonitor.*（Node child_process 实现）。
   合并在 preload 侧完成。偏好用 utools.dbStorage 持久化。 */
import type {
  PlatformBridge, AppRow, CategoryId, KillResult, Capability, GuiSnapshot, NetworkSnapshot, RuntimePlatform,
} from "../types";

declare global {
  interface Window {
    gooseMonitor?: {
      listProcesses(category: string): Promise<AppRow[]>;
      killProcess(id: string, snapshotToken: string, pids: number[]): Promise<KillResult>;
      getRuntimePlatform(): RuntimePlatform;
      getGuiCapability(): Promise<Capability>;
      getGuiSnapshot(): Promise<GuiSnapshot>;
      getNetworkCapability(): Promise<Capability>;
      getNetworkSnapshot(): Promise<NetworkSnapshot>;
    };
    utools?: { isDarkColors?: () => boolean; dbStorage?: { getItem(k: string): unknown; setItem(k: string, v: string): void } };
  }
}

export class UtoolsBridge implements PlatformBridge {
  readonly name = "utools" as const;
  readonly runtimePlatform = window.gooseMonitor!.getRuntimePlatform();

  getGuiCapability(): Promise<Capability> { return window.gooseMonitor!.getGuiCapability(); }
  getGuiSnapshot(): Promise<GuiSnapshot> { return window.gooseMonitor!.getGuiSnapshot(); }
  getNetworkCapability(): Promise<Capability> { return window.gooseMonitor!.getNetworkCapability(); }
  getNetworkSnapshot(): Promise<NetworkSnapshot> { return window.gooseMonitor!.getNetworkSnapshot(); }

  async listProcesses(category: CategoryId): Promise<AppRow[]> {
    return (await window.gooseMonitor!.listProcesses(category)) as AppRow[];
  }

  async killProcess(row: AppRow): Promise<KillResult> {
    const pids = row.allPids && row.allPids.length ? row.allPids : [row.pid];
    return (await window.gooseMonitor!.killProcess(row.id, row.snapshotToken, pids)) as KillResult;
  }

  getPref(key: string): string | null {
    const u = window.utools;
    if (u?.dbStorage) {
      const v = u.dbStorage.getItem(key);
      return v == null ? null : String(v);
    }
    try { return localStorage.getItem(key); } catch { return null; }
  }
  setPref(key: string, value: string): void {
    const u = window.utools;
    if (u?.dbStorage) { u.dbStorage.setItem(key, value); return; }
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }
}
