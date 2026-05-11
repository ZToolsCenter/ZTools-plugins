window.utools = { ...window.ztools }
window.exports = {
  fidget: {
    mode: "none",
    args: {
      enter: async (action) => {
        const isMac = utools?.isMacOS() ?? false
        const win = utools.createBrowserWindow('index.html', {
          transparent: true, // 启用透明
          frame: false, // 禁用窗口边框
          alwaysOnTop: true, // 始终在最顶层
          skipTaskbar: true, // 跳过任务栏
          focusable: false, // 是否可聚焦
          fullscreen: !isMac, // 全屏  mac全屏模式会开启新桌面
          hasShadow: false, // 禁用阴影
          resizable: false, // 禁用调整大小
          maximizable: false, // 禁用最大化
          movable: false, // 可移动
          modal: true,
          show: true,
          backgroundColor: '#00000000',
          webPreferences: {
            nodeIntegration: true,
            devTools: false,
            contextIsolation: false
          }
        })
        utools.outPlugin()
        // win.webContents.openDevTools() // 打开开发者工具
        if (isMac) {
          win.setFullScreenable(false)
          win.setIgnoreMouseEvents(true)
          const primaryDisplay = utools.getPrimaryDisplay();
          const { width, height } = primaryDisplay.size; // 物理屏幕的完整宽度和高度
          const { width: workAreaWidth, height: workAreaHeight } = primaryDisplay.workAreaSize; // 工作区大小（不包括任务栏、Dock等）

          console.log(`屏幕尺寸: ${width}`);
          console.log(`工作区尺寸: ${workAreaWidth}`);

          win.setBounds({
            width: workAreaWidth,
            height: workAreaHeight,
            x: 0,
            y: 0
          })
        }

        utools.hideMainWindow()
      },
    },
  }
};