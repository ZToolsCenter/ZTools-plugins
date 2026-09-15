/**
 * 截图标注 — 基于 tui-image-editor (fabric.js)
 * 支持: 选择拖拽, 矩形, 箭头, 文字, 马赛克, 撤销/重做, 清空, 复制
 */
// Load tui CSS (Vite strips <link> tags for non-module CSS, so load dynamically)
(function() {
  ['tui-color-picker.min.css', 'tui-image-editor.min.css'].forEach(function(file) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './assets/' + file;
    document.head.appendChild(link);
  });
})();
let imageEditor = null;
let annotationInProgress = false;
let isMosaicMode = false;
let mosaicStart = null;
let mosaicScreenStart = null;
let activeMode = 'select';
let currentColor = '#ff4d4f'; // 默认标注颜色
let currentLineWidth = 3; // 默认线条宽度
let currentFontSize = 28; // 默认字体大小
let originalImageInfo = null; // 保存原始图片信息
const win = globalThis.window;

function showStatus(message) {
  const status = document.getElementById('status');
  if (status) status.textContent = message;
}
// ── Mode detection ──
const editorParams = new URLSearchParams(window.location.search);
const editorKey = editorParams.get('editorKey');
let storedEditorImage = '';
if (editorKey) {
  try {
    storedEditorImage = window.localStorage.getItem(editorKey) || '';
    window.localStorage.removeItem(editorKey);
  } catch {
    // Ignore storage failures and use the URL fallback.
  }
}
const standaloneImage = editorParams.get('image') || storedEditorImage;
const isStandalone = !!standaloneImage;
const returnToInput = editorParams.get('returnInput') === '1';
const screenshotFlow = editorParams.get('screenshotFlow') === '1';
const editorChannel = 'dagu-ocr-editor';

function isChildWindow() {
  if (window.opener) return true;
  const host = win?.ztools || win?.utools;
  try {
    return host?.getWindowType?.() === 'browser';
  } catch {
    return false;
  }
}

function sendEditorMessage(event, payload = {}) {
  const sendToParent = win?.ztools?.sendToParent || win?.utools?.sendToParent;
  if (typeof sendToParent !== 'function') return false;
  try {
    sendToParent(editorChannel, { event, ...payload });
    return true;
  } catch (error) {
    console.warn('[annotate] 回传父窗口失败:', error);
    return false;
  }
}

function navigateToMain(action, imageUrl) {
  const url = new URL('index.html', window.location.href);
  if (action) url.searchParams.set('editorAction', action);
  if (imageUrl) url.searchParams.set('image', imageUrl);
  window.location.href = url.href;
}

function hasPluginExitApi() {
  return typeof win?.ztools?.outPlugin === 'function'
    || typeof win?.utools?.hideMainWindow === 'function';
}

function leaveEditor() {
  const notified = isChildWindow() ? sendEditorMessage('closed', { returnToInput }) : false;
  if (notified || isChildWindow() || window.opener) {
    // 子窗口必须始终自关：通知父窗口失败也不能把窗口留在屏幕上。
    setTimeout(() => window.close(), notified ? 150 : 0);
    return;
  }
  if (isStandalone && !hasPluginExitApi()) {
    navigateToMain();
    return;
  }
  exitPlugin();
}

