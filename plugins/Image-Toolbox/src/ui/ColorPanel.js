import { eventBus } from '../../core/src/index.js';
import { FILTER_RANGES, FILTER_PRESETS, getFilterUiValue, setFilter, clearFilters, applyFilterPreset, isPresetActive } from '../../core/src/utils/filters.js';

/**
 * 调色面板 — 侧栏「调色」Tab
 * 选中图片图层时显示滤镜预设、亮度/对比度/饱和度/色相/模糊滑块与重置按钮。
 * 非图片图层或未选中时显示提示文本。
 */
class ColorPanel {
  constructor(containerEl, canvasManager, historyManager) {
    this._el = containerEl;
    this._cm = canvasManager;
    this._hm = historyManager;
    this._filterScope = 'all';
    this._eventBusUnsubscribers = [];

    this._render();
    this._bindEvents();
    this._update();
  }

  _render() {
    this._el.innerHTML = `
      <div class="panel panel--color">
        <div class="panel__body" id="color-panel-body">
          <div class="property-empty">选中图片图层以调色</div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this._eventBusUnsubscribers.push(
      eventBus.on('canvas:selectionCreated', () => this._update()),
      eventBus.on('canvas:selectionUpdated', () => this._update()),
      eventBus.on('canvas:selectionCleared', () => this._update()),
      eventBus.on('layer:selected', () => this._update()),
      eventBus.on('canvas:objectModified', () => this._update()),
      eventBus.on('canvas:restored', () => this._update()),
      eventBus.on('image:loaded', () => this._clearHint())
    );

    this._el.addEventListener('input', (e) => this._handleEvent(e));
    this._el.addEventListener('change', (e) => this._handleEvent(e));
    this._el.addEventListener('click', (e) => this._handleEvent(e));
  }

  _update() {
    const bodyEl = this._el.querySelector('#color-panel-body');
    if (!bodyEl) return;

    const reference = this._getReferenceImage();
    if (reference) {
      bodyEl.innerHTML = this._getColorAdjustHTML(reference);
    } else {
      const hint = this._getAllImages().length > 0
        ? '选中图片图层以调色'
        : '当前画布没有可调色的图片图层';
      bodyEl.innerHTML = `${this._getScopeControlHTML()}<div class="property-empty">${hint}</div>`;
    }
  }

  _clearHint() {
    this._update();
  }

  _getColorAdjustHTML(active) {
    const items = [
      { type: 'brightness', label: '亮度' },
      { type: 'contrast',  label: '对比' },
      { type: 'saturation',label: '饱和' },
      { type: 'hue',       label: '色相' },
      { type: 'blur',      label: '模糊' },
    ];

    const sliders = items.map(({ type, label }) => {
      const range = FILTER_RANGES[type];
      const value = getFilterUiValue(active, type);
      return `
        <div class="property-item property-item--wide">
          <label>${label}</label>
          <input type="range" class="property-range" data-prop="filter:${type}"
                 min="${range.min}" max="${range.max}" step="${range.step}" value="${value}" />
          <span class="property-value">${value}</span>
        </div>
      `;
    }).join('');

    const filterPresets = FILTER_PRESETS.map(preset => {
      const targets = this._getTargetImages();
      const isActive = this._filterScope === 'all'
        ? targets.length > 0 && targets.every(image => isPresetActive(image, preset.preset))
        : isPresetActive(active, preset.preset);
      return `<button type="button" class="options-btn options-btn-sm filter-preset-btn ${isActive ? 'active' : ''}" data-preset="${preset.preset}">${preset.label}</button>`;
    }).join('');

    const scopeTitle = this._filterScope === 'all'
      ? `调色 (${this._getTargetImages().length} 个图片图层)`
      : '调色';

    return `
      ${this._getScopeControlHTML()}
      <div class="property-section-title">滤镜</div>
      <div class="filter-presets">${filterPresets}</div>
      <div class="property-section-title">${scopeTitle}</div>
      ${sliders}
      <div class="property-item property-item--wide property-item--actions">
        <button type="button" class="property-btn" data-prop="filter:reset">重置调色</button>
      </div>
    `;
  }

  _handleEvent(e) {
    // 滤镜预设按钮（一键应用）
    const presetTarget = e.target.closest('[data-preset]');
    if (presetTarget && this._el.contains(presetTarget)) {
      const preset = presetTarget.dataset.preset;
      if (preset && preset.startsWith('filter-')) {
        if (e.type !== 'click') return;
        this._applyFilterPreset(preset);
        return;
      }
    }

    // 调色滑块 / 重置
    const target = e.target.closest('[data-prop]');
    if (!target || !this._el.contains(target)) return;

    const prop = target.dataset.prop;
    if (!prop) return;

    if (prop === 'filterScope') {
      if (e.type !== 'change') return;
      this._filterScope = target.value === 'all' ? 'all' : 'current';
      this._update();
      return;
    }

    if (!prop.startsWith('filter:')) return;

    const targets = this._getTargetImages();
    if (targets.length === 0) return;

    const value = target.value;

    // 重置按钮
    if (prop === 'filter:reset') {
      if (e.type !== 'click') return;
      this._hm?.saveState?.();
      targets.forEach(image => clearFilters(image));
      this._markImagesChanged(targets);
      this._requestRender();
      this._notifyObjectChanged(targets[0]);
      this._update();
      return;
    }

    // 滑块
    const type = prop.slice('filter:'.length);
    const uiValue = parseInt(value, 10);
    if (!Number.isFinite(uiValue)) return;

    targets.forEach(image => setFilter(image, type, uiValue));
    this._markImagesChanged(targets);

    if (target.nextElementSibling && target.nextElementSibling.classList.contains('property-value')) {
      target.nextElementSibling.textContent = String(uiValue);
    }

    this._requestRender();

    if (e.type === 'change') {
      this._notifyObjectChanged(targets[0]);
    }
  }

  _applyFilterPreset(presetName) {
    const targets = this._getTargetImages();
    if (targets.length === 0) return;
    this._hm?.saveState?.();
    targets.forEach(image => applyFilterPreset(image, presetName));
    this._markImagesChanged(targets);
    this._requestRender();
    this._notifyObjectChanged(targets[0]);
    this._update();
  }

  _getScopeControlHTML() {
    return `
      <div class="property-section-title">作用范围</div>
      <div class="property-item property-item--wide">
        <label>范围</label>
        <select class="property-select" data-prop="filterScope">
          <option value="current" ${this._filterScope === 'current' ? 'selected' : ''}>当前图层</option>
          <option value="all" ${this._filterScope === 'all' ? 'selected' : ''}>全部图片图层</option>
        </select>
      </div>
    `;
  }

  _getTargetImages() {
    if (this._filterScope === 'all') {
      return this._getAllImages();
    }

    const active = this._getActiveObject();
    return active && active.type === 'image' && active.type !== 'activeSelection' ? [active] : [];
  }

  _getReferenceImage() {
    if (this._filterScope === 'all') {
      const active = this._getActiveObject();
      return active?.type === 'image' ? active : this._getAllImages()[0] || null;
    }

    const active = this._getActiveObject();
    return active?.type === 'image' ? active : null;
  }

  _getAllImages() {
    const canvas = this._cm?.canvas;
    if (!canvas) return [];
    return canvas.getObjects().filter(obj => (
      obj &&
      obj.type === 'image' &&
      !obj.excludeFromLayer &&
      !obj.excludeFromHistory
    ));
  }

  _markImagesChanged(images) {
    images.forEach(image => {
      image.dirty = true;
      image.setCoords();
    });
  }

  _getActiveObject() {
    return this._cm?.getActiveObject?.() || null;
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

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default ColorPanel;
