const { ipcRenderer } = require("electron");
const settings = require("./settingsConfig.js");

window.settings = settings;

window.isDev = ztools.isDev();
window.isMacOs = ztools.isMacOs();

var parentSenderId = null;

console.log("preload_mask.js");

ipcRenderer.on("ping", (event, message) => {
  console.log(`Received ping message:`, message); // 打印接收到的消息，例如 "sdf"
  // window.parentSenderId = event.senderId;
  window.parentSenderId = message.rootWebContentsId;
  switch (message.type) {
    case "handshake":
      window.absolutePosition = message.position;
      break;
    default:
      break;
  }

  // 发送 pong 消息回去
  // ipcRenderer.sendTo(event.senderId, 'pong', 'pong message');
});

window.ipcRenderer = ipcRenderer;

const { writeFile, copyFile } = require("fs");
window.writeFile = writeFile;
window.copyFile = copyFile;

if (isMacOs) {
  // 在 macOS 上使用我们的自定义模块
  const macScroll = require("./mac-scroll");
  window.nodeWinMouse = macScroll; // 提供与 node-win-mouse 兼容的接口
} else {
  // 在其他平台上继续使用 node-win-mouse
  const nodeWinMouse = require("node-win-mouse");
  window.nodeWinMouse = nodeWinMouse;
}
