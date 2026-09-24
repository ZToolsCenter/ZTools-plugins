/**
 * rmb-capitalized preload.js
 *
 * 桥接：
 *  - 暴露 RMBConverter 到 window（供前端 index.js 复用）
 *  - 监听主搜索 onMainPush，匹配数字 / 千分位时直接给出人民币大写「一条」结果（无第二条、无格式切换）
 *  - 监听插件 onPluginEnter，从 feature 进来的 payload 也走相同复制流程
 *  - 兜底 navigator.clipboard，方便浏览器直接打开文件时调试
 */

const RMBConverter = require('./converter.js');

// 把纯函数暴露给前端
window.RMBConverter = RMBConverter;

/**
 * 复制文本（优先用 ztools API，兜底用 navigator.clipboard）
 */
function copyText(text) {
  let ok = false;
  try {
    if (window.ztools && typeof window.ztools.copyText === 'function') {
      ok = !!window.ztools.copyText(text);
    }
  } catch (e) { /* 忽略 */ }
  if (!ok) {
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { /* 忽略 */ }
  }
  return ok;
}

/**
 * 弹出通知
 * @param {string} text 通知正文（ZTools 的 showNotification 仅暴露 body 参数，
 *   通知标题由 ZTools 根据插件 name 自动拼装，插件无法自定义）
 */
function notify(text) {
  try {
    if (window.ztools && typeof window.ztools.showNotification === 'function') {
      window.ztools.showNotification(text);
    }
  } catch (e) { /* 忽略 */ }
}

/**
 * 隐藏主窗口
 */
function hideWindow() {
  try {
    if (window.ztools && typeof window.ztools.hideMainWindow === 'function') {
      window.ztools.hideMainWindow();
    }
  } catch (e) { /* 忽略 */ }
}

// 内联 SVG 图标（黄底"壹"字），用于主搜索结果项的 icon
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="8" fill="#FFD60A"/>' +
  '<text x="32" y="46" font-family="Microsoft YaHei, PingFang SC, Heiti SC, sans-serif" font-size="46" font-weight="700" text-anchor="middle" fill="#1A1A1A">壹</text>' +
  '</svg>';

const LOGO_DATA_URI = 'data:image/svg+xml;base64,' + Buffer.from(LOGO_SVG).toString('base64');

/**
 * 给主搜索的查询产生结果项（直接匹配：仅返回人民币大写一条结果）
 */
function buildMainPushItems(text) {
  const cleaned = String(text || '').trim();
  if (!RMBConverter.isValidNumber(cleaned)) return [];

  const out = RMBConverter.numberToCapital(cleaned);
  if (!out.result) return [];

  // 直接匹配的语义：数字 / 千分位格式 → 直接转成大写，唯一一条结果，无格式切换、无第二条
  return [
    {
      title: out.result,
      description: '人民币大写 · 点击或回车复制',
      icon: LOGO_DATA_URI,
      value: { kind: 'capital', text: out.result },
    },
  ];
}

/**
 * 从 onMainPush 的选中结果里取出要复制的文本
 */
function pickText(selectData) {
  if (!selectData) return '';
  if (selectData.value && selectData.value.text) return String(selectData.value.text);
  if (typeof selectData.text === 'string') return selectData.text;
  if (typeof selectData.title === 'string') return selectData.title;
  return '';
}

// ---- 主搜索推送 ----
if (window.ztools && typeof window.ztools.onMainPush === 'function') {
  window.ztools.onMainPush(
    function (queryData) {
      const text = queryData && queryData.payload != null ? String(queryData.payload) : '';
      return buildMainPushItems(text);
    },
    function (selectData) {
      const text = pickText(selectData);
      if (!text) return false;
      copyText(text);
      notify('已复制：' + text);
      hideWindow();
      return false; // 复制后直接关闭，不进入插件
    }
  );
}

// ---- 插件进入事件（处理从 feature cmds 进入的情况；正常路径走 onMainPush） ----
if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
  window.ztools.onPluginEnter(function (param) {
    const payload = param && param.payload != null ? String(param.payload).trim() : '';
    if (param && param.type === 'regex' && RMBConverter.isValidNumber(payload)) {
      // 从 feature 进入的数字，直接复制大写结果
      const out = RMBConverter.numberToCapital(payload);
      if (out.result) {
        copyText(out.result);
        notify('已复制：' + out.result);
        hideWindow();
      }
    }
    // 其他情况（关键词进入）由 index.html 自行处理
  });
}
