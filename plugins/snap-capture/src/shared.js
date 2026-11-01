/* 轻影截图 · 共用基础层（经典脚本，挂到 window.SNAP）
   设置存储、宿主封装、通用小工具。所有页面先加载本文件。 */

(function () {
  'use strict';

  const host = () => String(window.location.protocol) === 'file:';

  function api() {
    return window.ztools || window.utools || null;
  }

  // ── 设置 ────────────────────────────────────────────────
  const DEFAULTS = {
    saveDir: '',
    askEveryTime: false,
    fileNamePattern: '截图-{y}{m}{d}-{H}{M}{S}',
    ocrDir: '',
    translator: 'microsoft',
    baiduAppId: '',
    baiduKey: '',
    targetLang: 'auto',
    sourceLang: 'auto',
    copyAfterSave: false,
    pinAutoClose: false,
    historyEnabled: true,
    historyLimit: 100,
    lastTool: 'none',
    color: '#ff4d4f',
    strokeWidth: 3
  };

  const KEY = 'snap.settings';

  function hasDb() {
    const z = api();
    return Boolean(z && z.dbStorage && typeof z.dbStorage.getItem === 'function');
  }

  function loadSettings() {
    let stored = {};
    try {
      if (hasDb()) {
        const value = api().dbStorage.getItem(KEY);
        if (value && typeof value === 'object') stored = value;
        else if (typeof value === 'string') stored = JSON.parse(value);
      } else {
        stored = JSON.parse(window.localStorage.getItem(KEY) || '{}');
      }
    } catch {
      stored = {};
    }
    return { ...DEFAULTS, ...stored };
  }

  let settingsCache = null;

  function getSettings() {
    if (!settingsCache) settingsCache = loadSettings();
    return settingsCache;
  }

  function saveSettings(patch) {
    settingsCache = { ...getSettings(), ...patch };
    try {
      if (hasDb()) api().dbStorage.setItem(KEY, settingsCache);
      else window.localStorage.setItem(KEY, JSON.stringify(settingsCache));
    } catch (error) {
      console.warn('[snap] 保存设置失败', error);
    }
    return settingsCache;
  }

  // ── 时间与文件名 ────────────────────────────────────────
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function fileName(settings, date = new Date()) {
    const pattern = (settings && settings.fileNamePattern) || DEFAULTS.fileNamePattern;
    return pattern
      .replace(/\{y\}/g, String(date.getFullYear()))
      .replace(/\{M\}/g, pad(date.getMonth() + 1))
      .replace(/\{d\}/g, pad(date.getDate()))
      .replace(/\{H\}/g, pad(date.getHours()))
      .replace(/\{m\}/g, pad(date.getMinutes()))
      .replace(/\{S\}/g, pad(date.getSeconds()));
  }

  // ── 语言 ────────────────────────────────────────────────
  const LANGUAGES = [
    { code: 'auto', label: '自动检测' },
    { code: 'zh', label: '简体中文' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'en', label: '英语' },
    { code: 'ja', label: '日语' },
    { code: 'ko', label: '韩语' },
    { code: 'fr', label: '法语' },
    { code: 'de', label: '德语' },
    { code: 'es', label: '西班牙语' },
    { code: 'ru', label: '俄语' }
  ];

  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;

  function detectTarget(text) {
    return CJK.test(String(text || '')) ? 'en' : 'zh';
  }

  function resolveTarget(settings, text) {
    const target = (settings && settings.targetLang) || 'auto';
    return target === 'auto' ? detectTarget(text) : target;
  }

  // ── 杂项 ────────────────────────────────────────────────
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundRect(rect) {
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    return {
      left,
      top,
      width: Math.max(1, Math.round(rect.left + rect.width) - left),
      height: Math.max(1, Math.round(rect.top + rect.height) - top)
    };
  }

  function isDarkTheme() {
    const z = api();
    try {
      if (z && typeof z.isDarkColors === 'function') return z.isDarkColors();
    } catch {
      // 忽略
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function notify(message) {
    const z = api();
    try {
      if (z && typeof z.showNotification === 'function') z.showNotification(message);
    } catch {
      // 忽略
    }
  }

  // 子窗口 → 父窗口
  function sendToParent(event, payload) {
    const z = api();
    if (z && typeof z.sendToParent === 'function') {
      try {
        z.sendToParent('zsnap:parent', { event, ...payload });
        return true;
      } catch (error) {
        console.warn('[snap] 回传父窗口失败', error);
      }
    }
    try {
      window.opener?.postMessage({ type: 'zsnap:parent', payload: { event, ...payload } }, '*');
    } catch {
      // 无父窗口
    }
    return false;
  }

  // 父窗口 → 子窗口（经 preload 中转到 postMessage）
  function onChildMessage(callback) {
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'zsnap:child') callback(data.payload || {});
    });
  }

  // 向子窗口投递消息：先走 preload 的 ipcRenderer.sendTo（定向、可靠），
  // 再退回 webContents.send（渲染进程侧的代理对象，未必真能送达）。
  function sendToChild(windowInstance, payload) {
    if (!windowInstance) return false;
    const contents = windowInstance.webContents;
    const id = (contents && contents.id) || windowInstance.id;
    const bridge = window.zsnap;

    if (bridge && typeof bridge.sendToChild === 'function' && id) {
      try {
        const result = bridge.sendToChild(id, payload);
        if (result && result.ok) return true;
      } catch (error) {
        console.warn('[snap] ipcRenderer.sendTo 投递失败', error);
      }
    }

    try {
      if (contents && typeof contents.send === 'function') {
        contents.send('zsnap:child', payload);
        return true;
      }
    } catch (error) {
      console.warn('[snap] 向子窗口发送失败', error);
    }
    return false;
  }

  // 同一 partition 下所有页面共享 localStorage，作为消息通道的兜底传图方式
  function stashImage(key, dataUrl) {
    try {
      window.localStorage.setItem(key, dataUrl);
      return true;
    } catch (error) {
      console.warn('[snap] 暂存图片失败（可能超出配额）', error);
      return false;
    }
  }

  function takeImage(key) {
    try {
      return window.localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function dropImage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 忽略
    }
  }

  function hideMainWindow() {
    const z = api();
    if (!z) return;
    try {
      // 传 false：不要把焦点还给上一个应用，否则宿主会顶回主窗口压住截图层
      if (typeof z.hideMainWindow === 'function') z.hideMainWindow(false);
    } catch {
      // 忽略
    }
  }

  function showMainWindow() {
    const z = api();
    if (!z) return;
    try {
      if (typeof z.showMainWindow === 'function') z.showMainWindow();
    } catch {
      // 忽略
    }
  }

  function outPlugin() {
    const z = api();
    try {
      if (z && typeof z.outPlugin === 'function') z.outPlugin();
    } catch {
      // 忽略
    }
  }

  function createWindow(url, options, callback) {
    const z = api();
    const create = z && (z.createBrowserWindow || z.createBrowserWindow);
    if (typeof create !== 'function') return null;
    try {
      return create.call(z, url, options, callback);
    } catch (error) {
      console.warn('[snap] 创建窗口失败', error);
      return null;
    }
  }

  window.SNAP = {
    DEFAULTS,
    LANGUAGES,
    api,
    host,
    getSettings,
    saveSettings,
    fileName,
    detectTarget,
    resolveTarget,
    escapeHtml,
    clamp,
    roundRect,
    isDarkTheme,
    notify,
    sendToParent,
    onChildMessage,
    sendToChild,
    stashImage,
    takeImage,
    dropImage,
    hideMainWindow,
    showMainWindow,
    outPlugin,
    createWindow
  };
})();
