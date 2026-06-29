import { eventBus } from '../../core/src/index.js';

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
  }

  _updateControls() {
    this._closeShapePicker();

    const controlsEl = this._el.querySelector('#optionsbar-controls');
    if (!controlsEl) return;

    const module = this._tm.getCurrentModule();
    if (module && typeof module.getOptionsBarHTML === 'function') {
      controlsEl.innerHTML = module.getOptionsBarHTML();
    } else {
      controlsEl.innerHTML = '';
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
