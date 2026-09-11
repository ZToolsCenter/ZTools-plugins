import type { AccountData, VaultGroup } from "@/lib/types";

export interface ClipboardImageData {
  width: number;
  height: number;
  data: number[];
}

/** uTools 子搜索框输入回调；其他端可忽略。 */
export type SubInputHandler = (text: string) => void;

/** onPluginEnter 派发到 window 上的事件 payload。 */
export interface PluginEnterDetail {
  code: string;
  /** uTools 类型：text / img / files / regex / over / window 等，其他端为 "main" */
  type?: string;
  /** regex 模式下为用户输入的字符串，例如 "github"；主关键字模式下为 cmd 字符串。 */
  payload?: string;
}

export interface PlatformAdapter {
  loadAccounts(): AccountData[] | Promise<AccountData[]>;
  saveAccounts(accounts: AccountData[]): void | Promise<void>;
  loadGroups(): VaultGroup[] | Promise<VaultGroup[]>;
  saveGroups(groups: VaultGroup[]): void | Promise<void>;
  copyText(text: string): void | Promise<void>;
  readClipboardText(): string | Promise<string>;
  readClipboardImage(): ClipboardImageData | null | Promise<ClipboardImageData | null>;
  captureScreen(): Promise<string | null>;
  saveToFile(content: string, defaultName: string): boolean | Promise<boolean>;
  readFromFile(): string | null | Promise<string | null>;
  hideWindow(): void;
  showWindow(): void;
  showNotification(text: string): void;

  /** uTools 专属：接管/释放主搜索框作为子输入框。其他端为 noop。 */
  setSubInput?(handler: SubInputHandler, placeholder: string, initial?: string): void;
  removeSubInput?(): void;
  /** uTools 专属：隐藏主窗口并把 text 粘贴到上一个聚焦窗口。返回是否调用成功。 */
  pasteText?(text: string): boolean;
  /** uTools 专属：隐藏主窗口并模拟键盘输入 text（兜底，部分网站拒绝粘贴时用）。 */
  typeString?(text: string): boolean;
  /** uTools 专属：退出插件，回到 uTools 主搜索框。 */
  outPlugin?(): void;
}
