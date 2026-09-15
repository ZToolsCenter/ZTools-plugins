/** onPluginEnter 派发到 window 上的事件 payload。 */
export interface PluginEnterDetail {
  code: string;
  /** uTools 类型：text / img / files / regex / over / window 等，其他端为 "main" */
  type?: string;
  /** regex 模式下为用户输入的字符串；主关键字模式下为 cmd 字符串。 */
  payload?: string;
}

/**
 * 平台适配器：窗口 / 通知 / 存储（逻辑键；物理前缀 `ga:` 由实现层加）。
 * 本机 FS 走 `@/lib/fs`（window.gooseFs），不在此接口上堆路径 API。
 */
export interface PlatformAdapter {
  /**
   * 读存储。传入逻辑键（如 `settings`），实现层写物理键 `ga:settings`。
   * **禁止** `gn:` / `goose-note-*`（ADR 0004）。
   */
  storageGet<T = unknown>(key: string): T | null | Promise<T | null>;
  storageSet(key: string, value: unknown): boolean | Promise<boolean>;
  storageRemove(key: string): boolean | Promise<boolean>;
  copyText(text: string): void | Promise<void>;
  showNotification(text: string): void;
  hideWindow(): void;
  showWindow(): void;
  outPlugin?(): void;
}