function finishEditorCopy(dataURL) {
  showStatus('已复制到剪贴板');
  if (returnToInput) {
    if (sendEditorMessage('result', { action: 'ocr', imageUrl: dataURL })) {
      setTimeout(() => window.close(), 300);
      return;
    }
    if (window.opener) {
      window.opener.postMessage({
        type: 'imageEdited',
        imageUrl: dataURL
      }, '*');
      setTimeout(() => window.close(), 300);
    } else {
      navigateToMain('ocr', dataURL);
    }
    return;
  }
  setTimeout(leaveEditor, 300);
}
// ── DOM refs ──
const $ = (id) => document.getElementById(id);
const editorContainer = $('editor-container');
const viewer = $('viewer') || editorContainer;
const loadingEl = $('loading');
const dialogOverlay = $('dialog-overlay');
const dialogTitle = $('dialog-title');
const dialogInput = $('dialog-input');
const dialogInputWrapper = $('dialog-input-wrapper');
const dialogConfirm = $('dialog-confirm');
const dialogCancel = $('dialog-cancel');
const btnSelect = $('btn-select');
const btnRect = $('btn-rect');
const btnArrow = $('btn-arrow');
const btnText = $('btn-text');
const btnMosaic = $('btn-mosaic');
const btnUndo = $('btn-undo');
const btnRedo = $('btn-redo');
const btnClear = $('btn-clear');
const btnCopy = $('btn-copy');
const btnDownload = $('btn-download');
const btnCancel = $('btn-cancel');
const closeBtn = $('close-btn');
const screenshotActions = $('screenshot-actions');
const btnOcr = $('btn-ocr');
const btnTranslate = $('btn-translate');
const styleMenu = $('style-menu');
const currentColorSwatch = $('currentColorSwatch');
const customColorInput = $('customColorInput');
// ── Dialog state ──
let pendingDialogResolve = null;
function showDialog(title, showInput) {
  dialogTitle.textContent = title;
  dialogInputWrapper.classList.toggle('hidden', !showInput);
  dialogInput.value = '';
  dialogOverlay.classList.add('show');
  if (showInput) setTimeout(() => dialogInput.focus(), 100);
}
function hideDialog() {
  dialogOverlay.classList.remove('show');
}
function waitForDialog() {
  return new Promise((resolve) => {
    pendingDialogResolve = resolve;
  });
}
dialogConfirm.addEventListener('click', () => {
  hideDialog();
  if (pendingDialogResolve) {
    pendingDialogResolve({ confirmed: true, value: dialogInput.value });
    pendingDialogResolve = null;
  }
});
dialogCancel.addEventListener('click', () => {
  hideDialog();
  if (pendingDialogResolve) {
    pendingDialogResolve({ confirmed: false });
    pendingDialogResolve = null;
  }
});
// ── Drawing state ──
let drawStart = null;
let drawScreenStart = null;
let drawShape = null; // temporary shape during drag
// ── Toolbar mode switching ──
function deactivateAllButtons() {
  [btnSelect, btnRect, btnArrow, btnText, btnMosaic].forEach(b => b.classList.remove('active'));
}
function removeDrawingListeners() {
  if (!imageEditor) return;
  const fc = imageEditor._graphics.getCanvas();
  fc.off('mouse:down', onDrawStart);
  fc.off('mouse:move', onDrawMove);
  fc.off('mouse:up', onDrawEnd);
  fc.off('mouse:down', onMosaicDown);
  fc.off('mouse:move', onMosaicMove);
  fc.off('mouse:up', onMosaicUp);
  fc.off('mouse:down', onTextPlace);
  if (drawShape && drawShape.canvas) {
    drawShape.canvas.remove(drawShape);
  }
  isMosaicMode = false;
  mosaicStart = null;
  mosaicScreenStart = null;
  drawStart = null;
  drawScreenStart = null;
  drawShape = null;
}
function switchMode(mode) {
  if (!imageEditor) return;
  const fabricCanvas = imageEditor._graphics.getCanvas();
  removeDrawingListeners();
  imageEditor.stopDrawingMode();
  deactivateAllButtons();
  activeMode = mode;
  switch (mode) {
    case 'select':
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = true;
      fabricCanvas.defaultCursor = 'default';
      btnSelect.classList.add('active');
      break;
    case 'rect':
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.on('mouse:down', onDrawStart);
      fabricCanvas.on('mouse:move', onDrawMove);
      fabricCanvas.on('mouse:up', onDrawEnd);
      btnRect.classList.add('active');
      break;
    case 'arrow':
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.on('mouse:down', onDrawStart);
      fabricCanvas.on('mouse:move', onDrawMove);
      fabricCanvas.on('mouse:up', onDrawEnd);
      btnArrow.classList.add('active');
      break;
    case 'text':
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      btnText.classList.add('active');
      fabricCanvas.on('mouse:down', onTextPlace);
      break;
    case 'mosaic':
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false;
      fabricCanvas.defaultCursor = 'crosshair';
      btnMosaic.classList.add('active');
      isMosaicMode = true;
      fabricCanvas.on('mouse:down', onMosaicDown);
      fabricCanvas.on('mouse:move', onMosaicMove);
      fabricCanvas.on('mouse:up', onMosaicUp);
      break;
  }
  showStatus({
    select: '选择模式',
    rect: '矩形标注模式',
    arrow: '箭头标注模式',
    text: '点击截图上的位置添加文字',
    mosaic: '马赛克模式',
  }[mode] || '');
}
// ── Rect / Arrow drawing with fabric.js ──
function onDrawStart(o) {
  const fc = imageEditor._graphics.getCanvas();
  const pointer = fc.getPointer(o.e);
  drawStart = { x: pointer.x, y: pointer.y };
  drawScreenStart = { x: o.e.clientX, y: o.e.clientY };
  if (activeMode === 'rect') {
    drawShape = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 0, height: 0,
      fill: 'transparent', stroke: currentColor, strokeWidth: currentLineWidth,
    });
    fc.add(drawShape);
  } else if (activeMode === 'arrow') {
    drawShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: currentColor, strokeWidth: currentLineWidth, fill: currentColor,
    });
    fc.add(drawShape);
  }
}
function onDrawMove(o) {
  if (!drawStart || !drawShape) return;
  const fc = imageEditor._graphics.getCanvas();
  const pointer = fc.getPointer(o.e);
  if (activeMode === 'rect') {
    const left = Math.min(drawStart.x, pointer.x);
    const top = Math.min(drawStart.y, pointer.y);
    const width = Math.abs(pointer.x - drawStart.x);
    const height = Math.abs(pointer.y - drawStart.y);
    drawShape.set({ left, top, width, height });
  } else if (activeMode === 'arrow') {
    drawShape.set({ x2: pointer.x, y2: pointer.y });
  }
  fc.renderAll();
}
function onDrawEnd(o) {
  if (!drawStart || !drawShape) return;
  const fc = imageEditor._graphics.getCanvas();
  const pointer = fc.getPointer(o.e);
  const dx = pointer.x - drawStart.x;
  const dy = pointer.y - drawStart.y;
  const screenDx = o.e.clientX - drawScreenStart.x;
  const screenDy = o.e.clientY - drawScreenStart.y;
  const tooSmall = Math.abs(screenDx) < 3 && Math.abs(screenDy) < 3;
  // Remove the temporary shape
  if (drawShape.canvas) fc.remove(drawShape);
  drawStart = null;
  drawScreenStart = null;
  drawShape = null;
  if (tooSmall) {
    fc.renderAll();
    switchMode('select');
    return;
  }
  const left = Math.min(pointer.x, pointer.x - dx);
  const top = Math.min(pointer.y, pointer.y - dy);
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  if (activeMode === 'rect') {
    const rect = new fabric.Rect({
      left: left, top: top,
      width: width || 1, height: height || 1,
      fill: 'transparent', stroke: currentColor, strokeWidth: currentLineWidth,
    });
    fc.add(rect);
  } else if (activeMode === 'arrow') {
    const angle = Math.atan2(dy, dx);
    const headLen = currentLineWidth * 4; // 箭头大小和线宽成正比
    const x1 = pointer.x - dx;
    const y1 = pointer.y - dy;
    const x2 = pointer.x;
    const y2 = pointer.y;
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: currentColor, strokeWidth: currentLineWidth, fill: currentColor,
    });
    const head = new fabric.Triangle({
      left: x2, top: y2,
      angle: (angle * 180 / Math.PI) + 90,
      width: headLen, height: headLen,
      fill: currentColor,
      originX: 'center', originY: 'center',
    });
    fc.add(new fabric.Group([line, head]));
  }
  fc.renderAll();
  switchMode('select');
}
// ── Text placement (click-to-place) ──
function onTextPlace(o) {
  const fc = imageEditor._graphics.getCanvas();
  const pointer = fc.getPointer(o.e);
  const text = new fabric.IText('', {
    left: pointer.x,
    top: pointer.y,
    fontSize: currentFontSize,
    fill: currentColor,
    fontWeight: 'bold',
  });
  // Remove empty text if user exits editing without typing
  const onExitEditing = (e) => {
    if (e.target === text && !text.text.trim()) {
      fc.remove(text);
    }
    fc.off('text:editing:exited', onExitEditing);
  };
  fc.on('text:editing:exited', onExitEditing);
  fc.add(text);
  fc.setActiveObject(text);
  text.enterEditing();
  fc.renderAll();
  switchMode('select');
  showStatus('已添加文字');
}
// ── Mosaic implementation ──
function onMosaicDown(o) {
  const pointer = imageEditor._graphics.getCanvas().getPointer(o.e);
  mosaicStart = { x: pointer.x, y: pointer.y };
  mosaicScreenStart = { x: o.e.clientX, y: o.e.clientY };
}
function onMosaicMove(o) {
  if (!mosaicStart) return;
}
function onMosaicUp(o) {
  if (!mosaicStart) return;
  const pointer = imageEditor._graphics.getCanvas().getPointer(o.e);
  const left = Math.min(mosaicStart.x, pointer.x);
  const top = Math.min(mosaicStart.y, pointer.y);
  const width = Math.abs(pointer.x - mosaicStart.x);
  const height = Math.abs(pointer.y - mosaicStart.y);
  mosaicStart = null;
  const screenWidth = Math.abs(o.e.clientX - mosaicScreenStart.x);
  const screenHeight = Math.abs(o.e.clientY - mosaicScreenStart.y);
  mosaicScreenStart = null;
  if (screenWidth < 3 || screenHeight < 3) return;
  applyMosaic(left, top, width, height);
}
function applyMosaic(left, top, width, height) {
  const pixelSize = 10;
  const canvas = imageEditor._graphics.getCanvas();
  const lowerEl = canvas.getContext().canvas;
  const regionWidth = Math.max(1, Math.round(width));
  const regionHeight = Math.max(1, Math.round(height));
  // Draw the region at low resolution then scale up to create pixelation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = regionWidth;
  tempCanvas.height = regionHeight;
  const tempCtx = tempCanvas.getContext('2d');
  const smallW = Math.max(1, Math.ceil(regionWidth / pixelSize));
  const smallH = Math.max(1, Math.ceil(regionHeight / pixelSize));
  // Step 1: draw region at tiny size
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(lowerEl, left, top, width, height, 0, 0, smallW, smallH);
  // Step 2: scale back up for pixelation effect
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = regionWidth;
  resultCanvas.height = regionHeight;
  const resultCtx = resultCanvas.getContext('2d');
  resultCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, regionWidth, regionHeight);
  // Step 3: add the generated canvas synchronously as a fabric image.
  const mosaicImage = new fabric.Image(resultCanvas, {
    left,
    top,
    evented: false,
  });
  canvas.add(mosaicImage);
  canvas.renderAll();
  switchMode('select');
}
// ── Delete selected object ──
function deleteSelected() {
  if (!imageEditor) return;
  const canvas = imageEditor._graphics.getCanvas();
  const activeObj = canvas.getActiveObject();
  // Don't delete while editing IText (would delete the whole object on Backspace)
  if (activeObj && !activeObj.isEditing) {
    canvas.remove(activeObj);
    canvas.discardActiveObject();
    canvas.renderAll();
    showStatus('已删除选中元素');
  }
}

