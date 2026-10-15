const { ipcRenderer } = require('electron');
class IpcRendererUtils {
    constructor({initCallback = undefined} = {}){
        this.mainId = '';
        ipcRenderer.on('init', (event, data) => {
            console.log('init -------------- IpcRendererUtils')
            this.mainId = event.senderId;
            if (typeof initCallback == 'function') {
                initCallback(data)
            }
        });
    }
    getRemindeId(){
        console.log(this.mainId, this.remindId)
        return this.remindId
    }
    /**
     * 发送信息到主窗口
     * @param messageId
     * @param data
     */
    sendMainMessage(messageId, data= {}){
        ipcRenderer.sendTo(this.mainId, messageId, JSON.stringify(data))
    }
    /**
     * 关闭窗口
     */
    winClose() {
        this.sendMainMessage('control::close');
    }
}
module.exports = IpcRendererUtils