const { ipcRenderer } = require('electron');
window.utools = {
    ...window.ztools,
    getUser: () => {
        return null;
    }
};
console.log('window.utools', window.utools);

window.ipcRenderer = ipcRenderer;

// 启动插件时间
window.startPluginTime = new Date().getTime();