function undo() {
  if (!imageEditor) return;
  imageEditor.undo()
    .then(() => showStatus('已撤销'))
    .catch(() => showStatus('没有可撤销的操作'));
}

function redo() {
  if (!imageEditor) return;
  imageEditor.redo()
    .then(() => showStatus('已重做'))
    .catch(() => showStatus('没有可重做的操作'));
}

async function clearAnnotations() {
  showDialog('确定清空所有标注吗？', false);
  const result = await waitForDialog();
  if (!result.confirmed || !imageEditor) return;

  try {
    await imageEditor.clearObjects();
    imageEditor.clearUndoStack();
    imageEditor.clearRedoStack();
    showStatus('已清空所有标注');
  } catch (e) {
    console.error('清空标注失败:', e);
    showStatus('清空标注失败');
  }
}
// ── Save/Load settings ──
function saveSettings() {
  localStorage.setItem('annotate_color', currentColor);
  localStorage.setItem('annotate_line_width', currentLineWidth);
  localStorage.setItem('annotate_font_size', currentFontSize);
}
function loadSettings() {
  const lineWidthRange = document.getElementById('lineWidthRange');
  const lineWidthValue = document.getElementById('lineWidthValue');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  const savedColor = localStorage.getItem('annotate_color');
  const savedLineWidth = localStorage.getItem('annotate_line_width');
  const savedFontSize = localStorage.getItem('annotate_font_size');
  if (savedColor) {
    setCurrentColor(savedColor, false);
  }
  if (savedLineWidth) {
    currentLineWidth = parseInt(savedLineWidth);
    lineWidthRange.value = currentLineWidth;
    lineWidthValue.textContent = currentLineWidth;
  }
  if (savedFontSize) {
    currentFontSize = parseInt(savedFontSize);
    fontSizeSelect.value = currentFontSize;
  }
  updateColorPreview();
}

