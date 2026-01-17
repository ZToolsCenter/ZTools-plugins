/**
 * 悬浮窗类
 * 悬浮窗的创建、显示、隐藏、拖拽等操作
 */
class FloatingWindow {
  constructor() {
    this.floatingWindow = null;
    this.creat();
    this.registerDragListener();
    this.isMacOS = utools.isMacOS();
    this.positionUpdated = false;
    this.positionTimer = null;
    this.lastPosition = null;
    this.isHandshake = false;
    this.windowBounds = utools.dbStorage.getItem("floatingWindow");
    this.maxRetries = 30; // 最大重试次数
    this.retryDelay = 1000; // 重试延迟(毫秒)
    this.watchdog = null; // 窗口监控定时器
    this.startWindowWatchdog();
    this.bounds = null;
  }
  //   注册拖拽监听
  registerDragListener() {



    window.ipcRenderer.on("floatingWindowToIndex", async (event, message) => {
      switch (message.type) {
        case "messageReceived":
          this.isHandshake = true;
          console.log("浮窗握手成功");
          break;

        case "drag":
          // 仅设置窗口的位置，不修改宽度和高度
          if (!this.windowBounds) {
            this.windowBounds = this.floatingWindow.getBounds();
          }
          this.floatingWindow.setBounds({ x: message.content.x, y: message.content.y, width: this.windowBounds.width, height: this.windowBounds.height });

          // 添加位置更新逻辑
          if (this.positionTimer) {
            clearTimeout(this.positionTimer);
          }

          this.lastPosition = { x: message.content.x, y: message.content.y };
          this.positionTimer = setTimeout(() => {
            // 仅保存位置，不包括宽度和高度
            utools.dbStorage.setItem("floatingWindow", { x: this.lastPosition.x, y: this.lastPosition.y, width: this.windowBounds.width, height: this.windowBounds.height });
            console.log("位置已保存到数据库", { x: this.lastPosition.x, y: this.lastPosition.y });
          }, 3000);
          break;
        case "resize":
          this.bounds = this.floatingWindow.getBounds();
          // width取整
          this.bounds.width = Math.round(this.bounds.width);
          utools.dbStorage.setItem("floatingWindow", this.bounds);
          this.windowBounds = this.bounds;
          console.log("悬浮窗尺寸变更已保存到数据库", this.bounds);
          break;

        case "contextmenu":
          contextMenuWindow.create(message.content.x, message.content.y);
          break;

        case "workEnd":
          console.log("workEnd", message);
          await onWorkEnd(message.content.duration, message.content.progress);
          floatingWindow.sendMessage({ type: "callBackResponse" });
          break;

        case "breakEnd":
          console.log("breakEnd", message);
          await onBreakEnd(message.content.duration, message.content.type, message.content.progress);
          floatingWindow.sendMessage({ type: "callBackResponse" });
          break;

        case "doneTask":
          todoManger_.compltedActiveTask();
          break;

        case "updateTrick":
          Ele_minutes.textContent = message.content.minutes;
          Ele_seconds.textContent = message.content.seconds;
          break;

        case "stateChange":
          Ele_clockBox.classList = `clock ${message.content}`;
          currentState = message.content;
          document.getElementById("controlBox").classList.remove("waiting");

          console.log("stateChange", message.content);

          switch (message.content) {
            case "idle":
              Ele_state.innerHTML = "";
              //  "🙆🏻开始最棒的一天吧";
              Ele_minutes.textContent = message.workTime.minutes;
              Ele_seconds.textContent = message.workTime.seconds;

              break;
            case "working":
              Ele_state.innerHTML = `专注中`;
              if (settings.config.showTomatoAnimation && settings.config.showFloatingWindow && settings.config.autoHideAni) {
                if (tomatoPile) {
                  tomatoPile.hide();
                } else {
                  setTimeout(() => {
                    tomatoPile.hide();
                  }, 1000);
                }
              }

              break;
            case "breaking":
              Ele_state.innerHTML = `休息中`;
              break;
            case "workPaused":
              Ele_state.innerHTML = `暂停中`;
              break;
            case "breakPaused":
              Ele_state.innerHTML = `暂停中`;
              break;
            default:
              Ele_state.innerHTML = "开始最棒的一天吧";
          }

          // 如果状态不是工作状态，且配置了显示番茄动画，且配置了显示悬浮窗，则显示番茄动画
          if (message.content.state != "working" && settings.config.showTomatoAnimation && settings.config.showFloatingWindow) {
            tomatoPile && tomatoPile.show();
          }
          break;

        case "tomatoFalling":
          this.bounds = this.floatingWindow.getBounds();
          tomatoPile.tomatoFalling(message.content.progress, this.bounds.x, this.bounds.y);
          break;

        case "playAudio":
          console.log("playAudio settings change", message.content.value);

          document.getElementById("musicBox").setAttribute("data-active", String(message.content.value));
          settings.updateConfig("playAudio", message.content.value, true);
          break;
      }
    });
  }

