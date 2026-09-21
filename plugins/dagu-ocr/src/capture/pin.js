// 固定到屏幕的图片窗口：拖动移动、滚轮缩放、双击/Esc 关闭。

import { readEditorImage } from '../editor-image-handoff.js';

const win = globalThis.window;
const params = new URLSearchParams(win.location.search);
const pinId = params.get('pinId') || '';
const pinKey = params.get('pinKey') || '';

const image = document.getElementById('pin-image');
const closeButton = document.getElementById('pin-close');
const hint = document.getElementById('pin-hint');

let dragging = false;
let dragOffset = { x: 0, y: 0 };
let hintTimer = null;

function send(event, payload = {}) {
  const host = win.ztools || win.utools;
  const sendToParent = host?.sendToParent;
  if (typeof sendToParent !== 'function') return false;
  try {
    sendToParent('dagu-ocr-editor', { event, source: 'pin', pinId, ...payload });
    return true;
  } catch (error) {
    console.warn('[pin] 回传父窗口失败:', error);
    return false;
  }
}

function closeSelf() {
  send('pinClose');
  setTimeout(() => {
    try {
      win.close();
    } catch {
      // 窗口已关闭时忽略。
    }
  }, 30);
}

function showHint(message) {
  hint.textContent = message;
  hint.classList.add('visible');
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('visible'), 1800);
}

image.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  dragOffset = { x: event.screenX - win.screenX, y: event.screenY - win.screenY };
  image.setPointerCapture?.(event.pointerId);
});

win.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  send('pinMove', {
    x: Math.round(event.screenX - dragOffset.x),
    y: Math.round(event.screenY - dragOffset.y)
  });
});

win.addEventListener('pointerup', () => {
  dragging = false;
});

win.addEventListener('wheel', (event) => {
  event.preventDefault();
  send('pinZoom', {
    factor: event.deltaY < 0 ? 1.1 : 1 / 1.1,
    anchorX: Math.round(event.screenX),
    anchorY: Math.round(event.screenY)
  });
}, { passive: false });

win.addEventListener('dblclick', () => closeSelf());

win.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSelf();
});

closeButton.addEventListener('click', () => closeSelf());

readEditorImage(pinKey, false).then((dataUrl) => {
  if (!dataUrl) {
    closeSelf();
    return;
  }
  image.src = dataUrl;
  showHint('滚轮缩放 · 拖动移动 · 双击或 Esc 关闭');
});
