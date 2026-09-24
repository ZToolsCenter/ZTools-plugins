// ZTools 主窗口 preload：接收独立编辑窗口通过 sendToParent 回传的消息。
const EDITOR_CHANNEL = 'dagu-ocr-editor';

try {
  const fs = require('fs');
  const path = require('path');
  window.__daguOcrWriteTextFile = (name, text) => {
    fs.writeFileSync(path.join(process.env.TEMP || process.env.TMP || '.', name), text, 'utf8');
  };
} catch {
  // 普通浏览器开发环境没有 Node 能力：截图覆盖层只把诊断写进控制台。
}

// 供截图覆盖层保存 PNG 文件使用。
try {
  const fs = require('fs');
  window.__daguOcrWriteFile = (filePath, base64) => {
    if (typeof filePath !== 'string' || !filePath) return false;
    fs.writeFileSync(filePath, Buffer.from(String(base64 || ''), 'base64'));
    return true;
  };
} catch {
  // 普通浏览器开发环境没有 Node 能力。
}

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
