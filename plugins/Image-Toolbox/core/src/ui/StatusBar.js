import { eventBus } from '../index.js';

/**
 * Status bar UI component.
 * Shows image size, layer count, engine version, and export shortcuts.
 */
class StatusBar {
  constructor(containerEl, canvasManager, layerManager) {
    this._el = containerEl;
    this._cm = canvasManager;
    this._lm = layerManager;
    this._eventBusUnsubscribers = [];

    this._bindEvents();
    this._render();
  }

  _render() {
    this._el.innerHTML = `
      <div class="statusbar__left">
        <span class="statusbar__item" id="status-size">-- × --</span>
        <span class="statusbar__separator"></span>
        <span class="statusbar__item" id="status-layers">图层: 0</span>
        <span class="statusbar__separator"></span>
        <span class="statusbar__item">Fabric.js 5.x</span>
      </div>
      <div class="statusbar__right">
        <button class="statusbar__btn statusbar__btn--primary" id="status-save-file">保存到电脑</button>
        <button class="statusbar__btn" id="status-clipboard">复制到剪贴板</button>
      </div>
    `;
  }

  _bindEvents() {
    // Update size after image load.
    this._eventBusUnsubscribers.push(
      eventBus.on('image:loaded', (img) => {
        this._updateSize(img);
      })
    );

    // Update size after canvas changes.
    this._eventBusUnsubscribers.push(
      eventBus.on('canvas:objectModified', () => {
        if (this._cm.originalImage) {
          this._updateSize(this._cm.originalImage);
        }
      })
    );

    // Update layer count when layers change.
    this._eventBusUnsubscribers.push(
      eventBus.on('layers:updated', (layers) => {
        const countEl = this._el.querySelector('#status-layers');
        if (countEl) {
          countEl.textContent = `图层: ${layers ? layers.length : this._lm.getCount()}`;
        }
      })
    );

    // 导出按钮
    this._el.addEventListener('click', (e) => {
      if (e.target.id === 'status-save-file') {
        eventBus.emit('export:requested', 'file');
      } else if (e.target.id === 'status-clipboard') {
        eventBus.emit('export:requested', 'clipboard');
      }
    });
  }

  _updateSize(img) {
    const sizeEl = this._el.querySelector('#status-size');
    if (sizeEl && img) {
      const w = Math.round(img.width * img.scaleX);
      const h = Math.round(img.height * img.scaleY);
      sizeEl.textContent = `${w} × ${h} px`;
    }
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default StatusBar;
