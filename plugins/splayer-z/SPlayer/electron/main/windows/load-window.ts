import { BrowserWindow } from "electron";
import { createWindow } from "./index";
import { loadWinUrl } from "../utils/config";

class LoadWindow {
  private win: BrowserWindow | null = null;
  private winURL: string;
  constructor() {
    this.winURL = loadWinUrl;
  }
  /**
   * 主窗口事件
   * @returns void
   */
  private event(): void {
    if (!this.win) return;
    // 准备好显示
    this.win.on("ready-to-show", () => {
      this.win?.show();
    });
  }
  /**
   * 创建窗口
   * @returns BrowserWindow | null
   */
  create(): BrowserWindow | null {
    this.win = createWindow({
      width: 800,
      height: 560,
      maxWidth: 800,
      maxHeight: 560,
      resizable: false,
      alwaysOnTop: true,
      // 不在任务栏显示
      skipTaskbar: true,
      // 窗口不能最小化
      minimizable: false,
      // 窗口不能最大化
      maximizable: false,
      // 窗口不能进入全屏状态
      fullscreenable: false,
      show: false,
    });
    if (!this.win) return null;
    // 加载地址
    this.win.loadURL(this.winURL);
    // 窗口事件
    this.event();
    return this.win;
  }
  /**
   * 获取窗口
   * @returns BrowserWindow | null
   */
  getWin(): BrowserWindow | null {
    return this.win;
  }
}

export default new LoadWindow();
