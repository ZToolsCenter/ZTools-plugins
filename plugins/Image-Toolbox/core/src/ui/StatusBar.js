import { eventBus } from '../index.js';

/**
 * dataURL 转 Blob
 * 在 Electron preload 环境中，readBinaryFile 返回的 ArrayBuffer 跨上下文传递可能丢失数据，
 * 因此 ORA 文件通过 readImageFile 读取为 dataURL（base64 字符串），再在渲染进程转为 Blob。
 */
function _dataURLToBlob(dataURL) {
  const match = dataURL.match(/^data:[^;]+;base64,(.+)$/i);
  if (!match) {
    // 不是 base64 dataURL，直接 fetch
    return null;
  }
  const base64 = match[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/zip' });
}

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
        <button class="statusbar__btn" id="status-open-file" title="打开图片或 ORA 工程文件">打开</button>
        <button class="statusbar__btn statusbar__btn--primary" id="status-save" title="保存文件">保存</button>
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

    // 按钮事件
    this._el.addEventListener('click', (e) => {
      if (e.target.id === 'status-save') {
        this._showSaveDialog();
      } else if (e.target.id === 'status-clipboard') {
        eventBus.emit('export:requested', 'clipboard');
      } else if (e.target.id === 'status-open-file') {
        this._openFilePicker();
      }
    });
  }

  // ── 打开文件 ──

  /**
   * 打开文件选择器 — 支持图片 (png/jpg/jpeg/webp/bmp/gif/svg) 和 ORA 工程文件
   */
  _openFilePicker() {
    // 优先使用宿主 API（Electron 环境）
    if (typeof window.showOpenDialog === 'function') {
      const result = window.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '图片和工程文件', extensions: ['ora', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
          { name: 'OpenRaster 工程文件', extensions: ['ora'] },
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'] },
        ],
      });
      const filePath = this._extractFilePath(result);
      if (filePath) {
        this._loadFileFromPath(filePath);
      }
      return;
    }

    // 降级：浏览器 file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ora,.png,.jpg,.jpeg,.webp,.bmp,.gif,.svg,image/*,application/zip';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this._dispatchFile(file);
      }
    };
    input.click();
  }

  /**
   * 从宿主 API 返回值中提取文件路径
   */
  _extractFilePath(result) {
    if (!result) return null;
    if (typeof result === 'string') return result;
    if (Array.isArray(result) && result.length > 0) return result[0];
    if (result.filePaths && Array.isArray(result.filePaths) && result.filePaths.length > 0) return result.filePaths[0];
    return null;
  }

  /**
   * 从文件路径加载 — 自动判断 ORA 或普通图片
   */
  _loadFileFromPath(filePath) {
    const isOra = filePath.toLowerCase().endsWith('.ora');

    if (isOra) {
      // ORA 工程文件 — 通过 readImageFile 读取为 dataURL，再转 Blob
      // 不使用 readBinaryFile (ArrayBuffer)，因为 Electron preload 的
      // ArrayBuffer 跨上下文传递可能出问题
      if (typeof window.readImageFile === 'function') {
        const dataURL = window.readImageFile(filePath);
        console.log('[ORA] readImageFile result:', dataURL ? `dataURL length=${dataURL.length}` : 'null');
        if (dataURL) {
          // dataURL → Blob
          const blob = _dataURLToBlob(dataURL);
          console.log('[ORA] _dataURLToBlob result:', blob ? `blob size=${blob.size}, type=${blob.type}` : 'null');
          if (blob && blob.size > 0) {
            eventBus.emit('ora:import', blob);
          } else {
            eventBus.emit('toast:show', { message: 'ORA 文件解析失败', type: 'error' });
          }
        } else {
          eventBus.emit('toast:show', { message: 'ORA 文件读取失败', type: 'error' });
        }
      } else {
        fetch(`file://${filePath}`)
          .then(r => r.blob())
          .then(blob => eventBus.emit('ora:import', blob))
          .catch(() => {
            eventBus.emit('toast:show', { message: 'ORA 文件读取失败', type: 'error' });
          });
      }
      return;
    }

    // 普通图片 — 读取为 dataURL 后加载
    if (typeof window.readImageFile === 'function') {
      const dataURL = window.readImageFile(filePath);
      if (dataURL) {
        eventBus.emit('file:open', dataURL);
      }
    } else {
      fetch(`file://${filePath}`)
        .then(r => r.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () => eventBus.emit('file:open', reader.result);
          reader.readAsDataURL(blob);
        })
        .catch(() => {
          eventBus.emit('toast:show', { message: '文件读取失败', type: 'error' });
        });
    }
  }

  /**
   * 分发 File/Blob 对象 — 自动判断 ORA 或普通图片
   */
  _dispatchFile(file) {
    const name = file.name?.toLowerCase() || '';
    if (name.endsWith('.ora')) {
      eventBus.emit('ora:import', file);
    } else {
      // 图片文件转 dataURL
      const reader = new FileReader();
      reader.onload = () => eventBus.emit('file:open', reader.result);
      reader.readAsDataURL(file);
    }
  }

  // ── 保存文件 ──

  /**
   * 显示保存格式选择弹窗
   */
  _showSaveDialog() {
    // 移除已有弹窗
    const existing = document.querySelector('.save-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'save-dialog-overlay';
    overlay.innerHTML = `
      <div class="save-dialog">
        <div class="save-dialog__title">保存文件</div>
        <div class="save-dialog__hint">选择保存格式</div>
        <div class="save-dialog__options">
          <button class="save-dialog__option" data-format="ora">
            <div class="save-dialog__option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </div>
            <div class="save-dialog__option-info">
              <div class="save-dialog__option-name">ORA 工程文件</div>
              <div class="save-dialog__option-desc">保留所有图层并栅格化，可再次编辑</div>
            </div>
          </button>
          <button class="save-dialog__option" data-format="png">
            <div class="save-dialog__option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div class="save-dialog__option-info">
              <div class="save-dialog__option-name">PNG 图片</div>
              <div class="save-dialog__option-desc">无损，支持透明背景</div>
            </div>
          </button>
          <button class="save-dialog__option" data-format="jpg">
            <div class="save-dialog__option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 16l5-5 4 4 3-3 6 6"/>
              </svg>
            </div>
            <div class="save-dialog__option-info">
              <div class="save-dialog__option-name">JPEG 图片</div>
              <div class="save-dialog__option-desc">体积小，适合分享</div>
            </div>
          </button>
          <button class="save-dialog__option" data-format="webp">
            <div class="save-dialog__option-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M8 12h8M12 8v8"/>
              </svg>
            </div>
            <div class="save-dialog__option-info">
              <div class="save-dialog__option-name">WebP 图片</div>
              <div class="save-dialog__option-desc">高压缩比，支持透明</div>
            </div>
          </button>
        </div>
        <button class="save-dialog__cancel">取消</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('save-dialog__cancel')) {
        overlay.remove();
      }
    });

    // 选择格式
    overlay.querySelectorAll('.save-dialog__option').forEach(btn => {
      btn.addEventListener('click', () => {
        const format = btn.dataset.format;
        overlay.remove();
        this._executeSave(format);
      });
    });
  }

  /**
   * 执行保存操作
   */
  _executeSave(format) {
    if (format === 'ora') {
      eventBus.emit('ora:export');
    } else {
      eventBus.emit('export:requested', { type: 'file', format });
    }
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
