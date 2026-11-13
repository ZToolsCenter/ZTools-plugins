// 固定到屏幕的图片窗口：拖动移动、滚轮缩放、双击/Esc 关闭。

import { readEditorImage } from '../editor-image-handoff.js';
import { copyImageDataUrl } from '../clipboard-image.js';

const win = globalThis.window;
const params = new URLSearchParams(win.location.search);
const pinId = params.get('pinId') || '';
const pinKey = params.get('pinKey') || '';

const image = document.getElementById('pin-image');
const closeButton = document.getElementById('pin-close');
const hint = document.getElementById('pin-hint');
const menu = document.getElementById('pin-menu');

let dragging = false;
let dragOffset = { x: 0, y: 0 };
let hintTimer = null;
let imageDataUrl = '';

image.draggable = false;

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

function hideMenu() {
  menu.hidden = true;
}

function showMenu(x, y) {
  if (!imageDataUrl) return;
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, win.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, win.innerHeight - rect.height - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button')?.focus?.();
}

async function handleMenuAction(action) {
  hideMenu();
  if (action === 'copy') {
    showHint(await copyImageDataUrl(win, imageDataUrl) ? '已复制到剪贴板' : '复制失败');
    return;
  }
  if (action === 'delete') {
    closeSelf();
    return;
  }
  if (action === 'edit' || action === 'ocr' || action === 'translate') {
    send('pinAction', { action });
  }
}

image.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  // Chromium 里 img 默认可原生拖拽；不阻止默认行为会抢占 pointermove，表现为拖图片而不是拖窗口。
  event.preventDefault();
  dragging = true;
  dragOffset = { x: event.screenX - win.screenX, y: event.screenY - win.screenY };
  try {
    image.setPointerCapture?.(event.pointerId);
  } catch {
    // 合成指针没有活动指针时允许测试/辅助技术触发同样逻辑。
  }
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

image.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  showMenu(event.clientX, event.clientY);
});

win.addEventListener('contextmenu', (event) => {
  if (event.target === image) return;
  event.preventDefault();
  hideMenu();
});

document.addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target)) hideMenu();
}, true);

menu.addEventListener('click', (event) => {
  const action = event.target instanceof Element ? event.target.dataset.action : '';
  if (action) void handleMenuAction(action);
});

win.addEventListener('wheel', (event) => {
  if (!menu.hidden) return;
  event.preventDefault();
  send('pinZoom', {
    factor: event.deltaY < 0 ? 1.1 : 1 / 1.1,
    anchorX: Math.round(event.screenX),
    anchorY: Math.round(event.screenY)
  });
}, { passive: false });

win.addEventListener('dblclick', () => closeSelf());

win.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.hidden) {
    hideMenu();
    return;
  }
  if (event.key === 'Escape') closeSelf();
});

closeButton.addEventListener('click', () => closeSelf());

readEditorImage(pinKey, false).then((dataUrl) => {
  if (!dataUrl) {
    closeSelf();
    return;
  }
  imageDataUrl = dataUrl;
  image.src = dataUrl;
  showHint('滚轮缩放 · 拖动移动 · 双击或 Esc 关闭');
});
