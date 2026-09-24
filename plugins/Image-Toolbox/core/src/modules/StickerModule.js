import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';

/**
 * 贴纸模块 — 从本地文件选择图片，作为新图层添加到画布
 *
 * 作为左侧工具栏的动作工具：激活后顶部选项栏出现「从文件添加图片」按钮，点击触发选图；添加后自动切回「移动/框选」，便于拖拽、缩放、旋转贴纸。
 */
class StickerModule extends BaseModule {
  /**
   * @param {import('../CanvasManager.js').default} canvasManager
   * @param {import('../HistoryManager.js').default} historyManager
   * @param {object} [defaultOptions]
   * @param {object} [host] - 宿主适配器，提供 pickImage 能力
   */
  constructor(canvasManager, historyManager, defaultOptions = {}, host = null) {
    super(canvasManager, historyManager, {
      maxRatio: 0.5, // 贴纸相对参考尺寸（原图或画布）的最大占比
      ...defaultOptions,
    }, host);
    this._busy = false;
  }

  /**
   * 调出文件管理器选择一张本地图片，作为新图层添加到画布中心
   * @returns {Promise<void>}
   */
  async addStickerFromLocalFile() {
    const host = this._host;
    if (!host || typeof host.pickImage !== 'function') {
      eventBus.emit('toast:show', { message: '当前环境不支持选择图片', type: 'error' });
      return;
    }

    let dataURL;
    try {
      // pickImage 在 uTools/ZTools 同步返回 dataURL，Web 端返回 Promise
      dataURL = await Promise.resolve(host.pickImage());
    } catch (err) {
      console.error('[StickerModule] 选择图片失败:', err);
      eventBus.emit('toast:show', { message: '选择图片失败，请重试', type: 'error' });
      return;
    }

    if (!dataURL) return; // 用户取消选择

    try {
      const img = await this._loadImage(dataURL);
      this._addStickerImage(img);
    } catch (err) {
      console.error('[StickerModule] 加载贴纸失败:', err);
      eventBus.emit('toast:show', { message: '图片加载失败，可能格式不支持或文件已损坏', type: 'error' });
    }
  }

  getOptionsBarHTML() {
    return `
      <div class="options-group">
        <button class="options-btn" data-preset="sticker-from-file" title="从本地文件选择图片作为新图层添加到画布">
          从文件添加图片
        </button>
      </div>
    `;
  }

  async applyPreset(preset) {
    if (preset !== 'sticker-from-file') return;
    if (this._busy) return;
    this._busy = true;
    try {
      await this.addStickerFromLocalFile();
    } finally {
      this._busy = false;
    }
  }

  /**
   * 将 dataURL 加载为 fabric.Image（带超时保护）
   * @param {string} dataURL
   * @returns {Promise<fabric.Image>}
   */
  _loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('图片加载超时'));
      }, 15000);

      fabric.Image.fromURL(dataURL, (fabricImg, isError) => {
        clearTimeout(timeout);
        if (isError || !fabricImg) {
          reject(new Error('图片加载失败'));
          return;
        }
        resolve(fabricImg);
      }, undefined, undefined); // dataURL 无需 crossOrigin
    });
  }

  /**
   * 把 fabric.Image 作为贴纸图层添加到画布中心，并等比缩小到参考尺寸内
   * @param {fabric.Image} img
   */
  _addStickerImage(img) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    this._positionAndScale(img);

    img.set({
      id: 'sticker_' + Date.now(),
      _layerKind: 'sticker',
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      transparentCorners: false,
    });

    // 沿用 TextModule 的撤销语义：先保存快照（不含新图层），再添加
    this.history?.saveState();

    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.renderAll();

    // 切回移动/框选，使新贴纸立即可拖拽、缩放、旋转
    eventBus.emit('tool:requestChange', 'select');
  }

  /**
   * 计算贴纸在当前视口中心的落点，并按需等比缩小
   * @param {fabric.Image} img
   */
  _positionAndScale(img) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoom = canvas.getZoom() || 1;
    // 视口中心在画布场景坐标系下的位置
    const centerX = (canvas.getWidth() / 2 - vpt[4]) / zoom;
    const centerY = (canvas.getHeight() / 2 - vpt[5]) / zoom;

    const ref = this.canvasManager.originalImage;
    const maxW = (ref ? ref.width : canvas.getWidth()) * this.options.maxRatio;
    const maxH = (ref ? ref.height : canvas.getHeight()) * this.options.maxRatio;

    let scale = 1;
    if (img.width > maxW || img.height > maxH) {
      scale = Math.min(maxW / img.width, maxH / img.height, 1);
    }
    if (scale <= 0 || !isFinite(scale)) scale = 1;

    img.set({
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      scaleX: scale,
      scaleY: scale,
    });
  }
}

export default StickerModule;
