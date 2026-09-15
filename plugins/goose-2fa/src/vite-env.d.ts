/// <reference types="vite/client" />


interface ClipboardImageData {
  width: number;
  height: number;
  data: number[];
}

interface Goose2FA {
  loadAccounts: () => import("./lib/types").AccountData[];
  saveAccounts: (accounts: import("./lib/types").AccountData[]) => boolean;
  loadGroups: () => import("./lib/types").VaultGroup[];
  saveGroups: (groups: import("./lib/types").VaultGroup[]) => boolean;
  copyText: (text: string) => void;
  showNotification: (text: string) => void;
  readClipboardImage: () => ClipboardImageData | null;
  readClipboardText: () => string;
  captureScreen: (callback: (base64: string | null) => void) => boolean;
  hideWindow: () => void;
  showWindow: () => void;
  saveToFile?: (content: string, defaultName: string) => boolean;
  readFromFile?: () => string | null;
  /** 接管 uTools 主搜索框作为子输入框 */
  setSubInput?: (
    handler: (text: string) => void,
    placeholder: string,
    initial?: string,
  ) => boolean;
  removeSubInput?: () => void;
  /** 隐藏主窗口并粘贴到上一个聚焦窗口 */
  pasteText?: (text: string) => boolean;
  /** 隐藏主窗口并模拟键盘输入（粘贴被拒时的兜底） */
  typeString?: (text: string) => boolean;
  /** 退出当前插件回到 uTools 主搜索框 */
  outPlugin?: () => void;
}

interface Window {
  goose2fa?: Goose2FA;
  utools?: Record<string, unknown>;
}
