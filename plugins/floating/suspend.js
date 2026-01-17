const fs = require('fs');
const { ipcRenderer } = require('electron')

const mineMap = {
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/jpeg": "jpeg",
    "image/jpeg": "jpg",
    "image/jpeg": "jpe",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "image/x-icon": "ico"
}

let winId;
ipcRenderer.on('init', (event, wId) => {
    console.log('init', event, wId);
    winId = wId;
});
window.toEdit = () => {
    window.ztools.sendToParent('toEdit');
}
window.resize = (changed, proportion) => {
    window.ztools.sendToParent('resize', { winId, changed, proportion });
}
window.moveBounds = (x, y, width, height) => {
    window.ztools.sendToParent('moveBounds', { winId, x, y, width, height });
}

/**
 * 拷贝当前图片，借助窗口截图实现
 */
window.copyNowImage = () => {
    window.ztools.sendToParent('copyNowImage');
}

/*
 * 保存当前图片，借助窗口截图实现
 */
window.saveNowImage = () => {
    window.ztools.sendToParent('saveNowImage');
}

ipcRenderer.on('reduction', (event) => {
    document.body.className = "body-hover"
})

window.modifyOpacity = (op) => {
    console.log('modifyOpacity', op, winId);
    window.ztools.sendToParent('modifyOpacity', { op, winId });
}


ipcRenderer.on('will-resize', (event, newBounds) => {
    //只能按比例缩放图片
    let img = window.document.querySelector("img");
    img.style.width = '100%';
    img.style.height = '100%';
    let scale = img.width / (img.height * 1.0)
    let height = newBounds.width / scale;
    window.setSize(newBounds.width, Math.min(newBounds.height, height));
})