function updateColorPreview() {
  if (currentColorSwatch) currentColorSwatch.style.backgroundColor = currentColor;
  if (customColorInput && /^#[0-9a-f]{6}$/i.test(currentColor)) customColorInput.value = currentColor;
}

function setCurrentColor(color, persist = true) {
  if (!color) return;
  currentColor = color;
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === currentColor);
  });
  updateColorPreview();
  if (persist) saveSettings();
}

const EDITOR_PADDING = 24;
const MIN_CANVAS_SIZE = 200;

function editorViewport() {
  return {
    width: Math.max((editorContainer?.clientWidth || window.innerWidth) - EDITOR_PADDING, 1),
    height: Math.max((editorContainer?.clientHeight || window.innerHeight) - EDITOR_PADDING, 1)
  };
}

function canvasDisplaySize(width, height) {
  const viewport = editorViewport();
  const scale = Math.min(viewport.width / width, viewport.height / height, 1);
  let displayWidth = Math.max(Math.floor(width * scale), 1);
  let displayHeight = Math.max(Math.floor(height * scale), 1);
  const minimum = Math.min(MIN_CANVAS_SIZE, viewport.width, viewport.height);

  if (minimum > 0 && (displayWidth < minimum || displayHeight < minimum)) {
    const scaleUp = Math.min(
      minimum / displayWidth,
      minimum / displayHeight,
      viewport.width / displayWidth,
      viewport.height / displayHeight
    );
    displayWidth = Math.floor(displayWidth * scaleUp);
    displayHeight = Math.floor(displayHeight * scaleUp);
  }

  return { width: displayWidth, height: displayHeight, viewport };
}