  // 创建悬浮窗
  async creat() {
    try {
      this.isHandshake = false;
      // 获取悬浮窗位置,如果未保存则使用默认值
      let position = utools.dbStorage.getItem("floatingWindow");
      if (!position) {
        position = { x: 50, y: 50, width: 440, height: 48 };
      } else {
        const displays = utools.getAllDisplays();
        const { x, y, width, height } = position;

        // 检查当前位置是否在任何一个显示器的范围内
        const isWithinAnyDisplay = displays.some((display) => {
          const { bounds } = display;
          return x >= bounds.x && x + width <= bounds.x + bounds.width && y >= bounds.y && y + height <= bounds.y + bounds.height;
        });

        // 如果不在任何显示器范围内，重置位置
        if (!isWithinAnyDisplay) {
          position.x = 50;
          position.y = 50;
        }
      }
      this.floatingWindow = await utools.createBrowserWindow(
        "page/floatingWindow/floatingWindow.html",
        {
          width: position.width,
          height: 48,
          minWidth: utools.isMacOS() ? 82 : 48,
          minHeight: 48, // 设置窗口的最小高度
          maxHeight: 48, // 设置窗口的最大高度

          x: position.x,
          y: position.y,
          frame: false,
          useContentSize: true,
          transparent: true,
          webPreferences: {
            nodeIntegration: true,
            devTools: true,
            preload: "base/js/preload.js",
          },
          backgroundColor: "rgba(0,0,0,0.0)",
          alwaysOnTop: true, // 窗口是否总是显示在其他窗口之前
          hasShadow: false,
          skipTaskbar: true,
          resizable: true,
          show: false,
        },
        () => {
          console.log("悬浮窗创建完成");
          this.floatingWindow.setSkipTaskbar(true); // 隐藏任务栏图标
          // this.floatingWindow.setHasShadow(false); // 无阴影
          this.floatingWindow.setAlwaysOnTop(true, "status", -1); // 窗口总在最前
          // 显示开发者工具,分离模式
          // this.floatingWindow.webContents.openDevTools({ mode: "detach" });

          const handShake = () => {
            console.log("浮窗握手");
            this.sendMessage({ type: "handshake" });
            this.sendMessage({ type: "opacityChange", content: settings.config.opacity });
            setTimeout(() => {
              if (!this.isHandshake) {
                console.log("浮窗握手失败");
                handShake();
              } else {
                console.log("浮窗握手成功");
                // 取消监听握手成功
                window.ipcRenderer.removeAllListeners("浮窗握手成功");
              }
            }, 500);
          };
          handShake();
          updateTaskTitle(todoManger_.getActiveTask()); // 更新任务标题
        }
      );

      // 根据设置显示悬浮窗
      if (settings.config.showFloatingWindow) {
        await floatingWindow.show();
      }

      return;
    } catch (error) {
      console.error("创建悬浮窗失败:", error);
      throw error;
    }
  }

  // 显示悬浮窗
  async show() {
    if (this.floatingWindow) {
      // 检测是否在屏幕范围内
      const isWithinAnyDisplay = utools.getAllDisplays().some((display) => {
        const { bounds } = display;
        return (
          this.floatingWindow.getBounds().x >= bounds.x &&
          this.floatingWindow.getBounds().x + this.floatingWindow.getBounds().width <= bounds.x + bounds.width &&
          this.floatingWindow.getBounds().y >= bounds.y &&
          this.floatingWindow.getBounds().y + this.floatingWindow.getBounds().height <= bounds.y + bounds.height
        );
      });
      if (!isWithinAnyDisplay) {
        this.floatingWindow.setBounds({ x: 50, y: 50, width: this.windowBounds.width, height: this.windowBounds.height });
        // 保存到数据库
        utools.dbStorage.setItem("floatingWindow", { x: 50, y: 50, width: this.windowBounds.width, height: this.windowBounds.height });
      }

      this.floatingWindow.show();
    } else {
      console.error("悬浮窗未创建,正在创建...");
      await this.creat();
      this.floatingWindow.show();
    }
  }

  // 关闭(隐藏)悬浮窗
  async close() {
    if (this.floatingWindow) {
      this.floatingWindow.hide();
    } else {
      console.error("悬浮窗未创建,正在创建...");
      await this.creat();
      this.floatingWindow.hide();
    }
  }

  getBounds() {
    return this.floatingWindow.getBounds();
  }

  async sendMessage(message) {
    // 为每个消息添加senderId
    const messageWithSender = { ...message, senderId: window.ztools.getWebContentsId() };
    window.ipcRenderer.sendTo(this.floatingWindow.webContents.id, "floatingWindow", messageWithSender);
  }

  // 添加窗口监控方法
  startWindowWatchdog() {
    // 如果定时器在工作，跳过
    if (this.watchdog) {
      return;
    }

    this.watchdog = setInterval(() => {
      console.log("窗口监控定时器");
      if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      } else {
        console.log("检测到窗口不存在或已销毁，正在重新创建...");
        this.recreateWindow();
      }
    }, 2000); // 每2秒检查一次
  }

  async recreateWindow() {
    let retryCount = 0;
    while (retryCount < this.maxRetries) {
      try {
        await this.creat();
        console.log("窗口重建成功");
        return;
      } catch (error) {
        console.error(`窗口重建失败，尝试次数: ${retryCount + 1}`, error);
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }
    console.error("窗口重建失败，已达到最大重试次数");
  }
}
