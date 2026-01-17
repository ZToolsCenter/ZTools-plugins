// 番茄堆窗口
class TomatoPileWindow {
  constructor() {
    this.ubWindow = null;
  }

  destroy() {
    console.log("destroy tomatoPileWindow");
    if (this.ubWindow != null) {
      this.ubWindow.destroy();
      this.ubWindow = null;
    }
  }

  async create() {
    console.log("create tomatoPileWindow");
    if (this.ubWindow != null && !this.ubWindow.isDestroyed) return;

    try {
      let displayBounds = utools.getDisplayNearestPoint(utools.getCursorScreenPoint()).bounds;
      let windowConfig = {
        width: displayBounds.width,
        height: displayBounds.height,
        x: displayBounds.x,
        y: displayBounds.y,
        resizable: false,
        frame: false,
        transparent: true,
        webPreferences: {
          preload: "base/js/preload.js",
        },
        backgroundColor: "rgba(0,0,0,0.00)",
        fullscreen: false,
        simpleFullscreen: true,
        show: settings.config.showTomatoAnimation,
      };

      this.ubWindow = utools.createBrowserWindow("page/tomatoPileWindow/tomatoPileWindow.html", windowConfig, () => {
        console.log("create tomatoPileWindow success");
        // 开发者工具
        // this.ubWindow.webContents.openDevTools({ mode: 'detach' });
        this.ubWindow.webContents.setZoomFactor(1);
        this.ubWindow.setIgnoreMouseEvents(true);
        this.ubWindow.setSkipTaskbar(true);
        this.ubWindow.setHasShadow(false);

        const data = todoManger_.allTodayTomatos(settings.config.tomatoBoxRange);
        window.ipcRenderer.sendTo(this.ubWindow.webContents.id, "exce", { type: "totalTomatoNum", content: data });
        this.ubWindow.setAlwaysOnTop(true, "status", 1);
        utools.showMainWindow();
      });
    } catch (error) {
      console.error("创建番茄堆窗口失败:", error);
    }
  }

  async show() {
    console.log("show tomatoPileWindow");
    if (this.ubWindow == null && settings.config.showTomatoAnimation && settings.config.showFloatingWindow) {
      console.log("create tomatoPileWindow");
      await this.create();
    } else if (!this.ubWindow.isVisible()) {
      this.ubWindow.show();
      window.ipcRenderer.sendTo(this.ubWindow.webContents.id, "exce", { type: "stopFlag", content: false });
    }
  }

  async hide() {
    console.log("hide tomatoPileWindow");
    if (this.ubWindow == null) return;
    window.ipcRenderer.sendTo(this.ubWindow.webContents.id, "exce", { type: "stopFlag", content: true });
    setTimeout(() => {
      this.ubWindow && this.ubWindow.hide();
    }, 100);
  }

  async close() {
    console.log("close tomatoPileWindow");
    this.hide();
    this.destroy();
  }

  async tomatoFalling(progress, x, y) {
    console.log("send tomatoFalling", progress, x, y);
    if (this.ubWindow == null) return;
    window.ipcRenderer.sendTo(this.ubWindow.webContents.id, "exce", { type: "tomataFalling", content: { x, y, progress } });
  }

  async getBounds() {
    if (this.ubWindow == null) return;
    console.log("getBounds-->", this.ubWindow.getBounds());
    return this.ubWindow.getBounds();
  }

  getState() {
    try {
      return this.ubWindow && !this.ubWindow.isDestroyed() ? this.ubWindow.isVisible() : false;
    } catch (error) {
      console.error("获取番茄堆窗口状态失败:", error);
      return false;
    }
  }
}

// function destroyubWindow() {
//     if (ubWindow != null) {
//         ubWindow.destroy();
//         ubWindow = null;
//     }
// }

// // 创建番茄堆窗口
// async function creatubWindow() {
//     if (ubWindow != null && !ubWindow.isDestroyed) return;

//     let displayBounds = utools.getDisplayNearestPoint(utools.getCursorScreenPoint()).bounds;
//     let windowConfig = {
//         width: displayBounds.width,
//         height: displayBounds.height,
//         x: displayBounds.x,
//         y: displayBounds.y,
//         resizable: false,
//         frame: false,
//         transparent: true,
//         webPreferences: {
//             // nodeIntegration: true,
//             // devTools: true,
//             // zoomFactor: 1.75,
//             preload: 'js/floatingWindow/preload.js'
//         },
//         backgroundColor: "rgba(0,0,0,0.00)",
//         fullscreen: false,
//         simpleFullscreen: true, // 使用简单全屏模式
//         // alwaysOnTop: true, // 窗口是否总是显示在其他窗口之前
//         show: settings.config.showTomatoAnimation,
//         // opacity: 0.1,
//     }

//     ubWindow = utools.createBrowserWindow(
//         "box.html",
//         windowConfig,
//         () => {
//             ubWindow.webContents.setZoomFactor(1);
//             ubWindow.setIgnoreMouseEvents(true); // 在这里设置forward为true可以让鼠标事件穿透窗口
//             ubWindow.setSkipTaskbar(true);
//             ubWindow.setHasShadow(false);
//             // ubWindow.webContents.openDevTools({ mode: "detach" });
//             // ubWindow.show();

//             const data = todoManger_.allTodayTomatos(settings.config.tomatoBoxRange);
//             // const jsonData = JSON.stringify(data);
//             // await ubWindow.webContents.executeJavaScript(`totalTomatoNum(${jsonData})`);

//             window.ipcRenderer.sendTo(ubWindow.webContents.id, 'exce', { type: "totalTomatoNum", content: data });
//             ubWindow.setAlwaysOnTop(true, 'status', 1);
//             utools.showMainWindow();

//         }
//     );

// }

// async function showubWindow() {
//     if (ubWindow != null) {
//         ubWindow.show();
//         window.ipcRenderer.sendTo(ubWindow.webContents.id, 'exce', { type: "stopFlag", content: false });
//     } else {
//         // creatubWindow();
//         // ubWindow.show();
//     }
// }
// async function hideubWindow() {
//     if (ubWindow != null) {
//         window.ipcRenderer.sendTo(ubWindow.webContents.id, 'exce', { type: "stopFlag", content: true });
//         setTimeout(() => {
//             ubWindow.hide();
//         }, 100);
//         // ubWindow.hide();

//     }
// }
