// ZTools 主窗口 preload：接收独立编辑窗口通过 sendToParent 回传的消息。
const EDITOR_CHANNEL = 'dagu-ocr-editor';

try {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on(EDITOR_CHANNEL, (_event, payload) => {
    window.postMessage({
      type: 'daguOcrEditorMessage',
      payload
    }, '*');
  });
} catch {
  // 普通浏览器开发环境没有 Electron IPC。
}
