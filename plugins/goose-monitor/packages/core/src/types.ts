/* ProcKill 共享类型 —— bridge 与 UI 之间的契约。 */

/** 合并后的子进程（Electron Helper 等）。 */
export interface Helper {
  name: string;
  /** 角色描述，如 "GPU" / "标签页 ×9" / "主进程"。 */
  role: string;
  cpu: number; // 百分比
  mem: number; // MB
  pid: number;
  /** 该子进程正在监听的 TCP 端口。 */
  ports?: number[];
}

/** 一行 = 一个应用 / 进程组（已合并 Helper）。 */
export interface AppRow {
  id: string;
  /** 跨刷新/重启稳定的应用身份，用于持久化豁免和计划任务。 */
  identity: string;
  /** 当前进程组快照；后端在终止前重验，防止 PID 复用或成员变化。 */
  snapshotToken: string;
  /** 显示名（应用名或进程名）。 */
  name: string;
  /** 兼容旧桥接的短标签；界面不再将它作为图标占位显示。 */
  monogram: string;
  /** 合并后的进程总数。 */
  procs: number;
  /** 合并后 CPU 总和（%）。 */
  cpu: number;
  /** 合并后内存总和（MB）。 */
  mem: number;
  /** 主进程/代表 PID。 */
  pid: number;
  /** 可执行路径。 */
  path: string;
  /** 主进程完整命令行（合并组用 main 的 commandLine）。 */
  commandLine?: string;
  /** 子进程明细。 */
  helpers: Helper[];
  /** 系统/后台进程（图标更小、圆角更小）。 */
  sys?: boolean;
  /** 来自系统目录的应用或进程；真实图标缺失时使用独立系统图标。 */
  systemOwned?: boolean;
  /** 真实图标 data URL（运行时由后端提供，可选）。 */
  iconUrl?: string;
  /** 合并组下所有 PID，kill 时需要。 */
  allPids?: number[];
  /** 组合并后正在监听的 TCP 端口（去重升序）。 */
  ports?: number[];
}

export type CategoryId = "all" | "gui" | "cpu" | "mem" | "net" | "bg";

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
  key: string; // ⌘<key>
}

export interface KillResult {
  ok: boolean;
  /** 被结束的 PID 列表。 */
  killed: number[];
  error?: string;
}

export type CapabilityStatus = "supported" | "unsupported" | "unavailable";
export interface Capability {
  status: CapabilityStatus;
  error?: string;
}

export interface GuiSnapshot {
  status: "supported" | "error";
  sampledAt: number;
  pids: number[];
  error?: string;
}

export interface NetworkAppUsage {
  app: AppRow;
  activePids: number[];
  downloadBps: number;
  uploadBps: number;
}

export interface NetworkSnapshot {
  status: "supported" | "error";
  sampledAt: number;
  windowMs?: number;
  apps: NetworkAppUsage[];
  error?: string;
}

export type RuntimePlatform = "mac" | "win" | "linux";

/** uTools 宿主与浏览器开发 mock 共用的界面契约。 */
export interface PlatformBridge {
  /** 平台名，用于调试与降级提示。 */
  readonly name: "utools" | "browser";
  readonly runtimePlatform: RuntimePlatform;
  getGuiCapability(): Promise<Capability>;
  getGuiSnapshot(): Promise<GuiSnapshot>;
  getNetworkCapability(): Promise<Capability>;
  getNetworkSnapshot(): Promise<NetworkSnapshot>;
  /** 列出某分类下的进程组（已做 Helper 合并）。 */
  listProcesses(category: CategoryId): Promise<AppRow[]>;
  /** 结束一个进程组（含其所有子进程）。 */
  killProcess(row: AppRow): Promise<KillResult>;
  /** 持久化界面偏好。 */
  getPref(key: string): string | null;
  setPref(key: string, value: string): void;
}
