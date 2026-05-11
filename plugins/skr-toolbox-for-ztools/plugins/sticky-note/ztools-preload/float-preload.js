"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { ipcRenderer } = require('electron');
// 主窗口的 webContents ID
let mainWindowId = null;
let selfWindowId = null;
ipcRenderer.on('init', (event, data) => {
    console.log('收到 init 消息，主窗口 ID:', data.mainWindowId);
    mainWindowId = data.mainWindowId;
    selfWindowId = data.windowId;
});
// 直接获取当前窗口信息
function getWinInfoDirect() {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        x: window.screenX,
        y: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight
    };
}
window.customFloatAPI = {
    sendToMain: (channel, ...args) => {
        ipcRenderer.sendTo(mainWindowId, channel, ...args);
    },
    setAlwaysOnTop: (alwaysOnTop) => {
        ipcRenderer.sendTo(mainWindowId, 'set-always-on-top', { alwaysOnTop, windowId: selfWindowId });
    },
    getWinInfoDirect,
};
