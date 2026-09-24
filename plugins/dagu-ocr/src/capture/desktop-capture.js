// 冻结屏幕采集：通过 ZTools 桌面捕获源拿到光标所在显示器的原始分辨率截图。

export function hostApi(win = globalThis.window) {
  return win?.ztools || win?.utools || null;
}

// 采集/加载等异步步骤的超时包装，避免宿主无响应时窗口悬挂。
export function withTimeout(promise, ms, message = '操作超时') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function isDesktopCaptureSupported(win = globalThis.window) {
  const host = hostApi(win);
  return typeof host?.desktopCaptureSources === 'function'
    && typeof host?.getCursorScreenPoint === 'function';
}

export function displayUnderCursor(win = globalThis.window) {
  const host = hostApi(win);
  const fallback = {
    id: 0,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1
  };
  if (!host) return fallback;
  const safeCall = (callback) => {
    try {
      const result = callback();
      return result instanceof Error ? null : result;
    } catch (error) {
      console.warn('[capture] 显示器查询失败:', error);
      return null;
    }
  };
  try {
    const screenPoint = safeCall(() => host.getCursorScreenPoint?.()) || { x: 0, y: 0 };
    const dipPoint = safeCall(() => host.screenToDipPoint?.(screenPoint)) || screenPoint;
    const nearest = normalizeDisplay(safeCall(() => host.getDisplayNearestPoint?.(dipPoint)));
    if (nearest) return nearest;
    const primary = normalizeDisplay(safeCall(() => host.getPrimaryDisplay?.()));
    return primary || fallback;
  } catch (error) {
    console.warn('[capture] 获取显示器信息失败:', error);
    return fallback;
  }
}

function normalizeDisplay(display) {
  if (!display || typeof display !== 'object') return null;
  const bounds = display.bounds || {};
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
  return display;
}

export function displayPixelSize(display) {
  const bounds = display?.bounds || {};
  const scaleFactor = display?.scaleFactor || 1;
  return {
    width: Math.max(1, Math.round((bounds.width || 0) * scaleFactor)),
    height: Math.max(1, Math.round((bounds.height || 0) * scaleFactor))
  };
}

export function pickSourceForDisplay(sources, display) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!list.length) return null;
  const displayId = display?.id;
  if (displayId !== undefined && displayId !== null) {
    const matched = list.find((source) => String(source.display_id) === String(displayId));
    if (matched) return matched;
  }
  return list.find((source) => /^screen/i.test(String(source.id || ''))) || list[0];
}

// 返回原始分辨率截图（image 像素与显示器物理像素一致）。
export async function captureDisplay(win, display) {
  const host = hostApi(win);
  if (typeof host?.desktopCaptureSources !== 'function') {
    throw new Error('当前环境不支持屏幕捕获');
  }
  const requested = displayPixelSize(display);
  const sources = await host.desktopCaptureSources({ types: ['screen'], thumbnailSize: requested });
  const source = pickSourceForDisplay(sources, display);
  const thumbnail = source?.thumbnail;
  const dataUrl = typeof thumbnail?.toDataURL === 'function' ? thumbnail.toDataURL() : '';
  if (!dataUrl) throw new Error('未获取到屏幕截图');
  const size = typeof thumbnail?.getSize === 'function' ? thumbnail.getSize() : requested;
  return {
    dataUrl,
    display,
    pixelSize: {
      width: size?.width || requested.width,
      height: size?.height || requested.height
    }
  };
}
