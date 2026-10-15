const _IpcRendererUtils = require('../../utils/IpcRendererUtils');
window.require = require;
const { setTimeout, clearTimeout } = require("timers");
window.comSetTimeout = setTimeout;
window.comClearTimeout = clearTimeout;

window.IpcRendererUtils = new _IpcRendererUtils({
    initCallback(data){
        window.remindId = data.id
        setTimeout(() => {
            if (typeof window.initData == 'function') {
                window.initData(data)
            }
        }, 500);
    }
});