// 缩放与平移状态：viewZoom 是相对“适配窗口”尺寸的倍率，viewPos 是画布容器左上角相对查看区的位置
let viewZoom = 1;
let viewPos = { x: 0, y: 0 };
let panningFlag = false;
let panStartScreen = null;

function viewerViewport() {
  return {
    width: Math.max(viewer?.clientWidth || window.innerWidth, 1),
    height: Math.max(viewer?.clientHeight || window.innerHeight, 1)
  };
}

function scaledDisplaySize() {
  if (!imageEditor) return null;
  const fabricCanvas = imageEditor._graphics.getCanvas();
  const base = canvasDisplaySize(fabricCanvas.getWidth(), fabricCanvas.getHeight());
  return {
    width: Math.max(1, Math.round(base.width * viewZoom)),
    height: Math.max(1, Math.round(base.height * viewZoom))
  };
}

// 画布没超过查看区时始终居中；超过后可拖动，但限制在查看区范围内
function clampViewPos(width, height) {
  const vp = viewerViewport();
  const x = width <= vp.width
    ? Math.round((vp.width - width) / 2)
    : Math.round(Math.min(0, Math.max(vp.width - width, viewPos.x)));
  const y = height <= vp.height
    ? Math.round((vp.height - height) / 2)
    : Math.round(Math.min(0, Math.max(vp.height - height, viewPos.y)));
  return { x, y };
}

function isZoomedBeyondViewport() {
  const size = scaledDisplaySize();
  if (!size) return false;
  const vp = viewerViewport();
  return size.width > vp.width || size.height > vp.height;
}

function applyViewport() {
  if (!imageEditor) return;
  const fabricCanvas = imageEditor._graphics.getCanvas();
  const size = scaledDisplaySize();
  if (!size) return;
  const pos = clampViewPos(size.width, size.height);
  viewPos = pos;

  const canvasElement = fabricCanvas.getElement();
  canvasElement.style.width = size.width + 'px';
  canvasElement.style.height = size.height + 'px';

  viewer.querySelectorAll(
    '.tui-image-editor-canvas-container, .tui-image-editor-canvas-container canvas, .canvas-container, .canvas-container canvas'
  ).forEach((element) => {
    element.style.maxWidth = '';
    element.style.maxHeight = '';
  });

  const canvasContainer = viewer.querySelector('.tui-image-editor-canvas-container')
    || viewer.querySelector('.canvas-container');
  if (canvasContainer) {
    canvasContainer.style.width = size.width + 'px';
    canvasContainer.style.height = size.height + 'px';
    canvasContainer.style.position = 'absolute';
    canvasContainer.style.left = pos.x + 'px';
    canvasContainer.style.top = pos.y + 'px';
  }
  fabricCanvas.renderAll();
}

function fitEditorCanvas() {
  viewZoom = 1;
  applyViewport();
}

function handleEditorResize() {
  window.requestAnimationFrame(fitEditorCanvas);
}

// ── 缩放与平移交互 ──
// 滚轮在光标位置缩放；图片被放大到超出查看区后，在空白处按住左键可拖动
function handleWheel(e) {
  if (!imageEditor) return;
  e.preventDefault();
  const before = scaledDisplaySize();
  if (!before) return;
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  viewZoom = Math.min(8, Math.max(0.2, viewZoom * factor));
  const after = scaledDisplaySize();
  const rect = viewer.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const fx = before.width ? (cx - viewPos.x) / before.width : 0.5;
  const fy = before.height ? (cy - viewPos.y) / before.height : 0.5;
  viewPos.x = Math.round(cx - fx * after.width);
  viewPos.y = Math.round(cy - fy * after.height);
  applyViewport();
  showStatus('缩放 ' + Math.round(viewZoom * 100) + '%');
}

