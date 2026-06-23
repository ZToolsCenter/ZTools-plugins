import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';

/**
 * 导出模块 — 将编辑结果导出为图片文件或复制到剪贴板
 *
 * 接受可选 host adapter 注入。未注入时降级到浏览器原生行为。
 */
class ExportModule extends BaseModule {
  /**
   * @param {import('../CanvasManager.js').default} canvasManager
   * @param {import('../HistoryManager.js').default} historyManager
   * @param {object} [defaultOptions]
   * @param {import('../interfaces/HostAdapter.js').default} [host]
   */
  constructor(canvasManager, historyManager, defaultOptions = {}, host = null) {
    super(canvasManager, historyManager, {
      format: 'png',
      quality: 1,
      multiplier: 1,
      ...defaultOptions,
    });
    this._host = host;
  }

  /**
   * 注入 host adapter（可在运行时设置）。
   * @param {import('../interfaces/HostAdapter.js').default} host
   */
  setHost(host) {
    this._host = host;
  }

  /**
   * 导出为文件 — 先弹保存对话框，用户选择格式后自动匹配导出
   */
  async exportToFile() {
    const dataURL = this.exportToDataURL('png');
    if (!dataURL) return;

    // 优先使用 host adapter
    if (this._host?.saveImage) {
      const saved = await this._host.saveImage(dataURL, 'edited.png');
      if (saved) {
        this._notifyToast('图片已保存', 'success');
      }
      return;
    }

    // 降级：浏览器下载
    this._browserDownload(dataURL, 'edited.png');
  }

  /**
   * 导出到剪贴板
   */
  async exportToClipboard() {
    const dataURL = this.exportToDataURL('png', 1, { trimToImage: true });
    if (!dataURL) return;

    // 优先使用 host adapter
    if (this._host?.copyImage) {
      const ok = await this._host.copyImage(dataURL);
      this._notifyToast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'success' : 'error');
      return;
    }

    // 降级：Clipboard API
    try {
      const blob = await (await fetch(dataURL)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      this._notifyToast('已复制到剪贴板', 'success');
    } catch (err) {
      console.error('[ExportModule] 剪贴板操作失败:', err);
      this._notifyToast('复制失败', 'error');
    }
  }

  /**
   * 获取 DataURL
   * @param {string} [format] - 'png' | 'jpeg' | 'webp'
   * @param {number} [quality] - 0~1
   * @param {object} [options]
   * @returns {string|null}
   */
  exportToDataURL(format, quality, options = {}) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return null;

    const fmt = format || 'png';
    const q = quality ?? 1;
    const dataURLOptions = {
      format: fmt,
      quality: q,
      multiplier: this.options.multiplier || 1,
    };

    if (options.trimToImage) {
      const bounds = this._getImageExportBounds();
      if (bounds) {
        Object.assign(dataURLOptions, bounds);
      }
    }

    return this._toDataURL(dataURLOptions, {
      resetViewport: !!options.trimToImage,
      transparentBackground: !!options.trimToImage,
    });
  }

  /**
   * 带选项导出
   */
  exportWithOptions(options = {}) {
    const opts = {
      format: 'png',
      multiplier: 1,
      quality: 1,
      ...options,
    };
    return this.exportToDataURL(opts.format, opts.quality);
  }

  _toDataURL(dataURLOptions, options = {}) {
    const canvas = this.canvasManager.canvas;
    const viewportTransform = canvas.viewportTransform?.slice();
    const backgroundColor = canvas.backgroundColor;

    try {
      this.canvasManager.refreshDynamicMosaics?.({ render: true });
      if (options.resetViewport) {
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
      }
      if (options.transparentBackground) {
        canvas.backgroundColor = null;
      }
      return canvas.toDataURL(dataURLOptions);
    } finally {
      if (viewportTransform) {
        canvas.viewportTransform = viewportTransform;
      }
      canvas.backgroundColor = backgroundColor;
      canvas.requestRenderAll();
    }
  }

  _getImageExportBounds() {
    const canvas = this.canvasManager.canvas;
    const clipBounds = this._getObjectBounds(canvas.clipPath);
    if (clipBounds) {
      return this._normalizeBounds(clipBounds);
    }

    const imageBounds = this._getObjectBounds(this.canvasManager.originalImage);
    if (imageBounds) {
      return this._normalizeBounds(imageBounds);
    }

    return null;
  }

  _getObjectBounds(obj) {
    if (!obj) return null;

    try {
      obj.setCoords?.();
      const rect = obj.getBoundingRect?.(true, true);
      if (rect && this._isValidBounds(rect)) {
        return rect;
      }
    } catch (err) {
      console.warn('[ExportModule] 获取导出边界失败，使用备用计算:', err);
    }

    const scaleX = obj.scaleX ?? 1;
    const scaleY = obj.scaleY ?? 1;
    return {
      left: obj.left ?? 0,
      top: obj.top ?? 0,
      width: (obj.width ?? 0) * scaleX,
      height: (obj.height ?? 0) * scaleY,
    };
  }

  _normalizeBounds(bounds) {
    if (!this._isValidBounds(bounds)) return null;

    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    const right = Math.ceil(bounds.left + bounds.width);
    const bottom = Math.ceil(bounds.top + bounds.height);

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  _isValidBounds(bounds) {
    return Number.isFinite(bounds.left)
        && Number.isFinite(bounds.top)
        && Number.isFinite(bounds.width)
        && Number.isFinite(bounds.height)
        && bounds.width > 0
        && bounds.height > 0;
  }

  /**
   * 浏览器下载（降级方案）
   */
  _browserDownload(dataURL, filename) {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * 通过 eventBus 发送 Toast 事件，由 UI 层渲染。
   * @param {string} message
   * @param {'success'|'error'} type
   */
  _notifyToast(message, type = 'success') {
    eventBus.emit('toast:show', { message, type });
  }

  activate() {
    super.activate();
  }

  deactivate() {
    super.deactivate();
  }
}

export default ExportModule;
