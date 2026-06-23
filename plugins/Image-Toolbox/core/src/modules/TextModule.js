import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { getFontOptionsHTML, recordFontUsage } from '../utils/fonts.js';

/**
 * 加字模块 — 在图片上添加文字标注
 * 使用 fabric.IText 支持双击编辑
 */
class TextModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, {
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
      fontSize: 24,
      fill: '#d83b31',
      stroke: null,
      strokeWidth: 0,
      fontWeight: 'normal',
      fontStyle: 'normal',
      underline: false,
      textAlign: 'left',
      ...defaultOptions,
    });

    this._boundMouseDown = this._onMouseDown.bind(this);
  }

  activate(options = {}) {
    super.activate(options);  // 禁用所有对象交互
    const canvas = this.canvasManager.canvas;

    // 恢复文字对象的交互性（允许点击已有文字进行编辑）
    canvas.getObjects().forEach(obj => {
      if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
        obj.set({ selectable: true, evented: true });
      }
    });

    canvas.defaultCursor = 'text';
    canvas.on('mouse:down', this._boundMouseDown);
    eventBus.emit('module:activated', 'text');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;
    canvas.off('mouse:down', this._boundMouseDown);

    // 提交所有正在编辑的文字
    canvas.getObjects().forEach(obj => {
      if (obj.isEditing) {
        obj.exitEditing();
      }
    });

    super.deactivate();  // 恢复所有对象交互
  }

  /**
   * 点击位置添加文字
   */
  addTextOnClick(x, y) {
    this.addText('双击编辑', x, y);
  }

  /**
   * 在指定位置添加文字
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @returns {fabric.IText}
   */
  addText(text, x, y) {
    const canvas = this.canvasManager.canvas;
    const opts = this.options;

    const textObj = new fabric.IText(text, {
      left: x,
      top: y,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      fill: opts.fill,
      stroke: opts.stroke,
      strokeWidth: opts.strokeWidth,
      fontWeight: opts.fontWeight,
      fontStyle: opts.fontStyle,
      underline: opts.underline,
      textAlign: opts.textAlign,
      editable: true,
      id: 'text_' + Date.now(),
    });

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    canvas.renderAll();
    recordFontUsage(opts.fontFamily);

    // 进入编辑模式
    setTimeout(() => {
      textObj.enterEditing();
      textObj.selectAll();
    }, 50);

    this.history.saveState();
    return textObj;
  }

  // ── 样式设置 ──

  setFontFamily(family) {
    this.options.fontFamily = family;
    this._updateActiveTextStyle('fontFamily', family);
    recordFontUsage(family);
  }

  setFontSize(size) {
    this.options.fontSize = parseInt(size);
    this._updateActiveTextStyle('fontSize', parseInt(size));
  }

  setFontWeight(weight) {
    this.options.fontWeight = weight;
    this._updateActiveTextStyle('fontWeight', weight);
  }

  setFontStyle(style) {
    this.options.fontStyle = style;
    this._updateActiveTextStyle('fontStyle', style);
  }

  setTextColor(color) {
    this.options.fill = color;
    this._updateActiveTextStyle('fill', color);
  }

  setStroke(color, width) {
    this.options.stroke = color;
    this.options.strokeWidth = width;
    this._updateActiveTextStyle('stroke', color);
    this._updateActiveTextStyle('strokeWidth', width);
  }

  setUnderline(underline) {
    this.options.underline = underline;
    this._updateActiveTextStyle('underline', underline);
  }

  setBackgroundColor(color) {
    this._updateActiveTextStyle('backgroundColor', color);
  }

  /**
   * 应用文字预设样式
   * @param {string} presetName
   */
  applyPreset(presetName) {
    const presets = {
      red: {
        fill: '#d83b31',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      blue: {
        fill: '#1677FF',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      pink: {
        fill: '#FF4FA3',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      purple: {
        fill: '#8B5CF6',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      white: {
        fill: '#FFFFFF',
        fontWeight: 'normal',
        stroke: null,
        strokeWidth: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
      },
      yellow: {
        fill: '#FFD700',
        fontWeight: 'bold',
        stroke: '#000000',
        strokeWidth: 2,
      },
      black: {
        fill: '#111111',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      outline: {
        fill: '#FFFFFF',
        fontWeight: 'bold',
        stroke: '#000000',
        strokeWidth: 3,
      },
      orange: {
        fill: '#FF7A00',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
      green: {
        fill: '#2EAD4A',
        fontWeight: 'bold',
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
    };

    const preset = presets[presetName];
    if (!preset) return;

    Object.entries(preset).forEach(([key, value]) => {
      this.options[key] = value;
      this._updateActiveTextStyle(key, value);
    });
  }

  // ── 内部 ──

  _updateActiveTextStyle(prop, value) {
    const active = this.canvasManager.getActiveObject();
    if (active && (active.type === 'i-text' || active.type === 'text' || active.type === 'textbox')) {
      active.set(prop, value);
      this.canvasManager.canvas.renderAll();
    }
  }

  _onMouseDown(e) {
    const canvas = this.canvasManager.canvas;
    const pointer = canvas.getPointer(e.e);

    // 检查是否点到了已有的文字
    const target = e.target;
    if (target && (target.type === 'i-text' || target.type === 'text')) {
      // 允许选择和编辑已有文字
      return;
    }

    // 添加新文字
    this.addTextOnClick(pointer.x, pointer.y);
  }

  // ── 选项栏 ──

  getOptionsBarHTML() {
    return `
      <div class="options-group">
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="red" style="--text-preset-fill:#d83b31; --text-preset-stroke:#FFFFFF">标注红</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="blue" style="--text-preset-fill:#1677FF; --text-preset-stroke:#FFFFFF">标注蓝</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="pink" style="--text-preset-fill:#FF4FA3; --text-preset-stroke:#FFFFFF">标注粉</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="purple" style="--text-preset-fill:#8B5CF6; --text-preset-stroke:#FFFFFF">标注紫</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="yellow" style="--text-preset-fill:#FFD700; --text-preset-stroke:#000000">标题黄</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="black" style="--text-preset-fill:#111111; --text-preset-stroke:#FFFFFF">黑白字</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="outline" style="--text-preset-fill:#FFFFFF; --text-preset-stroke:#000000">描边白</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="orange" style="--text-preset-fill:#FF7A00; --text-preset-stroke:#FFFFFF">警示橙</button>
        <button class="options-btn options-btn-sm text-preset-btn" data-preset="green" style="--text-preset-fill:#2EAD4A; --text-preset-stroke:#FFFFFF">强调绿</button>
      </div>
    `;
  }

  // ── 属性面板 ──

  getPropertyPanelHTML() {
    const active = this.canvasManager.getActiveObject();
    if (!active || (active.type !== 'i-text' && active.type !== 'text' && active.type !== 'textbox')) {
      const opts = this.options;
      return `
        <div class="property-section-title">文字工具默认值</div>
        <div class="property-item property-item--wide">
          <label>字体</label>
          <select class="property-select" data-module-prop="fontFamily">
            ${this._getFontOptionsHTML(opts.fontFamily)}
          </select>
        </div>
        <div class="property-item">
          <label>字号</label>
          <input type="number" class="property-input" data-module-prop="fontSize" value="${opts.fontSize}" min="8" max="200" />
        </div>
        <div class="property-item">
          <label>颜色</label>
          <input type="color" class="property-color" data-module-prop="fill" value="${opts.fill || '#000000'}" />
        </div>
        <div class="property-item">
          <label>描边</label>
          <input type="color" class="property-color" data-module-prop="stroke" value="${opts.stroke || '#000000'}" />
        </div>
        <div class="property-item">
          <label>描边宽</label>
          <input type="number" class="property-input" data-module-prop="strokeWidth" value="${opts.strokeWidth || 0}" min="0" max="20" />
        </div>
        <div class="property-item">
          <label>粗体</label>
          <input type="checkbox" class="property-checkbox" data-module-prop="fontWeight" ${opts.fontWeight === 'bold' ? 'checked' : ''} />
        </div>
        <div class="property-item">
          <label>斜体</label>
          <input type="checkbox" class="property-checkbox" data-module-prop="fontStyle" ${opts.fontStyle === 'italic' ? 'checked' : ''} />
        </div>
        <div class="property-item">
          <label>下划线</label>
          <input type="checkbox" class="property-checkbox" data-module-prop="underline" ${opts.underline ? 'checked' : ''} />
        </div>
        <div class="property-item">
          <label>对齐</label>
          <select class="property-select property-select--short" data-module-prop="textAlign">
            ${this._getSelectOption('left', '左', opts.textAlign)}
            ${this._getSelectOption('center', '中', opts.textAlign)}
            ${this._getSelectOption('right', '右', opts.textAlign)}
          </select>
        </div>
        <div class="property-empty">这些设置会用于接下来新增的文字。</div>
      `;
    }

    return `
      <div class="property-item">
        <label>字号</label>
        <input type="number" class="property-input" data-prop="fontSize" value="${active.fontSize}" min="8" max="200" />
      </div>
      <div class="property-item">
        <label>颜色</label>
        <input type="color" class="property-color" data-prop="fill" value="${active.fill}" />
      </div>
      <div class="property-item">
        <label>描边</label>
        <input type="color" class="property-color" data-prop="stroke" value="${active.stroke || '#000000'}" />
      </div>
      <div class="property-item">
        <label>不透明度</label>
        <input type="range" class="property-range" data-prop="opacity" min="0" max="100" value="${Math.round(active.opacity * 100)}" />
        <span class="property-value">${Math.round(active.opacity * 100)}%</span>
      </div>
    `;
  }

  onPropertyChange(key, value) {
    const active = this.canvasManager.getActiveObject();
    if (!active) return;

    switch (key) {
      case 'fontSize':
        active.set('fontSize', parseInt(value));
        break;
      case 'fill':
        active.set('fill', value);
        break;
      case 'stroke':
        active.set('stroke', value);
        break;
      case 'opacity':
        // value 已被 _handleInput 转换为 0-1 区间，直接使用
        active.set('opacity', value);
        break;
    }

    this.canvasManager.canvas.renderAll();
  }

  onToolPropertyChange(key, value, context = {}) {
    switch (key) {
      case 'fontFamily':
        this.options.fontFamily = value;
        if (context.eventType === 'change') recordFontUsage(value);
        break;
      case 'fontSize':
        this.options.fontSize = Math.max(8, parseInt(value, 10) || this.options.fontSize);
        break;
      case 'fill':
        this.options.fill = value;
        break;
      case 'stroke':
        this.options.stroke = value;
        break;
      case 'strokeWidth':
        this.options.strokeWidth = Math.max(0, parseInt(value, 10) || 0);
        break;
      case 'fontWeight':
        this.options.fontWeight = value ? 'bold' : 'normal';
        break;
      case 'fontStyle':
        this.options.fontStyle = value ? 'italic' : 'normal';
        break;
      case 'underline':
        this.options.underline = !!value;
        break;
      case 'textAlign':
        this.options.textAlign = value;
        break;
      default:
        return false;
    }

    return true;
  }

  _getFontOptionsHTML(current) {
    return getFontOptionsHTML(current);
  }

  _getSelectOption(value, label, current) {
    const selected = this._normalizeValue(value) === this._normalizeValue(current) ? ' selected' : '';
    return `<option value="${value}"${selected}>${label}</option>`;
  }

  _normalizeValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

export default TextModule;
