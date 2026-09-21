// 沉浸式截图覆盖层：冻结画面即画布，就地选区、标注与输出。

import './overlay.css';
import '../theme.css';
import { captureDisplay, hostApi, withTimeout } from './desktop-capture.js';
import { copyImageDataUrl, dataUrlToBlob } from '../clipboard-image.js';
import { readEditorImage } from '../editor-image-handoff.js';
import { readPrimedFrame } from './prime-frame.js';
import { createZtoolsThemeSync } from '../theme.js';
import { createStage } from './stage.js';
import { createSelection } from './selection.js';
import { createAnnotationStore, loadToolSettings, saveToolSettings } from './annotations.js';
import { createTextEditor } from './text-editor.js';
import { createToolController } from './tool-controller.js';
import { createToolbar } from './toolbar.js';
import { selectionSizeLabel } from './geometry.js';

const win = globalThis.window;
const CHANNEL = 'dagu-ocr-editor';
const params = new URLSearchParams(win.location.search);
const mode = params.get('mode') === 'image' ? 'image' : 'screen';
const imageKey = params.get('imageKey') || '';
const inlineImage = params.get('image') || '';
const waitForImage = params.get('waitForImage') === '1';
const returnToInput = params.get('returnInput') === '1';
const primeKey = params.get('primeKey') || '';

const display = {
  id: Number(params.get('displayId')) || 0,
  bounds: {
    x: Number(params.get('displayX')) || 0,
    y: Number(params.get('displayY')) || 0,
    width: Number(params.get('displayWidth')) || win.screen?.width || 1280,
    height: Number(params.get('displayHeight')) || win.screen?.height || 800
  },
  scaleFactor: Number(params.get('scaleFactor')) || 1
};

const state = {
  tool: 'select',
  settings: loadToolSettings(),
  finished: false
};

let stage = null;
let selection = null;
let store = null;
let controller = null;
let toolbar = null;
let textEditor = null;
let hintTimer = null;
let userAdjustedView = false;
let ready = false;

const elements = {
  stage: document.getElementById('capture-stage'),
  mask: document.getElementById('capture-mask'),
  badge: document.getElementById('capture-badge'),
  hint: document.getElementById('capture-hint'),
  toolbarRoot: document.getElementById('capture-toolbar-root'),
  loading: document.getElementById('capture-loading')
};

function host() {
  return hostApi(win);
}

function send(event, payload = {}) {
  const sendToParent = host()?.sendToParent;
  if (typeof sendToParent === 'function') {
    try {
      sendToParent(CHANNEL, { event, ...payload });
      return true;
    } catch (error) {
      console.warn('[capture] 回传父窗口失败:', error);
    }
  }
  try {
    win.opener?.postMessage({ type: 'daguOcrEditorMessage', payload: { event, ...payload } }, '*');
  } catch {
    // 无父窗口时忽略，仅影响开发环境。
  }
  return false;
}

function showHint(message, { sticky = false } = {}) {
  elements.hint.textContent = message || '';
  elements.hint.classList.toggle('visible', Boolean(message));
  if (hintTimer) clearTimeout(hintTimer);
  if (!message || sticky) return;
  hintTimer = setTimeout(() => elements.hint.classList.remove('visible'), 1600);
}

// 把覆盖层关键状态写入系统临时目录，便于在真实客户端定位问题。
function dumpStatus(stage, extra = {}) {
  const writer = win.__daguOcrWriteTextFile;
  if (typeof writer !== 'function') return;
  try {
    writer('dagu-capture-status.json', JSON.stringify({
      stage,
      mode,
      display,
      url: win.location.href,
      viewport: { width: win.innerWidth, height: win.innerHeight, devicePixelRatio: win.devicePixelRatio },
      hasDesktopCapture: typeof host()?.desktopCaptureSources,
      at: new Date().toISOString(),
      ...extra
    }, null, 2));
  } catch {
    // 诊断写入失败不影响主流程。
  }
}

function dumpFailure(reason, error, extra = {}) {
  dumpStatus('failed', {
    reason,
    message: error instanceof Error ? error.message : String(error ?? ''),
    stack: error instanceof Error ? error.stack : '',
    ...extra
  });
}

