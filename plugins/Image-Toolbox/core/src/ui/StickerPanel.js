import { eventBus } from '../index.js';

/**
 * 贴纸面板 UI 组件（左侧栏「贴纸」标签页内容）
 *
 * 提供从本地文件选择图片作为新图层的入口，
 * 实际加载与添加逻辑委托给 StickerModule。
 */
class StickerPanel {
  /**
   * @param {HTMLElement} containerEl
   * @param {import('../ToolManager.js').default} toolManager
   */
  constructor(containerEl, toolManager) {
    this._el = containerEl;
    this._tm = toolManager;
    this._busy = false;
    this._eventBusUnsubscribers = [];

    this._render();
    this._bindEvents();
  }

  _render() {
    this._el.innerHTML = `
      <div class="panel panel--sticker">
        <div class="panel__header">
          <span class="panel__title">贴纸</span>
        </div>
        <div class="panel__body sticker-panel__body">
          <button class="sticker-panel__add-btn" id="sticker-add-btn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>从文件添加图片</span>
          </button>
          <p class="sticker-panel__hint">
            选择本地图片作为新图层添加到画布，可在画布上拖拽、缩放、旋转。
          </p>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this._el.addEventListener('click', (e) => {
      const btn = e.target.closest('#sticker-add-btn');
      if (!btn) return;
      e.preventDefault();
      this._addFromLocalFile();
    });
  }

  async _addFromLocalFile() {
    if (this._busy) return;
    const module = this._tm?.getModule?.('sticker');
    if (!module || typeof module.addStickerFromLocalFile !== 'function') {
      eventBus.emit('toast:show', { message: '贴纸功能不可用', type: 'error' });
      return;
    }

    this._busy = true;
    this._flashButton(true);
    try {
      await module.addStickerFromLocalFile();
    } finally {
      this._busy = false;
      this._flashButton(false);
    }
  }

  _flashButton(busy) {
    const btn = this._el.querySelector('#sticker-add-btn');
    if (!btn) return;
    btn.classList.toggle('is-busy', !!busy);
    btn.disabled = !!busy;
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default StickerPanel;
