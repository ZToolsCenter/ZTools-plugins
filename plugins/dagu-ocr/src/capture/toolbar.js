// 截图工具条：主工具行 + 当前工具的子选项行，贴靠选区浮动。

import { nextToolbarPlacement } from './geometry.js';
import { iconMarkup } from '../icon-hydration.js';

export const CAPTURE_TOOLS = Object.freeze([
  { id: 'select', label: '选择', hint: '拖动标注对象，Delete 删除' },
  { id: 'shape', label: '形状', hint: '拖拽绘制矩形或椭圆' },
  { id: 'line', label: '线条', hint: '拖拽绘制直线或箭头' },
  { id: 'pen', label: '画笔', hint: '按住拖动自由绘制' },
  { id: 'marker', label: '荧光笔', hint: '按住拖动高亮标记' },
  { id: 'mosaic', label: '马赛克', hint: '拖拽区域添加马赛克' },
  { id: 'text', label: '文字', hint: '点击画面输入文字' },
  { id: 'eraser', label: '橡皮擦', hint: '点击标注对象删除' }
]);

export const PALETTE_COLORS = Object.freeze([
  '#ff4d4f', '#f5222d', '#fa8c16', '#faad14', '#fadb14', '#a0d911',
  '#52c41a', '#13c2c2', '#1890ff', '#2f54eb', '#722ed1', '#eb2f96',
  '#8c8c8c', '#000000', '#ffffff'
]);

const SUB_ROW_TOOLS = new Set(['shape', 'line', 'pen', 'marker', 'mosaic', 'text']);

function icon(name) {
  return iconMarkup(name);
}

function button({ id, className = 'capture-btn', title, html, data = {} }) {
  const attributes = Object.entries(data)
    .map(([key, value]) => ` data-${key}="${value}"`)
    .join('');
  const idAttribute = id ? ` id="${id}"` : '';
  return `<button type="button" class="${className}"${idAttribute} title="${title}" aria-label="${title}"${attributes}>${html}</button>`;
}

function colorButtons() {
  return PALETTE_COLORS.map((color) => (
    `<button type="button" class="capture-color" data-color="${color}" title="${color}" aria-label="颜色 ${color}" style="background:${color}"></button>`
  )).join('');
}

function palettePanel() {
  return `
    <div class="capture-palette">${colorButtons()}</div>
    <label class="capture-custom-color" title="自定义颜色">
      <input id="capture-custom-color" type="color" value="#ff4d4f" aria-label="自定义颜色">
    </label>`;
}

function panel(id, content) {
  return `<div class="capture-panel" data-panel="${id}">${content}</div>`;
}

function widthControl() {
  return `
    <label class="capture-range" title="线条粗细">
      <input id="capture-line-width" type="range" min="1" max="10" step="1" value="3" aria-label="线条粗细">
      <output id="capture-line-width-value">3</output>
    </label>`;
}