function timestampName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `截图-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

function currentRect() {
  const rect = selection?.rect;
  if (rect) return rect;
  const size = stage.imageSize();
  return { left: 0, top: 0, width: size.width, height: size.height };
}

function composeImage() {
  const rect = currentRect();
  if (!rect.width || !rect.height) return '';
  return stage.exportDataUrl(rect);
}

function toolbarState() {
  return {
    ...state.settings,
    tool: state.tool,
    canUndo: Boolean(store?.canUndo()),
    canRedo: Boolean(store?.canRedo())
  };
}

function setTool(nextTool) {
  state.tool = nextTool;
  toolbar?.sync(toolbarState());
  const hint = {
    select: '拖动标注对象，Delete 删除',
    shape: '拖拽绘制矩形或椭圆',
    line: '拖拽绘制直线或箭头',
    pen: '按住拖动自由绘制',
    marker: '按住拖动高亮标记',
    mosaic: '拖拽区域添加马赛克',
    text: '点击画面输入文字',
    eraser: '点击标注对象删除'
  }[nextTool];
  if (hint) showHint(hint);
}

function patchSettings(patch) {
  Object.assign(state.settings, patch);
  saveToolSettings(state.settings);
  toolbar?.sync(toolbarState());
}

function syncOverlay() {
  const zoom = stage.zoomScale();
  selection?.setScale(zoom);
  const rect = selection?.rect;
  const width = win.innerWidth;
  const height = win.innerHeight;

  if (!rect) {
    elements.mask.style.left = '0px';
    elements.mask.style.top = '0px';
    elements.mask.style.width = `${width}px`;
    elements.mask.style.height = `${height}px`;
    elements.mask.style.background = mode === 'image' ? 'transparent' : 'rgba(0, 0, 0, .28)';
    elements.mask.style.boxShadow = 'none';
    elements.badge.style.display = 'none';
    if (mode === 'image') {
      // 图片编辑没有截图选区阶段，工具条常驻底部居中。
      toolbar?.show();
      toolbar?.placeBottom({ width, height });
    } else {
      toolbar?.hide();
    }
    return;
  }

  const topLeft = stage.imageToViewport({ x: rect.left, y: rect.top });
  const bottomRight = stage.imageToViewport({ x: rect.left + rect.width, y: rect.top + rect.height });
  const screenRect = {
    left: topLeft.x,
    top: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y)
  };

  elements.mask.style.background = 'transparent';
  elements.mask.style.left = `${screenRect.left}px`;
  elements.mask.style.top = `${screenRect.top}px`;
  elements.mask.style.width = `${screenRect.width}px`;
  elements.mask.style.height = `${screenRect.height}px`;
  elements.mask.style.boxShadow = '0 0 0 9999px rgba(0, 0, 0, .35)';

  elements.badge.textContent = selectionSizeLabel(rect);
  elements.badge.style.display = 'block';
  elements.badge.style.left = `${Math.min(Math.max(0, screenRect.left), Math.max(0, width - 96))}px`;
  elements.badge.style.top = `${Math.max(4, screenRect.top - 28)}px`;

  toolbar?.show();
  toolbar?.place(screenRect, { width, height });
  textEditor?.place();
}

function writeFile(filePath, dataUrl) {
  const writer = win.__daguOcrWriteFile;
  if (typeof writer !== 'function') return false;
  try {
    const base64 = String(dataUrl).split(',')[1] || '';
    return writer(filePath, base64) !== false;
  } catch (error) {
    console.warn('[capture] 写入文件失败:', error);
    return false;
  }
}

function downloadImage(dataUrl) {
  try {
    const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
    const link = document.createElement('a');
    link.href = url;
    link.download = timestampName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showHint('图片已下载');
    return true;
  } catch (error) {
    console.warn('[capture] 下载失败:', error);
    showHint('保存失败');
    return false;
  }
}

function finish() {
  state.finished = true;
  send('closed', { returnInput: returnToInput });
  setTimeout(() => {
    try {
      win.close();
    } catch {
      // 窗口已关闭时忽略。
    }
  }, 120);
}

async function copyImage() {
  const dataUrl = composeImage();
  if (!dataUrl) {
    showHint('没有可复制的内容');
    return;
  }
  if (await copyImageDataUrl(win, dataUrl)) {
    showHint('已复制到剪贴板');
  } else {
    downloadImage(dataUrl);
  }
  finish();
}

function saveImage() {
  const dataUrl = composeImage();
  if (!dataUrl) {
    showHint('没有可保存的内容');
    return;
  }
  const api = host();
  let filePath = '';
  if (typeof api?.showSaveDialog !== 'function') {
    // 浏览器开发环境没有保存对话框，退化为下载。
    downloadImage(dataUrl);
    finish();
    return;
  }
  if (typeof api?.showSaveDialog === 'function') {
    try {
      filePath = api.showSaveDialog({
        title: '保存截图',
        defaultPath: timestampName(),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      }) || '';
    } catch (error) {
      console.warn('[capture] 打开保存对话框失败:', error);
    }
  }
  if (!filePath) {
    showHint('已取消保存');
    return;
  }
  if (writeFile(filePath, dataUrl)) {
    showHint('已保存到文件');
  } else {
    downloadImage(dataUrl);
  }
  finish();
}

function pinImage() {
  const dataUrl = composeImage();
  if (!dataUrl) {
    showHint('没有可固定的内容');
    return;
  }
  // 固定窗口由父窗口创建并驱动尺寸，覆盖层只负责把结果与位置交回。
  const rect = currentRect();
  const topLeft = stage.imageToViewport({ x: rect.left, y: rect.top });
  const scale = stage.zoomScale() || 1;
  send('pinResult', {
    imageUrl: dataUrl,
    bounds: {
      x: Math.round(win.screenX + topLeft.x),
      y: Math.round(win.screenY + topLeft.y),
      width: Math.max(40, Math.round(rect.width * scale)),
      height: Math.max(40, Math.round(rect.height * scale))
    }
  });
  showHint('已固定到屏幕，双击可关闭');
  finish();
}

function sendResult(action) {
  const dataUrl = composeImage();
  if (!dataUrl) {
    showHint('没有可处理的内容');
    return;
  }
  showHint(action === 'ocr' ? '已将图片交给 OCR' : '已将图片交给翻译');
  const delivered = send('result', { action, imageUrl: dataUrl });
  state.finished = true;
  if (!delivered && !win.opener) {
    // 没有宿主父窗口时退化为同窗口跳转，保持浏览器开发环境可用。
    const url = new URL('index.html', win.location.href);
    url.searchParams.set('editorAction', action);
    url.searchParams.set('image', dataUrl);
    win.location.href = url.href;
    return;
  }
  setTimeout(() => {
    try {
      win.close();
    } catch {
      // 窗口已关闭时忽略。
    }
  }, 150);
}

async function handleAction(action) {
  if (!stage) return;
  if (action === 'close') {
    cancel();
  } else if (action === 'undo') {
    await store.undo();
    controller.refreshOverlay();
  } else if (action === 'redo') {
    await store.redo();
    controller.refreshOverlay();
  } else if (action === 'toggle-bold') {
    patchSettings({ fontBold: !state.settings.fontBold });
  } else if (action === 'toggle-italic') {
    patchSettings({ fontItalic: !state.settings.fontItalic });
  } else if (action === 'copy') {
    await copyImage();
  } else if (action === 'save') {
    saveImage();
  } else if (action === 'pin') {
    pinImage();
  } else if (action === 'ocr' || action === 'translate') {
    sendResult(action);
  }
  toolbar?.sync(toolbarState());
}

function cancel() {
  if (state.finished) return;
  state.finished = true;
  send('closed', { returnInput: returnToInput });
  setTimeout(() => {
    try {
      win.close();
    } catch {
      // 窗口已关闭时忽略。
    }
  }, 80);
}

function stepBack() {
  const active = stage?.canvas?.getActiveObject();
  if (active?.isEditing) {
    active.exitEditing();
    return;
  }
  if (selection?.rect) {
    selection.clear();
    syncOverlay();
    showHint('已取消选区');
    return;
  }
  cancel();
}

// 图片模式读取待编辑图片；截图模式采集光标所在显示器。
async function resolveStageImage() {
  if (mode !== 'image') {
    // 主窗口触发时已并行抓帧，优先取用，省掉覆盖层加载完再采集的等待。
    if (primeKey) {
      const primed = await readPrimedFrame({ win, key: primeKey });
      if (primed?.dataUrl) {
        return {
          dataUrl: primed.dataUrl,
          pixelSize: primed.pixelSize || null,
          frameSource: 'primed',
          captureMs: primed.captureMs
        };
      }
    }
    const capture = await withTimeout(captureDisplay(win, display), 4000, '屏幕采集超时');
    return { dataUrl: capture.dataUrl, pixelSize: capture.pixelSize, frameSource: 'overlay' };
  }
  let dataUrl = '';
  if (imageKey) dataUrl = await readEditorImage(imageKey, waitForImage);
  if (!dataUrl) dataUrl = inlineImage;
  if (!dataUrl) throw new Error('缺少待编辑的图片');
  const pixelSize = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
  return { dataUrl, pixelSize };
}

async function initialize() {
  try {
    createZtoolsThemeSync({ win, doc: win.document });
    stage = createStage({ container: elements.stage, fabric: win.fabric });
    stage.setViewportSize(win.innerWidth, win.innerHeight);
    const source = await resolveStageImage();
    dumpStatus('captured', {
      pixelSize: source.pixelSize,
      frameSource: source.frameSource,
      captureMs: source.captureMs,
      frameReadyMs: Math.round(win.performance?.now?.() || 0)
    });
    await stage.setImage(source.dataUrl);
    stage.fit();

    selection = createSelection({ fabric: win.fabric, canvas: stage.canvas });
    selection.attach();
    store = createAnnotationStore({
      canvas: stage.canvas,
      fabric: win.fabric,
      onChange: () => {
        controller?.refreshOverlay();
        toolbar?.sync(toolbarState());
      }
    });
    textEditor = createTextEditor({
      container: elements.stage,
      fabric: win.fabric,
      stage,
      store,
      getSettings: () => state.settings,
      displayScale: display.scaleFactor || 1,
      onCommit: () => {
        controller?.refreshOverlay();
        toolbar?.sync(toolbarState());
      },
      onStatus: (message) => showHint(message)
    });
    controller = createToolController({
      fabric: win.fabric,
      canvas: stage.canvas,
      stage,
      store,
      selection,
      textEditor,
      getSettings: () => state.settings,
      getTool: () => state.tool,
      onStatus: (message) => showHint(message),
      onSelectionChange: () => syncOverlay(),
      onViewAdjusted: () => {
        userAdjustedView = true;
      },
      onRequestCopy: () => handleAction('copy')
    });
    toolbar = createToolbar({
      root: elements.toolbarRoot,
      getSettings: toolbarState,
      onToolChange: setTool,
      onAction: (action) => handleAction(action),
      onSettingsChange: patchSettings
    });
    syncOverlay();
    elements.loading?.remove?.();
    ready = true;
    send('ready', { pixelSize: source.pixelSize });
    showHint(mode === 'image'
      ? '可直接标注，拖拽可框选裁剪范围，滚轮缩放，空格/中键拖动画面'
      : '拖动鼠标框选区域，滚轮缩放，空格/中键拖动画面');
  } catch (error) {
    console.error('[capture] 初始化失败:', error);
    dumpFailure('initialize', error);
    send('captureFailed', { message: error instanceof Error ? error.message : String(error) });
    showHint('屏幕捕获失败，已回退到系统截图');
  }
}

win.addEventListener('keydown', (event) => {
  if (event.code === 'Space') controller?.handleKey(event, true);
  const ctrl = event.ctrlKey || event.metaKey;
  const key = String(event.key || '').toLowerCase();
  if (event.key === 'Escape') {
    stepBack();
  } else if (event.key === 'Enter') {
    handleAction('copy');
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    controller?.deleteSelected();
  } else if (ctrl && key === 'c') {
    handleAction('copy');
  } else if (ctrl && key === 's') {
    handleAction('save');
  } else if (ctrl && key === 'z') {
    handleAction('undo');
  } else if (ctrl && key === 'y') {
    handleAction('redo');
  }
});

win.addEventListener('keyup', (event) => {
  if (event.code === 'Space') controller?.handleKey(event, false);
});

win.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  stepBack();
});

win.addEventListener('beforeunload', () => {
  if (state.finished) return;
  state.finished = true;
  send('closed', { returnInput: returnToInput });
});

win.addEventListener('resize', () => {
  if (!stage) return;
  stage.setViewportSize(win.innerWidth, win.innerHeight);
  // 窗口被系统调整（例如显示时恢复到整屏）后重新适配画面，用户主动缩放后不再干预。
  if (!userAdjustedView) {
    stage.fit();
    selection?.setScale(stage.zoomScale());
  }
  syncOverlay();
});

// 供 E2E 测试与宿主联调使用的只读视图。
win.__captureOverlay = {
  get state() {
    return {
      mode,
      ready,
      tool: state.tool,
      settings: { ...state.settings },
      selection: selection?.rect || null,
      annotations: store ? store.objects.length : 0,
      finished: state.finished
    };
  },
  handleAction: (action) => handleAction(action),
  setSelection: (rect) => {
    selection.set(rect);
    syncOverlay();
  },
  get stage() {
    return stage;
  },
  get store() {
    return store;
  },
  get selection() {
    return selection;
  },
  get toolbar() {
    return toolbar;
  },
  get canvas() {
    return stage?.canvas || null;
  },
  get textEditor() {
    return textEditor;
  },
  get controller() {
    return controller;
  }
};

initialize();
