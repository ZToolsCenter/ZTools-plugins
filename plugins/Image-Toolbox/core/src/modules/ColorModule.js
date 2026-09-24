import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { requestRender as _requestRender } from '../utils/helpers.js';
import {
  FILTER_RANGES,
  FILTER_PRESETS,
  getFilterUiValue,
  getPresetFilterValues,
  setFilter,
  clearFilters,
  applyFilterPreset,
  isPresetActive,
} from '../utils/filters.js';
import { createFilterPreviewDataURL, disposeFilterPreview, getPreviewSize } from '../utils/filterPreview.js';

/**
 * 预览对象标识种子
 * 用模块级计数器而不是类静态字段，避免在旧版 Chromium（uTools / ZTools 内核）上
 * 因不支持 static class fields 而报语法错误
 */
let previewIdSeed = 0;

/**
 * 调色模块 — 左侧工具栏「调色」工具
 *
 * 激活后保持画布可选（与移动/框选一致），用户选中图片图层后：
 *   - 顶部预设栏以「效果缩略图 + 名称」卡片展示滤镜预设（原图/暖色/冷色/复古/黑白/鲜艳/柔光/锐利），
 *     缩略图取当前选中图层并实时套用对应预设，直观对比调色前后差异
 *   - 右侧属性面板显示调色滑块（亮度/对比/饱和/色相/模糊）+ 重置按钮
 */
class ColorModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, defaultOptions);
    // 标记：此模块接管属性面板，即使有选中对象也显示调色控件
    this.overridePropertyPanel = true;
    this._filterDragSaving = false;
    // 预设效果缩略图缓存：key 为预设名，value 为 dataURL
    // 同一张源图的缩略图只生成一次，避免每次重渲染都重新跑滤镜
    this._previewCache = new Map();
    this._previewCacheKey = null;
    this._previewSource = null;
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
    this._clearPreviewCache();
  }

  /**
   * 清空预设缩略图缓存并释放离屏画布
   * 图片内容变化（换图 / 替换图层）或模块停用时调用
   */
  _clearPreviewCache() {
    if (this._previewSource) {
      disposeFilterPreview(this._previewSource);
    }
    this._previewCache.clear();
    this._previewCacheKey = null;
    this._previewSource = null;
  }

  /**
   * 生成（或复用）预设效果缩略图
   *
   * @param {fabric.Image} reference 当前选中的图片图层
   * @returns {Map<string, string>} 预设名 → dataURL
   */
  _getPreviewMap(reference) {
    const cacheKey = this._getPreviewCacheKey(reference);
    if (this._previewCacheKey !== cacheKey) {
      if (this._previewSource && this._previewSource !== reference) {
        disposeFilterPreview(this._previewSource);
      }
      this._previewCache.clear();
      this._previewCacheKey = cacheKey;
      this._previewSource = reference;
    }

    FILTER_PRESETS.forEach(preset => {
      if (this._previewCache.has(preset.preset)) return;

      const dataURL = createFilterPreviewDataURL(reference, getPresetFilterValues(preset));
      if (dataURL) {
        this._previewCache.set(preset.preset, dataURL);
      }
    });

    return this._previewCache;
  }

  /**
   * 预览缓存的判定键：图片对象 + 源图地址，二者变化时重建缩略图
   * @param {fabric.Image} reference
   * @returns {string}
   */
  _getPreviewCacheKey(reference) {
    const src = reference?.getElement?.()?.src || '';
    return `${this._objectId(reference)}|${src}`;
  }

  _objectId(obj) {
    if (!obj) return 'none';
    if (!obj.__colorPreviewId) {
      Object.defineProperty(obj, '__colorPreviewId', {
        value: ++previewIdSeed,
        enumerable: false,
        configurable: true,
      });
    }
    return obj.__colorPreviewId;
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

    // 缩略图取「当前选中图层」作为基准；作用范围为全部时以参考图层预览效果
    const previews = this._getPreviewMap(reference);
    // 卡片宽度按源图宽高比动态计算，避免固定宽度导致横图被裁、竖图留白
    const { aspect } = getPreviewSize(reference);

    const presets = FILTER_PRESETS.map(preset => {
      const isActive = this._getFilterScope() === 'all'
        ? targets.every(image => isPresetActive(image, preset.preset))
        : isPresetActive(reference, preset.preset);
      const previewURL = previews.get(preset.preset);
      const preview = previewURL
        ? `<img class="filter-preset-btn__preview" src="${previewURL}" alt="" draggable="false" />`
        : `<span class="filter-preset-btn__preview filter-preset-btn__preview--empty"></span>`;
      return `<button type="button" class="filter-preset-btn ${isActive ? 'active' : ''}" data-preset="${preset.preset}" title="${preset.label}">${preview}<span class="filter-preset-btn__label">${preset.label}</span></button>`;
    }).join('');

    const scopeHint = this._getFilterScope() === 'all'
      ? `<span class="options-hint">全部图片图层 (${targets.length})</span>`
      : '<span class="options-hint">当前图层</span>';

    return `<div class="options-group options-group--filter" style="--preset-aspect: ${aspect}">${scopeHint}<div class="filter-preset-scroll">${presets}</div></div>`;
  }

  /**
   * 卡片总宽超过可用空间时给滚动区加标记，让它显示出横向滚动条并让出高度。
   * 由 OptionsBar 在插入 DOM 后调用（此时才能量到真实布局尺寸）。
   *
   * @param {HTMLElement} container 选项栏内容容器
   */
  syncPresetScrollState(container) {
    const scrollEl = container?.querySelector?.('.filter-preset-scroll');
    if (!scrollEl) return;

    const scrollable = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
    scrollEl.classList.toggle('is-scrollable', scrollable);
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
      this.history?.saveState?.();
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
