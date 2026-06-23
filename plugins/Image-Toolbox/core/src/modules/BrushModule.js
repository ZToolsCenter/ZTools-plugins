import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';

/**
 * 画笔模块 - 使用 Fabric 自由绘制生成可编辑的 path 图层。
 */
class BrushModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, {
      color: '#d83b31',
      width: 6,
      ...defaultOptions,
    });

    this._cursorPreview = null;
    this._savedBeforeStroke = false;
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseOut = this._hideCursorPreview.bind(this);
    this._boundPathCreated = this._onPathCreated.bind(this);
  }

  activate(options = {}) {
    super.activate(options);

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    canvas.discardActiveObject();
    canvas.isDrawingMode = true;
    canvas.defaultCursor = 'none';
    canvas.hoverCursor = 'none';
    canvas.freeDrawingCursor = 'none';
    this._ensureBrush();
    this._applyBrushOptions();
    canvas.on('mouse:down', this._boundMouseDown);
    canvas.on('mouse:out', this._boundMouseOut);
    canvas.on('path:created', this._boundPathCreated);
    canvas.upperCanvasEl?.addEventListener('mousemove', this._boundMouseMove);
    canvas.upperCanvasEl?.addEventListener('mouseleave', this._boundMouseOut);

    eventBus.emit('module:activated', 'brush');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.off('mouse:down', this._boundMouseDown);
      canvas.off('mouse:out', this._boundMouseOut);
      canvas.off('path:created', this._boundPathCreated);
      canvas.upperCanvasEl?.removeEventListener('mousemove', this._boundMouseMove);
      canvas.upperCanvasEl?.removeEventListener('mouseleave', this._boundMouseOut);
      this._removeCursorPreview();
      canvas.isDrawingMode = false;
      canvas.freeDrawingCursor = 'crosshair';
      canvas.hoverCursor = 'move';
      this._savedBeforeStroke = false;
    }

    super.deactivate();
  }

  setColor(color) {
    this.options.color = this._normalizeColor(color, this.options.color);
    this._applyBrushOptions();
    this._updateCursorPreviewStyle();
  }

  setWidth(width) {
    const parsed = parseInt(width, 10);
    this.options.width = this._clamp(Number.isFinite(parsed) ? parsed : this.options.width, 1, 80);
    this._applyBrushOptions();
    this._updateCursorPreviewStyle();
  }

  applyPreset(presetName) {
    const presets = {
      'brush-red': { color: '#d83b31' },
      'brush-blue': { color: '#1677ff' },
      'brush-yellow': { color: '#ffd700' },
      'brush-green': { color: '#2ead4a' },
      'brush-white': { color: '#ffffff' },
      'brush-black': { color: '#111111' },
      'brush-thin': { width: 3 },
      'brush-medium': { width: 6 },
      'brush-thick': { width: 12 },
      'brush-heavy': { width: 24 },
    };

    const preset = presets[presetName];
    if (!preset) return;

    if (preset.color) this.setColor(preset.color);
    if (preset.width) this.setWidth(preset.width);
  }

  getOptionsBarHTML() {
    const color = this._normalizeColor(this.options.color);
    const width = this.options.width;

    return `
      <div class="options-group">
        ${this._getColorPresetButton('brush-red', '红', '#d83b31', color)}
        ${this._getColorPresetButton('brush-blue', '蓝', '#1677ff', color)}
        ${this._getColorPresetButton('brush-yellow', '黄', '#ffd700', color)}
        ${this._getColorPresetButton('brush-green', '绿', '#2ead4a', color)}
        ${this._getColorPresetButton('brush-white', '白', '#ffffff', color)}
        ${this._getColorPresetButton('brush-black', '黑', '#111111', color)}
      </div>
      <div class="options-group">
        <button class="options-btn options-btn-sm ${width === 3 ? 'active' : ''}" data-preset="brush-thin">细</button>
        <button class="options-btn options-btn-sm ${width === 6 ? 'active' : ''}" data-preset="brush-medium">中</button>
        <button class="options-btn options-btn-sm ${width === 12 ? 'active' : ''}" data-preset="brush-thick">粗</button>
        <button class="options-btn options-btn-sm ${width === 24 ? 'active' : ''}" data-preset="brush-heavy">特粗</button>
      </div>
    `;
  }

  getPropertyPanelHTML() {
    return `
      <div class="property-section-title">画笔工具</div>
      <div class="property-item">
        <label>颜色</label>
        <input type="color" class="property-color" data-module-prop="color" value="${this._escapeAttr(this._normalizeColor(this.options.color))}" />
      </div>
      <div class="property-item property-item--wide">
        <label>粗细</label>
        <input type="range" class="property-range" data-module-prop="width" min="1" max="80" value="${this.options.width}" />
        <span class="property-value">${this.options.width}px</span>
      </div>
      <div class="property-empty">按住鼠标拖拽即可绘制，生成的画笔会作为独立图层。</div>
    `;
  }

  onToolPropertyChange(key, value) {
    switch (key) {
      case 'color':
        this.setColor(value);
        return true;
      case 'width':
        this.setWidth(value);
        return true;
      default:
        return false;
    }
  }

  _onMouseDown(e) {
    const nativeEvent = e?.e;
    if (nativeEvent && typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;

    this.history.saveState();
    this._savedBeforeStroke = true;
  }

  _onMouseMove(e) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const nativeEvent = e?.e || e;
    if (!nativeEvent) return;

    const pointer = canvas.getPointer(nativeEvent);
    const preview = this._ensureCursorPreview();
    preview.set({
      left: pointer.x,
      top: pointer.y,
      visible: true,
    });
    canvas.bringToFront(preview);
    this._requestRender();
  }

  _onPathCreated(e) {
    const path = e.path;
    if (!path) return;

    path.set({
      id: 'brush_' + Date.now(),
      fill: null,
      stroke: this.options.color,
      strokeWidth: this.options.width,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
      _layerKind: 'brush',
      _layerColorPresetName: this._getColorPresetName(this.options.color),
      _layerWidthPresetName: this._getWidthPresetName(this.options.width),
    });
    path.setCoords();
    this.canvasManager.canvas.discardActiveObject();
    if (this._cursorPreview) {
      this.canvasManager.canvas.bringToFront(this._cursorPreview);
    }
    this.canvasManager.canvas.renderAll();
    eventBus.emit('canvas:objectMetadataChanged', path);
    this._savedBeforeStroke = false;
  }

  _ensureCursorPreview() {
    if (this._cursorPreview) return this._cursorPreview;

    const canvas = this.canvasManager.canvas;
    const preview = new fabric.Circle({
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      radius: this.options.width / 2,
      fill: 'rgba(255,255,255,0.08)',
      stroke: this.options.color,
      strokeWidth: 1,
      strokeUniform: true,
      selectable: false,
      evented: false,
      excludeFromLayer: true,
      excludeFromProperty: true,
      excludeFromHistory: true,
      excludeFromExport: true,
      objectCaching: false,
      visible: false,
    });

    this._cursorPreview = preview;
    canvas.add(preview);
    canvas.bringToFront(preview);
    return preview;
  }

  _updateCursorPreviewStyle() {
    if (!this._cursorPreview) return;

    this._cursorPreview.set({
      radius: this.options.width / 2,
      stroke: this.options.color,
    });
    this._cursorPreview.setCoords();
    this._requestRender();
  }

  _hideCursorPreview() {
    if (!this._cursorPreview) return;

    this._cursorPreview.set('visible', false);
    this._requestRender();
  }

  _removeCursorPreview() {
    if (!this._cursorPreview) return;

    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.remove(this._cursorPreview);
    }
    this._cursorPreview = null;
  }

  _requestRender() {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;
    if (typeof canvas.requestRenderAll === 'function') {
      canvas.requestRenderAll();
    } else {
      canvas.renderAll();
    }
  }

  _ensureBrush() {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    if (!canvas.freeDrawingBrush || !(canvas.freeDrawingBrush instanceof fabric.PencilBrush)) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    }
  }

  _applyBrushOptions() {
    const canvas = this.canvasManager.canvas;
    if (!canvas?.freeDrawingBrush) return;

    canvas.freeDrawingBrush.color = this.options.color;
    canvas.freeDrawingBrush.width = this.options.width;
  }

  _getColorPresetButton(preset, label, color, currentColor) {
    const normalized = this._normalizeColor(color);
    const active = currentColor === normalized ? ' active' : '';
    return `
      <button class="options-btn options-btn-sm brush-color-btn${active}" data-preset="${preset}" style="--brush-color:${normalized}">
        <span class="brush-color-dot"></span>${label}
      </button>
    `;
  }

  _normalizeColor(color, fallback = '#000000') {
    if (typeof color !== 'string') return fallback;

    const value = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return '#' + value.slice(1).split('').map(ch => ch + ch).join('');
    }

    return fallback;
  }

  _getColorPresetName(color) {
    const colorMap = {
      '#d83b31': '红',
      '#1677ff': '蓝',
      '#ffd700': '黄',
      '#2ead4a': '绿',
      '#ffffff': '白',
      '#111111': '黑',
    };

    return colorMap[this._normalizeColor(color, '')] || '';
  }

  _getWidthPresetName(width) {
    const widthMap = {
      3: '细',
      6: '中',
      12: '粗',
      24: '特粗',
    };

    return widthMap[Math.round(Number(width))] || '';
  }

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  _escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"]/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }[ch]));
  }
}

export default BrushModule;
