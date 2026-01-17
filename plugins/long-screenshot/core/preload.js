console.log("ztools.isDev():", ztools.isDev());
if (!ztools.isDev()) {
  console.log = console.info = console.error = console.warn = () => { };
}

const { ipcRenderer } = require('electron');

const settings = require('./settingsConfig.js');


window.settings = settings;


window.isDev = ztools.isDev();
window.isMacOs = ztools.isMacOs();



// 创建主窗口
var scutMask = null;
function createMask() {
  ztools.hideMainWindow();

  // 如果窗口已经存在，则不创建
  if (scutMask !== null && !scutMask.isDestroyed()) {
    return;
  }


  let displayBounds = ztools.getDisplayNearestPoint(ztools.getCursorScreenPoint()).bounds;
  console.log(displayBounds);

  let windowConfig = {
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: 'core/preload_mask.js',
      zoomFactor: 1,
    },
    backgroundColor: "rgba(0,0,0,0.00)",

    show: true,
    width: displayBounds.width,
    height: displayBounds.height,
    x: displayBounds.x,
    y: displayBounds.y,
    skipTaskbar: true,
    hasShadow: false,
  };

  console.log(windowConfig)

  scutMask = ztools.createBrowserWindow("ui/mask.html", windowConfig, () => {
    !isMacOs && scutMask.setFullScreen(true)
    // 获取当前root webContents.id
    let rootWebContentsId = ztools.getWebContentsId()
    ipcRenderer.sendTo(scutMask.webContents.id, 'ping',
      { type: "handshake", position: scutMask.getPosition(), rootWebContentsId })
  });

  scutMask.setAlwaysOnTop(true, "screen-saver", 2);
  isDev && scutMask.webContents.openDevTools({ mode: "detach" });

}

window.createMask = createMask;
window.processExit = process.exit;




ztools.onPluginEnter(({ code, type, payload }) => {
  console.log('onPluginEnter', code, type, payload)
  switch (payload) {
    case '长截图设置':
      break;
    default:
      window.createMask()
      // 阻止页面加载
      break;
  }
});







// 处理来自主进程的消息
ipcRenderer.on('pong', (event, arg) => {
  console.log('pong', arg)

  switch (arg.type) {
    case 'startCapture':
      console.log('startCapture')

      break;
    case 'endCapture':
      console.log('endCapture')
      process.exit();
      break;
    case 'mouseEnter':
      scutMask.setIgnoreMouseEvents(false, { forward: true })
      // focus on the mask
      scutMask.webContents.focus();

      break;
    case 'mouseLeave':
      scutMask.setIgnoreMouseEvents(true, { forward: true })
      break;
    case 'mouseScroll':
      scutMask.setIgnoreMouseEvents(true, { forward: true })

      break;
  }




})



