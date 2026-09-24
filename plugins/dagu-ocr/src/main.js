import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { OCRApp } from './ocr.js';
import { pngSizeFromDataUrl } from './image-size.js';
import { displayUnderCursor, isDesktopCaptureSupported } from './capture/desktop-capture.js';
import { createPrimeKey, primeCaptureFrame } from './capture/prime-frame.js';

const win = globalThis.window || globalThis;
const EDITOR_PAGE = 'overlay.html';

function hideMainWindow() {
  if (typeof win?.ztools?.hideMainWindow === 'function') win.ztools.hideMainWindow();
  else if (typeof win?.utools?.hideMainWindow === 'function') win.utools.hideMainWindow();
}

function showMainWindow() {
  if (typeof win?.ztools?.showMainWindow === 'function') win.ztools.showMainWindow();
  else if (typeof win?.utools?.showMainWindow === 'function') win.utools.showMainWindow();
}

let controller;

// ── 覆盖层窗口：截图与图片编辑共用同一套窗口生命周期 ──
let activeOverlay = null;
const pinWindows = new Map();

function editorWindowSize(imageUrl) {
  const clamp = (width, height) => ({
    width: Math.min(Math.max(width + 24, 860), 1400),
    height: Math.min(Math.max(height + 80, 640), 900)
  });
  const pngSize = pngSizeFromDataUrl(imageUrl);
  if (pngSize) return Promise.resolve(clamp(pngSize.width, pngSize.height));

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(clamp(image.naturalWidth, image.naturalHeight));
    image.onerror = () => resolve({ width: 960, height: 640 });
    image.src = imageUrl;
  });
}

function centeredBounds(size) {
  const display = displayUnderCursor(win);
  const area = display?.workArea || display?.bounds || { x: 0, y: 0, width: 1280, height: 800 };
  return {
    x: Math.round(area.x + Math.max(0, (area.width - size.width) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - size.height) / 2)),
    width: Math.round(size.width),
    height: Math.round(size.height)
  };
}

