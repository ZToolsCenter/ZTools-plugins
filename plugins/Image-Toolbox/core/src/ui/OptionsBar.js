import { eventBus } from '../index.js';

/**
 * Top options bar UI component.
 * Renders presets for the active tool.
 */
class OptionsBar {
  constructor(containerEl, toolManager) {
    this._el = containerEl;
    this._tm = toolManager;
    this._currentTool = null;
    this._shapePickerEl = null;
    this._shapePickerAnchor = null;
    this._boundDocumentClick = this._handleDocumentClick.bind(this);
    this._boundKeyDown = this._handleKeyDown.bind(this);
    this._boundRepositionShapePicker = this._positionShapePicker.bind(this);
    this._eventBusUnsubscribers = [];

    this._render();
    this._bindEvents();
  }

  _render() {
    this._el.innerHTML = `
      <div class="optionsbar__controls" id="optionsbar-controls"></div>
    `;
  }

  _bindEvents() {
    // Update options when the active tool changes.
    this._eventBusUnsubscribers.push(
      eventBus.on('tool:changed', (toolName) => {
        this._currentTool = toolName;
        this._closeShapePicker();
        this._updateControls();
      })
    );

    [
      'canvas:selectionCreated',
      'canvas:selectionUpdated',
      'canvas:selectionCleared',
      'canvas:objectModified',
      'canvas:restored',
      'image:loaded',
      'tool:propertiesChanged',
    ].forEach(eventName => {
      this._eventBusUnsubscribers.push(
        eventBus.on(eventName, () => {
          if (this._currentTool) this._updateControls();
        })
      );
    });

    // Only handle one-click presets here; detailed controls live in the property panel.
    this._el.addEventListener('click', (e) => {
      this._handleControlEvent(e);
    });

    // 鼠标悬停在横向滑动的预设区（图形配色 / 调色预设）时，滚轮转为横向滚动
    this._el.addEventListener('wheel', (e) => {
      const scrollEl = e.target.closest('.shape-style-scroll, .filter-preset-scroll');
      if (!scrollEl) return;
      // 仅在纵向滚轮占主导时接管（触控板原生横向滚动不拦截）
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      scrollEl.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  _updateControls() {
    this._closeShapePicker();

    const controlsEl = this._el.querySelector('#optionsbar-controls');
    if (!controlsEl) return;

    const module = this._tm.getCurrentModule();
    if (module && typeof module.getOptionsBarHTML === 'function') {
      controlsEl.innerHTML = module.getOptionsBarHTML();
      this._scrollActivePresetIntoView(controlsEl, '.shape-style-scroll', '.shape-style-btn.active');
      // 调色预设卡片同样需要把当前生效项滚到可视区，避免点击后位置被重置
      this._scrollActivePresetIntoView(controlsEl, '.filter-preset-scroll', '.filter-preset-btn.active');
      // 卡片宽度随图片比例变化，需在插入 DOM 后实测是否溢出，再决定滚动条占位
      this._syncFilterPresetScrollState(controlsEl, module);
    } else {
      controlsEl.innerHTML = '';
    }
  }

  /**
   * 让调色预设区按实际内容宽度决定是否显示滚动条。
   *
   * 卡片宽度是按源图比例动态算的，插入 DOM 前无法得知是否溢出；
   * 溢出时才给滚动区加标记并让出 6px 高度，避免滚动条压住卡片底部。
   *
   * @param {HTMLElement} container 选项栏内容容器
   * @param {object} module 当前工具模块
   */
  _syncFilterPresetScrollState(container, module) {
    if (typeof module?.syncPresetScrollState === 'function') {
      module.syncPresetScrollState(container);
      return;
    }

    const scrollEl = container.querySelector('.filter-preset-scroll');
    if (!scrollEl) return;
    scrollEl.classList.toggle('is-scrollable', scrollEl.scrollWidth > scrollEl.clientWidth + 1);
  }

  /**
   * 横向滑动的预设区重渲染后，把当前选中的预设滚到可视区，
   * 避免点击后滚动位置被重置导致激活项不可见。
   *
   * @param {HTMLElement} container 选项栏容器
   * @param {string} scrollSelector 可横向滑动的预设区选择器
   * @param {string} activeSelector 激活项选择器
   */
  _scrollActivePresetIntoView(container, scrollSelector, activeSelector) {
    const scrollEl = container.querySelector(scrollSelector);
    if (!scrollEl) return;
    const activeBtn = scrollEl.querySelector(activeSelector);
    if (!activeBtn) return;

    const scrollRect = scrollEl.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    const margin = 8;

    if (btnRect.left < scrollRect.left + margin) {
      scrollEl.scrollLeft -= (scrollRect.left + margin - btnRect.left);
    } else if (btnRect.right > scrollRect.right - margin) {
      scrollEl.scrollLeft += (btnRect.right - (scrollRect.right - margin));
    }
  }

  _handleControlEvent(e) {
    const pickerToggle = e.target.closest('[data-shape-picker-toggle]');
    if (pickerToggle) {
      e.preventDefault();
      e.stopPropagation();
      const module = this._tm.getCurrentModule();
      if (module && typeof module.getShapePickerHTML === 'function') {
        this._toggleShapePicker(pickerToggle, module);
      }
      return;
    }

    const target = e.target.closest('[data-preset]');
    if (!target) return;

    const module = this._tm.getCurrentModule();
    if (!module) return;

    if (module.applyPreset) module.applyPreset(target.dataset.preset);
    this._updateControls();
    eventBus.emit('tool:propertiesChanged');
  }

  _toggleShapePicker(anchor, module) {
    if (this._shapePickerEl && this._shapePickerAnchor === anchor) {
      this._closeShapePicker();
      return;
    }

    this._closeShapePicker();

    const pickerEl = document.createElement('div');
    pickerEl.className = 'shape-picker-popover';
    pickerEl.innerHTML = module.getShapePickerHTML();
    pickerEl.addEventListener('click', (e) => {
      const target = e.target.closest('[data-preset]');
      if (!target) return;

      const currentModule = this._tm.getCurrentModule();
      if (currentModule && currentModule.applyPreset) currentModule.applyPreset(target.dataset.preset);
      this._closeShapePicker();
      this._updateControls();
      eventBus.emit('tool:propertiesChanged');
    });

    document.body.appendChild(pickerEl);
    this._shapePickerEl = pickerEl;
    this._shapePickerAnchor = anchor;
    this._positionShapePicker();

    setTimeout(() => document.addEventListener('click', this._boundDocumentClick), 0);
    document.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('resize', this._boundRepositionShapePicker);
    window.addEventListener('scroll', this._boundRepositionShapePicker, true);
  }

  _positionShapePicker() {
    if (!this._shapePickerEl || !this._shapePickerAnchor) return;

    const anchorRect = this._shapePickerAnchor.getBoundingClientRect();
    const pickerRect = this._shapePickerEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - pickerRect.width - margin);
    const left = Math.min(Math.max(anchorRect.left, margin), maxLeft);

    let top = anchorRect.bottom + margin;
    if (top + pickerRect.height > window.innerHeight - margin) {
      top = anchorRect.top - pickerRect.height - margin;
    }
    top = Math.max(margin, top);

    this._shapePickerEl.style.left = `${left}px`;
    this._shapePickerEl.style.top = `${top}px`;
  }

  _handleDocumentClick(e) {
    if (!this._shapePickerEl) return;
    if (this._shapePickerEl.contains(e.target) || this._shapePickerAnchor?.contains(e.target)) return;
    this._closeShapePicker();
  }

  _handleKeyDown(e) {
    if (e.key === 'Escape') this._closeShapePicker();
  }

  _closeShapePicker() {
    if (!this._shapePickerEl) return;

    this._shapePickerEl.remove();
    this._shapePickerEl = null;
    this._shapePickerAnchor = null;
    document.removeEventListener('click', this._boundDocumentClick);
    document.removeEventListener('keydown', this._boundKeyDown);
    window.removeEventListener('resize', this._boundRepositionShapePicker);
    window.removeEventListener('scroll', this._boundRepositionShapePicker, true);
  }

  /**
   * Destroy the options bar.
   */
  destroy() {
    this._closeShapePicker();
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default OptionsBar;
