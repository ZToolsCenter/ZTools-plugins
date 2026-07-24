import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { requestRender as _requestRender } from '../utils/helpers.js';
import {
  FILTER_RANGES,
  FILTER_PRESETS,
  getFilterUiValue,
  setFilter,
  clearFilters,
  applyFilterPreset,
  isPresetActive,
} from '../utils/filters.js';

/**
 * 调色模块 — 左侧工具栏「调色」工具
 *
 * 激活后保持画布可选（与移动/框选一致），用户选中图片图层后：
 *   - 顶部预设栏显示滤镜预设（原图/暖色/冷色/复古/黑白/鲜艳/柔光/锐利）
 *   - 右侧属性面板显示调色滑块（亮度/对比/饱和/色相/模糊）+ 重置按钮
 */
class ColorModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, defaultOptions);
    // 标记：此模块接管属性面板，即使有选中对象也显示调色控件
    this.overridePropertyPanel = true;
    this._filterDragSaving = false;
  }

  activate(options = {}) {
    this.active = true;
    this.options = { ...this.options, ...options };

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    canvas.selection = true;
    canvas.defaultCursor = 'default';

    // 启用未锁定图层的交互性，确保用户可以选中图片图层
    this._enableEditableLayerInteractivity();
  }

  deactivate() {
    this.active = false;
  }

  // ── 顶部预设栏：滤镜预设 ──
  getOptionsBarHTML() {
    const targets = this._getTargetImages();
    const reference = this._getReferenceImage();
    if (!reference || targets.length === 0) {
      const hint = this._getFilterScope() === 'all'
        ? '当前画布没有可调色的图片图层'
        : '选中图片图层以调色';
      return `<div class="options-group"><span class="options-hint">${hint}</span></div>`;
    }

    const presets = FILTER_PRESETS.map(preset => {
      const isActive = this._getFilterScope() === 'all'
        ? targets.every(image => isPresetActive(image, preset.preset))
        : isPresetActive(reference, preset.preset);
      return `<button class="options-btn options-btn-sm filter-preset-btn ${isActive ? 'active' : ''}" data-preset="${preset.preset}">${preset.label}</button>`;
    }).join('');

    const scopeHint = this._getFilterScope() === 'all'
      ? `<span class="options-hint">全部图片图层 (${targets.length})</span>`
      : '<span class="options-hint">当前图层</span>';

    return `<div class="options-group">${scopeHint}${presets}</div>`;
  }

  // ── 右侧属性面板：调色滑块 ──
  getPropertyPanelHTML() {
    const reference = this._getReferenceImage();
    const scopeControl = this._getScopeControlHTML();
    if (!reference) {
      const hint = this._getAllImages().length > 0
        ? '选中图片图层，或将作用范围切换为全部图片图层'
        : '当前画布没有可调色的图片图层';
      return `${scopeControl}<div class="property-empty">${hint}</div>`;
    }

    const items = [
      { type: 'brightness', label: '亮度' },
      { type: 'contrast',   label: '对比' },
      { type: 'saturation', label: '饱和' },
      { type: 'hue',        label: '色相' },
      { type: 'blur',       label: '模糊' },
    ];

    const sliders = items.map(({ type, label }) => {
      const range = FILTER_RANGES[type];
      const value = getFilterUiValue(reference, type);
      return `
        <div class="property-item property-item--wide">
          <label>${label}</label>
          <input type="range" class="property-range" data-module-prop="filter:${type}"
                 min="${range.min}" max="${range.max}" step="${range.step}" value="${value}" data-value-suffix="" />
          <span class="property-value">${value}</span>
        </div>
      `;
    }).join('');

    const scopeTitle = this._getFilterScope() === 'all'
      ? `调色 (${this._getTargetImages().length} 个图片图层)`
      : '调色';

    return `
      ${scopeControl}
      <div class="property-section-title">${scopeTitle}</div>
      ${sliders}
      <div class="property-item property-item--wide property-item--actions">
        <button type="button" class="property-btn" data-module-action="filter-reset">重置调色</button>
      </div>
    `;
  }

  // ── 滤镜预设点击（顶部预设栏） ──
  applyPreset(presetName) {
    if (!presetName || !presetName.startsWith('filter-')) return;

    const targets = this._getTargetImages();
    if (targets.length === 0) return;

    this.history?.saveState?.();
    targets.forEach(image => applyFilterPreset(image, presetName));
    this._markImagesChanged(targets);
    _requestRender(this.canvasManager.canvas);
    eventBus.emit('canvas:objectModified', targets[0]);
  }

  // ── 调色滑块变化（属性面板） ──
  onToolPropertyChange(prop, value, { eventType } = {}) {
    if (prop === 'filterScope') {
      if (eventType !== 'change') return false;
      this.options.filterScope = value === 'all' ? 'all' : 'current';
      eventBus.emit('tool:propertiesChanged');
      return true;
    }

    if (!prop || !prop.startsWith('filter:')) return false;

    const targets = this._getTargetImages();
    if (targets.length === 0) return false;

    const type = prop.slice('filter:'.length);
    const uiValue = parseInt(value, 10);
    if (!Number.isFinite(uiValue)) return false;

    // 拖拽开始时保存一次历史（仅首个 input 事件触发），保存调整前状态以支持撤销
    if (eventType === 'input' && !this._filterDragSaving) {
      this._filterDragSaving = true;
      this.history?.saveState?.();
    }

    targets.forEach(image => setFilter(image, type, uiValue));
    this._markImagesChanged(targets);
    _requestRender(this.canvasManager.canvas);

    if (eventType === 'change') {
      this._filterDragSaving = false;
      eventBus.emit('canvas:objectModified', targets[0]);
    }
    return false; // 不刷新属性面板（避免滑块失焦）
  }

  // ── 重置按钮（属性面板） ──
  onToolPropertyAction(action, { eventType } = {}) {
    if (action !== 'filter-reset') return;
    if (eventType !== 'click') return;

    const targets = this._getTargetImages();
    if (targets.length === 0) return;

    this.history?.saveState?.();
    targets.forEach(image => clearFilters(image));
    this._markImagesChanged(targets);
    _requestRender(this.canvasManager.canvas);
    eventBus.emit('canvas:objectModified', targets[0]);
  }

  _getScopeControlHTML() {
    const scope = this._getFilterScope();
    return `
      <div class="property-section-title">作用范围</div>
      <div class="property-item property-item--wide">
        <label>范围</label>
        <select class="property-select" data-module-prop="filterScope" data-refresh-property="true">
          <option value="current" ${scope === 'current' ? 'selected' : ''}>当前图层</option>
          <option value="all" ${scope === 'all' ? 'selected' : ''}>全部图片图层</option>
        </select>
      </div>
    `;
  }

  _getFilterScope() {
    return this.options.filterScope === 'all' ? 'all' : 'current';
  }

  _getTargetImages() {
    if (this._getFilterScope() === 'all') {
      return this._getAllImages();
    }

    const active = this._getActiveImage();
    return active ? [active] : [];
  }

  _getReferenceImage() {
    if (this._getFilterScope() === 'all') {
      return this._getActiveImage() || this._getAllImages()[0] || null;
    }

    return this._getActiveImage();
  }

  _getAllImages() {
    const canvas = this.canvasManager?.canvas;
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

  // ── 获取当前选中的图片图层 ──
  _getActiveImage() {
    const active = this.canvasManager?.getActiveObject?.();
    if (!active || active.type === 'activeSelection') return null;
    return active.type === 'image' ? active : null;
  }
}

export default ColorModule;
