/* 悬浮图片窗口
   拖动移动、滚轮缩放、Ctrl+滚轮改透明度、拖边裁剪、摇一摇隐藏其他贴图。
   窗口本身归 preload 的「贴图管家」管，这里只负责交互和画。 */

(function () {
  'use strict';

  const S = window.SNAP;
  const params = new URLSearchParams(window.location.search);
  const pinId = params.get('pinId') || '';

  const img = document.getElementById('pin');
  const closeBtn = document.getElementById('close');
  const tip = document.getElementById('tip');
  const cropLayer = document.getElementById('cropLayer');
  const cropBox = document.getElementById('cropBox');
  const cropBar = document.getElementById('cropBar');

  let dataUrl = '';
  let menu = null;
  let drag = null;
  // 裁剪中的框（CSS 像素，相对窗口内容区，也就是图片显示区）
  let crop = null;
  let cropDrag = null;

  function showTip(text) {
    tip.textContent = text;
    tip.classList.add('show');
    if (showTip.timer) clearTimeout(showTip.timer);
    showTip.timer = setTimeout(() => tip.classList.remove('show'), 1500);
  }

  function send(event, payload = {}) {
    S.sendToParent(event, { pinId, ...payload });
  }

  // ── 图片 ──
  const stashKey = `snap-pin-img-${pinId}`;
  const SHOT_PATH = params.get('shot') || '';

  function applyImage(url) {
    if (!url || url === dataUrl) return;
    dataUrl = url;
    img.src = url;
  }

  if (SHOT_PATH && window.zsnap && typeof window.zsnap.readShot === 'function') {
    try {
      const hit = window.zsnap.readShot(SHOT_PATH);
      if (hit && hit.ok && hit.dataUrl) applyImage(hit.dataUrl);
    } catch (error) {
      console.warn('[snap] 读取截图失败', error);
    }
  }

  S.onChildMessage((payload) => {
    if (!payload) return;
    if (payload.event === 'image' && payload.dataUrl) applyImage(payload.dataUrl);
    if (payload.event === 'othersToggled') {
      showTip(payload.hidden ? `已隐藏其他 ${payload.count} 张贴图 · 再摇一次恢复` : '贴图都回来了');
    }
    if (payload.event === 'cropped' && payload.ok) showTip('已裁剪');
    if (payload.event === 'editing') showTip('已在标注窗打开');
    if (payload.event === 'replaced' && payload.ok) showTip('已更新');
  });

  setTimeout(() => {
    if (!dataUrl) applyImage(S.takeImage(stashKey));
  }, 400);

  send('pinReady');

  // ── 拖动窗口 ──
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (crop) return; // 裁剪模式下拖动是画框，不是搬窗口
    if (event.target === closeBtn) return;
    if (menu && menu.contains(event.target)) return; // 点在菜单里：别关菜单也别开始拖窗口
    closeMenu();
    drag = {
      startX: event.screenX,
      startY: event.screenY,
      originX: window.screenX,
      originY: window.screenY,
      moved: false
    };
    document.body.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.screenX - drag.startX;
    const dy = event.screenY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = null;
      send('pinMove', { x: Math.round(drag.originX + dx), y: Math.round(drag.originY + dy) });
    });
  });

  window.addEventListener('pointerup', () => {
    drag = null;
  });

  // ── 缩放 / 透明度 ──
  window.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (crop) return;
    if (event.ctrlKey || event.metaKey) {
      send('pinOpacity', { delta: event.deltaY < 0 ? 0.08 : -0.08 });
      showTip(event.deltaY < 0 ? '更不透明' : '更透明');
      return;
    }
    send('pinZoom', { factor: event.deltaY < 0 ? 1.1 : 0.9 });
  }, { passive: false });

  // ── 双击 / Esc ──
  window.addEventListener('dblclick', () => {
    if (menu) return;
    if (crop) {
      applyCrop();
      return;
    }
    send('pinClose');
  });

  // ── 快捷键 ──
  window.addEventListener('keydown', (event) => {
    const ctrl = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      if (crop) {
        exitCrop();
        return;
      }
      if (menu) closeMenu();
      else send('pinClose');
      return;
    }

    if (event.key === 'Enter' && crop) {
      event.preventDefault();
      applyCrop();
      return;
    }

    if (!ctrl && event.key.toLowerCase() === 'c') {
      beginCrop();
      return;
    }

    if (!ctrl && event.key.toLowerCase() === 'e') {
      send('pinEdit', { dataUrl });
      return;
    }

    if (!ctrl && event.key.toLowerCase() === 'r') {
      rotate();
      return;
    }

    if (ctrl && event.key.toLowerCase() === 'c') copyImage();
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveImage();
    }
    if (ctrl && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      if (crop) crop = { x: 0, y: 0, width: innerWidth, height: innerHeight };
      else beginCrop();
    }
  });

  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    send('pinClose');
  });

  // ─────────────── 裁剪 ───────────────
  // 整个裁剪框都在窗口内，坐标即窗口内像素；换回原图分辨率由 naturalWidth 比例换算，
  // 所以不管窗口被缩放成多大，裁出来的像素都是实的。

  const HANDLE = 7;
  const MIN_CROP = 12;

  function beginCrop() {
    if (!img.naturalWidth) return;
    closeMenu();
    document.documentElement.classList.add('cropping');
    cropLayer.hidden = false;
    cropBar.hidden = false;
    closeBtn.hidden = true;
    // 默认框住整张图，用户直接从整张开始收
    crop = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    paintCrop();
    showTip('拖边调整，Enter 确认，Esc 取消');
  }

  function exitCrop() {
    crop = null;
    cropDrag = null;
    document.documentElement.classList.remove('cropping');
    cropLayer.hidden = true;
    cropBar.hidden = true;
    closeBtn.hidden = false;
  }

  function paintCrop() {
    if (!crop) return;
    cropBox.style.left = `${crop.x}px`;
    cropBox.style.top = `${crop.y}px`;
    cropBox.style.width = `${crop.width}px`;
    cropBox.style.height = `${crop.height}px`;
  }

  function clampCrop(box) {
    const w = Math.max(MIN_CROP, box.width);
    const h = Math.max(MIN_CROP, box.height);
    const x = S.clamp(box.x, 0, Math.max(0, innerWidth - w));
    const y = S.clamp(box.y, 0, Math.max(0, innerHeight - h));
    return {
      x,
      y,
      width: Math.min(w, innerWidth - x),
      height: Math.min(h, innerHeight - y)
    };
  }

  // 命中判定用几何算，不依赖子元素是否接收 pointer 事件
  function hitEdge(x, y) {
    if (!crop) return null;
    const nearL = Math.abs(x - crop.x) <= HANDLE;
    const nearR = Math.abs(x - (crop.x + crop.width)) <= HANDLE;
    const nearT = Math.abs(y - crop.y) <= HANDLE;
    const nearB = Math.abs(y - (crop.y + crop.height)) <= HANDLE;
    const insideX = x >= crop.x - HANDLE && x <= crop.x + crop.width + HANDLE;
    const insideY = y >= crop.y - HANDLE && y <= crop.y + crop.height + HANDLE;
    if (!insideX || !insideY) return null;
    if (nearT && nearL) return 'nw';
    if (nearT && nearR) return 'ne';
    if (nearB && nearL) return 'sw';
    if (nearB && nearR) return 'se';
    if (nearL) return 'w';
    if (nearR) return 'e';
    if (nearT) return 'n';
    if (nearB) return 's';
    return 'move';
  }

  const CURSOR = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize', move: 'move'
  };

  window.addEventListener('pointerdown', (event) => {
    if (!crop || event.button !== 0) return;
    const edge = hitEdge(event.clientX, event.clientY);
    event.preventDefault();
    if (!edge) {
      // 框外按下＝重新起框
      const start = { x: event.clientX, y: event.clientY };
      cropDrag = { kind: 'new', start };
      crop = clampCrop({ x: start.x, y: start.y, width: 0, height: 0 });
      paintCrop();
      return;
    }
    cropDrag = { kind: edge === 'move' ? 'move' : 'resize', edge, start: { x: event.clientX, y: event.clientY }, box: { ...crop } };
  }, true);

  window.addEventListener('pointermove', (event) => {
    if (crop && !cropDrag) {
      const edge = hitEdge(event.clientX, event.clientY);
      document.body.style.cursor = edge ? CURSOR[edge] : 'crosshair';
      return;
    }
    if (!cropDrag || !crop) return;
    const dx = event.clientX - cropDrag.start.x;
    const dy = event.clientY - cropDrag.start.y;

    if (cropDrag.kind === 'new') {
      crop = clampCrop({
        x: Math.min(cropDrag.start.x, event.clientX),
        y: Math.min(cropDrag.start.y, event.clientY),
        width: Math.abs(dx),
        height: Math.abs(dy)
      });
      paintCrop();
      return;
    }

    if (cropDrag.kind === 'move') {
      crop = clampCrop({ ...cropDrag.box, x: cropDrag.box.x + dx, y: cropDrag.box.y + dy });
      paintCrop();
      return;
    }

    const box = { ...cropDrag.box };
    const e = cropDrag.edge;
    if (e.includes('w')) {
      box.x = Math.min(cropDrag.box.x + dx, cropDrag.box.x + cropDrag.box.width - MIN_CROP);
      box.width = cropDrag.box.width - (box.x - cropDrag.box.x);
    }
    if (e.includes('e')) box.width = Math.max(MIN_CROP, cropDrag.box.width + dx);
    if (e.includes('n')) {
      box.y = Math.min(cropDrag.box.y + dy, cropDrag.box.y + cropDrag.box.height - MIN_CROP);
      box.height = cropDrag.box.height - (box.y - cropDrag.box.y);
    }
    if (e.includes('s')) box.height = Math.max(MIN_CROP, cropDrag.box.height + dy);
    crop = clampCrop(box);
    paintCrop();
  });

  window.addEventListener('pointerup', () => {
    cropDrag = null;
    if (crop) document.body.style.cursor = 'crosshair';
  });

  function applyCrop() {
    if (!crop || !img.naturalWidth) {
      exitCrop();
      return;
    }
    const box = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / Math.max(1, box.width);
    const scaleY = img.naturalHeight / Math.max(1, box.height);
    const sx = Math.max(0, Math.round((crop.x - box.left) * scaleX));
    const sy = Math.max(0, Math.round((crop.y - box.top) * scaleY));
    const sw = Math.max(1, Math.round(crop.width * scaleX));
    const sh = Math.max(1, Math.round(crop.height * scaleY));
    if (sw < 4 || sh < 4) {
      showTip('裁得太小');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(sw, img.naturalWidth - sx);
    canvas.height = Math.min(sh, img.naturalHeight - sy);
    canvas.getContext('2d').drawImage(img, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const next = canvas.toDataURL('image/png');
    if (!next) {
      showTip('裁剪失败');
      return;
    }

    const rect = { x: crop.x - box.left, y: crop.y - box.top, width: crop.width, height: crop.height };
    exitCrop();
    img.src = next;
    dataUrl = next;
    send('pinCrop', { dataUrl: next, rect, size: { width: canvas.width, height: canvas.height } });
  }

  cropBar.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'apply') applyCrop();
    if (btn.dataset.act === 'cancel') exitCrop();
  });

  // ─────────────── 摇一摇：藏起其他贴图 ───────────────
  const shake = { lastX: null, lastT: 0, dir: 0, flips: 0, dist: 0, cool: 0 };

  window.addEventListener('pointermove', (event) => {
    if (crop) return;
    const now = performance.now();
    if (now - shake.lastT > 900) {
      shake.flips = 0;
      shake.dist = 0;
      shake.lastX = null;
    }
    if (shake.lastX !== null) {
      const dx = event.screenX - shake.lastX;
      if (Math.abs(dx) >= 2) {
        const dir = Math.sign(dx);
        if (dir !== shake.dir) {
          shake.flips += 1;
          shake.dir = dir;
        }
        shake.dist += Math.abs(dx);
      }
    }
    shake.lastX = event.screenX;
    shake.lastT = now;

    if (shake.flips >= 4 && shake.dist > 110 && now > shake.cool) {
      shake.cool = now + 1500;
      shake.flips = 0;
      shake.dist = 0;
      send('pinShake');
    }
  });

  // ── 右键菜单 ──
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (crop) return;
    openMenu(event.clientX, event.clientY);
  });

  function openMenu(x, y) {
    closeMenu();
    menu = document.createElement('div');
    menu.id = 'menu';
    menu.innerHTML = [
      '<button data-act="edit">编辑标注…<span>E</span></button>',
      '<button data-act="ocr">识别文字<span></span></button>',
      '<button data-act="translate">翻译<span></span></button>',
      '<div class="sep"></div>',
      '<button data-act="crop">裁剪<span>C</span></button>',
      '<button data-act="rotate">旋转 90°<span>R</span></button>',
      '<button data-act="less">更透明<span>Ctrl 滚轮</span></button>',
      '<button data-act="more">更不透明<span></span></button>',
      '<div class="sep"></div>',
      '<button data-act="shake">隐藏其他贴图<span>摇一摇</span></button>',
      '<button data-act="board">贴图板<span>Ctrl B</span></button>',
      '<button data-act="copy">复制图片<span>Ctrl C</span></button>',
      '<button data-act="save">另存为…<span>Ctrl S</span></button>',
      '<div class="sep"></div>',
      '<button data-act="close" class="danger">关闭<span>Esc</span></button>'
    ].join('');
    document.body.appendChild(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;

    menu.addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      closeMenu();
      if (act === 'edit') send('pinEdit', { dataUrl });
      if (act === 'ocr') send('pinOcr', { dataUrl });
      if (act === 'translate') send('pinTranslate', { dataUrl });
      if (act === 'crop') beginCrop();
      if (act === 'rotate') rotate();
      if (act === 'less') send('pinOpacity', { delta: -0.08 });
      if (act === 'more') send('pinOpacity', { delta: 0.08 });
      if (act === 'shake') send('pinShake');
      if (act === 'board') send('pinBoard', { tab: 'pins' });
      if (act === 'copy') copyImage();
      if (act === 'save') saveImage();
      if (act === 'close') send('pinClose');
    });
  }

  // 旋转 90°：就地重画，窗口尺寸由父窗口按新比例调整
  function rotate() {
    if (!dataUrl || !img.naturalWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    let next = '';
    try {
      next = canvas.toDataURL('image/png');
    } catch (error) {
      showTip('旋转失败');
      return;
    }
    if (!next) {
      showTip('旋转失败');
      return;
    }
    dataUrl = next;
    img.src = next;
    send('pinReplace', { dataUrl: next });
    showTip('已旋转');
  }

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
  }

  window.addEventListener('pointerdown', (event) => {
    // 点在菜单内部时不关菜单，留给按钮的 click 处理；点菜单外才关
    if (menu && !menu.contains(event.target)) closeMenu();
  }, true);

  // ── 复制 / 保存 ──
  function copyImage() {
    if (!dataUrl) return;
    const bridge = window.zsnap;
    const result = bridge && bridge.copyImage ? bridge.copyImage(dataUrl) : { ok: false };
    if (result && result.ok) {
      S.notify('已复制到剪贴板');
      showTip('已复制到剪贴板');
      return;
    }
    const z = S.api();
    try {
      if (z && typeof z.copyImage === 'function') z.copyImage(dataUrl);
      showTip('已复制到剪贴板');
    } catch {
      showTip('复制失败');
    }
  }

  function saveImage() {
    if (!dataUrl) return;
    const z = S.api();
    const settings = S.getSettings();
    const bridge = window.zsnap;
    const name = S.fileName(settings);

    if (settings.saveDir && !settings.askEveryTime && bridge && bridge.saveImage) {
      const result = bridge.saveImage(settings.saveDir, name, dataUrl, 'png');
      if (result && result.ok) {
        S.notify('已保存到 ' + result.path);
        showTip('已保存');
      } else {
        showTip(result?.error || '保存失败');
      }
      return;
    }

    if (!z || typeof z.showSaveDialog !== 'function') return;
    const paths = bridge && bridge.paths ? bridge.paths() : {};
    let target = '';
    try {
      target = z.showSaveDialog({
        title: '保存图片',
        defaultPath: `${settings.saveDir || paths.pictures || ''}/${name}.png`.replace(/\\/g, '/'),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      }) || '';
    } catch (error) {
      console.warn('[snap] 保存对话框失败', error);
    }
    if (!target) return;
    const wrote = bridge && bridge.writeImage ? bridge.writeImage(target, dataUrl) : { ok: false };
    if (wrote && wrote.ok) {
      S.saveSettings({ saveDir: bridge.dirname(target) });
      S.notify('已保存到 ' + wrote.path);
      showTip('已保存');
    } else {
      showTip('保存失败');
    }
  }

  window.addEventListener('keydown', (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      send('pinBoard', { tab: 'pins' });
    }
  });
})();