function beginPan(e) {
  if (!imageEditor || activeMode !== 'select' || e.button !== 0) return;
  if (!isZoomedBeyondViewport()) return;
  const fabricCanvas = imageEditor._graphics.getCanvas();
  let hit = true;
  try {
    hit = !!(fabricCanvas.findTarget && fabricCanvas.findTarget(e));
  } catch (err) {
    // 拾取失败时保持默认为已命中，避免干扰对象拖动
    hit = true;
  }
  if (hit) return;
  panningFlag = true;
  panStartScreen = { x: e.clientX, y: e.clientY, pos: { x: viewPos.x, y: viewPos.y } };
  fabricCanvas.selection = false;
  fabricCanvas.defaultCursor = 'grabbing';
  showStatus('拖动图片位置');
}

function movePan(e) {
  if (!panningFlag || !panStartScreen || !imageEditor) return;
  const fabricCanvas = imageEditor._graphics.getCanvas();
  viewPos.x = panStartScreen.pos.x + (e.clientX - panStartScreen.x);
  viewPos.y = panStartScreen.pos.y + (e.clientY - panStartScreen.y);
  fabricCanvas.defaultCursor = 'grabbing';
  applyViewport();
}

function endPan() {
  if (!panningFlag) return;
  panningFlag = false;
  panStartScreen = null;
  if (imageEditor && activeMode === 'select') {
    const fabricCanvas = imageEditor._graphics.getCanvas();
    fabricCanvas.selection = true;
    fabricCanvas.defaultCursor = 'default';
  }
}

function bindViewportInteraction() {
  viewer.addEventListener('mousedown', beginPan, true);
  window.addEventListener('mousemove', movePan);
  window.addEventListener('mouseup', endPan);
  viewer.addEventListener('wheel', handleWheel, { passive: false });
}

// ── DataURL to Blob conversion ──
function dataURLToBlob(dataURL) {
  var parts = dataURL.split(',');
  var mime = parts[0].match(/:(.*?);/)[1];
  var binary = atob(parts[1]);
  var array = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function currentCanvasDataUrl() {
  if (!imageEditor) return null;
  var canvas = imageEditor._graphics.getCanvas();
  canvas.renderAll();
  return canvas.toDataURL({ format: 'png', multiplier: 1 });
}

function sendScreenshotAction(action) {
  var imageUrl = currentCanvasDataUrl();
  if (!imageUrl) return;

  if (sendEditorMessage('result', { action, imageUrl })) {
    showStatus(action === 'ocr' ? '已将图片交给 OCR' : '已将图片交给翻译');
    setTimeout(function() { window.close(); }, 250);
    return;
  }

  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'annotateAction', action: action, imageUrl: imageUrl }, '*');
      showStatus(action === 'ocr' ? '已将图片交给 OCR' : '已将图片交给翻译');
      setTimeout(function() { window.close(); }, 250);
      return;
    }
  } catch (error) {
    console.warn('[annotate] 通知主窗口失败:', error);
  }

  navigateToMain(action, imageUrl);
}

