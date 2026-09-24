import { eventBus } from '../../core/src/index.js';
import { getFontOptionsHTML, recordFontUsage, isSystemFontsLoaded, onSystemFontsLoaded } from '../../core/src/utils/fonts.js';
import { clamp, escapeHTML, escapeAttr } from '../../core/src/utils/helpers.js';

/**
 * Property panel UI component.
 * Renders property editors for the selected layer type.
 */
class PropertyPanel {
  constructor(containerEl, toolManager, canvasManager = null, layerManager = null) {
    this._el = containerEl;
    this._tm = toolManager;
    this._cm = canvasManager || toolManager?._cm || null;
    this._lm = layerManager;
    this._eventBusUnsubscribers = [];

    this._bindEvents();
    this._render();
  }

  _render() {
    this._el.innerHTML = `
      <div class="panel panel--property">
        <div class="panel__header">
          <span class="panel__title">属性</span>
        </div>
        <div class="panel__body" id="property-body">
          <div class="property-empty">选中物件以编辑属性</div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Update the property panel when selection changes.
    this._eventBusUnsubscribers.push(
      eventBus.on('canvas:selectionCreated', () => this._updateProperties()),
      eventBus.on('canvas:selectionUpdated', () => this._updateProperties()),
      eventBus.on('canvas:selectionCleared', () => this._updateProperties()),
      eventBus.on('layer:selected', () => this._updateProperties()),
      eventBus.on('layers:updated', () => this._updateProperties()),
      eventBus.on('canvas:objectAdded', () => this._updateProperties()),
      eventBus.on('canvas:objectRemoved', () => this._updateProperties()),
      eventBus.on('canvas:restored', () => this._updateProperties()),
      eventBus.on('image:loaded', () => this._clearProperties()),
      eventBus.on('tool:changed', () => this._updateProperties()),
      eventBus.on('crop:updated', () => this._updateProperties()),
      eventBus.on('tool:propertiesChanged', () => this._updateProperties()),
      eventBus.on('canvas:objectModified', () => this._updateProperties())
    );

    // Delegate property input handling.
    this._el.addEventListener('input', (e) => {
      this._handleInput(e);
    });
    this._el.addEventListener('change', (e) => {
      this._handleInput(e);
    });
    this._el.addEventListener('click', (e) => {
      this._handleInput(e);
    });
  }

  _updateProperties() {
    const bodyEl = this._el.querySelector('#property-body');
    if (!bodyEl) return;

    const module = this._tm.getCurrentModule();
    const active = this._getActiveObject();

    // 模块可声明 overridePropertyPanel 接管属性面板（即使有选中对象）
    if (module?.overridePropertyPanel && typeof module.getPropertyPanelHTML === 'function') {
      const html = module.getPropertyPanelHTML();
      if (html) {
        bodyEl.innerHTML = html;
        return;
      }
    }

    if (active?.excludeFromProperty && module && typeof module.getPropertyPanelHTML === 'function') {
      const html = module.getPropertyPanelHTML();
      if (html) {
        bodyEl.innerHTML = html;
        return;
      }
    }

    if (active) {
      bodyEl.innerHTML = this._getLayerPropertiesHTML(active);
      return;
    }

    if (!module) {
      bodyEl.innerHTML = '<div class="property-empty">选中物件以编辑属性</div>';
      return;
    }

    // Prefer the active module's custom property panel when available.
    if (typeof module.getPropertyPanelHTML === 'function') {
      const html = module.getPropertyPanelHTML();
      if (html) {
        bodyEl.innerHTML = html;
        return;
      }
    }

    bodyEl.innerHTML = '<div class="property-empty">选中物件以编辑属性</div>';
  }

  _getLayerPropertiesHTML(active) {
    const meta = this._getLayerMeta(active);
    const isText = this._isTextObject(active);
    const isBackground = !!meta?.isBackground;
    const locked = meta ? meta.locked : (active.selectable === false && active.evented === false);
    // 背景图层的锁定只限制删除、改名和排序，仍允许显式编辑几何参数。
    const editDisabled = (locked && !isBackground) ? ' disabled' : '';
    const renameDisabled = (!meta || isBackground) ? ' disabled' : '';
    const lockDisabled = isBackground ? ' disabled' : '';
    const opacity = active.opacity == null ? 1 : active.opacity;
    const typeLabel = this._getTypeLabel(active, meta);
    const layerName = meta?.name || typeLabel;
    const width = this._getScaledWidth(active);
    const height = this._getScaledHeight(active);

    let html = '';

    html += `
      <div class="property-item property-item--wide">
        <label>名称</label>
        <input type="text" class="property-input property-input--name" data-prop="layerName" value="${this._escapeAttr(layerName)}"${renameDisabled} />
      </div>
      <div class="property-item">
        <label>类型</label>
        <span class="property-static">${this._escapeHTML(typeLabel)}</span>
      </div>
      <div class="property-item">
        <label>显示</label>
        <input type="checkbox" class="property-checkbox" data-prop="visible" ${active.visible !== false ? 'checked' : ''} />
      </div>
      <div class="property-item">
        <label>锁定</label>
        <input type="checkbox" class="property-checkbox" data-prop="locked" ${locked ? 'checked' : ''}${lockDisabled} />
      </div>
    `;

    // 位置
    html += `
      <div class="property-item">
        <label>X</label>
        <input type="number" class="property-input" data-prop="left" value="${this._formatNumber(active.left)}"${editDisabled} />
      </div>
      <div class="property-item">
        <label>Y</label>
        <input type="number" class="property-input" data-prop="top" value="${this._formatNumber(active.top)}"${editDisabled} />
      </div>
    `;

    // 大小（如有）
    if (active.width !== undefined) {
      html += `
        <div class="property-item">
          <label>宽</label>
          <input type="number" class="property-input" data-prop="width" value="${this._formatNumber(width)}" min="1"${editDisabled} />
        </div>
        <div class="property-item">
          <label>高</label>
          <input type="number" class="property-input" data-prop="height" value="${this._formatNumber(height)}" min="1"${editDisabled} />
        </div>
      `;
    }

    // 旋转
    html += `
      <div class="property-item">
        <label>旋转</label>
        <input type="number" class="property-input" data-prop="angle" value="${this._formatNumber(active.angle || 0)}"${editDisabled} />
      </div>
    `;

    // Opacity.
    html += `
      <div class="property-item">
        <label>不透明</label>
        <input type="range" class="property-range" data-prop="opacity"
               min="0" max="100" value="${Math.round(opacity * 100)}"${editDisabled} />
        <span class="property-value">${Math.round(opacity * 100)}%</span>
      </div>
    `;

    if (isText) {
      html += `
        <div class="property-item property-item--wide">
          <label>内容</label>
          <input type="text" class="property-input property-input--text" data-prop="text" value="${this._escapeAttr(active.text || '')}"${editDisabled} />
        </div>
        <div class="property-item property-item--wide">
          <label>字体</label>
          <select class="property-select" data-prop="fontFamily"${editDisabled}>
            ${this._getFontOptionsHTML(active.fontFamily)}
          </select>
        </div>
        <div class="property-item">
          <label>字号</label>
          <input type="number" class="property-input" data-prop="fontSize" value="${active.fontSize}" min="8" max="200"${editDisabled} />
        </div>
        <div class="property-item">
          <label>颜色</label>
          <input type="color" class="property-color" data-prop="fill" value="${this._toColorValue(active.fill, '#000000')}"${editDisabled} />
        </div>
        <div class="property-item">
          <label>描边</label>
          <input type="color" class="property-color" data-prop="stroke" value="${this._toColorValue(active.stroke, '#000000')}"${editDisabled} />
        </div>
        <div class="property-item">
          <label>描边宽</label>
          <input type="number" class="property-input" data-prop="strokeWidth" value="${active.strokeWidth || 0}" min="0" max="20"${editDisabled} />
        </div>
        <div class="property-item">
          <label>描边位</label>
          <select class="property-select property-select--short" data-prop="strokePosition"${editDisabled}>
            ${this._getSelectOption('outside', '外部', active._strokePosition || 'outside')}
            ${this._getSelectOption('inside', '内部', active._strokePosition || 'outside')}
          </select>
        </div>
        <div class="property-item">
          <label>粗体</label>
          <input type="checkbox" class="property-checkbox" data-prop="fontWeight" ${active.fontWeight === 'bold' ? 'checked' : ''}${editDisabled} />
        </div>
        <div class="property-item">
          <label>斜体</label>
          <input type="checkbox" class="property-checkbox" data-prop="fontStyle" ${active.fontStyle === 'italic' ? 'checked' : ''}${editDisabled} />
        </div>
        <div class="property-item">
          <label>下划线</label>
          <input type="checkbox" class="property-checkbox" data-prop="underline" ${active.underline ? 'checked' : ''}${editDisabled} />
        </div>
        <div class="property-item">
          <label>删除线</label>
          <input type="checkbox" class="property-checkbox" data-prop="linethrough" ${active.linethrough ? 'checked' : ''}${editDisabled} />
        </div>
        <div class="property-item">
          <label>对齐</label>
          <select class="property-select property-select--short" data-prop="textAlign"${editDisabled}>
            ${this._getSelectOption('left', '左', active.textAlign)}
            ${this._getSelectOption('center', '中', active.textAlign)}
            ${this._getSelectOption('right', '右', active.textAlign)}
          </select>
        </div>
      `;
    } else if (this._supportsPaint(active)) {
      html += `
        <div class="property-item">
          <label>填充</label>
          <input type="color" class="property-color" data-prop="fill" value="${this._toColorValue(active.fill, '#000000')}"${editDisabled} />
        </div>
        <div class="property-item property-item--wide">
          <label>填充不透明</label>
          <input type="range" class="property-range" data-prop="fillOpacity" min="0" max="100" value="${this._getColorOpacityPercent(active.fill)}"${editDisabled} />
          <span class="property-value">${this._getColorOpacityPercent(active.fill)}%</span>
        </div>
        <div class="property-item">
          <label>描边</label>
          <input type="color" class="property-color" data-prop="stroke" value="${this._toColorValue(active.stroke, '#000000')}"${editDisabled} />
        </div>
        <div class="property-item property-item--wide">
          <label>描边不透明</label>
          <input type="range" class="property-range" data-prop="strokeOpacity" min="0" max="100" value="${this._getColorOpacityPercent(active.stroke)}"${editDisabled} />
          <span class="property-value">${this._getColorOpacityPercent(active.stroke)}%</span>
        </div>
        <div class="property-item">
          <label>描边宽</label>
          <input type="number" class="property-input" data-prop="strokeWidth" value="${active.strokeWidth || 0}" min="0" max="80"${editDisabled} />
        </div>
      `;
    }

    return html;
  }

  _clearProperties() {
    const bodyEl = this._el.querySelector('#property-body');
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="property-empty">选中物件以编辑属性</div>';
    }
  }

  _handleInput(e) {
    const target = e.target.closest('[data-prop], [data-module-prop], [data-module-action], [data-module-preset]');
    if (!target || !this._el.contains(target)) return;

    const prop = target.dataset.prop;
    const moduleProp = target.dataset.moduleProp;
    const moduleAction = target.dataset.moduleAction;
    const modulePreset = target.dataset.modulePreset;
    if (!prop && !moduleProp && !moduleAction && !modulePreset) return;
    // 普通属性控件只在 input/change 事件中处理；click 事件仅放行模块动作/预设
    if (e.type === 'click' && !moduleAction && !modulePreset) return;

    const module = this._tm.getCurrentModule();
    if (moduleProp || moduleAction || modulePreset) {
      this._handleModuleInput(e, module, moduleProp, moduleAction, modulePreset);
      return;
    }

    const active = this._getActiveObject();
    if (!active) return;

    let value = target.type === 'checkbox' ? target.checked : target.value;
    let propertyValue = value;

    switch (prop) {
      case 'layerName':
        if (e.type === 'change') {
          this._renameLayer(active, value);
        }
        return;
      case 'visible':
        if (e.type === 'change') {
          this._setLayerVisibility(active, value);
          this._notifyObjectChanged(active);
        }
        return;
      case 'locked':
        if (e.type === 'change') {
          this._setLayerLock(active, value);
          this._notifyObjectChanged(active);
        }
        return;
      case 'left':
      case 'top':
      case 'angle': {
        const parsed = parseFloat(value);
        if (!Number.isFinite(parsed)) return;
        active.set(prop, parsed);
        propertyValue = parsed;
        break;
      }
      case 'width':
        this._setScaledDimension(active, 'width', value);
        break;
      case 'height':
        this._setScaledDimension(active, 'height', value);
        break;
      case 'opacity': {
        const percent = this._clamp(parseInt(value, 10), 0, 100);
        propertyValue = percent / 100;
        active.set('opacity', propertyValue);
        if (target.nextElementSibling) {
          target.nextElementSibling.textContent = percent + '%';
        }
        break;
      }
      case 'fillOpacity':
      case 'strokeOpacity': {
        const percent = this._clamp(parseInt(value, 10), 0, 100);
        const paintProp = prop === 'fillOpacity' ? 'fill' : 'stroke';
        propertyValue = percent / 100;
        active.set(paintProp, this._withColorOpacity(active[paintProp], propertyValue));
        if (target.nextElementSibling) {
          target.nextElementSibling.textContent = percent + '%';
        }
        break;
      }
      case 'text':
        active.set('text', value);
        break;
      case 'fontFamily':
        active.set('fontFamily', value);
        if (e.type === 'change') recordFontUsage(value);
        break;
      case 'fontSize':
      case 'strokeWidth': {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return;
        propertyValue = parsed;
        active.set(prop, parsed);
        break;
      }
      case 'fill':
      case 'stroke':
        active.set(prop, this._withColorOpacity(value, this._getColorOpacity(active[prop], 1)));
        break;
      case 'fontWeight':
        propertyValue = value ? 'bold' : 'normal';
        active.set('fontWeight', propertyValue);
        break;
      case 'fontStyle':
        propertyValue = value ? 'italic' : 'normal';
        active.set('fontStyle', propertyValue);
        break;
      case 'underline':
        active.set('underline', value);
        break;
      case 'linethrough':
        active.set('linethrough', value);
        break;
      case 'textAlign':
        active.set('textAlign', value);
        break;
      case 'strokePosition':
        active.set('paintFirst', value === 'inside' ? 'fill' : 'stroke');
        active.set('_strokePosition', value);
        break;
      default:
        return;
    }

    active.setCoords();
    this._requestRender();

    // Notify the module so it can keep custom linked state in sync.
    if (module?.onPropertyChange) {
      module.onPropertyChange(prop, propertyValue, { eventType: e.type });
    }

    if (e.type === 'change' && !active.excludeFromHistory) {
      this._notifyObjectChanged(active);
    }
  }

  _handleModuleInput(e, module, prop, action, preset) {
    if (!module) return;

    const target = e.target;
    if (preset) {
      if (typeof module.applyPreset === 'function') {
        module.applyPreset(preset);
        this._updateProperties();
        eventBus.emit('tool:propertiesChanged');
      }
      return;
    }

    if (action) {
      if (typeof module.onToolPropertyAction === 'function') {
        module.onToolPropertyAction(action, { eventType: e.type });
      }
      return;
    }

    if (!prop || typeof module.onToolPropertyChange !== 'function') return;

    const value = target.type === 'checkbox' ? target.checked : target.value;
    const handled = module.onToolPropertyChange(prop, value, { eventType: e.type });

    if (target.type === 'range' && target.nextElementSibling) {
      const suffix = target.dataset.valueSuffix != null ? target.dataset.valueSuffix : 'px';
      target.nextElementSibling.textContent = `${value}${suffix}`;
    }

    if (handled !== false && target.dataset.refreshProperty === 'true') {
      this._updateProperties();
    }
  }

  _getActiveObject() {
    return this._cm?.getActiveObject?.() || null;
  }

  _getLayerMeta(obj) {
    if (!obj || !this._lm) return null;
    if (typeof this._lm.getLayerByObject === 'function') {
      return this._lm.getLayerByObject(obj);
    }
    return typeof this._lm._findMeta === 'function' ? this._lm._findMeta(obj) : null;
  }

  _renameLayer(active, name) {
    const meta = this._getLayerMeta(active);
    const nextName = String(name || '').trim();
    if (!meta || !nextName) return;
    this._lm.renameLayer(meta.id, nextName);
  }

  _setLayerVisibility(active, visible) {
    const meta = this._getLayerMeta(active);
    if (meta && typeof this._lm?.setVisibility === 'function') {
      this._lm.setVisibility(meta.id, visible);
      return;
    }

    active.set('visible', visible);
    this._requestRender();
  }

  _setLayerLock(active, locked) {
    const meta = this._getLayerMeta(active);
    if (meta && typeof this._lm?.setLock === 'function') {
      this._lm.setLock(meta.id, locked);
      return;
    }

    active.set({ selectable: !locked, evented: !locked });
    if (locked && this._cm?.canvas?.getActiveObject() === active) {
      this._cm.canvas.discardActiveObject();
    }
    this._requestRender();
  }

  _setScaledDimension(active, prop, value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const base = prop === 'width' ? active.width : active.height;
    if (!base) return;

    active.set(prop === 'width' ? 'scaleX' : 'scaleY', parsed / base);
  }

  _notifyObjectChanged(active) {
    eventBus.emit('canvas:objectModified', active);
  }

  _requestRender() {
    const canvas = this._cm?.canvas;
    if (!canvas) return;
    if (typeof canvas.requestRenderAll === 'function') {
      canvas.requestRenderAll();
    } else {
      canvas.renderAll();
    }
  }

  _isTextObject(obj) {
    return obj && (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox');
  }

  _supportsPaint(obj) {
    return obj && obj.type !== 'image' && obj.type !== 'group'
      && (obj.fill !== undefined || obj.stroke !== undefined || obj.strokeWidth !== undefined);
  }

  _getScaledWidth(obj) {
    if (typeof obj.getScaledWidth === 'function') return Math.abs(obj.getScaledWidth());
    return Math.abs((obj.width || 0) * (obj.scaleX || 1));
  }

  _getScaledHeight(obj) {
    if (typeof obj.getScaledHeight === 'function') return Math.abs(obj.getScaledHeight());
    return Math.abs((obj.height || 0) * (obj.scaleY || 1));
  }

  _getTypeLabel(obj, meta) {
    if (meta?.isBackground) return '背景图片';
    const labels = {
      'image': '图像',
      'i-text': '文字',
      'text': '文字',
      'textbox': '文字',
      'rect': '矩形',
      'circle': '圆形',
      'path': '路径',
      'triangle': '三角形',
      'group': '组合',
      'line': '线条',
    };
    return labels[obj.type] || obj.type || '图层';
  }

  _getFontOptionsHTML(current) {
    if (isSystemFontsLoaded()) {
      return getFontOptionsHTML(current);
    }

    // 异步加载字体，完成后更新属性面板
    onSystemFontsLoaded(() => {
      this._updateProperties();
    });

    return '<option value="" disabled selected>加载字体中...</option>';
  }

  _getSelectOption(value, label, current) {
    const selected = this._normalizeValue(value) === this._normalizeValue(current) ? ' selected' : '';
    return `<option value="${this._escapeAttr(value)}"${selected}>${this._escapeHTML(label)}</option>`;
  }

  _normalizeValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  _toColorValue(value, fallback = '#000000') {
    if (typeof value !== 'string') return fallback;
    const color = value.trim();
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      if (color.length === 4) {
        return '#' + color.slice(1).split('').map(ch => ch + ch).join('');
      }
      return color;
    }

    const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      return '#' + [rgb[1], rgb[2], rgb[3]]
        .map(v => this._clamp(parseInt(v, 10), 0, 255).toString(16).padStart(2, '0'))
        .join('');
    }

    return fallback;
  }

  _getColorOpacityPercent(color) {
    return Math.round(this._getColorOpacity(color, 0) * 100);
  }

  _getColorOpacity(color, fallback = 1) {
    const value = String(color ?? '').trim().toLowerCase();
    if (!value) return fallback;
    if (value === 'transparent') return 0;

    const rgba = value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
    if (rgba) {
      const alpha = parseFloat(rgba[1]);
      return this._clamp(Number.isFinite(alpha) ? alpha : fallback, 0, 1);
    }

    return 1;
  }

  _withColorOpacity(color, opacity) {
    const alpha = this._clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
    const rgb = this._extractRgb(color);

    if (!rgb) return color;
    if (alpha === 0 && String(color ?? '').trim().toLowerCase() === 'transparent') return 'transparent';

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

  _formatNumber(value) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 100) / 100;
  }

  _clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return clamp(value, min, max);
  }

  _escapeHTML(value) {
    return escapeHTML(value);
  }

  _escapeAttr(value) {
    return escapeAttr(value);
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default PropertyPanel;
