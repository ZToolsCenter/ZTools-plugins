import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { SAVE_STATUS, normalizeSaveResult } from '../adapters/BaseHostAdapter.js';

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
   * @param {object} [host]
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
   * @param {object} host
   */
  setHost(host) {
    this._host = host;
  }

  /**
   * 导出为文件 — 先弹保存对话框，用户选择格式后自动匹配导出
   *
   * 所有失败分支都必须给出用户可见的提示：此前 host.saveImage 返回 false
   * 时直接 return，界面毫无反应，用户会误以为已保存而关闭窗口丢失编辑成果。
   * @param {string} [presetFormat] - 预设格式 ('png'|'jpeg'|'webp')，优先于对话框选择
   */
  async exportToFile(presetFormat) {
    // 如果指定了预设格式，直接使用该格式导出
    const format = presetFormat || null;

    // 优先使用 host adapter 的原生对话框 + 写入能力
    if (this._host?.showSaveImageDialog && this._host?.writeImageFile) {
      const ext = format || 'png';
      // 传入格式，让保存对话框只显示该格式的过滤器
      const filePath = this._host.showSaveImageDialog(`edited.${ext}`, ext);
      // 对话框返回空 = 用户主动取消，属于正常操作，不提示错误
      if (!filePath) {
        return;
      }

      // 如果有预设格式，强制使用；否则从文件名推断
      const actualFormat = format || this._getFormatFromFilePath(filePath);
      const dataURL = this.exportToDataURL(actualFormat);
      if (!dataURL) {
        this._notifyToast('导出失败：无法生成图片数据', 'error');
        return;
      }

      const result = normalizeSaveResult(this._host.writeImageFile(filePath, dataURL));
      this._reportSaveResult(result);
      return;
    }

    const actualFormat = format || 'png';
    const dataURL = this.exportToDataURL(actualFormat);
    if (!dataURL) {
      this._notifyToast('导出失败：无法生成图片数据', 'error');
      return;
    }

    // 次选：host adapter 的 saveImage（自带保存对话框）
    if (this._host?.saveImage) {
      let result;
      try {
        result = normalizeSaveResult(await this._host.saveImage(dataURL, `edited.${actualFormat}`));
      } catch (err) {
        // 宿主抛异常也算写入失败，不能让异常静默逃逸
        console.error('[ExportModule] 保存图片失败:', err);
        this._notifyToast('保存失败：' + (err?.message || '写入文件时出错'), 'error');
        return;
      }

      // 平台无保存能力时继续走浏览器下载降级，不当作失败打扰用户
      if (result.status === SAVE_STATUS.UNSUPPORTED) {
        this._browserDownload(dataURL, `edited.${actualFormat}`);
        return;
      }

      this._reportSaveResult(result);
      return;
    }

    // 降级：浏览器下载
    this._browserDownload(dataURL, `edited.${actualFormat}`);
  }

  /**
   * 根据保存结果给出用户提示。
   * - saved    → 成功提示
   * - canceled → 用户主动取消，静默（不是错误）
   * - failed   → 明确错误提示，绝不静默
   * @param {{ ok: boolean, status: string, reason: string|null }} result
   */
  _reportSaveResult(result) {
    if (result.status === SAVE_STATUS.SAVED || result.ok) {
      this._notifyToast('图片已保存', 'success');
      return;
    }
    if (result.status === SAVE_STATUS.CANCELED) {
      return;
    }
    this._notifyToast('保存失败：' + (result.reason || '无法写入文件'), 'error');
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

  _getFormatFromFilePath(filePath) {
    const ext = String(filePath || '').split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (ext === 'webp') return 'webp';
    return 'png';
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
