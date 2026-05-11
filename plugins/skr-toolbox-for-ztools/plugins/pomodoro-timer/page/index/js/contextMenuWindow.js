// 上下文菜单类
class ContextMenuWindow {
  constructor() {
    this.contextmenuWindow = null;
    this.registerEvent();
    console.log("contextMenuWindow实例化");
  }
  registerEvent() {


    // 监听上下文菜单操作事件
    window.ipcRenderer.on("contextMenuExce", (event, message) => {
      console.log("contextMenuExce", message);
      switch (message) {
        case "blur":
          break;
        case "hideFloat":
          settingsPageComponent.find(item => item.name === "showFloatingWindow").component.toggle(false);
          break;
        case "hidePile":
          settingsPageComponent.find(item => item.name === "showTomatoAnimation").component.toggle(false);
          break;
        case "showPile":
          settingsPageComponent.find(item => item.name === "showTomatoAnimation").component.toggle(true);
          this.contextmenuWindow.destroy();
          break;
        case "showSetting":
          utools.redirect("超级番茄设置");
          break;
        case "showStatistic":
          utools.redirect("超级番茄统计");
          break;
        case "showAudio":
          utools.redirect("超级番茄白噪音");
          break;
        case "showAccount":
          utools.redirect("超级番茄账号");
          break;
        case "exit":
          // 激活窗口 
          utools.redirect("退出超级番茄");
          break;
      }
      this.close();
    });
  }

  create(x, y) {
    console.log("contextmenu", x, y);
    if (this.contextmenuWindow && !this.contextmenuWindow.isDestroyed()) {
      this.close();
    }

    const params = new URLSearchParams({
      pileShown: tomatoPile.getState(),
      autoHideAni: settings.config.autoHideAni,
      darkMode: settings.config.darkMode,
    });

    // console.log("contextmenuWindow", "page/contextMenu/contextMenu.html?" + params.toString());
    this.contextmenuWindow = utools.createBrowserWindow(
      "page/contextMenu/contextMenu.html?" + params.toString(),
      {
        x: x - 8,
        y: y - 8,
        width: 160,
        height: 120,
        frame: false,
        transparent: true,
        webPreferences: {
          nodeIntegration: true,
          devTools: true,
          preload: "base/js/preload.js",
        },
        backgroundColor: "rgba(0,0,0,0)",
        // alwaysOnTop: true, // 窗口是否总是显示在其他窗口之前
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
      },
      () => {
        // this.contextmenuWindow.webContents.openDevTools({ mode: 'detach' });
        try {
          if (this.contextmenuWindow && !this.contextmenuWindow.isDestroyed()) {
            this.contextmenuWindow.setSkipTaskbar(true);
            this.contextmenuWindow.setAlwaysOnTop(true, "screen-saver", 2);

            window.ipcRenderer.sendTo(this.contextmenuWindow.webContents.id, "toContextMenu", { type: "握手", senderId: window.ztools.getWebContentsId() });

          }
        } catch (error) {
          console.error('上下文菜单窗口操作失败:', error);
        }
      }
    );
  }
  close() {
    try {
      if (this.contextmenuWindow && !this.contextmenuWindow.isDestroyed()) {
        this.contextmenuWindow.destroy();
      }
    } catch (error) {
      console.error('关闭上下文菜单窗口失败:', error);
    }
    this.contextmenuWindow = null;
  }
}
