/**
 * CyberChef 中文版 ZTools 插件 —— preload（Node 能力桥）
 *
 * 硬约束：本文件不得压缩或混淆，必须保持逐行可读（ZTools 官方规定）。
 * 本文件只 require Node 内置模块（fs / path / electron），不引入任何第三方依赖。
 *
 * 重要：所有 window.ztools 访问都发生在函数被调用时，绝不在顶层读取 ——
 * 宿主 preload 与插件 preload 的执行顺序不保证。
 *
 * 暴露给页面的 API：window.cyberchefApi
 * 页面侧桥接脚本为 plugin-bridge.js。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 自动带入的上限。CyberChef 的 CodeMirror 对超大文本会明显卡顿，
// 超过上限时明确提示用户改用面板内的「打开文件」按钮。
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function exists(p) {
  try {
    return typeof p === 'string' && p.length > 0 && fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function isFile(p) {
  try {
    return exists(p) && fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

function basename(p) {
  return path.basename(String(p || ''));
}

/**
 * 把文件读成适合填进 Input 的字符串。
 * 返回 { kind: 'text' | 'binary', text, name, size } 或 { error }。
 * 二进制文件不强行当文本塞进去，而是转成 Base64 —— CyberChef 里用
 * 「从 Base64 解码」即可还原，比静默乱码更可预期。
 */
function readInputFile(p) {
  try {
    if (!isFile(p)) {
      return { error: '路径不存在或不是文件' };
    }
    const stat = fs.statSync(p);
    if (stat.size > MAX_FILE_BYTES) {
      return { error: '文件超过 2 MB，请用面板内的「打开文件」按钮' };
    }

    const buf = fs.readFileSync(p);
    let hasNul = false;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0) { hasNul = true; break; }
    }

    const text = buf.toString('utf8');
    const hasReplacement = text.indexOf('\uFFFD') !== -1;
    const hasControl = /[\x00-\x08\x0E-\x1F]/.test(text);
    const looksText = !hasNul && !hasReplacement && !hasControl;

    if (looksText) {
      return { kind: 'text', text: text, name: basename(p), size: stat.size };
    }
    return { kind: 'binary', text: buf.toString('base64'), name: basename(p), size: stat.size };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/**
 * 读剪贴板文本。优先用 Electron clipboard；宿主未暴露 electron 模块时
 * 返回空串，由页面侧 navigator.clipboard.readText() 兜底。
 */
function getClipboardText() {
  try {
    const electron = require('electron');
    if (electron && electron.clipboard && typeof electron.clipboard.readText === 'function') {
      return electron.clipboard.readText() || '';
    }
  } catch (e) {
    // 宿主未提供 electron 模块：静默降级
  }
  return '';
}

function copyText(text) {
  try {
    if (window.ztools && typeof window.ztools.copyText === 'function') {
      return !!window.ztools.copyText(String(text));
    }
  } catch (e) {
    // 继续尝试 Electron 剪贴板
  }
  try {
    const electron = require('electron');
    if (electron && electron.clipboard && typeof electron.clipboard.writeText === 'function') {
      electron.clipboard.writeText(String(text));
      return true;
    }
  } catch (e) {
    // 无可用剪贴板能力
  }
  return false;
}

function showToast(message) {
  try {
    if (window.ztools && typeof window.ztools.showToast === 'function') {
      const result = window.ztools.showToast(String(message), { duration: 2200 });
      if (result && typeof result.catch === 'function') {
        result.catch(function () {});
      }
      return true;
    }
  } catch (e) {
    // 由页面侧 DOM toast 兜底
  }
  return false;
}

function openFiles() {
  try {
    if (window.ztools && typeof window.ztools.showOpenDialog === 'function') {
      const picked = window.ztools.showOpenDialog({
        title: '选择要送入 CyberChef 的文件',
        properties: ['openFile'],
        filters: [{ name: '全部文件', extensions: ['*'] }]
      });
      return Array.isArray(picked) ? picked : [];
    }
  } catch (e) {
    // 对话框不可用
  }
  return [];
}

function saveText(defaultName, content) {
  try {
    if (!window.ztools || typeof window.ztools.showSaveDialog !== 'function') return null;
    // 用户点「取消」时返回 undefined，必须区分，不能当成成功
    const target = window.ztools.showSaveDialog({ title: '保存输出', defaultPath: defaultName });
    if (!target) return null;
    fs.writeFileSync(target, String(content), 'utf8');
    return target;
  } catch (e) {
    return null;
  }
}

function isHost() {
  return !!(window.ztools && typeof window.ztools.onPluginEnter === 'function');
}

window.cyberchefApi = {
  exists: exists,
  isFile: isFile,
  basename: basename,
  readInputFile: readInputFile,
  getClipboardText: getClipboardText,
  copyText: copyText,
  showToast: showToast,
  openFiles: openFiles,
  saveText: saveText,
  isHost: isHost
};