// ── Copy to clipboard ──
async function copyToClipboard() {
  if (!imageEditor) {
    return;
  }
  try {
    var fc = imageEditor._graphics.getCanvas();
    fc.renderAll();
    // Render to dataURL synchronously (includes background + all annotation objects)
    var dataURL = fc.toDataURL({ format: 'png', multiplier: 1 });
    // ── Method 1: ztools.copyImage ──
    if (win?.ztools?.copyImage) {
      try {
        var result = win.ztools.copyImage(dataURL);
        if (result !== false) {
          finishEditorCopy(dataURL);
          return;
        }
      } catch (e) { console.warn('[annotate] ztools.copyImage failed:', e); }
    }
    // ── Method 2: utools.copyImage ──
    if (win?.utools?.copyImage) {
      try {
        var result2 = win.utools.copyImage(dataURL);
        if (result2 !== false) {
          finishEditorCopy(dataURL);
          return;
        }
      } catch (e) { console.warn('[annotate] utools.copyImage failed:', e); }
    }
    // ── Method 3: navigator.clipboard.write ──
    var blob = dataURLToBlob(dataURL);
    if (navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        finishEditorCopy(dataURL);
        return;
      } catch (e) { console.warn('[annotate] navigator.clipboard.write failed:', e); }
    }
    // ── Method 4: Download fallback ──
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'annotated-image.png';
    a.click();
    URL.revokeObjectURL(url);
    finishEditorCopy(dataURL);
  } catch (e) {
    console.error('[annotate] 导出失败:', e);
  }
}
// ── Download to file ──
function downloadImage() {
  if (!imageEditor) return;
  const dataURL = currentCanvasDataUrl();
  if (!dataURL) return;
  const blob = dataURLToBlob(dataURL);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'annotated-image.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  showStatus('图片已下载');
}
// ── Exit / Cleanup ──
function cleanup() {
  try {
    window.removeEventListener('resize', handleEditorResize);
    if (imageEditor) {
      removeDrawingListeners();
      imageEditor.destroy();
      imageEditor = null;
    }
  } catch (e) {
    // ignore cleanup errors
  }
}
function exitPlugin() {
  cleanup();
  if (win?.ztools?.outPlugin) {
    win.ztools.outPlugin(false);
  } else if (win?.utools) {
    win.utools.hideMainWindow();
  }
}
// ── Annotation initialization ──
function startAnnotation(imageUrl) {
  annotationInProgress = true;
  if (loadingEl) loadingEl.classList.add('show');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // 保存原始图片信息
    originalImageInfo = {
      width: img.naturalWidth,
      height: img.naturalHeight,
      url: imageUrl
    };

    // 等待窗口调整完成后再加载编辑器
    setTimeout(() => {
      if (loadingEl) loadingEl.classList.remove('show');

      try {
        const editor = new tui.ImageEditor(viewer, {
          includeUI: false,
          useDefaultUI: false,
        });
        imageEditor = editor;
        win.imageEditor = editor;
        window.addEventListener('resize', handleEditorResize);
        editor.loadImageFromURL(imageUrl, 'annotated-image')
          .then(() => {
            const fabricCanvas = editor._graphics.getCanvas();
            // canvas 逻辑尺寸保持图片原始大小，保证编辑精度
            const imgW = fabricCanvas.getWidth();
            const imgH = fabricCanvas.getHeight();
            fitEditorCanvas();
            switchMode('select');
            annotationInProgress = false;
            showStatus('图片加载完成');
          })
          .catch((err) => {
            console.error('图片加载失败:', err);
            leaveEditor();
          });
      } catch (e) {
        console.error('编辑器初始化失败:', e);
        leaveEditor();
      }
    }, 100);
  };
  img.onerror = () => {
    leaveEditor();
  };
  img.src = imageUrl;
}
// ── Direct editor navigation ──
function openAnnotationWindow(imageUrl) {
  if (isChildWindow()) {
    startAnnotation(imageUrl);
    return;
  }
  if (typeof win?.ztools?.showMainWindow === 'function') win.ztools.showMainWindow();
  else if (typeof win?.utools?.showMainWindow === 'function') win.utools.showMainWindow();

  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('image', imageUrl);
  url.searchParams.set('screenshotFlow', '1');
  if (returnToInput) url.searchParams.set('returnInput', '1');
  window.location.href = url.href;
}
// ── Screen capture ──
function triggerScreenCapture() {
  const hasCaptureApi = !!(
    (win?.ztools && typeof win.ztools.screenCapture === 'function') ||
    (win?.utools && typeof win.utools.screenCapture === 'function')
  );
  if (!hasCaptureApi) {
    showStatus('当前环境不支持截图功能');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.onchange = (e) => {
      if (e.target.files.length > 0) {
        const reader = new FileReader();
        reader.onload = (event) => {
          input.remove();
          openAnnotationWindow(event.target.result);
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    };
    document.body.appendChild(input);
    input.click();
    return;
  }
  if (win?.ztools?.hideMainWindow) {
    win.ztools.hideMainWindow();
  } else if (win?.utools) {
    win.utools.hideMainWindow();
  }
  setTimeout(() => {
    const capture = (cb) => {
      if (win?.ztools?.screenCapture) win.ztools.screenCapture(cb);
      else if (win?.utools?.screenCapture) win.utools.screenCapture(cb);
    };
    capture((imageUrl) => {
      if (!imageUrl) {
        setTimeout(() => exitPlugin(), 1000);
        return;
      }
      openAnnotationWindow(imageUrl);
    });
  }, 300);
}
// ── Toolbar event binding ──
function bindToolbar() {
  const lineWidthRange = document.getElementById('lineWidthRange');
  const lineWidthValue = document.getElementById('lineWidthValue');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  btnSelect.addEventListener('click', () => switchMode('select'));
  btnRect.addEventListener('click', () => switchMode('rect'));
  btnArrow.addEventListener('click', () => switchMode('arrow'));
  btnText.addEventListener('click', () => switchMode('text'));
  btnMosaic.addEventListener('click', () => switchMode('mosaic'));
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnClear.addEventListener('click', clearAnnotations);
  // 颜色选择和样式控件事件
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCurrentColor(btn.dataset.color);
    });
  });
  if (customColorInput) customColorInput.addEventListener('input', () => setCurrentColor(customColorInput.value));
  // 线条宽度拖动条事件
  lineWidthRange.addEventListener('input', () => {
    currentLineWidth = parseInt(lineWidthRange.value);
    lineWidthValue.textContent = currentLineWidth;
    saveSettings();
  });
  // 字体大小下拉框事件
  fontSizeSelect.addEventListener('change', () => {
    currentFontSize = parseInt(fontSizeSelect.value);
    saveSettings();
  });
  document.querySelectorAll('.toolbar-menu').forEach(menu => {
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      document.querySelectorAll('.toolbar-menu').forEach(other => {
        if (other !== menu) other.removeAttribute('open');
      });
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.toolbar-menu')) {
      document.querySelectorAll('.toolbar-menu[open]').forEach(menu => menu.removeAttribute('open'));
    }
  });
  btnCopy.addEventListener('click', copyToClipboard);
  if (btnDownload) btnDownload.addEventListener('click', downloadImage);
  if (btnOcr) btnOcr.addEventListener('click', () => sendScreenshotAction('ocr'));
  if (btnTranslate) btnTranslate.addEventListener('click', () => sendScreenshotAction('translate'));

  const closeAction = () => {
    cleanup();
    leaveEditor();
  };
  closeBtn.addEventListener('click', closeAction);
  btnCancel.addEventListener('click', closeAction);
}
// ── Keyboard shortcuts ──
function bindShortcuts() {
  // Window capture phase: fires before document-level tui handlers
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !dialogOverlay.classList.contains('show')) {
      const fc = imageEditor?._graphics?.getCanvas();
      const activeObj = fc?.getActiveObject();
      if (activeObj?.isEditing) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      deleteSelected();
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      copyToClipboard();
    } else if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape') {
      if (dialogOverlay.classList.contains('show')) {
        hideDialog();
        if (pendingDialogResolve) {
          pendingDialogResolve({ confirmed: false });
          pendingDialogResolve = null;
        }
        switchMode('select');
      } else if (isMosaicMode) {
        switchMode('select');
      } else {
        if (styleMenu?.open) styleMenu.removeAttribute('open');
        switchMode('select');
      }
    }
  });
}
// ── Flow dispatch ──
function handlePluginEnter(param) {
  if (!param) return;
  if (param.code === 'screenshot-annotate') {
    if (param.type === 'img' && param.payload) {
      openAnnotationWindow(param.payload);
    } else {
      triggerScreenCapture();
    }
  }
}
// ── Initialization ──
bindToolbar();
bindShortcuts();
bindViewportInteraction();
loadSettings(); // 加载保存的设置
if ((screenshotFlow || returnToInput) && screenshotActions) screenshotActions.classList.add('show');
if (isStandalone) {
  document.addEventListener('DOMContentLoaded', () => {
    startAnnotation(standaloneImage);
  });
} else {
  if (win.__ztoolsEnterParam) {
    const p = win.__ztoolsEnterParam;
    win.__ztoolsEnterParam = null;
    handlePluginEnter(p);
  }
  if (win?.ztools?.removeSubInput) {
    try { win.ztools.removeSubInput(); } catch (e) {}
  }
  if (win?.ztools?.onPluginEnter) {
    win.ztools.onPluginEnter(handlePluginEnter);
  } else if (win?.utools) {
    win.utools.onPluginEnter(handlePluginEnter);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const payload = params.get('payload');
    if (code === 'screenshot-annotate') {
      if (payload?.startsWith('data:image/')) {
        openAnnotationWindow(payload);
      } else {
        triggerScreenCapture();
      }
    }
    if (win.__ztoolsEnterParam) {
      const p = win.__ztoolsEnterParam;
      win.__ztoolsEnterParam = null;
      handlePluginEnter(p);
    }
  });
}
