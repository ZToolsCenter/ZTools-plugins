/* 浏览器 bridge：纯前端预览，用动态 mock 数据（每次轮询数值都会小幅变化）。
   kill 是"假关闭"（记入 killed 集合，后续快照不再包含），用于无原生后端时
   完整验证 UI / 键盘流 / 排序 / 搜索 / 不闪烁。 */
import type {
  PlatformBridge, AppRow, CategoryId, KillResult, Capability, GuiSnapshot, NetworkSnapshot, RuntimePlatform,
} from "../types";
import { tickSnapshot, mockGuiPids, mockNetworkSnapshot } from "./mock-data";

export class BrowserBridge implements PlatformBridge {
  readonly name = "browser" as const;
  readonly runtimePlatform: RuntimePlatform;
  private killed = new Set<string>();
  private params = new URLSearchParams(location.search);

  constructor() {
    const platform = this.params.get("platform");
    this.runtimePlatform = platform === "win" || platform === "linux" ? platform : "mac";
  }

  async getGuiCapability(): Promise<Capability> {
    return { status: this.params.get("gui") === "off" ? "unsupported" : "supported" };
  }
  async getGuiSnapshot(): Promise<GuiSnapshot> {
    if ((await this.getGuiCapability()).status !== "supported") return { status: "error", sampledAt: Date.now(), pids: [], error: "界面分类不可用" };
    return { status: "supported", sampledAt: Date.now(), pids: mockGuiPids(this.killed) };
  }
  async getNetworkCapability(): Promise<Capability> {
    return { status: this.params.get("network") === "off" ? "unsupported" : "supported" };
  }
  async getNetworkSnapshot(): Promise<NetworkSnapshot> {
    if ((await this.getNetworkCapability()).status !== "supported") return { status: "error", sampledAt: Date.now(), apps: [], error: "网络采样不可用" };
    return mockNetworkSnapshot(this.killed);
  }
  async listProcesses(category: CategoryId): Promise<AppRow[]> {
    return tickSnapshot(category === "gui" || category === "net" ? "all" : category, this.killed).list;
  }

  async killProcess(row: AppRow): Promise<KillResult> {
    this.killed.add(row.id);
    return { ok: true, killed: row.allPids || [row.pid] };
  }

  getPref(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  setPref(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }
}
