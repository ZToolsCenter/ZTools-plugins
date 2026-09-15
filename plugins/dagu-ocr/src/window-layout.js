function finiteHeight(value) {
  return Number.isFinite(value) ? Math.ceil(value) : 0;
}

export function measurePluginHeight({ root, doc } = {}) {
  const rootHeight = finiteHeight(root?.scrollHeight);
  if (rootHeight) return rootHeight;

  return Math.max(
    finiteHeight(doc?.documentElement?.scrollHeight),
    finiteHeight(doc?.body?.scrollHeight)
  );
}

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

export function createPluginWindowLayoutSync({ win = globalThis.window, doc = win?.document, root } = {}) {
  const host = getHost(win);
  const target = root || doc?.querySelector?.('.app-shell') || doc?.getElementById?.('app');
  if (!host || !target || isBrowserWindow(host)) {
    return {
      schedule() {},
      sync() {},
      dispose() {}
    };
  }

  const requestFrame = typeof win?.requestAnimationFrame === 'function'
    ? win.requestAnimationFrame.bind(win)
    : (callback) => setTimeout(callback, 0);
  const cancelFrame = typeof win?.cancelAnimationFrame === 'function'
    ? win.cancelAnimationFrame.bind(win)
    : clearTimeout;
  let frameId = null;
  let forcePending = false;
  let lastHeight = 0;
  let disposed = false;

  const syncNow = (force = false) => {
    frameId = null;
    if (disposed) return;

    const height = measurePluginHeight({
      root: target,
      doc
    });
    if (!height || (!force && height === lastHeight)) return;

    lastHeight = height;
    try {
      Promise.resolve(host.setExpendHeight(height)).catch(() => {});
    } catch {
      // Host APIs are optional when the plugin runs in a normal browser.
    }
  };

  const schedule = (force = false) => {
    if (disposed) return;
    forcePending = forcePending || force;
    if (frameId !== null) return;
    frameId = requestFrame(() => {
      const shouldForce = forcePending;
      forcePending = false;
      syncNow(shouldForce);
    });
  };

  const onResize = () => schedule();
  win?.addEventListener?.('resize', onResize);

  const Observer = win?.ResizeObserver || globalThis.ResizeObserver;
  const observer = typeof Observer === 'function' ? new Observer(() => schedule()) : null;
  observer?.observe(target);

  return {
    schedule,
    sync: () => syncNow(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) cancelFrame(frameId);
      observer?.disconnect();
      win?.removeEventListener?.('resize', onResize);
    }
  };
}
