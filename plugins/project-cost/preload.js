/**
 * ZTools 插件 preload —— 以 Node 上下文运行。
 * 本插件全部业务在渲染进程内完成（localStorage + 纯前端计算），
 * 这里只暴露宿主环境信息，供页面做「是否在 ZTools 内运行」的判断与降级。
 * 规范：不压缩、不混淆，保持清晰可读。
 */
(function () {
  const api = {
    appName: typeof window.ztools?.getAppName === 'function' ? window.ztools.getAppName() : 'browser',
    platform: process.platform,
    versions: {
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
      node: process.versions.node || '',
    },
    /** 让窗口高度贴合台账视图（680 以内，避免超出小屏） */
    fit: function (height) {
      try {
        if (window.ztools?.setExpendHeight) {
          window.ztools.setExpendHeight(Math.min(Math.max(+height || 618, 360), 680));
        }
      } catch (e) {
        /* 浏览器里预览时忽略 */
      }
    },
    toast: function (msg) {
      try {
        window.ztools?.showToast?.(String(msg));
      } catch (e) {
        /* 忽略 */
      }
    },
  };

  try {
    if (typeof window !== 'undefined' && window.contextBridge
      && typeof window.contextBridge.exposeInMainWorld === 'function') {
      window.contextBridge.exposeInMainWorld('renovationApi', api);
      return;
    }
  } catch (e) {
    /* 落到下方兜底 */
  }
  try {
    window.renovationApi = api;
  } catch (e) {
    /* 极端情况下 window 不可写，放弃暴露 */
  }
})();
