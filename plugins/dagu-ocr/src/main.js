import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { OCRApp } from './ocr.js';

const win = globalThis.window || globalThis;

function hideMainWindow() {
  if (typeof win?.ztools?.hideMainWindow === 'function') win.ztools.hideMainWindow();
  else if (typeof win?.utools?.hideMainWindow === 'function') win.utools.hideMainWindow();
}

function showMainWindow() {
  if (typeof win?.ztools?.showMainWindow === 'function') win.ztools.showMainWindow();
  else if (typeof win?.utools?.showMainWindow === 'function') win.utools.showMainWindow();
}

function editorUrl(imageUrl, options = {}) {
  const url = new URL('annotate.html', window.location.href);
  let stored = false;
  try {
    const key = `dagu-ocr-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(key, imageUrl);
    url.searchParams.set('editorKey', key);
    stored = true;
  } catch {
    // Fall back to the URL when localStorage is unavailable.
  }
  if (!stored) url.searchParams.set('image', imageUrl);
  if (options.fromScreenshot) url.searchParams.set('screenshotFlow', '1');
  if (options.returnInput) url.searchParams.set('returnInput', '1');
  return url.href;
}

let editorWindow = null;

function fallbackNavigateToEditor(imageUrl, options = {}) {
  const url = editorUrl(imageUrl, options);
  window.location.href = url;
}

function editorWindowSize(imageUrl) {
  return new Promise((resolve) => {
    const fallback = { width: 960, height: 640 };
    const image = new Image();
    image.onload = () => resolve({
      width: Math.min(Math.max(image.naturalWidth + 24, 860), 1400),
      height: Math.min(Math.max(image.naturalHeight + 80, 640), 900)
    });
    image.onerror = () => resolve(fallback);
    image.src = imageUrl;
  });
}

async function openEditorWindow(imageUrl, options = {}) {
  const createWindow = win?.ztools?.createBrowserWindow || win?.utools?.createBrowserWindow;
  if (typeof createWindow !== 'function') {
    fallbackNavigateToEditor(imageUrl, options);
    return;
  }

  hideMainWindow();
  const size = await editorWindowSize(imageUrl);
  const url = editorUrl(imageUrl, options);
  let child;

  try {
    child = createWindow(url, {
      show: true,
      width: size.width,
      height: size.height,
      minWidth: 860,
      minHeight: 640,
      frame: false,
      title: options.fromScreenshot ? '截图编辑' : '图片编辑',
      resizable: true,
      center: true,
      autoHideMenuBar: true,
      backgroundColor: '#f4f7f5',
      skipTaskbar: false,
      alwaysOnTop: true,
      webPreferences: { preload: 'preload.js' }
    }, () => {
      child?.show?.();
      child?.focus?.();
    });
    editorWindow = child;
    child?.show?.();
    child?.focus?.();
    child?.on?.('closed', () => {
      if (editorWindow !== child) return;
      editorWindow = null;
      if (options.returnInput) showMainWindow();
      else controller?.exitPlugin?.();
    });
  } catch (error) {
    editorWindow = null;
    console.warn('创建编辑窗口失败:', error);
    showMainWindow();
    fallbackNavigateToEditor(imageUrl, options);
  }
}

let controller;

function startScreenshotFlow() {
  hideMainWindow();
  controller.showStatus('正在唤起截图功能...');
  setTimeout(() => {
    controller.captureScreen((imageUrl) => {
      if (!imageUrl) {
        showMainWindow();
        controller.showStatus('已取消截图');
        return;
      }
      openEditorWindow(imageUrl, { fromScreenshot: true });
    });
  }, 300);
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
    const message = data.payload || {};
    if (message.event === 'result' && message.imageUrl) {
      showMainWindow();
      void controller.handleEditedImage(message.imageUrl, message.action || 'ocr');
    } else if (message.event === 'closed') {
      if (editorWindow && typeof editorWindow.close === 'function') {
        try { editorWindow.close(); } catch { /* 已关闭时忽略 */ }
      }
      editorWindow = null;
      if (message.returnInput || message.returnToInput) showMainWindow();
      else controller.exitPlugin();
    }
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
