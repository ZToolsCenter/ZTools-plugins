// 插件页面统一窗口尺寸：800×600（4:3，宿主主窗口内容宽度固定 800px），所有主页面一致（截图覆盖层与图片编辑窗口除外）。

export const UNIFIED_PLUGIN_HEIGHT = 600;

function getHost(win) {
  if (typeof win?.ztools?.setExpendHeight === 'function') return win.ztools;
  if (typeof win?.utools?.setExpendHeight === 'function') return win.utools;
  return null;
}

function isBrowserWindow(host) {
  if (typeof host?.getWindowType !== 'function') return false;
  try {
    return host.getWindowType() === 'browser';
  } catch {
    return false;
  }
}

export function createPluginWindowLayoutSync({ win = globalThis.window, height = UNIFIED_PLUGIN_HEIGHT } = {}) {
  const host = getHost(win);
  if (!host || isBrowserWindow(host)) {
    return { schedule() {}, sync() {}, dispose() {} };
  }

  const requestFrame = typeof win?.requestAnimationFrame === 'function'
    ? win.requestAnimationFrame.bind(win)
    : (callback) => setTimeout(callback, 0);
  const cancelFrame = typeof win?.cancelAnimationFrame === 'function'
    ? win.cancelAnimationFrame.bind(win)
    : clearTimeout;
  let frameId = null;
  let applied = false;

  const apply = (force = false) => {
    frameId = null;
    if (applied && !force) return;
    applied = true;
    try {
      Promise.resolve(host.setExpendHeight(height)).catch(() => {});
    } catch {
      // 宿主 API 不可用时忽略，普通浏览器开发环境没有该能力。
    }
  };

  return {
    schedule() {
      if (frameId !== null) return;
      frameId = requestFrame(() => apply());
    },
    sync: () => apply(true),
    dispose() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    }
  };
}
