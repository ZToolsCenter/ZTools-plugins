/* 轻影截图 · 截图覆盖层
   冻结画面当作画布：框选 → 标注 → 复制/保存/悬浮/OCR/翻译。 */

(function () {
  'use strict';

  const S = window.SNAP;
  const z = S.api();
  const params = new URLSearchParams(window.location.search);

  const MODE = params.get('mode') === 'image' ? 'image' : 'screen';
  // 微信式选区编辑器：窗口本身就是选区，不框选、不压暗、不放大镜
  const WINDOW_MODE = params.get('mode') === 'window';
  const TOOLBAR_SIDE = params.get('toolbarSide') === 'top' ? 'top' : 'bottom';
  const TOOLBAR_H = Number(params.get('toolbarHeight')) || 54;
  // 窗口为了放下工具条被撑宽时，左侧多出来的透明宽度
  const PAD_LEFT = Math.max(0, Number(params.get('padLeft')) || 0);
  if (WINDOW_MODE) document.documentElement.classList.add('win-mode');
  const PRIME_KEY = params.get('primeKey') || '';
  const IMAGE_KEY = params.get('imageKey') || '';
  const INLINE_IMAGE = params.get('image') || '';
  // preload 截完图会写成临时文件，把路径带过来（大图无法塞进 URL）
  const SHOT_PATH = params.get('shot') || '';
  const WAIT_IMAGE = params.get('waitImage') === '1';
  const QUICK_ACTION = params.get('action') || '';
  const RETURN_INPUT = params.get('returnInput') === '1';

  const displayInfo = {
    id: Number(params.get('displayId')) || 0,
    x: Number(params.get('displayX')) || 0,
    y: Number(params.get('displayY')) || 0,
    width: Number(params.get('displayWidth')) || 0,
    height: Number(params.get('displayHeight')) || 0,
    scaleFactor: Number(params.get('scaleFactor')) || 1
  };

  const el = {
    stage: document.getElementById('stage'),
    shot: document.getElementById('shot'),
    ink: document.getElementById('ink'),
    edge: document.getElementById('edge'),
    dim: document.getElementById('dim'),
    frame: document.getElementById('frame'),
    hud: document.getElementById('hud'),
    hint: document.getElementById('hint'),
    toolbar: document.getElementById('toolbar'),
    palette: document.getElementById('palette'),
    mag: document.getElementById('magnifier'),
    magCanvas: document.getElementById('magnifier-canvas'),
    magText: document.getElementById('magnifier-text'),
    editor: document.getElementById('editor'),
    editorInput: document.getElementById('editor-input'),
    loading: document.getElementById('loading')
  };

  const shotCtx = el.shot.getContext('2d', { alpha: false });
  const inkCtx = el.ink.getContext('2d');
  const magCtx = el.magCanvas.getContext('2d', { willReadFrequently: true });

  // 取色专用 1×1 画布：避免每次移动都对整张大图做 GPU 回读
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    settings: S.getSettings(),
    image: null,
    inkBase: document.createElement('canvas'),
    scale: 1,
    ox: 0,
    oy: 0,
    selection: null,
    tool: 'none',
    color: '#ff4d4f',
    width: 3,
    ops: [],
    redo: [],
    draft: null,
    interaction: null,
    editorPos: null,
    finished: false,
    ready: false,
    paletteOpen: false
  };

  // 选区小窗拖动状态
  let winDrag = null;

  if (state.settings.lastTool && state.settings.lastTool !== 'none') state.tool = state.settings.lastTool;
  state.color = state.settings.color || state.color;
  state.width = Number(state.settings.strokeWidth) || 3;

  // ───────────────────────── 基础换算 ─────────────────────────

  function imagePoint(clientX, clientY) {
    return {
      x: (clientX - state.ox) / state.scale,
      y: (clientY - state.oy) / state.scale
    };
  }

  function viewPoint(p) {
    return { x: p.x * state.scale + state.ox, y: p.y * state.scale + state.oy };
  }

  function selectionViewRect() {
    if (!state.selection) return null;
    const p = viewPoint({ x: state.selection.x, y: state.selection.y });
    return {
      left: p.x,
      top: p.y,
      width: state.selection.w * state.scale,
      height: state.selection.h * state.scale
    };
  }

  function currentRect() {
    if (state.selection) return { ...state.selection };
    return { x: 0, y: 0, w: state.image.width, h: state.image.height };
  }

  function normalize(a, b) {
    return {
      x: Math.round(Math.min(a.x, b.x)),
      y: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y))
    };
  }

  function clampSelection(rect) {
    const maxW = state.image ? state.image.width : 0;
    const maxH = state.image ? state.image.height : 0;
    let x = Math.max(0, Math.min(rect.x, maxW - 1));
    let y = Math.max(0, Math.min(rect.y, maxH - 1));
    let w = Math.max(1, Math.min(rect.w, maxW - x));
    let h = Math.max(1, Math.min(rect.h, maxH - y));
    return { x, y, w, h };
  }

  // ───────────────────────── 绘制 ─────────────────────────

  function drawPen(ctx, op) {
    const pts = op.pts;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.globalAlpha = op.alpha == null ? 1 : op.alpha;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i += 1) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(ctx, op) {
    const { x1, y1, x2, y2 } = op;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(10, op.width * 4.2);
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(angle) * head * 0.55, y2 - Math.sin(angle) * head * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(angle - 0.42) * head, y2 - Math.sin(angle - 0.42) * head);
    ctx.lineTo(x2 - Math.cos(angle + 0.42) * head, y2 - Math.sin(angle + 0.42) * head);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function paintOp(ctx, op) {
    if (!op) return;
    if (op.t === 'rect') {
      ctx.save();
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(op.x, op.y, op.w, op.h);
      ctx.restore();
      return;
    }
    if (op.t === 'ellipse') {
      ctx.save();
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.ellipse(op.x + op.w / 2, op.y + op.h / 2, Math.abs(op.w / 2), Math.abs(op.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (op.t === 'line') {
      ctx.save();
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (op.t === 'arrow') {
      drawArrow(ctx, op);
      return;
    }
    if (op.t === 'pen' || op.t === 'marker') {
      drawPen(ctx, op);
      return;
    }
    if (op.t === 'eraser') {
      // destination-out：只擦标注层，底图不动
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = op.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      op.pts.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (op.pts.length === 1) {
        ctx.lineTo(op.pts[0][0] + 0.01, op.pts[0][1]);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (op.t === 'mosaic' && op.patch) {
      ctx.drawImage(op.patch, op.x, op.y, op.w, op.h);
      return;
    }
    if (op.t === 'serial') {
      // 序号：实心圆 + 白色数字，编号按顺序自动排（删掉中间的会自动补位）
      const r = Math.max(4, op.r);
      const n = String(op.num || 1);
      const font = Math.min(r * 1.3, (r * 2.76) / n.length);
      ctx.save();
      ctx.fillStyle = op.color;
      ctx.beginPath();
      ctx.arc(op.x, op.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = op.labelColor || '#ffffff';
      ctx.font = `700 ${font}px "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n, op.x, op.y + font * 0.04);
      ctx.restore();
      return;
    }
    if (op.t === 'text') {
      ctx.save();
      ctx.fillStyle = op.color;
      ctx.textBaseline = 'top';
      ctx.font = `600 ${op.size}px "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif`;
      const lines = String(op.text).split('\n');
      const lineHeight = op.size * 1.32;
      lines.forEach((line, index) => {
        ctx.fillText(line, op.x, op.y + index * lineHeight);
      });
      ctx.restore();
    }
  }

  function rebuildInkBase() {
    state.inkBase.width = state.image.width;
    state.inkBase.height = state.image.height;
    const ctx = state.inkBase.getContext('2d');
    ctx.clearRect(0, 0, state.inkBase.width, state.inkBase.height);
    for (const op of state.ops) paintOp(ctx, op);
  }

  let renderPending = false;

  function render() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      inkCtx.clearRect(0, 0, el.ink.width, el.ink.height);
      if (state.ops.length) inkCtx.drawImage(state.inkBase, 0, 0);
      if (state.draft) paintOp(inkCtx, state.draft);
    });
  }

  // ───────────────────────── 界面同步 ─────────────────────────

  function syncOverlay() {
    if (WINDOW_MODE) {
      // 窗口本身就是选区：没有「框外」需要压暗，也没有尺寸角标
      el.dim.style.display = 'none';
      el.frame.hidden = true;
      el.hud.hidden = true;
      return;
    }
    const rect = selectionViewRect();
    if (!rect || rect.width < 2 || rect.height < 2) {
      // 还没框选：整屏压一层很淡的暗，提示「这是截图模式」
      el.dim.style.left = '0px';
      el.dim.style.top = '0px';
      el.dim.style.width = '100%';
      el.dim.style.height = '100%';
      el.dim.style.background = 'rgba(0, 0, 0, .18)';
      el.dim.style.boxShadow = 'none';
      el.frame.hidden = true;
      el.hud.hidden = true;
      return;
    }
    el.dim.style.background = 'transparent';
    el.dim.style.left = `${rect.left}px`;
    el.dim.style.top = `${rect.top}px`;
    el.dim.style.width = `${rect.width}px`;
    el.dim.style.height = `${rect.height}px`;
    el.dim.style.boxShadow = `0 0 0 9999px rgba(0, 0, 0, .42)`;

    el.frame.hidden = false;
    el.frame.style.left = `${rect.left}px`;
    el.frame.style.top = `${rect.top}px`;
    el.frame.style.width = `${rect.width}px`;
    el.frame.style.height = `${rect.height}px`;

    const text = `${Math.round(state.selection.w)} × ${Math.round(state.selection.h)}`;
    el.hud.hidden = false;
    el.hud.textContent = text;
    const hudTop = rect.top > 26 ? rect.top - 26 : rect.top + 8;
    el.hud.style.left = `${Math.max(4, rect.left)}px`;
    el.hud.style.top = `${hudTop}px`;
  }

  // ───────────────────────── 工具条 ─────────────────────────

  const ICON = {
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.6"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    arrow: '<path d="M4.5 19.5 17 7"/><path d="M11.6 6.4H18v6.4"/>',
    line: '<path d="M4.5 19.5 19.5 4.5"/>',
    pen: '<path d="M4 20l1-4.4 9.4-9.4 3.4 3.4L8.4 19 4 20z"/><path d="M13.4 7.2l3.4 3.4"/>',
    marker: '<path d="M7.5 17.5h9"/><path d="M9 15.5 15.6 5.6l2.8 1.9L11.8 17.5H9z"/>',
    mosaic: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    eraser: '<path d="M9.2 19.4h10.4"/><path d="M14.4 4.9 5.6 13.7a2 2 0 0 0 0 2.8l1.9 1.9a2 2 0 0 0 2.8 0l8.8-8.8a2 2 0 0 0 0-2.8l-1.9-1.9a2 2 0 0 0-2.8 0z"/><path d="M9.2 9.3l5.5 5.5"/>',
    text: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9.4 19h5.2"/>',
    undo: '<path d="M8.5 8H14a4.5 4.5 0 0 1 0 9H6.5"/><path d="M10.8 5.2 8 8l2.8 2.8"/>',
    redo: '<path d="M15.5 8H10a4.5 4.5 0 0 0 0 9h7.5"/><path d="M13.2 5.2 16 8l-2.8 2.8"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M15 6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v6.6A2.2 2.2 0 0 0 6.2 15"/>',
    save: '<path d="M12 4v10"/><path d="M8.2 10.6 12 14.4l3.8-3.8"/><path d="M5 18.5h14"/>',
    pin: '<path d="M9 4h6l-.8 5 3 3.4H6.8l3-3.4L9 4z"/><path d="M12 12.4V20"/>',
    ocr: '<path d="M4 8.5V5.6A1.6 1.6 0 0 1 5.6 4h3"/><path d="M20 8.5V5.6A1.6 1.6 0 0 0 18.4 4h-3"/><path d="M4 15.5v2.9A1.6 1.6 0 0 0 5.6 20h3"/><path d="M20 15.5v2.9A1.6 1.6 0 0 1 18.4 20h-3"/><path d="M8 9.6h8"/><path d="M8 14.4h5"/>',
    translate: '<path d="M4 6h8"/><path d="M8 6v2c0 3-1.6 5.2-4 6.4"/><path d="M5.6 10.4c.9 2 2.6 3.4 4.6 4"/><path d="M12.6 20l3.6-9 3.6 9"/><path d="M14 17h4.6"/>',
    close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
    serial: '<circle cx="12" cy="12" r="8.2"/><path d="M11.2 9.4 13 8.2v7.6"/><path d="M10.2 15.8h5.6"/>'
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  }

  const TOOLS = [
    { key: 'rect', icon: 'rect', title: '矩形', hint: 'R' },
    { key: 'ellipse', icon: 'ellipse', title: '椭圆', hint: 'E' },
    { key: 'arrow', icon: 'arrow', title: '箭头', hint: 'A' },
    { key: 'line', icon: 'line', title: '直线', hint: 'L' },
    { key: 'pen', icon: 'pen', title: '画笔', hint: 'P' },
    { key: 'marker', icon: 'marker', title: '荧光笔', hint: 'H' },
    { key: 'mosaic', icon: 'mosaic', title: '马赛克', hint: 'M' },
    { key: 'serial', icon: 'serial', title: '序号', hint: 'N' },
    { key: 'eraser', icon: 'eraser', title: '橡皮擦', hint: 'X' },
    { key: 'text', icon: 'text', title: '文字', hint: 'T' }
  ];

  const PALETTE = ['#ff4d4f', '#ffb020', '#34c759', '#2f7cf6', '#ffffff', '#161a1f'];
  const WIDTHS = [2, 3, 5, 8];

  function buildToolbar() {
    el.toolbar.innerHTML = '';
    TOOLS.forEach((tool) => {
      const btn = document.createElement('button');
      btn.dataset.tool = tool.key;
      btn.title = `${tool.title} (${tool.hint})`;
      btn.innerHTML = icon(tool.icon);
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        setTool(tool.key, { toggle: true });
      });
      el.toolbar.appendChild(btn);
    });

    const colorBtn = document.createElement('button');
    colorBtn.id = 'color-btn';
    colorBtn.title = '颜色与粗细';
    colorBtn.style.cssText = `color:${state.color}`;
    colorBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6.4" fill="currentColor"/><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.35)" stroke-width="1.2" fill="none"/></svg>';
    colorBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePalette();
    });
    el.toolbar.appendChild(sep());

    el.toolbar.appendChild(colorBtn);
    el.toolbar.appendChild(sep());

    const undo = button('undo', '撤销 (Ctrl+Z)', () => doUndo());
    undo.id = 'btn-undo';
    const redo = button('redo', '重做 (Ctrl+Y)', () => doRedo());
    redo.id = 'btn-redo';
    el.toolbar.appendChild(undo);
    el.toolbar.appendChild(redo);
    el.toolbar.appendChild(sep());

    const copy = button('copy', '复制 (Enter)', () => doAction('copy'));
    copy.classList.add('chip');
    copy.innerHTML += '<span>复制</span>';
    const save = button('save', '保存 (Ctrl+S)', () => doAction('save'));
    save.classList.add('chip');
    save.innerHTML += '<span>保存</span>';
    const pin = button('pin', '悬浮到屏幕', () => doAction('pin'));
    pin.classList.add('chip');
    pin.innerHTML += '<span>悬浮</span>';
    const ocr = button('ocr', '识别文字', () => doAction('ocr'));
    ocr.classList.add('chip');
    ocr.innerHTML += '<span>识别</span>';
    const translate = button('translate', '翻译图片文字', () => doAction('translate'));
    translate.classList.add('chip');
    translate.innerHTML += '<span>翻译</span>';
    [copy, save, pin, ocr, translate].forEach((btn) => el.toolbar.appendChild(btn));

    el.toolbar.appendChild(sep());
    const close = button('close', '取消 (Esc)', () => cancel());
    close.classList.add('danger');
    el.toolbar.appendChild(close);

    buildPalette();
    syncToolbar();
  }

  function button(name, title, handler) {
    const btn = document.createElement('button');
    btn.title = title;
    btn.innerHTML = icon(name);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return btn;
  }

  function sep() {
    const node = document.createElement('span');
    node.className = 'sep';
    return node;
  }

  function buildPalette() {
    el.palette.innerHTML = '';
    PALETTE.forEach((color) => {
      const dot = document.createElement('button');
      dot.className = 'swatch';
      dot.dataset.color = color;
      dot.style.background = color;
      dot.title = color;
      dot.addEventListener('click', (event) => {
        event.stopPropagation();
        state.color = color;
        S.saveSettings({ color });
        syncPalette();
        syncToolbar();
      });
      el.palette.appendChild(dot);
    });

    const widths = document.createElement('div');
    widths.className = 'widths';
    WIDTHS.forEach((width) => {
      const btn = document.createElement('button');
      btn.className = 'wbtn';
      btn.dataset.width = String(width);
      btn.title = `${width}px`;
      const dot = document.createElement('i');
      const size = 3 + width * 1.5;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      btn.appendChild(dot);
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        state.width = width;
        S.saveSettings({ strokeWidth: width });
        syncPalette();
        syncToolbar();
      });
      widths.appendChild(btn);
    });
    el.palette.appendChild(widths);
    syncPalette();
  }

  function syncPalette() {
    el.palette.querySelectorAll('.swatch').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.color === state.color);
    });
    el.palette.querySelectorAll('.wbtn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.width) === state.width);
    });
  }

  function syncToolbar() {
    el.toolbar.querySelectorAll('button[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === state.tool);
    });
    const colorBtn = document.getElementById('color-btn');
    if (colorBtn) colorBtn.style.color = state.color;
    const undo = document.getElementById('btn-undo');
    if (undo) undo.disabled = state.ops.length === 0;
    const redo = document.getElementById('btn-redo');
    if (redo) redo.disabled = state.redo.length === 0;

    const drawing = ['rect', 'ellipse', 'arrow', 'pen', 'marker', 'mosaic', 'eraser'].includes(state.tool) || state.tool === 'text';
    if (!drawing) closePalette();
  }

  function togglePalette() {
    state.paletteOpen = !state.paletteOpen;
    el.palette.hidden = !state.paletteOpen;
    if (state.paletteOpen) placePalette();
  }

  function closePalette() {
    if (!state.paletteOpen) return;
    state.paletteOpen = false;
    el.palette.hidden = true;
  }

  function placePalette() {
    if (!state.paletteOpen) return;
    const bar = el.toolbar.getBoundingClientRect();
    const box = el.palette.getBoundingClientRect();
    let left = bar.left;
    let top = bar.top - box.height - 8;
    if (top < 8) top = bar.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    el.palette.style.left = `${Math.round(left)}px`;
    el.palette.style.top = `${Math.round(top)}px`;
  }

  function placeToolbar() {
    if (WINDOW_MODE) {
      if (!state.image) {
        el.toolbar.hidden = true;
        return;
      }
      el.toolbar.hidden = false;

      // 窗口窄于工具条时收掉动作按钮的文字，只留图标
      const root = document.documentElement;
      root.classList.remove('compact');
      el.toolbar.classList.remove('wrap');
      if (el.toolbar.getBoundingClientRect().width > window.innerWidth - 12) {
        root.classList.add('compact');
      }
      // 收到最小还是放不下（超窄屏 / 极端 DPI）就换行，绝不裁掉按钮
      if (el.toolbar.getBoundingClientRect().width > window.innerWidth - 12) {
        el.toolbar.classList.add('wrap');
      }

      const iw = state.image.naturalWidth || state.image.width;
      const imgW = Math.round(iw * state.scale);
      const imgH = Math.round((state.image.naturalHeight || state.image.height) * state.scale);
      const box = el.toolbar.getBoundingClientRect();

      let left = PAD_LEFT + imgW / 2 - box.width / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - box.width - 4));

      const slack = Math.max(0, (TOOLBAR_H - box.height) / 2);
      const top = TOOLBAR_SIDE === 'top' ? slack : state.oy + imgH + slack;

      el.toolbar.style.left = `${Math.round(left)}px`;
      el.toolbar.style.top = `${Math.round(Math.max(0, top))}px`;
      placePalette();
      return;
    }

    const rect = selectionViewRect();
    if (!rect) {
      el.toolbar.hidden = true;
      return;
    }
    el.toolbar.hidden = false;
    // 窄屏时自动换行，避免工具条溢出到屏幕外
    el.toolbar.classList.remove('wrap');
    if (el.toolbar.getBoundingClientRect().width > window.innerWidth - 24) {
      el.toolbar.classList.add('wrap');
    }
    const box = el.toolbar.getBoundingClientRect();
    const gap = 10;
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));

    let top = rect.top + rect.height + gap;
    if (top + box.height > window.innerHeight - 8) {
      top = rect.top - box.height - gap;
    }
    if (top < 8) top = Math.min(window.innerHeight - box.height - 8, rect.top + rect.height + gap);
    el.toolbar.style.left = `${Math.round(left)}px`;
    el.toolbar.style.top = `${Math.round(Math.max(8, top))}px`;
    placePalette();
  }

  function setTool(tool, options = {}) {
    const toggle = options.toggle !== false;
    // 再点一次同一个工具＝收起，回到「不改动选区」的状态
    state.tool = toggle && state.tool === tool ? 'none' : tool;
    S.saveSettings({ lastTool: state.tool });
    syncToolbar();
    closeEditor();
    // 马赛克不涉及颜色，别让调色板挡着画
    if (state.tool === 'mosaic') closePalette();
    if (state.tool !== 'text') hideHint();
    if (state.tool === 'mosaic') showHint('在图上拖一块要遮挡的区域');
    if (state.tool === 'serial') showHint('在图上点一下落一个序号，自动 1、2、3…');
    if (state.tool === 'none') {
      showHint(WINDOW_MODE ? '按住图片可以拖动窗口' : '拖动选区内部可移动，拖到外面重新框选');
    }
  }

  // ───────────────────────── 马赛克 ─────────────────────────

  // 屏幕上看起来大约 8px 一块；缩放显示时按比例换算回图像坐标，
  // 这样不管窗口被放大还是缩小，马赛克颗粒的视觉大小都稳定。
  function mosaicBlock() {
    return Math.max(5, Math.round(8 / Math.max(0.2, state.scale || 1)));
  }

  function makeMosaic(rect) {
    const w = Math.max(1, Math.round(rect.w));
    const h = Math.max(1, Math.round(rect.h));
    const block = mosaicBlock();
    const sw = Math.max(1, Math.ceil(w / block));
    const sh = Math.max(1, Math.ceil(h / block));

    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    small.getContext('2d').drawImage(el.shot, rect.x, rect.y, w, h, 0, 0, sw, sh);

    const patch = document.createElement('canvas');
    patch.width = w;
    patch.height = h;
    const pctx = patch.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(small, 0, 0, w, h);
    return patch;
  }

  // 取不到底片时兜底：至少涂一层实心底色，别让用户觉得「点了没反应」
  function fallbackMosaic(rect) {
    const patch = document.createElement('canvas');
    patch.width = Math.max(1, Math.round(rect.w));
    patch.height = Math.max(1, Math.round(rect.h));
    const ctx = patch.getContext('2d');
    ctx.fillStyle = 'rgba(90, 96, 106, .92)';
    ctx.fillRect(0, 0, patch.width, patch.height);
    return patch;
  }

  function mosaicFor(rect) {
    try {
      const patch = makeMosaic(rect);
      // 极小的选区可能取到全透明：给个兜底
      return patch;
    } catch (error) {
      console.warn('[snap] 马赛克生成失败', error);
      S.sendToParent('diag', { message: `mosaic failed: ${error && error.message}` });
      return fallbackMosaic(rect);
    }
  }

  // ───────────────────────── 交互 ─────────────────────────

  function insideSelection(p) {
    const s = state.selection;
    if (!s) return false;
    return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  }

  function beginSelection(p) {
    state.interaction = { kind: 'select', origin: p };
    state.draft = null;
    render();
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (!state.ready) return;
    hideHint();
    closePalette();

    // 选区小窗（微信式）：没选工具、或者选了「移动」，按住图片直接搬窗口。
    // 工具条、按钮上的按下不参与拖动，否则点按钮会把窗口甩走。
    const draggable = state.tool === 'none';
    if (WINDOW_MODE && draggable
      && !(event.target.closest && event.target.closest('button, .toolbar, #toolbar'))) {
      winDrag = {
        startX: event.screenX,
        startY: event.screenY,
        originX: window.screenX,
        originY: window.screenY,
        moved: false
      };
      event.preventDefault();
      return;
    }

    const handle = event.target.closest ? event.target.closest('.handle') : null;
    if (handle) {
      const box = selectionViewRect();
      state.interaction = {
        kind: 'resize',
        dir: handle.dataset.h,
        start: imagePoint(event.clientX, event.clientY),
        box: { ...state.selection },
        view: box
      };
      event.preventDefault();
      return;
    }

    const p = imagePoint(event.clientX, event.clientY);
    const drawingTool = ['rect', 'ellipse', 'arrow', 'line', 'pen', 'marker', 'mosaic', 'eraser'].includes(state.tool);

    if (state.tool === 'serial' && state.selection && insideSelection(p)) {
      addSerialAt(p);
      event.preventDefault();
      return;
    }

    if (state.tool === 'text' && state.selection && insideSelection(p)) {
      openEditor(event.clientX, event.clientY, p);
      event.preventDefault();
      return;
    }

    if (drawingTool && state.selection && insideSelection(p)) {
      state.interaction = { kind: 'draw', start: p };
      state.draft = makeDraft(p);
      render();
      event.preventDefault();
      return;
    }

    // 没有选工具时，拖动选区内部＝整体移动选区
    // 选区编辑器窗口里本身就等于选区，移动/重框都没有意义
    if (!WINDOW_MODE && !drawingTool && state.selection && insideSelection(p)) {
      state.interaction = { kind: 'move', start: p, box: { ...state.selection } };
      event.preventDefault();
      return;
    }

    if (WINDOW_MODE) {
      event.preventDefault();
      return;
    }
    beginSelection(p);
    event.preventDefault();
  }

  // 编号永远按顺序排：删掉中间的，后面的自动补位
  function renumberSerials() {
    let n = 0;
    for (const op of state.ops) {
      if (op && op.t === 'serial') {
        n += 1;
        op.num = n;
      }
    }
  }

  // 点一下就落一个序号：屏幕上看直径约 26px，随缩放换算成图像像素
  function addSerialAt(p) {
    const radius = 13 / Math.max(0.2, state.scale || 1);
    state.ops.push({
      t: 'serial',
      x: p.x,
      y: p.y,
      r: radius,
      color: state.color === '#ffffff' ? '#ff4d4f' : state.color,
      labelColor: '#ffffff'
    });
    state.redo.length = 0;
    renumberSerials();
    rebuildInkBase();
    render();
    syncToolbar();
    showHint(`序号 ${state.ops.filter((op) => op.t === 'serial').length} · 继续点击接着编号`);
  }

  function makeDraft(p) {    const base = {
      color: state.color,
      width: state.width / state.scale
    };
    if (state.tool === 'rect' || state.tool === 'mosaic') {
      return { t: state.tool, x: p.x, y: p.y, w: 0, h: 0, ...base };
    }
    if (state.tool === 'ellipse') {
      return { t: 'ellipse', x: p.x, y: p.y, w: 0, h: 0, ...base };
    }
    if (state.tool === 'arrow' || state.tool === 'line') {
      return { t: state.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: state.color, width: state.width / state.scale };
    }
    if (state.tool === 'pen') {
      return { t: 'pen', pts: [[p.x, p.y]], color: state.color, width: state.width / state.scale };
    }
    if (state.tool === 'marker') {
      return {
        t: 'marker',
        pts: [[p.x, p.y]],
        color: state.color,
        width: (state.width * 3.4) / state.scale,
        alpha: 0.38
      };
    }
    if (state.tool === 'eraser') {
      return {
        t: 'eraser',
        pts: [[p.x, p.y]],
        // 橡皮擦要够粗才好用：屏幕上约 18~40px，随粗细档位放大
        width: Math.max(18, state.width * 7) / state.scale
      };
    }
    return null;
  }

  function handlePointerMove(event) {
    if (winDrag) {
      const dx = event.screenX - winDrag.startX;
      const dy = event.screenY - winDrag.startY;
      if (!winDrag.moved && Math.hypot(dx, dy) < 2) return;
      winDrag.moved = true;
      const x = Math.round(winDrag.originX + dx);
      const y = Math.round(winDrag.originY + dy);
      // 子窗口没有 setBounds 权限，交给父窗口搬
      if (window.zsnap && typeof window.zsnap.moveWindow === 'function') {
        window.zsnap.moveWindow(x, y);
      }
      return;
    }

    const p = imagePoint(event.clientX, event.clientY);
    updateMagnifier(event.clientX, event.clientY);
    const it = state.interaction;

    if (!it) {
      const canMove = !WINDOW_MODE && state.selection && state.tool === 'none' && insideSelection(p);
      document.body.style.cursor = WINDOW_MODE
        ? (state.tool === 'none' ? 'move' : 'default')
        : (canMove ? 'move' : 'crosshair');
      return;
    }

    if (it.kind === 'move') {
      const dx = p.x - it.start.x;
      const dy = p.y - it.start.y;
      state.selection = clampSelection({
        x: it.box.x + dx,
        y: it.box.y + dy,
        w: it.box.w,
        h: it.box.h
      });
      syncOverlay();
      placeToolbar();
      return;
    }

    if (it.kind === 'select') {
      const rect = normalize(it.origin, p);
      if (rect.w < 1 || rect.h < 1) return;
      state.selection = clampSelection(rect);
      syncOverlay();
      placeToolbar();
      return;
    }

    if (it.kind === 'draw' && state.draft) {
      const draft = state.draft;
      if (draft.t === 'rect' || draft.t === 'ellipse' || draft.t === 'mosaic') {
        const rect = normalize(it.start, p);
        draft.x = rect.x;
        draft.y = rect.y;
        draft.w = rect.w;
        draft.h = rect.h;
        // 马赛克必须边拖边看得见，否则用户会以为没生效。
        // 每帧重算太贵，只有尺寸变化超过 8px 或隔了 48ms 才刷新一次。
        if (draft.t === 'mosaic' && draft.w > 4 && draft.h > 4) {
          const now = performance.now();
          if (!draft.patch || now - (draft.patchedAt || 0) > 48 || Math.abs(draft.w - (draft.patchedW || 0)) > 8) {
            draft.patch = mosaicFor(draft);
            draft.patchedAt = now;
            draft.patchedW = draft.w;
          }
        }
      } else if (draft.t === 'arrow' || draft.t === 'line') {
        draft.x2 = p.x;
        draft.y2 = p.y;
      } else if (draft.t === 'pen' || draft.t === 'marker' || draft.t === 'eraser') {
        const last = draft.pts[draft.pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.2) draft.pts.push([p.x, p.y]);
      }
      render();
      return;
    }

    if (it.kind === 'resize') {
      const dx = p.x - it.start.x;
      const dy = p.y - it.start.y;
      let { x, y, w, h } = it.box;
      if (it.dir.includes('w')) {
        const nx = Math.min(x + w - 8, x + dx);
        w = x + w - nx;
        x = nx;
      }
      if (it.dir.includes('e')) w = Math.max(8, w + dx);
      if (it.dir.includes('n')) {
        const ny = Math.min(y + h - 8, y + dy);
        h = y + h - ny;
        y = ny;
      }
      if (it.dir.includes('s')) h = Math.max(8, h + dy);
      state.selection = clampSelection({ x, y, w, h });
      syncOverlay();
      placeToolbar();
    }
  }

  function handlePointerUp() {
    if (winDrag) {
      winDrag = null;
      return;
    }
    const it = state.interaction;
    state.interaction = null;
    if (!it) return;

    if (it.kind === 'select') {
      if (state.selection && (state.selection.w < 5 || state.selection.h < 5)) {
        state.selection = null;
        syncOverlay();
        el.toolbar.hidden = true;
        showHint('拖动鼠标框选区域');
        return;
      }
      if (!state.selection) return;
      syncOverlay();
      placeToolbar();
      return;
    }

    if (it.kind === 'draw' && state.draft) {
      const draft = state.draft;
      state.draft = null;
      let ok = false;
      if (draft.t === 'mosaic') {
        if (draft.w > 3 && draft.h > 3) {
          // 松手时按最终尺寸重算一次，保证颗粒清晰、坐标精确
          draft.patch = mosaicFor(draft);
          ok = true;
        } else {
          // 别静默丢弃，否则用户会以为工具没生效
          showHint('拖出来的范围太小，按住鼠标拉一块更大的区域');
        }
      } else if (draft.t === 'arrow' || draft.t === 'line') {
        ok = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 6;
      } else if (draft.t === 'pen' || draft.t === 'marker' || draft.t === 'eraser') {
        ok = draft.pts.length > 1;
      } else {
        ok = draft.w > 3 && draft.h > 3;
      }
      if (ok) {
        state.ops.push(draft);
        state.redo.length = 0;
        rebuildInkBase();
      }
      render();
      syncToolbar();
      return;
    }

    if (it.kind === 'resize') {
      state.selection = clampSelection(state.selection);
      syncOverlay();
      placeToolbar();
      return;
    }

    if (it.kind === 'move') {
      syncOverlay();
      placeToolbar();
    }
  }

  // ───────────────────────── 放大镜 ─────────────────────────

  function updateMagnifier(clientX, clientY) {
    if (WINDOW_MODE) {
      el.mag.hidden = true;
      return;
    }
    if (state.interaction && state.interaction.kind !== 'resize') {
      el.mag.hidden = true;
      return;
    }
    const p = imagePoint(clientX, clientY);
    if (p.x < 0 || p.y < 0 || p.x > state.image.width || p.y > state.image.height) {
      el.mag.hidden = true;
      return;
    }
    const span = 16;
    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, 132, 132);
    magCtx.drawImage(el.shot, p.x - span / 2, p.y - span / 2, span, span, 0, 0, 132, 132);

    magCtx.strokeStyle = 'rgba(96,165,250,.9)';
    magCtx.lineWidth = 1;
    magCtx.beginPath();
    magCtx.moveTo(66, 54);
    magCtx.lineTo(66, 78);
    magCtx.moveTo(54, 66);
    magCtx.lineTo(78, 66);
    magCtx.stroke();

    let rgb = '';
    try {
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.drawImage(state.image, Math.round(p.x), Math.round(p.y), 1, 1, 0, 0, 1, 1);
      const px = probeCtx.getImageData(0, 0, 1, 1).data;
      rgb = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    } catch {
      rgb = '';
    }
    el.magText.textContent = rgb ? `${rgb}  ${Math.round(p.x)}, ${Math.round(p.y)}` : `${Math.round(p.x)}, ${Math.round(p.y)}`;

    let left = clientX + 26;
    let top = clientY + 26;
    if (left + 132 > window.innerWidth - 8) left = clientX - 132 - 26;
    if (top + 160 > window.innerHeight - 8) top = clientY - 160 - 12;
    el.mag.style.left = `${Math.max(8, left)}px`;
    el.mag.style.top = `${Math.max(8, top)}px`;
    el.mag.hidden = false;
  }

  // ───────────────────────── 文字 ─────────────────────────

  function openEditor(clientX, clientY, imagePos) {
    const size = 22;
    el.editor.hidden = false;
    el.editor.style.left = `${clientX}px`;
    el.editor.style.top = `${clientY}px`;
    el.editorInput.value = '';
    el.editorInput.style.color = state.color;
    el.editorInput.style.fontSize = `${size * state.scale}px`;
    el.editorInput.style.width = '120px';
    state.editorPos = { ...imagePos, size };
    setTimeout(() => el.editorInput.focus(), 0);
    autoSizeEditor();
  }

  function autoSizeEditor() {
    el.editorInput.style.height = 'auto';
    el.editorInput.style.height = `${el.editorInput.scrollHeight}px`;
  }

  function commitEditor() {
    if (el.editor.hidden) return;
    const text = el.editorInput.value.replace(/\s+$/, '');
    const pos = state.editorPos;
    closeEditor();
    if (!text || !pos) return;
    state.ops.push({
      t: 'text',
      x: pos.x,
      y: pos.y,
      text,
      color: state.color,
      size: pos.size
    });
    state.redo.length = 0;
    rebuildInkBase();
    render();
    syncToolbar();
  }

  function closeEditor() {
    el.editor.hidden = true;
    el.editorInput.value = '';
    state.editorPos = null;
  }

  // ───────────────────────── 输出 ─────────────────────────

  function compose() {
    const rect = currentRect();
    const box = S.roundRect({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(state.image, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
    // 标注层整层贴上去：橡皮擦用的是 destination-out，必须限制在标注层内部，
    // 不能直接往合成画布上重放，否则会把底图一起擦穿。
    if (state.ops.length && state.inkBase.width) {
      ctx.drawImage(
        state.inkBase,
        box.left, box.top, box.width, box.height,
        0, 0, box.width, box.height
      );
    }
    return canvas.toDataURL('image/png');
  }

  function doUndo() {
    if (!state.ops.length) return;
    state.redo.push(state.ops.pop());
    renumberSerials();
    rebuildInkBase();
    render();
    syncToolbar();
  }

  function doRedo() {
    if (!state.redo.length) return;
    state.ops.push(state.redo.pop());
    renumberSerials();
    rebuildInkBase();
    render();
    syncToolbar();
  }

  async function doAction(action) {
    if (state.finished) return;
    if (action === 'close') {
      cancel();
      return;
    }
    if (!state.image) return;

    if (action === 'undo') return doUndo();
    if (action === 'redo') return doRedo();

    let dataUrl;
    try {
      dataUrl = compose();
    } catch (error) {
      console.warn('[snap] 合成失败', error);
      showHint('截图合成失败');
      return;
    }

    if (!dataUrl) return;

    if (action === 'copy') {
      const ok = await copyImage(dataUrl);
      S.notify(ok ? '已复制到剪贴板' : '复制失败，已改为保存');
      if (!ok) return saveImage(dataUrl);
      finish();
      return;
    }

    if (action === 'save') {
      return saveImage(dataUrl);
    }

    if (action === 'pin') {
      const rect = currentRect();
      const topLeft = viewPoint({ x: rect.x, y: rect.y });
      const bounds = {
        x: Math.round(window.screenX + topLeft.x),
        y: Math.round(window.screenY + topLeft.y),
        width: Math.max(40, Math.round(rect.w * state.scale)),
        height: Math.max(40, Math.round(rect.h * state.scale))
      };
      // 子窗口的 preload 持有完整 ztools API，直接建窗即可，不必中转
      let opened = false;
      try {
        if (window.zsnap && typeof window.zsnap.openPin === 'function') {
          opened = Boolean(window.zsnap.openPin(dataUrl, bounds)?.ok);
        }
      } catch (error) {
        console.warn('[snap] 打开悬浮窗失败', error);
      }
      if (!opened) S.sendToParent('pin', { dataUrl, bounds });
      finish();
      return;
    }

    if (action === 'ocr' || action === 'translate') {
      let opened = false;
      let viaParent = false;
      try {
        if (window.zsnap && typeof window.zsnap.openResult === 'function') {
          const res = window.zsnap.openResult(dataUrl, action);
          opened = Boolean(res && res.ok);
          viaParent = Boolean(res && res.via === 'parent');
        }
      } catch (error) {
        console.warn('[snap] 打开结果窗失败', error);
      }
      if (!opened) {
        S.sendToParent(action, { dataUrl });
        finish();
        return;
      }
      // 走 parent 通道时，父窗口会把这扇窗「原地导航」成结果窗 —— 本窗绝不能自己关，
      // 否则刚导航过去的结果窗会立刻被关掉。
      if (!viaParent) finish();
      return;
    }
  }

  async function copyImage(dataUrl) {
    if (window.zsnap && typeof window.zsnap.copyImage === 'function') {
      const result = window.zsnap.copyImage(dataUrl);
      if (result && result.ok) return true;
    }
    if (z && typeof z.copyImage === 'function') {
      try {
        if (z.copyImage(dataUrl) !== false) return true;
      } catch {
        // 继续尝试浏览器剪贴板
      }
    }
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  function saveImage(dataUrl) {
    const settings = S.getSettings();
    const baseName = S.fileName(settings);
    const paths = window.zsnap?.paths?.() || {};
    const dir = settings.saveDir || '';

    const needDialog = !dir || settings.askEveryTime;
    if (needDialog) {
      if (!z || typeof z.showSaveDialog !== 'function') {
        download(dataUrl, baseName);
        return;
      }
      let target = '';
      try {
        target = z.showSaveDialog({
          title: '保存截图',
          defaultPath: `${dir || paths.pictures || ''}/${baseName}.png`.replace(/\\/g, '/'),
          filters: [{ name: 'PNG 图片', extensions: ['png'] }]
        }) || '';
      } catch (error) {
        console.warn('[snap] 保存对话框失败', error);
      }
      if (!target) {
        showHint('已取消保存');
        return;
      }
      const result = window.zsnap.writeImage(target, dataUrl);
      if (result && result.ok) {
        S.saveSettings({ saveDir: window.zsnap.dirname(target) });
        S.notify('已保存到 ' + result.path);
        finish();
      } else {
        showHint('保存失败');
      }
      return;
    }

    const result = window.zsnap.saveImage(dir, baseName, dataUrl, 'png');
    if (result && result.ok) {
      S.notify('已保存到 ' + result.path);
      if (S.getSettings().copyAfterSave) copyImage(dataUrl);
      finish();
    } else {
      showHint(result?.error || '保存失败');
    }
  }

  function download(dataUrl, name) {
    try {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${name}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      finish();
    } catch {
      showHint('保存失败');
    }
  }

  function finish() {
    if (state.finished) return;
    state.finished = true;
    // 主窗口此时已 outPlugin 回后台，本窗口独立存活；关掉自己即可，
    // 所有插件窗口关闭后宿主会自动回收（强杀会连带干掉已打开的悬浮窗）。
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // 窗口已关闭
      }
    }, 90);
  }

  function cancel() {
    if (state.finished) return;
    state.finished = true;
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // 窗口已关闭
      }
    }, 60);
  }

  // ───────────────────────── 提示 ─────────────────────────

  let hintTimer = null;

  function showHint(text) {
    if (WINDOW_MODE) return; // 选区编辑器里不需要框选提示
    el.hint.textContent = text;
    el.hint.classList.remove('hide');
    if (hintTimer) clearTimeout(hintTimer);
  }

  function hideHint() {
    el.hint.classList.add('hide');
  }

  // ───────────────────────── 采集画面 ─────────────────────────

  function hostDisplay() {
    return {
      id: displayInfo.id,
      bounds: {
        x: displayInfo.x,
        y: displayInfo.y,
        width: displayInfo.width || window.screen.width,
        height: displayInfo.height || window.screen.height
      },
      scaleFactor: displayInfo.scaleFactor || 1
    };
  }

  async function captureScreen() {
    if (!z || typeof z.desktopCaptureSources !== 'function') throw new Error('宿主不支持屏幕采集');
    const display = hostDisplay();
    const pixelWidth = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
    const pixelHeight = Math.max(1, Math.round(display.bounds.height * display.scaleFactor));
    const sources = await z.desktopCaptureSources({
      types: ['screen'],
      thumbnailSize: { width: pixelWidth, height: pixelHeight }
    });
    const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
    if (!list.length) throw new Error('没有可用的屏幕源');
    const matched = list.find((item) => String(item.display_id) === String(display.id))
      || list.find((item) => /^screen/i.test(String(item.id || '')))
      || list[0];
    const thumbnail = matched && matched.thumbnail;
    const dataUrl = thumbnail && typeof thumbnail.toDataURL === 'function' ? thumbnail.toDataURL() : '';
    if (!dataUrl) throw new Error('未获取到屏幕画面');
    return dataUrl;
  }

  function readPrimedFrame(key, timeoutMs = 2600) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        let raw = null;
        try {
          raw = window.localStorage.getItem(key);
        } catch {
          resolve('');
          return;
        }
        if (raw) {
          try {
            window.localStorage.removeItem(key);
          } catch {
            // 清理失败忽略
          }
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed && parsed.dataUrl ? parsed.dataUrl : '');
          } catch {
            resolve(raw.startsWith('data:') ? raw : '');
          }
          return;
        }
        if (Date.now() > deadline) {
          resolve('');
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  function waitIncomingImage(timeoutMs = 8000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (url) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poller);
        resolve(url);
      };
      const timer = setTimeout(() => finish(''), timeoutMs);

      // ① 父页面经 ipc 投递
      S.onChildMessage((payload) => {
        if (payload && payload.event === 'image' && payload.dataUrl) finish(payload.dataUrl);
      });

      // ② 兜底：父页面把图片暂存在同一 partition 的 localStorage
      const poller = setInterval(() => {
        if (!IMAGE_KEY) return;
        try {
          const url = window.localStorage.getItem(IMAGE_KEY);
          if (url) finish(url);
        } catch {
          // 忽略
        }
      }, 250);
    });
  }

  async function resolveImage() {
    // 主路径：preload 已把整屏截图写成临时文件，路径在 ?shot=
    if (SHOT_PATH) {
      try {
        const hit = window.zsnap && typeof window.zsnap.readShot === 'function'
          ? window.zsnap.readShot(SHOT_PATH)
          : null;
        if (hit && hit.ok && hit.dataUrl) return hit.dataUrl;
      } catch (error) {
        console.warn('[snap] 读取临时截图失败', error);
      }
    }

    if (MODE === 'image') {
      let dataUrl = '';
      if (IMAGE_KEY) {
        try {
          dataUrl = window.localStorage.getItem(IMAGE_KEY) || '';
        } catch {
          dataUrl = '';
        }
      }
      if (!dataUrl) dataUrl = INLINE_IMAGE;
      if (!dataUrl && WAIT_IMAGE) dataUrl = await waitIncomingImage();
      if (!dataUrl) throw new Error('缺少待编辑的图片');
      return dataUrl;
    }

    if (PRIME_KEY) {
      const primed = await readPrimedFrame(PRIME_KEY);
      if (primed) return primed;
    }
    return captureScreen();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = src;
    });
  }

  // ─────────────── 底图升级（宿主给的是逻辑像素，父窗口随后补一张物理像素的） ───────────────

  async function applyShotUpgrade(dataUrl) {
    if (!dataUrl || !state.image) return;
    // 用户已经动笔就别换：标注坐标是按旧图像的像素记的，换了会整体错位
    if (state.ops && state.ops.length) {
      S.sendToParent('diag', { message: 'shotUpgrade 跳过（已有标注）' });
      return;
    }
    let next;
    try {
      next = await loadImage(dataUrl);
    } catch {
      return;
    }
    const oldW = state.image.naturalWidth || state.image.width;
    const oldH = state.image.naturalHeight || state.image.height;
    const newW = next.naturalWidth || next.width;
    const newH = next.naturalHeight || next.height;
    if (!newW || !newH) return;
    if (newW <= oldW + 1 && newH <= oldH + 1) return;

    state.image = next;
    const rx = oldW ? newW / oldW : 1;
    const ry = oldH ? newH / oldH : 1;

    if (WINDOW_MODE || MODE === 'image' || QUICK_ACTION === 'save') {
      state.selection = { x: 0, y: 0, w: newW, h: newH };
    } else if (state.selection) {
      state.selection = clampSelection({
        x: Math.round(state.selection.x * rx),
        y: Math.round(state.selection.y * ry),
        w: Math.round(state.selection.w * rx),
        h: Math.round(state.selection.h * ry)
      });
    }

    layout();
    S.sendToParent('diag', {
      message: `shotUpgrade 换图 ${oldW}x${oldH} → ${newW}x${newH} scale=${Number(state.scale.toFixed(3))}`
    });
  }

  // ───────────────────────── 布局 ─────────────────────────

  function layout() {
    if (!state.image) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const iw = state.image.naturalWidth || state.image.width;
    const ih = state.image.naturalHeight || state.image.height;

    let scale;
    let ox;
    let oy;
    if (WINDOW_MODE) {
      // 窗口 = 图片 + 工具条空白区，图永远 1:1 铺满，不做任何放大
      const boxH = Math.max(1, vh - TOOLBAR_H);
      scale = Math.min(vw / iw, boxH / ih);
      ox = PAD_LEFT;
      oy = TOOLBAR_SIDE === 'top' ? TOOLBAR_H : 0;
    } else {
      scale = Math.min(vw / iw, vh / ih, MODE === 'image' ? 1 : 2);
      ox = Math.round((vw - iw * scale) / 2);
      oy = Math.round((vh - ih * scale) / 2);
    }
    state.scale = scale;
    state.ox = ox;
    state.oy = oy;

    el.shot.width = iw;
    el.shot.height = ih;
    el.ink.width = iw;
    el.ink.height = ih;
    for (const canvas of [el.shot, el.ink]) {
      canvas.style.width = `${iw * scale}px`;
      canvas.style.height = `${ih * scale}px`;
      canvas.style.transform = `translate(${state.ox}px, ${state.oy}px)`;
    }
    // 截图边缘内描边：画在图片内缘、不被裁，任何底色都能跟桌面区分（最省事、不动窗口尺寸/坐标）
    if (el.edge) {
      el.edge.style.display = WINDOW_MODE ? 'block' : 'none';
      el.edge.style.width = `${iw * scale}px`;
      el.edge.style.height = `${ih * scale}px`;
      el.edge.style.transform = `translate(${state.ox}px, ${state.oy}px)`;
    }
    shotCtx.drawImage(state.image, 0, 0);

    state.inkBase.width = iw;
    state.inkBase.height = ih;
    rebuildInkBase();

    if (state.selection) {
      const maxW = iw;
      const maxH = ih;
      state.selection = clampSelection({
        x: Math.min(state.selection.x, maxW - 1),
        y: Math.min(state.selection.y, maxH - 1),
        w: state.selection.w,
        h: state.selection.h
      });
    }
    syncOverlay();
    placeToolbar();
    render();
  }

  // ───────────────────────── 启动 ─────────────────────────

  async function initialize() {
    if (WINDOW_MODE) el.loading.style.display = 'none';
    buildToolbar();

    // 父窗口抓到物理像素底图后会推过来，在这里原地换掉
    S.onChildMessage((payload) => {
      if (payload && payload.event === 'shotUpgrade') applyShotUpgrade(payload.dataUrl);
    });

    try {
      const source = await resolveImage();
      state.image = await loadImage(source);
    } catch (error) {
      console.warn('[snap] 取图失败', error);
      S.sendToParent('captureFailed', { message: String(error && error.message || error) });
      showHint('屏幕采集失败，正在尝试系统截图…');
      return;
    }

    layout();
    el.loading.classList.add('done');
    state.ready = true;

    if (WINDOW_MODE || MODE === 'image' || QUICK_ACTION === 'save') {
      const iw = state.image.naturalWidth || state.image.width;
      const ih = state.image.naturalHeight || state.image.height;
      state.selection = { x: 0, y: 0, w: iw, h: ih };
      syncOverlay();
      placeToolbar();
    }

    S.sendToParent('ready', {
      width: state.image.width,
      height: state.image.height,
      scale: state.scale
    });

    // 屏幕参数写进 diag：下次再出「糊」的问题，这几行就能定位
    try {
      const iw = state.image.naturalWidth || state.image.width;
      const ih = state.image.naturalHeight || state.image.height;
      const dpr = window.devicePixelRatio || 1;
      S.sendToParent('diag', {
        message: `overlay dpr=${dpr} css=${window.innerWidth}x${window.innerHeight} `
          + `img=${iw}x${ih} scale=${Number(state.scale.toFixed(3))} sf=${displayInfo.scaleFactor}`
      });

      // 实测 dpr 与宿主报的缩放比不一致时，让父窗口按真实 dpr 重设一次尺寸。
      // 这一步把「图被物理放大 1.25 倍所以看着糊」直接掐掉。
      if (WINDOW_MODE && iw && Math.abs(dpr - (displayInfo.scaleFactor || 1)) > 0.02) {
        S.sendToParent('resizeEditor', {
          width: Math.max(560, Math.round(iw / dpr)),
          height: Math.round(ih / dpr) + TOOLBAR_H,
          dpr
        });
      }
    } catch {
      // 忽略
    }

    if (QUICK_ACTION === 'save') {
      showHint('回车保存，Ctrl+C 复制');
    } else if (MODE === 'image') {
      showHint('可直接标注；拖动可重新框选范围');
    }
  }

  // ───────────────────────── 事件绑定 ─────────────────────────

  // 窗口尺寸被父窗口改过（换底图 / 退回 1:1 / 用户拖角）后要重新排一次
  window.addEventListener('resize', () => {
    if (state.image && state.ready) layout();
  });

  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (state.editorPos) {
      closeEditor();
      return;
    }
    if (WINDOW_MODE) {
      // 窗口就是选区，右键不该把选区清掉
      cancel();
      return;
    }
    if (state.selection) {
      state.selection = null;
      syncOverlay();
      el.toolbar.hidden = true;
      showHint('拖动鼠标框选区域');
      return;
    }
    cancel();
  });

  el.editorInput.addEventListener('input', autoSizeEditor);
  el.editorInput.addEventListener('blur', commitEditor);
  el.editorInput.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      closeEditor();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitEditor();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (state.editorPos) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = String(event.key || '').toLowerCase();

    if (event.key === 'Escape') {
      if (WINDOW_MODE) {
        cancel();
        return;
      }
      if (state.selection) {
        state.selection = null;
        syncOverlay();
        el.toolbar.hidden = true;
        showHint('拖动鼠标框选区域');
      } else {
        cancel();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      doAction('copy');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      doUndo();
      return;
    }
    if (ctrl && key === 'c') {
      event.preventDefault();
      doAction('copy');
      return;
    }
    if (ctrl && key === 's') {
      event.preventDefault();
      doAction('save');
      return;
    }
    if (ctrl && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (ctrl && key === 'y') {
      event.preventDefault();
      doRedo();
      return;
    }
    const map = { r: 'rect', e: 'ellipse', a: 'arrow', l: 'line', p: 'pen', h: 'marker', m: 'mosaic', n: 'serial', x: 'eraser', t: 'text' };
    if (!ctrl && map[key]) setTool(map[key], { toggle: true });
  });

  window.addEventListener('resize', () => {
    layout();
  });

  window.addEventListener('beforeunload', () => {
    if (state.finished) return;
    state.finished = true;
    S.sendToParent('closed', { returnInput: RETURN_INPUT, cancelled: true });
  });

  // 调试与自动化测试用的只读入口
  window.__snap = {
    get state() {
      return {
        mode: MODE,
        ready: state.ready,
        tool: state.tool,
        selection: state.selection,
        ops: state.ops.length,
        redo: state.redo.length,
        scale: state.scale
      };
    },
    setSelection(rect) {
      state.selection = clampSelection({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      syncOverlay();
      placeToolbar();
    },
    setTool: (tool) => setTool(tool, { toggle: false }),
    action: doAction,
    compose,
    undo: doUndo,
    redo: doRedo,
    get opsList() {
      return state.ops.map((op) => ({
        t: op.t,
        x: Math.round(op.x || op.x1 || 0),
        y: Math.round(op.y || op.y1 || 0),
        w: Math.round(op.w || 0),
        h: Math.round(op.h || 0),
        num: op.num,
        patch: Boolean(op.patch),
        patchSize: op.patch ? `${op.patch.width}x${op.patch.height}` : ''
      }));
    },
    get image() {
      return state.image;
    }
  };

  initialize();
})();
