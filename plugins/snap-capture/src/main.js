/* 轻影截图 · 主进程页面
   负责：入口分发、子窗口生命周期、设置读写。
   截图覆盖层、悬浮窗、结果面板都由这里创建并驱动。 */

(function () {
  'use strict';

  const S = window.SNAP;
  const z = S.api();
  const CH = 'zsnap:parent';
  // 结果面板与主页面同一 partition，用 fixed key 传递待识别图片
  const RESULT_IMAGE_KEY = 'snap-result-img';
  // 系统截图兜底路径下，覆盖层等待的图片
  const NATIVE_IMAGE_KEY = 'snap-native-img';

  const overlay = { child: null, bounds: null };
  // 截图流程进行中：用来挡住 mainHide 引发的「假 PluginOut」
  let captureFlow = false;
  const pins = new Map();
  let pendingImage = '';

  // ───────────────────────── 主题与提示 ─────────────────────────

  function applyTheme() {
    document.body.classList.toggle('light', !S.isDarkTheme());
  }

  let toastTimer = null;

  function toast(text) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = text;
    node.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
  }

  // ───────────────────────── 显示器与几何 ─────────────────────────

  function displayUnderCursor() {
    try {
      const point = z.getCursorScreenPoint ? z.getCursorScreenPoint() : { x: 0, y: 0 };
      const dip = z.screenToDipPoint ? z.screenToDipPoint(point) : point;
      return (z.getDisplayNearestPoint ? z.getDisplayNearestPoint(dip) : null)
        || (z.getPrimaryDisplay ? z.getPrimaryDisplay() : null)
        || { id: 0, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 1 };
    } catch {
      return { id: 0, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 1 };
    }
  }

  function workAreaOf(display) {
    return (display && (display.workArea || display.bounds)) || { x: 0, y: 0, width: 1440, height: 900 };
  }

  function centerBounds(width, height) {
    const area = workAreaOf(displayUnderCursor());
    return {
      x: Math.round(area.x + Math.max(0, (area.width - width) / 2)),
      y: Math.round(area.y + Math.max(0, (area.height - height) / 2)),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function clampToArea(bounds) {
    const area = workAreaOf(displayUnderCursor());
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    return {
      x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function imageSize(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ width: 0, height: 0 });
      image.src = dataUrl;
    });
  }

  // ───────────────────────── 截图覆盖层 ─────────────────────────

  function overlayUrl(options) {
    const url = new URL('overlay.html', window.location.href);
    url.searchParams.set('mode', options.mode || 'screen');
    if (options.mode !== 'image') {
      const display = options.display || displayUnderCursor();
      const bounds = display.bounds || { x: 0, y: 0, width: 1440, height: 900 };
      url.searchParams.set('displayId', String(display.id || 0));
      url.searchParams.set('displayX', String(Math.round(bounds.x)));
      url.searchParams.set('displayY', String(Math.round(bounds.y)));
      url.searchParams.set('displayWidth', String(Math.round(bounds.width)));
      url.searchParams.set('displayHeight', String(Math.round(bounds.height)));
      url.searchParams.set('scaleFactor', String(display.scaleFactor || 1));
    }
    if (options.primeKey) url.searchParams.set('primeKey', options.primeKey);
    if (options.imageKey) url.searchParams.set('imageKey', options.imageKey);
    if (options.waitImage) url.searchParams.set('waitImage', '1');
    if (options.action) url.searchParams.set('action', options.action);
    return url.href;
  }

  function closeOverlay() {
    const child = overlay.child;
    overlay.child = null;
    overlay.bounds = null;
    if (!child) return;
    try {
      child.close?.();
    } catch {
      // 窗口已关闭
    }
  }

  function createOverlayWindow(url, bounds) {
    const child = S.createWindow(url, {
      show: false,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(320, Math.round(bounds.width)),
      height: Math.max(240, Math.round(bounds.height)),
      frame: false,
      transparent: false,
      backgroundColor: '#07080a',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: true,
      title: '截图',
      webPreferences: {
        preload: 'preload.js',
        backgroundThrottling: false,
        zoomFactor: 1
      }
    }, () => {});
    if (!child) return null;
    overlay.child = child;
    overlay.bounds = bounds;
    return child;
  }

  // 覆盖层出现后反复压住主窗口：宿主在部分启动路径下会把主窗口顶回来。
  function showOverlay() {
    const child = overlay.child;
    if (!child) return;
    const bounds = overlay.bounds;
    if (bounds) {
      try {
        // setBounds 是生态里验证过的路径；setContentBounds 作为兜底
        if (typeof child.setBounds === 'function') child.setBounds(bounds);
        else if (typeof child.setContentBounds === 'function') child.setContentBounds(bounds);
      } catch (error) {
        console.warn('[snap] 调整覆盖层尺寸失败', error);
      }
    }
    try {
      if (child.isMinimized?.()) child.restore?.();
      child.show?.();
      child.focus?.();
      child.moveTop?.();
    } catch (error) {
      console.warn('[snap] 显示覆盖层失败', error);
    }

    // 只在覆盖层出现后压住置顶，不再反复调 hideMainWindow：
    // 每次调用都会让宿主触发一次「自动返回搜索」，反而把主窗口顶回最前。
    [0, 90, 260, 620, 1200, 2000].forEach((delay) => {
      setTimeout(() => {
        if (overlay.child !== child) return;
        try {
          child.focus?.();
          child.moveTop?.();
        } catch {
          // 窗口可能已关闭
        }
      }, delay);
    });
  }

  function primeKeyOf() {
    return `snap-prime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // 触发瞬间就抓帧：和窗口创建并行，减少「按了快捷键却没反应」的迟滞感
  async function primeCapture(display, key) {
    try {
      if (!z || typeof z.desktopCaptureSources !== 'function') return;
      await new Promise((resolve) => setTimeout(resolve, 60));
      const scale = display.scaleFactor || 1;
      const bounds = display.bounds || { width: 1440, height: 900 };
      const sources = await z.desktopCaptureSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.max(1, Math.round(bounds.width * scale)),
          height: Math.max(1, Math.round(bounds.height * scale))
        }
      });
      const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
      if (!list.length) return;
      const matched = list.find((item) => String(item.display_id) === String(display.id))
        || list.find((item) => /^screen/i.test(String(item.id || '')))
        || list[0];
      const dataUrl = matched?.thumbnail && typeof matched.thumbnail.toDataURL === 'function'
        ? matched.thumbnail.toDataURL()
        : '';
      if (!dataUrl) return;
      window.localStorage.setItem(key, JSON.stringify({ dataUrl }));
      setTimeout(() => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // 忽略
        }
      }, 8000);
    } catch (error) {
      console.warn('[snap] 预抓帧失败，覆盖层将自行采集', error);
    }
  }

  function startCapture(options = {}) {
    // 不要在这里调 hideMainWindow()：feature 已设 mainHide，
    // 宿主会在 PluginEnter 后自己收起主窗口；再调一次会触发
    // 「自动返回搜索」，把主窗口顶回来压掉覆盖层（dagu-ocr 就是这么失效的）。
    captureFlow = true;
    closeOverlay();

    const display = displayUnderCursor();
    const bounds = display.bounds || { x: 0, y: 0, width: 1440, height: 900 };

    if (!z || typeof z.desktopCaptureSources !== 'function') {
      startNativeCapture(options);
      return;
    }

    const key = primeKeyOf();
    void primeCapture(display, key);
    const child = createOverlayWindow(overlayUrl({
      mode: 'screen',
      display,
      primeKey: key,
      action: options.action
    }), bounds);

    if (!child) {
      startNativeCapture(options);
      return;
    }

    // 不把「能否显示」押在 ready 消息上：sendToParent → postMessage 这条链路
    // 一旦不通，窗口就永远是 show:false 的白窗口。这里无条件补一次。
    setTimeout(() => {
      if (overlay.child === child) showOverlay();
    }, 180);

    setTimeout(() => {
      if (overlay.child === child && !isVisible(child)) {
        console.warn('[snap] 覆盖层未能显示，回退系统截图');
        closeOverlay();
        startNativeCapture(options);
      }
    }, 3500);
  }

  function isVisible(child) {
    try {
      return child.isVisible?.() === true;
    } catch {
      return false;
    }
  }

  // 宿主不支持桌面捕获时，用系统截图兜底，再交给同一个编辑界面
  function startNativeCapture(options = {}) {
    if (!z || typeof z.screenCapture !== 'function') {
      toast('当前环境不支持截图');
      return;
    }
    const bounds = centerBounds(960, 620);
    const child = createOverlayWindow(overlayUrl({
      mode: 'image',
      imageKey: NATIVE_IMAGE_KEY,
      waitImage: true,
      action: options.action
    }), bounds);
    setTimeout(() => {
      try {
        z.screenCapture((dataUrl) => {
          if (!dataUrl) {
            closeOverlay();
            S.showMainWindow();
            toast('已取消截图');
            return;
          }
          // 先落 localStorage 兜底，再走消息通道
          S.stashImage(NATIVE_IMAGE_KEY, dataUrl);
          if (child) S.sendToChild(child, { event: 'image', dataUrl });
        });
      } catch (error) {
        console.warn('[snap] 系统截图失败', error);
        closeOverlay();
      }
    }, 120);
  }

  function openEditorWindow(dataUrl, options = {}) {
    if (!dataUrl) return;
    S.hideMainWindow();
    closeOverlay();
    void imageSize(dataUrl).then((size) => {
      const area = workAreaOf(displayUnderCursor());
      const maxW = Math.round(area.width * 0.86);
      const maxH = Math.round(area.height * 0.84);
      const scale = size.width && size.height
        ? Math.min(1, maxW / size.width, maxH / size.height)
        : 1;
      const width = Math.max(480, Math.round((size.width || 800) * scale) + 2);
      const height = Math.max(320, Math.round((size.height || 600) * scale) + 2);
      pendingImage = dataUrl;
      const child = createOverlayWindow(overlayUrl({
        mode: 'image',
        imageKey: 'snap-image-inline',
        action: options.action
      }), centerBounds(width, height));
      if (!child) {
        toast('无法创建编辑窗口');
        return;
      }
      try {
        window.localStorage.setItem('snap-image-inline', dataUrl);
      } catch (error) {
        console.warn('[snap] 图片缓存失败', error);
      }
      setTimeout(() => {
        try {
          window.localStorage.removeItem('snap-image-inline');
        } catch {
          // 忽略
        }
      }, 8000);
    });
  }

  // ───────────────────────── 悬浮窗 ─────────────────────────

  function pinImageKey(pinId) {
    return `snap-pin-img-${pinId}`;
  }

  function openPinWindow({ dataUrl, bounds }) {
    if (!dataUrl) return;
    void imageSize(dataUrl).then((size) => {
      const area = workAreaOf(displayUnderCursor());
      const maxW = area.width * 0.8;
      const maxH = area.height * 0.8;
      let width = bounds?.width || size.width || 320;
      let height = bounds?.height || size.height || 200;
      if (width > maxW) {
        height *= maxW / width;
        width = maxW;
      }
      if (height > maxH) {
        width *= maxH / height;
        height = maxH;
      }
      width = Math.max(40, Math.round(width));
      height = Math.max(40, Math.round(height));

      const target = clampToArea({
        x: bounds?.x ?? Math.round(area.x + area.width - width - 40),
        y: bounds?.y ?? Math.round(area.y + 60),
        width,
        height
      });

      const pinId = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // 兜底传图：同 partition 下 localStorage 可被子窗口直接读取，
      // 不依赖 sendToParent / webContents.send 这条尚未在真机验证的通道。
      S.stashImage(pinImageKey(pinId), dataUrl);
      const url = new URL('pin.html', window.location.href);
      url.searchParams.set('pinId', pinId);
      const child = S.createWindow(url.href, {
        show: false,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        useContentSize: true,
        frame: false,
        transparent: false,
        backgroundColor: '#0b0d11',
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        alwaysOnTop: true,
        title: '悬浮图片',
        webPreferences: {
          preload: 'preload.js',
          backgroundThrottling: false,
          zoomFactor: 1
        }
      }, () => {});

      if (!child) {
        toast('无法创建悬浮窗口');
        return;
      }
      pins.set(pinId, {
        child,
        dataUrl,
        base: { width: target.width, height: target.height },
        bounds: { ...target },
        zoom: 1,
        opacity: 1
      });
    });
  }

  function applyPinBounds(entry, bounds) {
    entry.bounds = bounds;
    try {
      if (typeof entry.child.setBounds === 'function') entry.child.setBounds(bounds);
      else {
        entry.child.setPosition?.(bounds.x, bounds.y);
        entry.child.setContentSize?.(bounds.width, bounds.height);
      }
    } catch (error) {
      console.warn('[snap] 调整悬浮窗失败', error);
    }
  }

  function revealPin(entry) {
    const child = entry.child;
    [0, 120, 400].forEach((delay) => {
      setTimeout(() => {
        try {
          child.show?.();
          child.focus?.();
          child.moveTop?.();
        } catch {
          // 忽略
        }
      }, delay);
    });
  }

  function handlePinMessage(payload) {
    const entry = pins.get(payload.pinId);
    if (!entry) return;

    if (payload.event === 'pinReady') {
      S.sendToChild(entry.child, { event: 'image', dataUrl: entry.dataUrl });
      revealPin(entry);
      return;
    }
    if (payload.event === 'pinMove') {
      applyPinBounds(entry, {
        ...entry.bounds,
        x: Math.round(payload.x),
        y: Math.round(payload.y)
      });
      return;
    }
    if (payload.event === 'pinZoom') {
      const factor = Number(payload.factor) || 1;
      const zoom = Math.min(4, Math.max(0.1, entry.zoom * factor));
      const width = Math.max(40, Math.round(entry.base.width * zoom));
      const height = Math.max(40, Math.round(entry.base.height * zoom));
      const cx = entry.bounds.x + entry.bounds.width / 2;
      const cy = entry.bounds.y + entry.bounds.height / 2;
      entry.zoom = zoom;
      applyPinBounds(entry, {
        x: Math.round(cx - width / 2),
        y: Math.round(cy - height / 2),
        width,
        height
      });
      return;
    }
    if (payload.event === 'pinOpacity') {
      const next = Math.min(1, Math.max(0.2, entry.opacity + (Number(payload.delta) || 0)));
      entry.opacity = next;
      try {
        entry.child.setOpacity?.(next);
      } catch {
        // 忽略
      }
      return;
    }
    if (payload.event === 'pinClose') {
      try {
        entry.child.close?.();
      } catch {
        // 忽略
      }
      // 清理兜底传图占用，避免 localStorage 堆积到超配额
      S.dropImage(pinImageKey(payload.pinId));
      pins.delete(payload.pinId);
      maybeQuit();
    }
  }

  function maybeQuit() {
    // 所有窗口都关掉后主动退出插件进程，避免残留
    setTimeout(() => {
      if (pins.size > 0 || overlay.child) return;
      S.outPlugin();
    }, 600);
  }

  // ───────────────────────── 结果面板 ─────────────────────────

  function openResultWindow({ dataUrl, mode }) {
    if (!dataUrl) return;
    const area = workAreaOf(displayUnderCursor());
    const width = Math.min(1040, Math.round(area.width * 0.66));
    const height = Math.min(760, Math.round(area.height * 0.78));
    const bounds = centerBounds(width, height);
    const url = new URL('result.html', window.location.href);
    url.searchParams.set('mode', mode === 'translate' ? 'translate' : 'ocr');
    S.stashImage(RESULT_IMAGE_KEY, dataUrl);
    const child = S.createWindow(url.href, {
      show: false,
      x: bounds.x,
      y: bounds.y,
      width,
      height,
      frame: false,
      transparent: false,
      backgroundColor: '#14161a',
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      hasShadow: true,
      title: mode === 'translate' ? '图片翻译' : '文字识别',
      webPreferences: {
        preload: 'preload.js',
        backgroundThrottling: false,
        zoomFactor: 1
      }
    }, () => {});
    if (!child) {
      toast('无法创建结果窗口');
      return;
    }
    pins.set('result-window', { child, dataUrl, kind: 'result' });
    [0, 120, 400].forEach((delay) => {
      setTimeout(() => {
        try {
          child.show?.();
          child.focus?.();
          child.moveTop?.();
        } catch {
          // 忽略
        }
      }, delay);
    });
  }

  // ───────────────────────── 子窗口消息 ─────────────────────────

  function handleChildMessage(payload) {
    const event = payload && payload.event;
    if (!event) return;

    // ── 截图覆盖层 ──
    if (event === 'ready') {
      showOverlay();
      return;
    }
    if (event === 'captureFailed') {
      closeOverlay();
      startNativeCapture({});
      return;
    }
    if (event === 'pin') {
      captureFlow = false;
      closeOverlay();
      openPinWindow(payload);
      return;
    }
    if (event === 'ocr' || event === 'translate') {
      captureFlow = false;
      closeOverlay();
      openResultWindow({ dataUrl: payload.dataUrl, mode: event });
      return;
    }
    if (event === 'closed') {
      captureFlow = false;
      closeOverlay();
      // 不再调 hideMainWindow：它会让宿主「自动返回搜索」把主窗口顶出来。
      // maybeQuit 里的 outPlugin 才是干净的收尾（回到之前的应用）。
      maybeQuit();
      return;
    }

    // ── 结果面板 ──
    if (event === 'resultReady') {
      const entry = pins.get('result-window');
      if (entry && entry.child) {
        S.sendToChild(entry.child, { event: 'image', dataUrl: entry.dataUrl });
      }
      return;
    }
    if (event === 'resultClosed') {
      const entry = pins.get('result-window');
      pins.delete('result-window');
      try {
        entry?.child?.close?.();
      } catch {
        // 忽略
      }
      maybeQuit();
      return;
    }

    // ── 悬浮窗 ──
    if (payload.pinId) handlePinMessage(payload);
  }

  // ───────────────────────── 设置页 ─────────────────────────

  const fields = {};

  const HISTORY_LIMIT_MIN = 10;
  const HISTORY_LIMIT_MAX = 2000;

  function humanBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function historyBridge() {
    const z = window.zsnap;
    return z && typeof z.historyStats === 'function' ? z : null;
  }

  // 把「已存几张 / 占多大 / 上限多少」写进说明行，超出时亮出「按此清理」
  function refreshHistoryStat() {
    if (!fields.historyNote) return;
    const limit = Number(fields.historyLimit && fields.historyLimit.value) || 0;
    const api = historyBridge();
    if (!api) {
      fields.historyNote.textContent = '当前环境读不到历史目录信息。';
      if (fields.historyTrim) fields.historyTrim.hidden = true;
      return;
    }
    let stats = null;
    try {
      stats = api.historyStats();
    } catch {
      stats = null;
    }
    if (!stats) {
      fields.historyNote.textContent = '当前环境读不到历史目录信息。';
      return;
    }

    const over = stats.count > limit;
    const parts = [
      `已存 ${stats.count} 张 · 占用 ${humanBytes(stats.bytes)}`,
      `上限 ${limit} 张${stats.count ? `（按当前大小约 ${humanBytes((stats.bytes / stats.count) * limit)}）` : ''}`
    ];
    if (over) {
      parts.push(`其中 ${stats.count - limit} 张超过上限，现在可以清理，不清理则下次截图时自动删最旧的`);
    } else {
      parts.push('超出上限时自动删最旧的');
    }
    fields.historyNote.textContent = parts.join('，') + '。';
    if (fields.historyTrim) fields.historyTrim.hidden = !over;
  }

  function bindHistoryLimit() {
    fields.historyLimit = document.getElementById('historyLimit');
    fields.historyNote = document.getElementById('history-note');
    fields.historyTrim = document.getElementById('historyTrim');

    const settings = S.getSettings();
    const current = Math.min(
      HISTORY_LIMIT_MAX,
      Math.max(HISTORY_LIMIT_MIN, Number(settings.historyLimit) || 100)
    );
    if (fields.historyLimit) {
      fields.historyLimit.value = String(current);
      fields.historyLimit.addEventListener('change', () => {
        let next = Math.round(Number(fields.historyLimit.value));
        if (!Number.isFinite(next) || next <= 0) next = current;
        next = Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, next));
        fields.historyLimit.value = String(next);
        S.saveSettings({ historyLimit: next });
        refreshHistoryStat();
        toast(`上限已改为 ${next} 张`);
      });
      // 输入过程中也实时刷新，方便看着占用数字调
      fields.historyLimit.addEventListener('input', () => {
        const n = Math.round(Number(fields.historyLimit.value));
        if (Number.isFinite(n) && n >= HISTORY_LIMIT_MIN && n <= HISTORY_LIMIT_MAX) {
          S.saveSettings({ historyLimit: n });
          refreshHistoryStat();
        }
      });
    }

    if (fields.historyTrim) {
      fields.historyTrim.addEventListener('click', () => {
        const limit = Math.min(
          HISTORY_LIMIT_MAX,
          Math.max(HISTORY_LIMIT_MIN, Math.round(Number(fields.historyLimit.value)) || 100)
        );
        const api = historyBridge();
        if (!api || typeof api.trimHistory !== 'function') return;
        const result = api.trimHistory(limit);
        if (result && result.ok) {
          toast(result.removed > 0 ? `已清理 ${result.removed} 张旧图` : '没有需要清理的');
        } else {
          toast('清理失败');
        }
        refreshHistoryStat();
      });
    }

    refreshHistoryStat();
  }

  function bindSettings() {
    fields.saveDir = document.getElementById('saveDir');
    fields.askEveryTime = document.getElementById('askEveryTime');
    fields.fileNamePattern = document.getElementById('fileNamePattern');
    fields.ocrDir = document.getElementById('ocrDir');
    fields.translator = document.getElementById('translator');
    fields.baiduAppId = document.getElementById('baiduAppId');
    fields.baiduKey = document.getElementById('baiduKey');
    fields.targetLang = document.getElementById('targetLang');
    fields.baiduRow = document.getElementById('baidu-row');
    fields.ocrBadge = document.getElementById('ocr-badge');
    fields.ocrNote = document.getElementById('ocr-note');
    fields.transNote = document.getElementById('trans-note');
    fields.historyEnabled = document.getElementById('historyEnabled');

    if (fields.targetLang) {
      fields.targetLang.innerHTML = S.LANGUAGES.map((item) => (
        `<option value="${item.code}">${item.label}</option>`
      )).join('');
    }

    const settings = S.getSettings();
    fields.saveDir.value = settings.saveDir || '';
    fields.fileNamePattern.value = settings.fileNamePattern;
    // ocrDir 是下拉，选项由 refreshOcrStatus 探测后填充，这里不直接赋值
    fields.translator.value = settings.translator;
    fields.baiduAppId.value = settings.baiduAppId || '';
    fields.baiduKey.value = settings.baiduKey || '';
    fields.targetLang.value = settings.targetLang;
    fields.askEveryTime.classList.toggle('on', Boolean(settings.askEveryTime));
    fields.askEveryTime.setAttribute('aria-checked', String(Boolean(settings.askEveryTime)));

    if (fields.historyEnabled) {
      const on = settings.historyEnabled !== false;
      fields.historyEnabled.classList.toggle('on', on);
      fields.historyEnabled.setAttribute('aria-checked', String(on));
      fields.historyEnabled.addEventListener('click', () => {
        const next = !fields.historyEnabled.classList.contains('on');
        fields.historyEnabled.classList.toggle('on', next);
        fields.historyEnabled.setAttribute('aria-checked', String(next));
        S.saveSettings({ historyEnabled: next });
        refreshHistoryStat();
      });
    }

    bindHistoryLimit();

    const openPins = document.getElementById('openPins');
    if (openPins) {
      openPins.addEventListener('click', () => {
        if (window.zsnap && window.zsnap.openBoard) window.zsnap.openBoard('pins');
      });
    }
    const openHistory = document.getElementById('openHistory');
    if (openHistory) {
      openHistory.addEventListener('click', () => {
        if (window.zsnap && window.zsnap.openBoard) window.zsnap.openBoard('history');
      });
    }

    syncTranslatorRows();

    fields.saveDir.addEventListener('change', () => {
      S.saveSettings({ saveDir: fields.saveDir.value.trim() });
    });
    fields.fileNamePattern.addEventListener('change', () => {
      S.saveSettings({ fileNamePattern: fields.fileNamePattern.value.trim() || S.DEFAULTS.fileNamePattern });
    });
    fields.ocrDir.addEventListener('change', () => {
      S.saveSettings({ ocrDir: fields.ocrDir.value.trim() });
      refreshOcrStatus();
    });    fields.translator.addEventListener('change', () => {
      S.saveSettings({ translator: fields.translator.value });
      syncTranslatorRows();
    });
    fields.baiduAppId.addEventListener('change', () => {
      S.saveSettings({ baiduAppId: fields.baiduAppId.value.trim() });
    });
    fields.baiduKey.addEventListener('change', () => {
      S.saveSettings({ baiduKey: fields.baiduKey.value.trim() });
    });
    fields.targetLang.addEventListener('change', () => {
      S.saveSettings({ targetLang: fields.targetLang.value });
    });
    fields.askEveryTime.addEventListener('click', () => {
      const next = !fields.askEveryTime.classList.contains('on');
      fields.askEveryTime.classList.toggle('on', next);
      fields.askEveryTime.setAttribute('aria-checked', String(next));
      S.saveSettings({ askEveryTime: next });
    });

    const pick = document.getElementById('pickDir');
    if (pick) {
      pick.addEventListener('click', () => {
        if (!z || typeof z.showOpenDialog !== 'function') return;
        try {
          const picked = z.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
          const dir = Array.isArray(picked) ? picked[0] : picked;
          if (dir) {
            fields.saveDir.value = dir;
            S.saveSettings({ saveDir: dir });
            toast('保存目录已更新');
          }
        } catch (error) {
          console.warn('[snap] 选择目录失败', error);
        }
      });
    }

    const check = document.getElementById('checkOcr');
    if (check) check.addEventListener('click', refreshOcrStatus);

    const browse = document.getElementById('browseOcr');
    if (browse) {
      browse.addEventListener('click', () => {
        if (!z || typeof z.showOpenDialog !== 'function') {
          toast('当前环境不支持选择目录');
          return;
        }
        try {
          const picked = z.showOpenDialog({ properties: ['openDirectory'] });
          const dir = Array.isArray(picked) ? picked[0] : picked;
          if (!dir) return;
          S.saveSettings({ ocrDir: dir });
          refreshOcrStatus();
          toast('已切换到所选引擎目录');
        } catch (error) {
          console.warn('[snap] 选择 OCR 目录失败', error);
        }
      });
    }

    const testTrans = document.getElementById('testTranslate');
    if (testTrans) {
      testTrans.addEventListener('click', async () => {
        if (!window.zsnap || typeof window.zsnap.testTranslate !== 'function') return;
        testTrans.disabled = true;
        testTrans.textContent = '测试中';
        try {
          const result = await window.zsnap.testTranslate({
            translator: fields.translator ? fields.translator.value : 'microsoft',
            providerId: (S.getSettings().translationProviderId || '').trim(),
            appId: fields.baiduAppId ? fields.baiduAppId.value.trim() : '',
            appKey: fields.baiduKey ? fields.baiduKey.value.trim() : ''
          });
          if (result && result.ok) {
            if (fields.transNote) {
              fields.transNote.textContent = `通道可用（${result.ms}ms）：${result.text.slice(0, 42)}`;
            }
            toast('翻译通道正常');
          } else {
            const reason = (result && result.error) || '未知错误';
            if (fields.transNote) fields.transNote.textContent = '通道不通：' + reason;
            toast('通道不通：' + reason.slice(0, 40));
          }
        } catch (error) {
          if (fields.transNote) fields.transNote.textContent = '测试失败：' + (error.message || error);
        } finally {
          testTrans.disabled = false;
          testTrans.textContent = '测试';
        }
      });
    }

    const ocrProvider = document.getElementById('ocrProvider');
    if (ocrProvider) {
      ocrProvider.addEventListener('change', () => {
        S.saveSettings({ ocrProviderId: ocrProvider.value });
        toast(ocrProvider.value ? '识别渠道已切换' : '识别将跟随 ZTools 默认');
      });
    }

    const transProvider = document.getElementById('translationProvider');
    if (transProvider) {
      transProvider.addEventListener('change', () => {
        S.saveSettings({ translationProviderId: transProvider.value });
        toast(transProvider.value ? '翻译渠道已切换' : '翻译将跟随 ZTools 默认');
      });
    }

    const checkProvider = document.getElementById('checkProvider');
    if (checkProvider) {
      checkProvider.addEventListener('click', async () => {
        checkProvider.disabled = true;
        checkProvider.textContent = '检查中';
        try {
          const info = await refreshProviders();
          const total = ((info && info.ocr) || []).length + ((info && info.translation) || []).length;
          toast(total ? `发现 ${total} 个可用的 ZTools 渠道` : '没发现提供商，用本机兜底');
        } finally {
          checkProvider.disabled = false;
          checkProvider.textContent = '刷新';
        }
      });
    }

    refreshProviders();
    refreshOcrStatus();
  }

  function syncTranslatorRows() {
    if (!fields.baiduRow) return;
    fields.baiduRow.hidden = fields.translator.value !== 'baidu';
  }

  // 列出 ZTools 已装配的识别 / 翻译渠道（f-provider 装了就都在这里）
  async function refreshProviders() {
    const ocrSelect = document.getElementById('ocrProvider');
    const transSelect = document.getElementById('translationProvider');
    const dirRow = document.getElementById('ocr-dir-row');
    const fallbackTrans = document.getElementById('fallback-trans-row');
    const settings = S.getSettings();
    let info = null;
    try {
      info = window.zsnap && window.zsnap.providerList ? await window.zsnap.providerList() : null;
    } catch {
      info = null;
    }

    const fill = (select, list, savedId, autoLabel) => {
      if (!select) return;
      const items = Array.isArray(list) ? list : [];
      const options = items.map((item) => (
        `<option value="${item.id}">${item.label}${item.isDefault ? ' · ZTools 默认' : ''}</option>`
      ));
      options.unshift(`<option value="">${autoLabel}</option>`);
      select.innerHTML = options.join('');
      select.value = items.some((item) => item.id === savedId) ? savedId : '';
      select.disabled = items.length === 0;
    };

    const ocrList = (info && info.ocr) || [];
    const transList = (info && info.translation) || [];
    fill(ocrSelect, ocrList, (settings.ocrProviderId || '').trim(), ocrList.length ? '跟随 ZTools 默认' : '未检测到 OCR 提供商');
    fill(transSelect, transList, (settings.translationProviderId || '').trim(), transList.length ? '跟随 ZTools 默认' : '未检测到翻译提供商');

    // 一个提供商都没有时才露出本机兜底设置
    if (dirRow) dirRow.hidden = ocrList.length > 0;
    if (fallbackTrans) fallbackTrans.hidden = transList.length > 0;

    const note = document.getElementById('provider-note');
    if (note) {
      if (!info || info.supported === false) {
        note.textContent = '当前 ZTools 版本不支持提供商机制，识别走本机微信引擎，翻译走内置免密钥通道。';
      } else if (!ocrList.length && !transList.length) {
        note.textContent = '没检测到任何提供商。装一个 f-provider 插件，微信 OCR、AI 识图、谷歌/微软/百度/有道/AI 翻译就都能直接选。';
      } else {
        const names = [];
        if (ocrList.length) names.push('识别 ' + ocrList.length + ' 个');
        if (transList.length) names.push('翻译 ' + transList.length + ' 个');
        note.textContent = `已接入 ZTools 提供商：${names.join('，')}。识别与翻译都走你在这里选的渠道。`;
      }
    }
    return info;
  }

  // 探测微信 OCR 引擎，填充下拉，并更新右上角状态
  function refreshOcrStatus() {
    const badge = fields.ocrBadge;
    const select = fields.ocrDir;
    const saved = (S.getSettings().ocrDir || '').trim();

    let status = null;
    try {
      status = window.zsnap && window.zsnap.ocrStatus
        ? window.zsnap.ocrStatus(saved || undefined, true)
        : null;
    } catch {
      status = null;
    }

    if (select) {
      const list = (status && status.candidates) || [];
      const options = list.map((item) => {
        const mark = item.ready ? '✓' : '×';
        const tip = item.ready ? '就绪' : (item.binary ? '缺 wco_data' : '无引擎文件');
        return `<option value="${item.dir}">${mark} ${item.dir}（${tip}）</option>`;
      });
      if (saved && !list.some((item) => item.dir === saved)) {
        options.push(`<option value="${saved}">${saved}（手动指定）</option>`);
      }
      if (!options.length) {
        options.push('<option value="">未探测到引擎，点「浏览」指定目录</option>');
      }
      select.innerHTML = options.join('');
      if (saved) select.value = saved;
      else if (status && status.dir) select.value = status.dir;
    }

    if (!badge) return;
    const label = badge.querySelector('span');
    badge.classList.remove('ok', 'warn', 'bad');
    if (status && status.ready) {
      badge.classList.add('ok');
      if (label) label.textContent = '微信 OCR 就绪';
      if (fields.ocrNote) fields.ocrNote.textContent = '引擎：' + status.dir + '（图片不出本机）';
    } else {
      badge.classList.add('bad');
      if (label) label.textContent = '未找到 OCR 引擎';
      if (fields.ocrNote) {
        const found = (status && status.candidates) || [];
        fields.ocrNote.textContent = found.length
          ? `探测到 ${found.length} 个位置但没有可用引擎（需含 build/Release/wechat_ocr.node 与 wco_data/WeChatOCR.exe）。装 f-provider 插件即可自动补齐。`
          : '未探测到微信 OCR 引擎。装 f-provider 插件后点「检测」，或用「浏览」指定 native 目录。';
      }
    }
  }

  // ───────────────────────── 入口 ─────────────────────────

  function readImagePayload(type, payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload) && payload[0]) {
      const first = payload[0];
      const filePath = typeof first === 'string' ? first : first.path;
      if (filePath && window.zsnap) {
        const result = window.zsnap.readImage(filePath);
        return result && result.ok ? result.dataUrl : '';
      }
    }
    return '';
  }

  function onEnter(action) {
    const code = action && action.code;
    const type = action && action.type;
    const payload = action && action.payload;

    if (code === 'capture') {
      startCapture({});
      return;
    }
    if (code === 'capture-save') {
      startCapture({ action: 'save' });
      return;
    }
    if (code === 'capture-pin') {
      startCapture({});
      return;
    }
    if (code === 'pin-image') {
      const dataUrl = readImagePayload(type, payload);
      if (!dataUrl) {
        toast('没有读到图片');
        return;
      }
      S.hideMainWindow();
      openPinWindow({ dataUrl });
      return;
    }
    if (code === 'edit-image') {
      const dataUrl = readImagePayload(type, payload);
      if (!dataUrl) {
        toast('没有读到图片');
        return;
      }
      openEditorWindow(dataUrl);
      return;
    }
    if (code === 'ocr-image') {
      const dataUrl = readImagePayload(type, payload);
      if (!dataUrl) {
        toast('没有读到图片');
        return;
      }
      S.hideMainWindow();
      openResultWindow({ dataUrl, mode: 'ocr' });
    }
  }

  // 署名与版本从 plugin.json 读，界面不另写死
  function fillSign() {
    const meta = (window.zsnap && window.zsnap.version) || {};
    const ver = document.getElementById('ver');
    if (ver && meta.version) ver.textContent = 'v' + meta.version;
    if (meta.author) {
      for (const id of ['sign-author', 'sign-author-foot']) {
        const node = document.getElementById(id);
        if (node) node.textContent = meta.author;
      }
    }
  }

  function boot() {
    applyTheme();
    const mark = document.getElementById('mark');
    if (mark) mark.src = 'logo.png';
    bindSettings();
    fillSign();

    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'zsnap:child') handleChildMessage(data.payload || {});
    });

    if (z && typeof z.onThemeChange === 'function') {
      z.onThemeChange(applyTheme);
    }

    // 截图入口已移到 preload 的 window.exports（mode:'none'），ZTools 触发截图类
    // feature 时根本不会渲染本页；本页只在「设置」下出现，因此不再绑定 PluginEnter。
    // 保留兜底：若宿主仍然派发了 enter 参数，就走一次手动截图。
    const enterParam = window.__ztoolsEnterParam;
    if (enterParam && enterParam.code === 'ui.capture') {
      window.__ztoolsEnterParam = null;
      onEnter(enterParam);
    }
  }

  window.__snapMain = {
    startCapture,
    openPinWindow,
    openResultWindow,
    openEditorWindow,
    state: () => ({ overlay: Boolean(overlay.child), pins: pins.size })
  };

  boot();
})();
