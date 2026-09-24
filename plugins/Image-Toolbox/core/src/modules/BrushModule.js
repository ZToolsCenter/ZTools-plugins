import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { clamp, escapeAttr, normalizeColor, requestRender as _requestRender } from '../utils/helpers.js';

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
    this._eventBusUnsubscribers = null;
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseOver = this._onMouseOver.bind(this);
    this._boundMouseOut = this._hideCursorPreview.bind(this);
    this._boundPathCreated = this._onPathCreated.bind(this);
    this._boundInvalidateCursorPreview = this._invalidateCursorPreview.bind(this);
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
    canvas.on('mouse:over', this._boundMouseOver);
    canvas.on('mouse:out', this._boundMouseOut);
    canvas.on('path:created', this._boundPathCreated);
    canvas.upperCanvasEl?.addEventListener('mousemove', this._boundMouseMove);
    canvas.upperCanvasEl?.addEventListener('mouseleave', this._boundMouseOut);

    // 画布被重置（撤销/重做、打开新图、导入 ORA）后，旧的光标预览对象
    // 已被清出画布，需要失效引用以便下次鼠标移动时重建。
    this._eventBusUnsubscribers = [
      eventBus.on('canvas:restored', this._boundInvalidateCursorPreview),
      eventBus.on('image:loaded', this._boundInvalidateCursorPreview),
    ];

    eventBus.emit('module:activated', 'brush');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.off('mouse:down', this._boundMouseDown);
      canvas.off('mouse:over', this._boundMouseOver);
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

    if (this._eventBusUnsubscribers) {
      this._eventBusUnsubscribers.forEach((unsub) => unsub && unsub());
      this._eventBusUnsubscribers = null;
    }

    super.deactivate();
  }

  setColor(color) {
    this.options.color = normalizeColor(color, this.options.color);
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
    const color = normalizeColor(this.options.color);
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
        <input type="color" class="property-color" data-module-prop="color" value="${escapeAttr(normalizeColor(this.options.color))}" />
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
    if (!preview) return;
    preview.set({
      left: pointer.x,
      top: pointer.y,
      visible: true,
    });
    canvas.bringToFront(preview);
    this._requestRender();
  }

  _onMouseOver(e) {
    // 鼠标进入画布时立即显示光标预览，无需等待 mousemove
    const nativeEvent = e?.e;
    if (!nativeEvent) return;
    this._onMouseMove({ e: nativeEvent });
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
    const preview = this._cursorPreview;
    const canvas = this.canvasManager.canvas;
    if (preview && canvas.getObjects().includes(preview)) {
      canvas.bringToFront(preview);
    }
    canvas.renderAll();
    eventBus.emit('canvas:objectMetadataChanged', path);
    this._savedBeforeStroke = false;
  }

  _ensureCursorPreview() {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return null;

    // 历史恢复/换图等操作会清空并重建画布对象，旧引用可能已不在画布上，
    // 此时需移除失效引用并重新创建，否则画笔位置圆点不会显示。
    if (this._cursorPreview && canvas.getObjects().includes(this._cursorPreview)) {
      return this._cursorPreview;
    }
    if (this._cursorPreview) {
      canvas.remove(this._cursorPreview);
      this._cursorPreview = null;
    }

    const preview = this._createCursorPreviewObject();
    this._cursorPreview = preview;
    canvas.add(preview);
    canvas.bringToFront(preview);
    return preview;
  }

  /**
   * 创建画笔位置光标预览。
   * 由「深色外圈 + 画笔色主圈 + 中心点」组成，确保在浅色/深色背景上都清晰可见。
   */
  _createCursorPreviewObject() {
    const color = normalizeColor(this.options.color, '#d83b31');
    const r = Math.max(this.options.width / 2, 3);

    return new fabric.Group([
      // 外圈：半透明深色描边，保证在浅色/深色背景上都有对比
      new fabric.Circle({
        radius: r + 2,
        fill: 'transparent',
        stroke: 'rgba(0, 0, 0, 0.35)',
        strokeWidth: 2,
        strokeUniform: true,
        objectCaching: false,
      }),
      // 主圈：画笔颜色
      new fabric.Circle({
        radius: r,
        fill: this._colorToRgba(color, 0.18),
        stroke: color,
        strokeWidth: 1.5,
        strokeUniform: true,
        objectCaching: false,
      }),
      // 中心点：指示精确落笔位置
      new fabric.Circle({
        radius: Math.max(1.5, Math.min(3, r * 0.35)),
        fill: color,
        stroke: 'rgba(255, 255, 255, 0.55)',
        strokeWidth: 0.5,
        strokeUniform: true,
        objectCaching: false,
      }),
    ], {
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      excludeFromLayer: true,
      excludeFromProperty: true,
      excludeFromHistory: true,
      excludeFromExport: true,
      objectCaching: false,
      visible: false,
    });
  }

  _updateCursorPreviewStyle() {
    const preview = this._cursorPreview;
    if (!preview) return;

    const color = normalizeColor(this.options.color, '#d83b31');
    const r = Math.max(this.options.width / 2, 3);
    const children = preview.getObjects ? preview.getObjects() : [];

    if (children[0]) children[0].set({ radius: r + 2 });
    if (children[1]) {
      children[1].set({
        radius: r,
        fill: this._colorToRgba(color, 0.18),
        stroke: color,
      });
    }
    if (children[2]) {
      children[2].set({
        radius: Math.max(1.5, Math.min(3, r * 0.35)),
        fill: color,
      });
    }

    preview.setCoords();
    this._requestRender();
  }

  _colorToRgba(color, alpha) {
    const value = normalizeColor(color, '#000000');
    const hex = value.startsWith('#') ? value.slice(1) : '';
    if (!/^[0-9a-f]{6}$/i.test(hex)) {
      // 非 hex 输入（如 rgba()）时退化为半透明黑，避免解析出 NaN
      return `rgba(0, 0, 0, ${alpha})`;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * 画布被重置（撤销/重做、打开新图、导入 ORA）后调用，
   * 移除旧的光标预览引用，待下次鼠标移动时重建。
   */
  _invalidateCursorPreview() {
    const canvas = this.canvasManager.canvas;
    if (this._cursorPreview && canvas) {
      canvas.remove(this._cursorPreview);
    }
    this._cursorPreview = null;
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
    _requestRender(this.canvasManager.canvas);
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
    const normalized = normalizeColor(color);
    const active = currentColor === normalized ? ' active' : '';
    return `
      <button class="options-btn options-btn-sm brush-color-btn${active}" data-preset="${preset}" style="--brush-color:${normalized}">
        <span class="brush-color-dot"></span>${label}
      </button>
    `;
  }

  _normalizeColor(color, fallback = '#000000') {
    return normalizeColor(color, fallback);
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

    return colorMap[normalizeColor(color, '')] || '';
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
    return clamp(value, min, max);
  }

  _escapeAttr(value) {
    return escapeAttr(value);
  }
}

export default BrushModule;
