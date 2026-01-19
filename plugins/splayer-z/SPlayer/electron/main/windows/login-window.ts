import { app, BrowserWindow, session } from "electron";
import { createWindow } from "./index";
import { join } from "path";

class LoginWindow {
  private win: BrowserWindow | null = null;
  private loginTimer: NodeJS.Timeout | null = null;
  private loginSession: Electron.Session | null = null;

  constructor() {}

  private getLoginSession(): Electron.Session {
    if (!this.loginSession) {
      this.loginSession = session.fromPartition("persist:login");
    }
    return this.loginSession;
  }
  // 事件绑定
  private event(mainWin: BrowserWindow): void {
    if (!this.win) return;
    // 阻止新窗口创建
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // 加载完成后显示并开始轮询登录状态
    this.win.webContents.once("did-finish-load", () => {
      this.win?.show();
      this.loginTimer = setInterval(() => this.checkLogin(mainWin), 1000);
      this.win?.on("closed", () => {
        if (this.loginTimer) clearInterval(this.loginTimer);
        this.loginTimer = null;
      });
    });
  }

  // 检查是否已登录
  private async checkLogin(mainWin: BrowserWindow) {
    if (!this.win) return;
    try {
      this.win.webContents.executeJavaScript(
        "document.title = '登录网易云音乐（ 若遇到无响应请关闭后重试 ）'",
      );
      // 判断 MUSIC_U
      const MUSIC_U = await this.getLoginSession().cookies.get({ name: "MUSIC_U" });
      if (MUSIC_U && MUSIC_U.length > 0) {
        if (this.loginTimer) clearInterval(this.loginTimer);
        this.loginTimer = null;
        const value = `MUSIC_U=${MUSIC_U[0].value};`;
        // 发送回主进程
        mainWin?.webContents.send("send-cookies", value);
        this.win.destroy();
        this.win = null;
      }
    } catch (error) {
      console.error(error);
    }
  }

  // 创建登录窗口
  async create(mainWin: BrowserWindow): Promise<BrowserWindow | null> {
    await app.whenReady();
    const loginSession = this.getLoginSession();
    // 清理登录会话存储
    await loginSession.clearStorageData({
      storages: ["cookies", "localstorage"],
    });

    this.win = createWindow({
      parent: mainWin,
      title: "登录网易云音乐（ 若遇到无响应请关闭后重试 ）",
      width: 1280,
      height: 800,
      center: true,
      frame: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        spellcheck: false,
        nodeIntegration: true,
        nodeIntegrationInWorker: true,
        session: loginSession,
      },
    });

    if (!this.win) return null;
    // 加载登录地址
    this.win.loadURL("https://music.163.com/#/login/");
    // 绑定事件
    this.event(mainWin);
    return this.win;
  }

  // 获取窗口
  getWin(): BrowserWindow | null {
    return this.win;
  }
}

export default new LoginWindow();
