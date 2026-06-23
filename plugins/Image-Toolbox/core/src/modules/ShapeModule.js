import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';

/**
 * 图形绘制模块 - 支持矩形、椭圆、星星、心形、梯形、直线、箭头等多种图形
 */
class ShapeModule extends BaseModule {
  static SHAPE_OPTIONS = [
    { type: 'rect', preset: 'shape-type-rect', label: '矩形', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="8" width="20" height="16" rx="2" /></svg>' },
    { type: 'circle', preset: 'shape-type-circle', label: '椭圆', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="16" rx="11" ry="9" /></svg>' },
    { type: 'star', preset: 'shape-type-star', label: '星星', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><polygon points="16 4 19.4 12 28 12.6 21.4 18 23.4 26.4 16 21.8 8.6 26.4 10.6 18 4 12.6 12.6 12" /></svg>' },
    { type: 'heart', preset: 'shape-type-heart', label: '心形', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27C8.3 20.6 4 16.6 4 11.3C4 7.3 6.9 4.5 10.7 4.5C13 4.5 15 5.8 16 7.8C17 5.8 19 4.5 21.3 4.5C25.1 4.5 28 7.3 28 11.3C28 16.6 23.7 20.6 16 27Z" /></svg>' },
    { type: 'trapezoid', preset: 'shape-type-trapezoid', label: '梯形', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><polygon points="10 8 22 8 28 24 4 24" /></svg>' },
    { type: 'line', preset: 'shape-type-line', label: '直线', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><line x1="5" y1="24" x2="27" y2="8" /></svg>' },
    { type: 'arrow', preset: 'shape-type-arrow', label: '箭头', icon: '<svg class="shape-icon-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24L25 8" /><path d="M16 7H26V17" /></svg>' },
  ];

  static SHAPE_STYLE_PRESETS = [
    { preset: 'shape-style-outline', label: '仅描边', fill: 'transparent', fillOpacity: 0, stroke: '#d83b31', strokeOpacity: 100 },
    { preset: 'shape-style-red', label: '标注红', fill: '#d83b31', fillOpacity: 22, stroke: '#d83b31', strokeOpacity: 100 },
    { preset: 'shape-style-blue', label: '标注蓝', fill: '#1677ff', fillOpacity: 20, stroke: '#1677ff', strokeOpacity: 100 },
    { preset: 'shape-style-orange', label: '警示橙', fill: '#ff7a00', fillOpacity: 22, stroke: '#ff7a00', strokeOpacity: 100 },
    { preset: 'shape-style-yellow', label: '标题黄', fill: '#ffd700', fillOpacity: 28, stroke: '#b7791f', strokeOpacity: 100 },
    { preset: 'shape-style-green', label: '强调绿', fill: '#2ead4a', fillOpacity: 20, stroke: '#2ead4a', strokeOpacity: 100 },
    { preset: 'shape-style-purple', label: '重点紫', fill: '#8b5cf6', fillOpacity: 20, stroke: '#8b5cf6', strokeOpacity: 100 },
    { preset: 'shape-style-black', label: '黑白框', fill: '#111111', fillOpacity: 12, stroke: '#111111', strokeOpacity: 100 },
    { preset: 'shape-style-white', label: '白描边', fill: '#ffffff', fillOpacity: 36, stroke: '#ffffff', strokeOpacity: 100 },
  ];

  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, {
      shapeType: 'rect',
      fill: 'transparent',
      stroke: 'rgba(216, 59, 49, 1)',
      strokeWidth: 2,
      ...defaultOptions,
    });

    this._isDrawing = false;
    this._startPoint = null;
    this._currentShape = null;
    this._previewShape = null;
    this._savedBeforeShape = false;

    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundMouseOut = this._onMouseOut.bind(this);
  }

  activate(options = {}) {
    super.activate(options);

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    canvas.discardActiveObject();
    canvas.defaultCursor = 'crosshair';
    canvas.upperCanvasEl?.addEventListener('mousedown', this._boundMouseDown);
    canvas.upperCanvasEl?.addEventListener('mousemove', this._boundMouseMove);
    canvas.upperCanvasEl?.addEventListener('mouseup', this._boundMouseUp);
    canvas.upperCanvasEl?.addEventListener('mouseout', this._boundMouseOut);

    eventBus.emit('module:activated', 'shape');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.upperCanvasEl?.removeEventListener('mousedown', this._boundMouseDown);
      canvas.upperCanvasEl?.removeEventListener('mousemove', this._boundMouseMove);
      canvas.upperCanvasEl?.removeEventListener('mouseup', this._boundMouseUp);
      canvas.upperCanvasEl?.removeEventListener('mouseout', this._boundMouseOut);
      this._removePreviewShape();
      this._isDrawing = false;
      this._startPoint = null;
      this._currentShape = null;
      this._savedBeforeShape = false;
    }

    super.deactivate();
  }

  setShapeType(type) {
    if (['rect', 'circle', 'star', 'heart', 'trapezoid', 'line', 'arrow'].includes(type)) {
      this.options.shapeType = type;
    }
  }

  setFill(fill) {
    const normalized = this._normalizeColor(fill, this.options.fill, true);
    this.options.fill = this._hasExplicitOpacity(normalized)
      ? normalized
      : this._withColorOpacity(normalized, this._getColorOpacity(this.options.fill));
  }

  setStroke(stroke) {
    const normalized = this._normalizeColor(stroke, this.options.stroke, false);
    this.options.stroke = this._hasExplicitOpacity(normalized)
      ? normalized
      : this._withColorOpacity(normalized, this._getColorOpacity(this.options.stroke));
  }

  setStrokeWidth(width) {
    const parsed = parseInt(width, 10);
    this.options.strokeWidth = this._clamp(Number.isFinite(parsed) ? parsed : this.options.strokeWidth, 1, 20);
  }

  setFillOpacity(opacity) {
    this.options.fill = this._withColorOpacity(this.options.fill, this._parseOpacity(opacity));
  }

  setStrokeOpacity(opacity) {
    this.options.stroke = this._withColorOpacity(this.options.stroke, this._parseOpacity(opacity));
  }

  applyPreset(presetName) {
    const stylePreset = ShapeModule.SHAPE_STYLE_PRESETS.find(item => item.preset === presetName);
    if (stylePreset) {
      this.options.fill = this._getPresetColor(stylePreset, 'fill');
      this.options.stroke = this._getPresetColor(stylePreset, 'stroke');
      return;
    }

    const presets = {
      'shape-type-rect': { shapeType: 'rect' },
      'shape-type-circle': { shapeType: 'circle' },
      'shape-type-star': { shapeType: 'star' },
      'shape-type-heart': { shapeType: 'heart' },
      'shape-type-trapezoid': { shapeType: 'trapezoid' },
      'shape-type-line': { shapeType: 'line' },
      'shape-type-arrow': { shapeType: 'arrow' },
      'shape-width-thin': { strokeWidth: 1 },
      'shape-width-medium': { strokeWidth: 2 },
      'shape-width-thick': { strokeWidth: 4 },
      'shape-width-heavy': { strokeWidth: 6 },
    };

    const preset = presets[presetName];
    if (!preset) return;

    if (preset.fill !== undefined) this.setFill(preset.fill);
    if (preset.stroke !== undefined) this.setStroke(preset.stroke);
    if (preset.strokeWidth !== undefined) this.setStrokeWidth(preset.strokeWidth);
    if (preset.shapeType !== undefined) this.setShapeType(preset.shapeType);
  }

  getOptionsBarHTML() {
    const shapeType = this.options.shapeType;
    const currentShape = ShapeModule.SHAPE_OPTIONS.find(item => item.type === shapeType) || ShapeModule.SHAPE_OPTIONS[0];
    const strokeWidth = this.options.strokeWidth;
    const colorPresets = ShapeModule.SHAPE_STYLE_PRESETS.map(item => {
      const fill = this._getPresetColor(item, 'fill');
      const stroke = this._getPresetColor(item, 'stroke');
      return `
        <button class="options-btn options-btn-sm shape-style-btn ${this._isStylePresetActive(item) ? 'active' : ''}" data-preset="${item.preset}" style="--shape-style-fill:${fill}; --shape-style-stroke:${stroke}" title="${item.label}">
          <span class="shape-style-btn__swatch"></span>
          <span>${item.label}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="options-group">
        <button class="options-btn options-btn-sm shape-picker-trigger" data-shape-picker-toggle="true" type="button" title="选择图形">
          <span class="shape-picker-trigger__icon">${currentShape.icon}</span>
          <span>${currentShape.label}</span>
          <span class="shape-picker-trigger__arrow">▾</span>
        </button>
      </div>
      <div class="options-group">
        ${colorPresets}
      </div>
      <div class="options-group">
        <button class="options-btn options-btn-sm ${strokeWidth === 1 ? 'active' : ''}" data-preset="shape-width-thin">细</button>
        <button class="options-btn options-btn-sm ${strokeWidth === 2 ? 'active' : ''}" data-preset="shape-width-medium">中</button>
        <button class="options-btn options-btn-sm ${strokeWidth === 4 ? 'active' : ''}" data-preset="shape-width-thick">粗</button>
        <button class="options-btn options-btn-sm ${strokeWidth === 6 ? 'active' : ''}" data-preset="shape-width-heavy">特粗</button>
      </div>
    `;
  }

  _isStylePresetActive(preset) {
    return this._normalizeComparableColor(this.options.fill) === this._normalizeComparableColor(this._getPresetColor(preset, 'fill'))
      && this._normalizeComparableColor(this.options.stroke) === this._normalizeComparableColor(this._getPresetColor(preset, 'stroke'));
  }

  _getPresetColor(preset, prop) {
    const opacity = this._parseOpacity(preset[`${prop}Opacity`]);
    return this._withColorOpacity(preset[prop], opacity);
  }

  getShapePickerHTML() {
    const shapeType = this.options.shapeType;
    const items = ShapeModule.SHAPE_OPTIONS.map(item => `
      <button class="shape-picker__item ${shapeType === item.type ? 'active' : ''}" data-preset="${item.preset}" type="button" title="${item.label}">
        <span class="shape-picker__icon">${item.icon}</span>
        <span class="shape-picker__label">${item.label}</span>
      </button>
    `).join('');

    return `
      <div class="shape-picker" role="dialog" aria-label="选择图形">
        <div class="shape-picker__header">图形工具组</div>
        <div class="shape-picker__grid">${items}</div>
      </div>
    `;
  }

  getPropertyShapePickerHTML() {
    const shapeType = this.options.shapeType;
    return ShapeModule.SHAPE_OPTIONS.map(item => `
      <button class="property-shape-btn ${shapeType === item.type ? 'active' : ''}" data-module-preset="${item.preset}" type="button" title="${item.label}">
        <span class="property-shape-btn__icon">${item.icon}</span>
        <span class="property-shape-btn__label">${item.label}</span>
      </button>
    `).join('');
  }

  getPropertyPanelHTML() {
    return `
      <div class="property-section-title">图形工具</div>
      <div class="property-item property-item--wide property-item--stacked">
        <label>图形</label>
        <div class="property-shape-grid">
          ${this.getPropertyShapePickerHTML()}
        </div>
      </div>
      <div class="property-item">
        <label>填充色</label>
        <input type="color" class="property-color" data-module-prop="fill" value="${this._extractHexColor(this.options.fill)}" />
      </div>
      <div class="property-item property-item--wide">
        <label>填充不透明</label>
        <input type="range" class="property-range" data-module-prop="fillOpacity" data-value-suffix="%" min="0" max="100" value="${this._getColorOpacityPercent(this.options.fill)}" />
        <span class="property-value">${this._getColorOpacityPercent(this.options.fill)}%</span>
      </div>
      <div class="property-item">
        <label>边框色</label>
        <input type="color" class="property-color" data-module-prop="stroke" value="${this._extractHexColor(this.options.stroke)}" />
      </div>
      <div class="property-item property-item--wide">
        <label>描边不透明</label>
        <input type="range" class="property-range" data-module-prop="strokeOpacity" data-value-suffix="%" min="0" max="100" value="${this._getColorOpacityPercent(this.options.stroke)}" />
        <span class="property-value">${this._getColorOpacityPercent(this.options.stroke)}%</span>
      </div>
      <div class="property-item property-item--wide">
        <label>边框宽度</label>
        <input type="range" class="property-range" data-module-prop="strokeWidth" min="1" max="20" value="${this.options.strokeWidth}" />
        <span class="property-value">${this.options.strokeWidth}px</span>
      </div>
      <div class="property-empty">拖拽鼠标绘制图形，支持矩形、椭圆、星星、心形等。</div>
    `;
  }

  onToolPropertyChange(key, value) {
    switch (key) {
      case 'fill':
        this.setFill(value);
        return true;
      case 'stroke':
        this.setStroke(value);
        return true;
      case 'fillOpacity':
        this.setFillOpacity(value);
        return true;
      case 'strokeOpacity':
        this.setStrokeOpacity(value);
        return true;
      case 'strokeWidth':
        this.setStrokeWidth(value);
        return true;
      default:
        return false;
    }
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const pointer = canvas.getPointer(e);
    this._isDrawing = true;
    this._startPoint = { x: pointer.x, y: pointer.y };
    this.history.saveState();
    this._savedBeforeShape = true;
  }

  _onMouseMove(e) {
    if (!this._isDrawing || !this._startPoint) return;

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const pointer = canvas.getPointer(e);
    const endPoint = { x: pointer.x, y: pointer.y };

    // 移除旧的预览形状
    this._removePreviewShape();

    // 创建新的预览形状
    const shape = this._createShape(this._startPoint, endPoint);
    if (shape) {
      this._previewShape = shape;
      canvas.add(shape);
      canvas.renderAll();
    }
  }

  _onMouseUp(e) {
    if (!this._isDrawing || !this._startPoint) return;

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const pointer = canvas.getPointer(e);
    const endPoint = { x: pointer.x, y: pointer.y };

    // 移除预览形状
    this._removePreviewShape();

    // 创建最终形状
    const shape = this._createShape(this._startPoint, endPoint);
    if (shape) {
      // 检查形状是否足够大
      if (this._isShapeLargeEnough(this._startPoint, endPoint)) {
        shape.set({
          id: 'shape_' + Date.now(),
          selectable: false,
          evented: false,
          _layerKind: 'shape',
          _layerShapeType: this.options.shapeType,
        });
        canvas.add(shape);
        canvas.renderAll();
        eventBus.emit('canvas:objectMetadataChanged', shape);
      }
    }

    this._isDrawing = false;
    this._startPoint = null;
    this._currentShape = null;
    this._savedBeforeShape = false;
  }

  _onMouseOut(e) {
    if (this._isDrawing) {
      this._removePreviewShape();
      this.canvasManager.canvas?.renderAll();
    }
  }

  _isShapeLargeEnough(startPoint, endPoint) {
    const width = Math.abs(endPoint.x - startPoint.x);
    const height = Math.abs(endPoint.y - startPoint.y);

    if (['line', 'arrow'].includes(this.options.shapeType)) {
      return Math.sqrt(width * width + height * height) > 5;
    }

    return width > 5 && height > 5;
  }

  _createShape(startPoint, endPoint) {
    const type = this.options.shapeType;
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(endPoint.x - startPoint.x);
    const height = Math.abs(endPoint.y - startPoint.y);

    const commonProps = {
      fill: this.options.fill,
      stroke: this.options.stroke,
      strokeWidth: this.options.strokeWidth,
      selectable: false,
      evented: false,
    };

    switch (type) {
      case 'rect':
        return new fabric.Rect({
          left,
          top,
          width,
          height,
          ...commonProps,
        });

      case 'circle':
        return new fabric.Ellipse({
          left: left + width / 2,
          top: top + height / 2,
          rx: width / 2,
          ry: height / 2,
          originX: 'center',
          originY: 'center',
          ...commonProps,
        });

      case 'star':
        return this._createStar(left + width / 2, top + height / 2, width, height, commonProps);

      case 'heart':
        return this._createHeart(left + width / 2, top + height / 2, width, height, commonProps);

      case 'trapezoid':
        return this._createTrapezoid(left, top, width, height, commonProps);

      case 'line':
        return this._createLine(startPoint, endPoint, commonProps);

      case 'arrow':
        return this._createArrow(startPoint, endPoint, commonProps);

      default:
        return null;
    }
  }

  _createStar(cx, cy, width, height, props) {
    const points = [];
    const spikes = 5;
    const outerX = width / 2;
    const outerY = height / 2;
    const innerX = outerX * 0.42;
    const innerY = outerY * 0.42;

    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const radiusX = i % 2 === 0 ? outerX : innerX;
      const radiusY = i % 2 === 0 ? outerY : innerY;
      points.push({ x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) });
    }

    const path = new fabric.Polygon(points, {
      ...props,
      left: cx,
      top: cy,
      originX: 'center',
      originY: 'center',
      strokeLineJoin: 'round',
    });

    return path;
  }

  _createHeart(cx, cy, width, height, props) {
    const pathData = `M 50 96
      C 17 68 4 55 4 34
      C 4 17 17 5 32 5
      C 41 5 47 10 50 18
      C 53 10 59 5 68 5
      C 83 5 96 17 96 34
      C 96 55 83 68 50 96 Z`;

    const heart = new fabric.Path(pathData, {
      ...props,
      left: cx,
      top: cy,
      originX: 'center',
      originY: 'center',
      scaleX: width / 100,
      scaleY: height / 100,
    });

    return heart;
  }

  _createTrapezoid(left, top, width, height, props) {
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const topInset = width * 0.22;
    const points = [
      { x: -width / 2 + topInset, y: -height / 2 },
      { x: width / 2 - topInset, y: -height / 2 },
      { x: width / 2, y: height / 2 },
      { x: -width / 2, y: height / 2 },
    ];

    return new fabric.Polygon(points, {
      ...props,
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
    });
  }

  _createLine(startPoint, endPoint, props) {
    return new fabric.Line([startPoint.x, startPoint.y, endPoint.x, endPoint.y], {
      ...props,
      stroke: props.stroke,
      strokeWidth: props.strokeWidth,
      fill: null,
      strokeLineCap: 'round',
    });
  }

  _createArrow(startPoint, endPoint, props) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) return null;

    const angle = Math.atan2(dy, dx);
    const headLength = Math.min(Math.max(distance * 0.25, 10), 28);
    const headAngle = Math.PI / 7;
    const headPointA = {
      x: endPoint.x - headLength * Math.cos(angle - headAngle),
      y: endPoint.y - headLength * Math.sin(angle - headAngle),
    };
    const headPointB = {
      x: endPoint.x - headLength * Math.cos(angle + headAngle),
      y: endPoint.y - headLength * Math.sin(angle + headAngle),
    };
    const pathData = `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}
      M ${headPointA.x} ${headPointA.y} L ${endPoint.x} ${endPoint.y} L ${headPointB.x} ${headPointB.y}`;

    return new fabric.Path(pathData, {
      ...props,
      fill: null,
      stroke: props.stroke,
      strokeWidth: props.strokeWidth,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
  }

  _removePreviewShape() {
    if (!this._previewShape) return;

    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.remove(this._previewShape);
    }
    this._previewShape = null;
  }

  _normalizeColor(color, fallback = '#000000', allowTransparent = false) {
    if (allowTransparent && color === 'transparent') return 'transparent';

    if (typeof color !== 'string') return fallback;

    const value = color.trim().toLowerCase();

    // 处理 rgba 格式
    if (value.startsWith('rgba')) return value;

    // 处理 hex 格式
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return '#' + value.slice(1).split('').map(ch => ch + ch).join('');
    }

    return fallback;
  }

  _normalizeComparableColor(color) {
    return String(color ?? '').replace(/\s+/g, '').toLowerCase();
  }

  _hasExplicitOpacity(color) {
    const value = String(color ?? '').trim().toLowerCase();
    return value === 'transparent' || value.startsWith('rgba');
  }

  _parseOpacity(value) {
    const parsed = parseInt(value, 10);
    return this._clamp(Number.isFinite(parsed) ? parsed : 100, 0, 100) / 100;
  }

  _getColorOpacityPercent(color) {
    return Math.round(this._getColorOpacity(color) * 100);
  }

  _getColorOpacity(color) {
    const value = String(color ?? '').trim().toLowerCase();
    if (!value || value === 'transparent') return 0;

    const rgba = value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
    if (rgba) {
      const alpha = parseFloat(rgba[1]);
      return this._clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    }

    return 1;
  }

  _withColorOpacity(color, opacity) {
    const alpha = this._clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
    const rgb = this._extractRgb(color);

    if (!rgb) {
      return alpha === 0 ? 'transparent' : color;
    }

    if (alpha === 0 && String(color ?? '').trim().toLowerCase() === 'transparent') {
      return 'transparent';
    }

    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this._formatAlpha(alpha)})`;
  }

  _extractRgb(color) {
    const value = String(color ?? '').trim().toLowerCase();
    if (!value || value === 'transparent') return { r: 0, g: 0, b: 0 };

    if (/^#[0-9a-f]{6}$/i.test(value)) {
      return {
        r: parseInt(value.slice(1, 3), 16),
        g: parseInt(value.slice(3, 5), 16),
        b: parseInt(value.slice(5, 7), 16),
      };
    }

    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return {
        r: parseInt(value[1] + value[1], 16),
        g: parseInt(value[2] + value[2], 16),
        b: parseInt(value[3] + value[3], 16),
      };
    }

    const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      return {
        r: this._clamp(parseInt(rgb[1], 10), 0, 255),
        g: this._clamp(parseInt(rgb[2], 10), 0, 255),
        b: this._clamp(parseInt(rgb[3], 10), 0, 255),
      };
    }

    return null;
  }

  _formatAlpha(alpha) {
    return String(Math.round(alpha * 100) / 100);
  }

  _extractHexColor(color) {
    if (typeof color !== 'string') return '#000000';

    // 如果已经是 hex 格式，直接返回
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;

    // 从 rgba 中提取
    const rgbaMatch = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(rgbaMatch[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(rgbaMatch[3], 10).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }

    return '#000000';
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

export default ShapeModule;