export function createToolbar({ root, getSettings, onToolChange, onAction, onSettingsChange }) {
  const element = document.createElement('div');
  element.id = 'capture-toolbar';
  element.className = 'capture-toolbar';
  element.setAttribute('role', 'toolbar');
  element.innerHTML = `
    <div class="capture-row capture-row-main">
      ${CAPTURE_TOOLS.map((tool) => button({
    id: `capture-tool-${tool.id}`,
    className: 'capture-btn capture-tool',
    title: tool.label,
    html: icon(tool.id),
    data: { tool: tool.id }
  })).join('')}
      <span class="capture-sep"></span>
      ${button({ id: 'capture-undo', title: '撤销 (Ctrl+Z)', html: icon('undo') })}
      ${button({ id: 'capture-redo', title: '重做 (Ctrl+Y)', html: icon('redo') })}
      <span class="capture-sep"></span>
      ${button({ id: 'capture-ocr', className: 'capture-btn capture-flow', title: '识别当前图片文字', html: 'OCR' })}
      ${button({ id: 'capture-translate', className: 'capture-btn capture-flow', title: '识别并翻译当前图片', html: '翻译' })}
      <span class="capture-sep"></span>
      ${button({ id: 'capture-close', title: '取消 (Esc)', html: icon('close') })}
      ${button({ id: 'capture-pin', title: '固定到屏幕', html: icon('pin') })}
      ${button({ id: 'capture-save', title: '保存 (Ctrl+S)', html: icon('save') })}
      ${button({ id: 'capture-copy', className: 'capture-btn capture-primary', title: '复制 (Enter)', html: icon('copy') })}
    </div>
    <div class="capture-row capture-row-sub" id="capture-subtoolbar">
      ${panel('shape', `
        <div class="capture-toggle-group">
          <button type="button" class="capture-toggle" data-shape-kind="rect" title="矩形">矩形</button>
          <button type="button" class="capture-toggle" data-shape-kind="ellipse" title="椭圆">椭圆</button>
        </div>
        <div class="capture-toggle-group">
          <button type="button" class="capture-toggle" data-shape-fill="false" title="仅描边">描边</button>
          <button type="button" class="capture-toggle" data-shape-fill="true" title="填充">填充</button>
        </div>
        ${widthControl()}
        ${palettePanel()}`)}
      ${panel('line', `
        <div class="capture-toggle-group">
          <button type="button" class="capture-toggle" data-arrow-kind="none" title="直线">直线</button>
          <button type="button" class="capture-toggle" data-arrow-kind="end" title="箭头">箭头</button>
          <button type="button" class="capture-toggle" data-arrow-kind="both" title="双向箭头">双向</button>
        </div>
        ${widthControl()}
        ${palettePanel()}`)}
      ${panel('pen', `${widthControl()}${palettePanel()}`)}
      ${panel('marker', `${widthControl()}${palettePanel()}`)}
      ${panel('mosaic', `
        <label class="capture-range" title="马赛克大小">
          <input id="capture-mosaic-size" type="range" min="4" max="24" step="2" value="12" aria-label="马赛克大小">
          <output id="capture-mosaic-size-value">12</output>
        </label>`)}
      ${panel('text', `
        <div class="capture-toggle-group">
          <button type="button" class="capture-toggle capture-toggle-font" id="capture-bold" title="加粗">B</button>
          <button type="button" class="capture-toggle capture-toggle-font capture-italic" id="capture-italic" title="斜体">I</button>
        </div>
        <label class="capture-select" title="字号">
          <select id="capture-font-size" aria-label="字号">
            <option value="16">16</option>
            <option value="20">20</option>
            <option value="24">24</option>
            <option value="28">28</option>
            <option value="32">32</option>
            <option value="40">40</option>
            <option value="48">48</option>
          </select>
        </label>
        ${palettePanel()}`)}
    </div>
  `;
  root.appendChild(element);

  const rowSub = element.querySelector('#capture-subtoolbar');
  const toolButtons = [...element.querySelectorAll('.capture-tool')];
  const panelElements = [...element.querySelectorAll('.capture-panel')];

  const emitSettings = (patch) => {
    onSettingsChange?.(patch);
    sync(getSettings());
  };

  const sync = (settings) => {
    const current = settings || getSettings();
    toolButtons.forEach((item) => {
      item.classList.toggle('active', item.dataset.tool === current.tool);
    });
    element.querySelectorAll('[data-shape-kind]').forEach((item) => {
      item.classList.toggle('active', item.dataset.shapeKind === current.shapeKind);
    });
    element.querySelectorAll('[data-shape-fill]').forEach((item) => {
      item.classList.toggle('active', String(current.shapeFill) === item.dataset.shapeFill);
    });
    element.querySelectorAll('[data-arrow-kind]').forEach((item) => {
      item.classList.toggle('active', item.dataset.arrowKind === current.arrowKind);
    });
    element.querySelectorAll('.capture-color').forEach((item) => {
      item.classList.toggle('active', item.dataset.color.toLowerCase() === String(current.color).toLowerCase());
    });
    const lineWidth = element.querySelector('#capture-line-width');
    const lineWidthValue = element.querySelector('#capture-line-width-value');
    if (lineWidth) lineWidth.value = String(current.lineWidth);
    if (lineWidthValue) lineWidthValue.textContent = String(current.lineWidth);
    const mosaicSize = element.querySelector('#capture-mosaic-size');
    const mosaicSizeValue = element.querySelector('#capture-mosaic-size-value');
    if (mosaicSize) mosaicSize.value = String(current.mosaicSize);
    if (mosaicSizeValue) mosaicSizeValue.textContent = String(current.mosaicSize);
    const fontSize = element.querySelector('#capture-font-size');
    if (fontSize) fontSize.value = String(current.fontSize);
    element.querySelector('#capture-bold')?.classList.toggle('active', Boolean(current.fontBold));
    element.querySelector('#capture-italic')?.classList.toggle('active', Boolean(current.fontItalic));
    const customColor = element.querySelector('#capture-custom-color');
    if (customColor && /^#[0-9a-f]{6}$/i.test(current.color)) customColor.value = current.color;
    rowSub.classList.toggle('hidden', !SUB_ROW_TOOLS.has(current.tool));
    panelElements.forEach((item) => {
      item.classList.toggle('hidden', item.dataset.panel !== current.tool);
    });
    const undo = element.querySelector('#capture-undo');
    const redo = element.querySelector('#capture-redo');
    if (undo) undo.disabled = !current.canUndo;
    if (redo) redo.disabled = !current.canRedo;
  };

  element.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.tool) {
      onToolChange?.(target.dataset.tool);
      return;
    }
    if (target.dataset.color) {
      emitSettings({ color: target.dataset.color });
      return;
    }
    if (target.dataset.shapeKind) {
      emitSettings({ shapeKind: target.dataset.shapeKind });
      return;
    }
    if (target.dataset.shapeFill) {
      emitSettings({ shapeFill: target.dataset.shapeFill === 'true' });
      return;
    }
    if (target.dataset.arrowKind) {
      emitSettings({ arrowKind: target.dataset.arrowKind });
      return;
    }
    const actions = {
      'capture-undo': 'undo',
      'capture-redo': 'redo',
      'capture-ocr': 'ocr',
      'capture-translate': 'translate',
      'capture-close': 'close',
      'capture-pin': 'pin',
      'capture-save': 'save',
      'capture-copy': 'copy',
      'capture-bold': 'toggle-bold',
      'capture-italic': 'toggle-italic'
    };
    const action = actions[target.id];
    if (action) onAction?.(action);
  });

  element.querySelector('#capture-line-width')?.addEventListener('input', (event) => {
    emitSettings({ lineWidth: Number(event.target.value) });
  });
  element.querySelector('#capture-mosaic-size')?.addEventListener('input', (event) => {
    emitSettings({ mosaicSize: Number(event.target.value) });
  });
  element.querySelector('#capture-font-size')?.addEventListener('change', (event) => {
    emitSettings({ fontSize: Number(event.target.value) });
  });
  element.querySelector('#capture-custom-color')?.addEventListener('input', (event) => {
    emitSettings({ color: event.target.value });
  });

  const api = {
    element,
    sync,
    show() {
      element.classList.add('visible');
    },
    hide() {
      element.classList.remove('visible');
    },
    get visible() {
      return element.classList.contains('visible');
    },
    // 图片编辑模式没有选区时把工具条放在底部居中。
    placeBottom(viewport) {
      const toolbarRect = element.getBoundingClientRect();
      element.style.left = `${Math.round(Math.max(8, (viewport.width - toolbarRect.width) / 2))}px`;
      element.style.top = `${Math.round(Math.max(8, viewport.height - toolbarRect.height - 16))}px`;
    },
    // 贴靠选区：优先在下方，放不下时自动换到上方。
    place(selectionScreenRect, viewport) {
      const toolbarRect = element.getBoundingClientRect();
      const placement = nextToolbarPlacement({
        selection: selectionScreenRect,
        toolbar: { width: toolbarRect.width, height: toolbarRect.height },
        viewport
      });
      element.style.left = `${placement.left}px`;
      element.style.top = `${placement.top}px`;
      return placement;
    }
  };

  sync(getSettings());
  return api;
}