function editorKey() {
  return `dagu-ocr-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function overlayUrl(options = {}) {
  const url = new URL(EDITOR_PAGE, window.location.href);
  const mode = options.mode === 'image' ? 'image' : 'screen';
  url.searchParams.set('mode', mode);
  if (mode === 'screen') {
    const display = options.display;
    url.searchParams.set('displayId', String(display?.id ?? ''));
    url.searchParams.set('displayX', String(Math.round(display?.bounds?.x || 0)));
    url.searchParams.set('displayY', String(Math.round(display?.bounds?.y || 0)));
    url.searchParams.set('displayWidth', String(Math.round(display?.bounds?.width || 0)));
    url.searchParams.set('displayHeight', String(Math.round(display?.bounds?.height || 0)));
    url.searchParams.set('scaleFactor', String(display?.scaleFactor || 1));
  }
  if (options.imageKey) url.searchParams.set('imageKey', options.imageKey);
  if (options.image) url.searchParams.set('image', options.image);
  if (options.primeKey) url.searchParams.set('primeKey', options.primeKey);
  if (options.waitForImage) url.searchParams.set('waitForImage', '1');
  if (options.returnInput) url.searchParams.set('returnInput', '1');
  return url.href;
}

function overlayWindowOptions(bounds, show = false) {
  const area = bounds || { x: 0, y: 0, width: 1280, height: 800 };
  return {
    show,
    x: Math.round(area.x),
    y: Math.round(area.y),
    width: Math.max(320, Math.round(area.width)),
    height: Math.max(240, Math.round(area.height)),
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
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
      backgroundThrottling: false
    }
  };
}

function createOverlayWindow({ url, bounds, fallback = null }) {
  const createWindow = win?.ztools?.createBrowserWindow || win?.utools?.createBrowserWindow;
  if (typeof createWindow !== 'function') return null;
  let child = null;
  try {
    child = createWindow(url, overlayWindowOptions(bounds), () => {});
  } catch (error) {
    console.warn('创建覆盖层窗口失败:', error);
  }
  if (!child) return null;
  activeOverlay = { child, bounds, fallback };
  return child;
}

function closeOverlayWindow() {
  const child = activeOverlay?.child;
  activeOverlay = null;
  if (!child) return;
  try {
    child.close?.();
  } catch {
    // 窗口已关闭时忽略。
  }
}

function overlayVisible() {
  try {
    return activeOverlay?.child?.isVisible?.() === true;
  } catch {
    return false;
  }
}

// 宿主偶尔不会立即呈现新建窗口，按生态插件做法主动补偿一次。
function ensureOverlayVisible() {
  const child = activeOverlay?.child;
  if (!child) return;
  try {
    if (child.isMinimized?.()) child.restore?.();
    if (!overlayVisible()) child.show?.();
    child.focus?.();
    child.moveTop?.();
  } catch (error) {
    console.warn('显示覆盖层失败:', error);
  }
}

// Windows 会把新建窗口压到工作区尺寸，显示前再强制一次目标边界。
function showOverlayWindow() {
  const { child, bounds, fallback } = activeOverlay || {};
  if (!child) return;
  if (bounds) {
    try {
      child.setBounds?.({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      });
    } catch (error) {
      console.warn('调整覆盖层窗口尺寸失败:', error);
    }
  }
  [0, 150, 450].forEach((delay) => setTimeout(ensureOverlayVisible, delay));
  setTimeout(() => {
    if (!activeOverlay || overlayVisible()) return;
    console.warn('覆盖层窗口未能显示，执行回退');
    closeOverlayWindow();
    if (typeof fallback === 'function') fallback();
  }, 1200);
}

// ── 固定到屏幕：父窗口负责创建并驱动置顶图片窗口 ──
function nextPinId() {
  return `pin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openPinWindow({ imageUrl, bounds }) {
  const createWindow = win?.ztools?.createBrowserWindow || win?.utools?.createBrowserWindow;
  if (typeof createWindow !== 'function' || !imageUrl || !bounds) return false;
  const pinId = nextPinId();
  const key = `dagu-ocr-pin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    window.localStorage.setItem(key, imageUrl);
  } catch (error) {
    console.warn('固定图片缓存失败:', error);
  }
  const width = Math.max(40, Math.round(bounds.width));
  const height = Math.max(40, Math.round(bounds.height));
  const position = { x: Math.round(bounds.x), y: Math.round(bounds.y) };
  const url = new URL('pin.html', window.location.href);
  url.searchParams.set('pinId', pinId);
  url.searchParams.set('pinKey', key);

  let child = null;
  try {
    child = createWindow(url.href, {
      show: true,
      ...position,
      width,
      height,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: '固定截图',
      webPreferences: {
        preload: 'preload.js',
        backgroundThrottling: false
      }
    }, () => {});
  } catch (error) {
    console.warn('创建固定窗口失败:', error);
  }
  if (!child) return false;

  pinWindows.set(pinId, {
    child,
    base: { width, height },
    zoom: 1,
    bounds: { ...position, width, height }
  });
  return true;
}

function applyPinBounds(entry, nextBounds) {
  entry.bounds = nextBounds;
  try {
    entry.child?.setBounds?.(nextBounds);
  } catch (error) {
    console.warn('调整固定窗口失败:', error);
  }
}

function handlePinMessage(message) {
  const entry = pinWindows.get(message.pinId);
  if (!entry) return;
  if (message.event === 'pinMove') {
    applyPinBounds(entry, {
      ...entry.bounds,
      x: Math.round(Number(message.x) || 0),
      y: Math.round(Number(message.y) || 0)
    });
    return;
  }
  if (message.event === 'pinZoom') {
    const factor = Number(message.factor) || 1;
    const zoom = Math.min(4, Math.max(0.1, entry.zoom * factor));
    const width = Math.max(24, Math.round(entry.base.width * zoom));
    const height = Math.max(24, Math.round(entry.base.height * zoom));
    const anchorX = Number(message.anchorX) || entry.bounds.x + entry.bounds.width / 2;
    const anchorY = Number(message.anchorY) || entry.bounds.y + entry.bounds.height / 2;
    const ratioX = (anchorX - entry.bounds.x) / Math.max(1, entry.bounds.width);
    const ratioY = (anchorY - entry.bounds.y) / Math.max(1, entry.bounds.height);
    entry.zoom = zoom;
    applyPinBounds(entry, {
      x: Math.round(anchorX - ratioX * width),
      y: Math.round(anchorY - ratioY * height),
      width,
      height
    });
    return;
  }
  if (message.event === 'pinClose') {
    try {
      entry.child?.close?.();
    } catch {
      // 窗口已关闭时忽略。
    }
    pinWindows.delete(message.pinId);
  }
}

// ── 截图：沉浸式覆盖层直接在全屏冻结画面上框选、标注 ──
function startScreenshotFlow() {
  hideMainWindow();
  controller.showStatus('正在准备截图...');
  closeOverlayWindow();

  if (!isDesktopCaptureSupported(win)) {
    startNativeScreenshotFlow();
    return;
  }

  const display = displayUnderCursor(win);
  const bounds = display?.bounds || { x: 0, y: 0, width: 1280, height: 800 };
  // 抓帧与覆盖层窗口创建并行：窗口加载完成时画面通常已就绪，不再等第二轮采集。
  const primeKey = createPrimeKey();
  void primeCaptureFrame({ win, display, key: primeKey });
  const child = createOverlayWindow({
    url: overlayUrl({ mode: 'screen', display, primeKey }),
    bounds,
    fallback: () => startNativeScreenshotFlow()
  });
  if (!child) startNativeScreenshotFlow();
}

// 宿主不支持桌面捕获时退回系统截图：先准备编辑窗口，再把截图写进去。
function startNativeScreenshotFlow() {
  hideMainWindow();
  controller.showStatus('正在唤起截图功能...');
  const key = editorKey();
  const pending = createOverlayWindow({
    url: overlayUrl({ mode: 'image', imageKey: key, waitForImage: true }),
    bounds: centeredBounds({ width: 960, height: 640 })
  });
  setTimeout(() => {
    controller.captureScreen((imageUrl) => {
      if (!imageUrl) {
        closeOverlayWindow();
        showMainWindow();
        controller.showStatus('已取消截图');
        return;
      }
      void publishEditorImage(imageUrl, key, pending);
    });
  }, 80);
}

async function publishEditorImage(imageUrl, key, child) {
  if (!child) {
    void openEditorWindow(imageUrl);
    return;
  }
  const size = await editorWindowSize(imageUrl);
  const bounds = centeredBounds(size);
  try {
    window.localStorage.setItem(key, imageUrl);
  } catch (error) {
    console.warn('编辑图片缓存失败:', error);
  }
  if (activeOverlay?.child === child) {
    activeOverlay.bounds = bounds;
    try {
      child.setBounds?.(bounds);
    } catch {
      // 窗口可能已关闭，交由 ready 回调处理。
    }
  }
}

// ── 编辑图片：与截图共用同一覆盖层，图片模式直接呈现待编辑图片 ──
async function openEditorWindow(imageUrl, options = {}) {
  if (!imageUrl) {
    controller?.showStatus?.('请先选择图片');
    return false;
  }
  hideMainWindow();
  closeOverlayWindow();

  const size = await editorWindowSize(imageUrl);
  const key = editorKey();
  let stored = false;
  try {
    window.localStorage.setItem(key, imageUrl);
    stored = true;
  } catch {
    // 存储不可用时退化为 URL 传递。
  }
  const url = overlayUrl({
    mode: 'image',
    imageKey: stored ? key : '',
    image: stored ? '' : imageUrl,
    returnInput: Boolean(options.returnInput)
  });
  const child = createOverlayWindow({
    url,
    bounds: centeredBounds(size),
    fallback: () => {
      showMainWindow();
      window.location.href = url;
    }
  });
  if (!child) {
    showMainWindow();
    window.location.href = url;
    return false;
  }
  return true;
}

function handleEditorMessage(message) {
  if (message.source === 'pin') {
    handlePinMessage(message);
    return true;
  }
  if (message.event === 'ready') {
    showOverlayWindow();
    controller?.showStatus?.('');
    return true;
  }
  if (message.event === 'captureFailed') {
    closeOverlayWindow();
    startNativeScreenshotFlow();
    return true;
  }
  if (message.event === 'pinResult' && message.imageUrl) {
    openPinWindow(message);
    return true;
  }
  if (message.event === 'result' && message.imageUrl) {
    showMainWindow();
    closeOverlayWindow();
    void controller.handleEditedImage(message.imageUrl, message.action || 'ocr');
    return true;
  }
  if (message.event === 'closed') {
    closeOverlayWindow();
    if (message.returnInput || message.returnToInput) showMainWindow();
    else controller.exitPlugin();
    return true;
  }
  return false;
}

controller = new OCRApp({
  win,
  onScreenshotRequest: startScreenshotFlow,
  onEditRequest: openEditorWindow
});
win.app = controller;

function handlePluginEnter(param) {
  return controller.onPluginEnter(param);
}

if (win?.ztools && typeof win.ztools.onPluginEnter === 'function') {
  win.ztools.onPluginEnter(handlePluginEnter);
} else if (win?.utools && typeof win.utools.onPluginEnter === 'function') {
  win.utools.onPluginEnter(handlePluginEnter);
}

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'daguOcrEditorMessage') {
    handleEditorMessage(data.payload || {});
    return;
  }
  if (data.type === 'annotateAction' && data.imageUrl) {
    showMainWindow();
    void controller.handleEditedImage(data.imageUrl, data.action);
    return;
  }
  if (data.type === 'imageEdited' && data.imageUrl) {
    showMainWindow();
    void controller.handleEditedImage(data.imageUrl, 'ocr');
  }
});

const mount = document.getElementById('app');
if (mount) createApp(App, { controller }).mount(mount);
controller.bindEvents();

async function bootstrap() {
  try {
    await controller.initialize();
    const params = new URLSearchParams(window.location.search);
    const editorAction = params.get('editorAction');
    const editorImage = params.get('image');
    if (editorAction && editorImage) {
      await controller.handleEditedImage(editorImage, editorAction);
      return;
    }

    if (win.__ztoolsEnterParam) {
      const param = win.__ztoolsEnterParam;
      win.__ztoolsEnterParam = null;
      await controller.onPluginEnter(param);
    }
  } catch (error) {
    controller.showStatus(`初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void bootstrap();
