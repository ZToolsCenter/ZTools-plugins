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

// 供「分享到大古快传」使用：把当前图片写进两个插件约定的交接目录，并给出跳转用的 token 与标签。
try {
  const fs = require('fs');
  const os = require('os');
  const handoff = require('./dagu-transfer-shared.cjs');
  const writer = handoff.createShareWriter({ fs, tmpdir: os.tmpdir() });
  window.__daguOcrPrepareShare = (base64) => writer.write(base64);
  window.__daguOcrDiscardShare = (fileName) => writer.discard(fileName);
  // 大古快传读到交接文件后会留下确认文件；跳转接口找不到对方时也返回成功，只能靠它判断。
  window.__daguOcrShareAcked = (fileName) => writer.isAcked(fileName);
} catch {
  // 普通浏览器开发环境没有 Node 能力：分享按钮会提示需要大古快传。
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
