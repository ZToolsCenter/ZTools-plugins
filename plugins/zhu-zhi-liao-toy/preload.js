/* 竹知了桌宠 —— ZTools 插件主进程入口
   注意：本文件是插件的 preload 脚本，运行在渲染进程里。preload 中 require('electron')
   只能拿到 ipcRenderer 等渲染端模块，ipcMain / screen 是主进程模块，在这里是 undefined。
   因此这里一律使用 ztools 提供的屏幕 API（getCursorScreenPoint / getDisplayNearestPoint /
   getPrimaryDisplay），它们经主进程转发，macOS / Windows 上都安全。注意 macOS 上不要调用
   ztools.screenToDipPoint / dipToScreenPoint，那两个在 macOS 上会触发主进程崩溃。 */
var toyWindow = null;
var IS_MAC = typeof process !== 'undefined' && process.platform === 'darwin';

function displayBoundsAtCursor() {
  try {
    var p = ztools.getCursorScreenPoint();
    var d = ztools.getDisplayNearestPoint(p);
    if (d && d.bounds) return d.bounds;
  } catch (e) {}
  try {
    var d = ztools.getPrimaryDisplay();
    if (d && d.bounds) return d.bounds;
  } catch (e) {}
  return null;
}

window.exports = {
  "start-toy": {
    mode: "none",
    args: {
      enter: function () {
        if (toyWindow && !toyWindow.isDestroyed()) {
          ztools.outPlugin();
          return;
        }
        ztools.hideMainWindow();

        var w = 380;
        var h = 380;
        var x = 0;
        var y = 0;
        var b = displayBoundsAtCursor();
        if (b) {
          x = b.x;
          y = b.y;
          w = b.width;
          h = b.height;
        }

        toyWindow = ztools.createBrowserWindow("toy/index.html", {
          x: x,
          y: y,
          width: w,
          height: h,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,   // 透明窗口在部分平台(尤其 mac)设 resizable:true 会失效
          focusable: true,    // 确保窗口能接收鼠标事件(否则 mac 上无法点击/拖动)
          hasShadow: false,
          backgroundColor: "#00000000",
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
          },
        }, function () {
          // mac 上必须先 show 再 focus 窗口才能拿到焦点/鼠标事件(参见 ZTools 修复)
          if (IS_MAC && toyWindow && !toyWindow.isDestroyed()) {
            try { toyWindow.show(); } catch (e) {}
            try { toyWindow.focus(); } catch (e) {}
          }
        });

        /* 确保不忽略鼠标事件、可聚焦（若 ztools 内部默认置了 focusable:false 会在此被纠正） */
        try { toyWindow.setIgnoreMouseEvents(false); } catch (e) {}
        try { toyWindow.setFocusable(true); } catch (e) {}

        ztools.outPlugin();
      },
    },
  },
};
