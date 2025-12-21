"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { ipcRenderer } = require('electron');
// 存储所有创建的窗口，用于后续查找
const childWindows = new Map();
// ✅ 监听刷新事件
ipcRenderer.on('refresh', (event) => {
    if (eventListenerCb) {
        eventListenerCb('refresh');
    }
});

function setCompatAlwaysOnTop(win, isTop) {
    if (!win || win.isDestroyed()) return;

    if (!isTop) {
        // 关闭置顶
        win.setAlwaysOnTop(false);
        return;
    }

    // 开启置顶
    if (window.ztools.isMacOS()) {
        win.setAlwaysOnTop(true); // macOS
    } else if (window.ztools.isWindows()) {
        win.setAlwaysOnTop(true, 'screen-saver'); // Windows
    } else {
        win.setAlwaysOnTop(true);
    }
}

function createFloatWindow({ item, isEdit, type }) {
    window.ztools.hideMainWindow();
    let width = 310;
    let height = 330;
    let x = 0;
    let y = 0;
    let url = `./dist/float.html?type=${type || 'normal'}`; // 兼容旧数据
    if (item) {
        url += `&id=${item.id}&isEdit=${isEdit}`;
        if (item.winWidth && item.winHeight) {
            width = item.winWidth < 50 ? 310 : item.winWidth;
            height = item.winHeight < 50 ? 330 : item.winHeight;
            x = item.winX || 0;
            y = item.winY || 0;
        }
    }
    else {
        url += `&isEdit=true`;
    }
    // ztools.showNotification(`${item.winWidth},${item.winHeight},${item.winX},${item.winY}`);
    const devTools = ztools.isDev();
    const win = ztools.createBrowserWindow(url, {
        show: false,
        width,
        height,
        x,
        y,
        useContentSize: true,
        skipTaskbar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        //背景透明，防止放大缩小时出现白框
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        alwaysOnTop: false,
        webPreferences: {
            preload: './ztools-preload/float-preload.js',
            devTools,
            nodeIntegration: true,
            contextIsolation: false,
            zoomFactor: 1.0,
        },
    }, () => {
        // ✅ 保存窗口引用
        childWindows.set(win.webContents.id, win);
        win.show();
        // 设置置顶状态
        let alwaysOnTop = true;
        if (item && item.alwaysOnTop !== undefined) {
            alwaysOnTop = item.alwaysOnTop;
        }
        // @ts-ignore
        setCompatAlwaysOnTop(win, alwaysOnTop);
        if (devTools) {
            win.webContents.openDevTools({ mode: 'detach' });
        }
        // 发送初始化消息
        ipcRenderer.sendTo(win.webContents.id, 'init', {
            mainWindowId: window.ztools.getWebContentsId(),
            windowId: win.webContents.id
        });
        // 监听子窗口设置置顶状态
        ipcRenderer.on('set-always-on-top', (event, { alwaysOnTop, windowId }) => {
            setCompatAlwaysOnTop(childWindows.get(windowId), alwaysOnTop);
        });
    });
}
let eventListenerCb = null;
// 数据上报
function collect(data) {
    console.log('数据上报：', data);
}

// 暴露API
window.customAPI = {
    createFloatWindow,
    addEventListener(callback) {
        eventListenerCb = callback;
    },
    collect,
};
