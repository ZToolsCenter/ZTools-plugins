import eventBus from './EventBus.js';

const CLIP_PATH_SERIALIZED_PROPS = ['clipPath', 'absolutePositioned', 'inverted'];

const DEFAULT_CANVAS_OPTIONS = {
  width: 800,
  height: 600,
  backgroundColor: '#d2d6d9',
  preserveObjectStacking: true,
  selection: true,
  stopContextMenu: true,
  fireRightClick: true,
};

/**
 * 画布管理器 — 封装 Fabric.js 画布的创建、配置和基础操作
 */
class CanvasManager {
  constructor(canvasElId) {
    this._canvasElId = canvasElId;
    this.canvas = null;
    this.originalImage = null;  // 原始 fabric.Image
    this.zoomLevel = 1;
    this._historySaveTimer = null;
    this._isCropMode = false;
  }

  // ── 生命周期 ──

  /**
   * 初始化画布
   * @param {object} [options] - Fabric.Canvas 配置
   */
  init(options = {}) {
    const el = document.getElementById(this._canvasElId);
    if (!el) {
      throw new Error(`[CanvasManager] 找不到画布元素 #${this._canvasElId}`);
    }

    const config = { ...DEFAULT_CANVAS_OPTIONS, ...options };
    this.canvas = new fabric.Canvas(this._canvasElId, config);
    this._bindEvents();
    this._updateCanvasSize();
    eventBus.emit('canvas:initialized', this.canvas);
  }

  /**
   * 销毁画布，释放内存
   */
  destroy() {
    if (this._historySaveTimer) {
      clearTimeout(this._historySaveTimer);
    }
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
    this.originalImage = null;
  }

  // ── 图片操作 ──

  /**
   * 加载图片到画布
   * @param {string|File} source - URL / DataURL / File 对象
   * @returns {Promise<fabric.Image>}
   */
  loadImage(source) {
    return new Promise((resolve, reject) => {
      if (!this.canvas) {
        reject(new Error('画布未初始化'));
        return;
      }

      // 超时保护：防止 fabric.Image.fromURL 永远不回调
      const timeout = setTimeout(() => {
        reject(new Error('图片加载超时（30s），可能是格式不支持'));
      }, 30000);

      /**
       * fabric.Image.fromURL 回调签名: function(fabricImage, isError)
       * crossOrigin 是第 4 个参数，不是 imgOptions 的一部分
       */
      const onLoad = (fabricImg, isError) => {
        clearTimeout(timeout);

        if (isError || !fabricImg) {
          const err = new Error('图片加载失败：格式不支持或文件已损坏');
          console.error('[CanvasManager]', err.message);
          eventBus.emit('image:loadError', err);
          reject(err);
          return;
        }

        console.log('[CanvasManager] 图片加载成功: %d×%d (type=%s)',
          fabricImg.width, fabricImg.height, fabricImg.type);

        this.originalImage = fabricImg;
        this.canvas.clear();
        this.canvas.add(fabricImg);
        this.canvas.renderAll();
        this._updateCanvasSize();
        eventBus.emit('image:loaded', fabricImg);
        resolve(fabricImg);
      };

      if (source instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataURL = e.target.result;
          // fromURL(url, callback, imgOptions, crossOrigin)
          fabric.Image.fromURL(dataURL, onLoad, undefined, 'anonymous');
        };
        reader.onerror = (err) => {
          clearTimeout(timeout);
          console.error('[CanvasManager] FileReader 读取失败:', err);
          eventBus.emit('image:loadError', err);
          reject(err);
        };
        reader.readAsDataURL(source);
      } else if (typeof source === 'string') {
        // 数据URL 不需要 crossOrigin
        const needCrossOrigin = !source.startsWith('data:');
        fabric.Image.fromURL(
          source,
          onLoad,
          undefined,                               // imgOptions
          needCrossOrigin ? 'anonymous' : undefined // crossOrigin
        );
      } else {
        reject(new Error('不支持的图片源类型'));
      }
    });
  }

  /**
   * 替换当前图片（不清除覆盖层）
   * @param {string} source
   */
  replaceImage(source) {
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(source, (fabricImg, isError) => {
        if (isError || !fabricImg) {
          reject(new Error('替换图片失败'));
          return;
        }
        if (this.originalImage) {
          this.canvas.remove(this.originalImage);
        }
        this.originalImage = fabricImg;
        this.canvas.insertAt(fabricImg, 1); // 放到最底层但保留背景
        this.canvas.renderAll();
        resolve(fabricImg);
      }, undefined, 'anonymous');
    });
  }

  /**
   * 获取画布当前图片 DataURL
   * @param {object} [options] - 导出选项
   * @returns {string}
   */
  getImageData(options = {}) {
    const opts = {
      format: 'png',
      multiplier: 1,
      ...options,
    };
    this.refreshDynamicMosaics?.({ render: true });
    return this.canvas.toDataURL(opts);
  }

  /**
   * 图片自适应画布大小
   * @param {number} [padding=40] - 边距
   */
  fitToCanvas(padding = 40) {
    if (!this.originalImage) return;

    const img = this.originalImage;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const availableW = cw - padding * 2;
    const availableH = ch - padding * 2;

    const scale = Math.min(availableW / img.width, availableH / img.height, 1);
    img.set({
      scaleX: scale,
      scaleY: scale,
      left: (cw - img.width * scale) / 2,
      top: (ch - img.height * scale) / 2,
    });
    this.canvas.renderAll();
  }

  // ── 画布控制 ──

  /**
   * 设置缩放
   * @param {number} level - 缩放级别(0.1~5)
   * @param {{x:number,y:number}} [point] - 缩放中心点
   */
  setZoom(level, point) {
    this.zoomLevel = Math.max(0.1, Math.min(5, level));
    const zoomPoint = point || new fabric.Point(
      this.canvas.width / 2,
      this.canvas.height / 2
    );
    this.canvas.zoomToPoint(zoomPoint, this.zoomLevel);
    eventBus.emit('canvas:zoomChanged', this.zoomLevel);
  }

  zoomIn(step = 0.1) {
    this.setZoom(this.zoomLevel + step);
  }

  zoomOut(step = 0.1) {
    this.setZoom(this.zoomLevel - step);
  }

  resetZoom() {
    this.setZoom(1);
  }

  // ── 物件管理 ──

  addObject(obj) {
    if (!this.canvas) return;
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.renderAll();
    eventBus.emit('canvas:objectAdded', obj);
  }

  removeObject(obj) {
    if (!this.canvas) return;
    this.canvas.remove(obj);
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    eventBus.emit('canvas:objectRemoved', obj);
  }

  removeActiveObject() {
    const active = this.canvas.getActiveObject();
    if (active) {
      this.removeObject(active);
    }
  }

  getActiveObject() {
    return this.canvas ? this.canvas.getActiveObject() : null;
  }

  /**
   * 清除所有覆盖层（保留原图）
   */
  clearOverlays() {
    if (!this.canvas) return;
    const objects = this.canvas.getObjects().filter(obj => obj !== this.originalImage);
    objects.forEach(obj => this.canvas.remove(obj));
    this.canvas.renderAll();
    eventBus.emit('canvas:overlaysCleared');
  }

  /**
   * 获取画布上的所有物件（不含原图）
   * @returns {fabric.Object[]}
   */
  getOverlays() {
    if (!this.canvas) return [];
    return this.canvas.getObjects().filter(obj => obj !== this.originalImage);
  }

  // ── 序列化 ──

  toJSON() {
    if (!this.canvas) return null;
    const json = this.canvas.toJSON([
      'clipPath',
      'filters',
      'id',
      'selectable',
      'evented',
      'absolutePositioned',
      'inverted',
      'objectCaching',
      'strokeLineCap',
      'strokeLineJoin',
      '_layerName',
      '_layerNameAuto',
      '_layerBaseName',
      '_layerKind',
      '_layerColorPresetName',
      '_layerWidthPresetName',
      '_layerPresetName',
      '_mosaicDynamic',
      '_mosaicMode',
      '_mosaicSize',
      '_mosaicBlurRadius',
      '_mosaicWidth',
      '_mosaicHeight',
      '_mosaicMaskType',
      '_mosaicBrushPoints',
      '_mosaicBrushSize',
      '_mosaicLassoPoints',
    ]);
    // 手动序列化 canvas.clipPath（Fabric.js canvas.toJSON 不包含此属性）
    if (this.canvas.clipPath) {
      json._canvasClipPath = this.canvas.clipPath.toJSON(CLIP_PATH_SERIALIZED_PROPS);
    }
    return json;
  }

  fromJSON(json) {
    return new Promise((resolve, reject) => {
      if (!this.canvas) {
        reject(new Error('画布未初始化'));
        return;
      }

      // 提取 canvas 级别的 clipPath
      const canvasClipPathData = json._canvasClipPath;
      delete json._canvasClipPath;

      this.canvas.loadFromJSON(json, () => {
        // 恢复 canvas.clipPath
        if (canvasClipPathData) {
          fabric.util.enlivenObjects([canvasClipPathData], (objects) => {
            this.canvas.clipPath = objects[0] || null;
            if (this.canvas.clipPath) {
              this.canvas.clipPath.absolutePositioned = true;
            }
            this.canvas.renderAll();
          });
        } else {
          // 快照中没有 clipPath → 清除画布上已有的（撤消裁切的关键）
          this.canvas.clipPath = null;
        }

        // 恢复 originalImage 引用
        const objs = this.canvas.getObjects();
        this.originalImage = objs.find(o => o.type === 'image' && o._originalImage) || objs[0];
        this.canvas.renderAll();
        eventBus.emit('canvas:restored');
        resolve();
      });
    });
  }

  // ── 辅助 ──

  /**
   * 判断点是否在画布内
   * @param {{x:number,y:number}} point
   * @returns {boolean}
   */
  isPointInCanvas(point) {
    return point.x >= 0 && point.x <= this.canvas.width
        && point.y >= 0 && point.y <= this.canvas.height;
  }

  // ── 内部方法 ──

  _updateCanvasSize() {
    const container = this.canvas.wrapperEl?.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const newWidth = rect.width;
    const newHeight = rect.height;

    // 容器不可见时跳过（避免读到 0×0 导致图片缩没）
    if (newWidth <= 0 || newHeight <= 0) return;

    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.canvas.setWidth(newWidth);
      this.canvas.setHeight(newHeight);
      this.canvas.calcOffset();

      // 如果已加载图片，重新适配
      if (this.originalImage) {
        this.fitToCanvas();
      }

      eventBus.emit('canvas:resized', { width: newWidth, height: newHeight });
    }
  }

  _bindEvents() {
    if (!this.canvas) return;

    // 选择变化
    this.canvas.on('selection:created', (e) => {
      eventBus.emit('canvas:selectionCreated', e.selected);
    });
    this.canvas.on('selection:updated', (e) => {
      eventBus.emit('canvas:selectionUpdated', e.selected);
    });
    this.canvas.on('selection:cleared', () => {
      eventBus.emit('canvas:selectionCleared');
    });

    // 物件修改
    this.canvas.on('object:modified', (e) => {
      eventBus.emit('canvas:objectModified', e.target);
    });
    this.canvas.on('text:changed', (e) => {
      eventBus.emit('canvas:objectMetadataChanged', e.target);
    });
    this.canvas.on('text:editing:exited', (e) => {
      eventBus.emit('canvas:objectModified', e.target);
    });

    // 物件添加/删除
    this.canvas.on('object:added', (e) => {
      eventBus.emit('canvas:objectAdded', e.target);
    });

    // 鼠标事件
    this.canvas.on('mouse:down', (e) => {
      eventBus.emit('canvas:mouseDown', e);
    });
    this.canvas.on('mouse:move', (e) => {
      eventBus.emit('canvas:mouseMove', e);
    });
    this.canvas.on('mouse:up', (e) => {
      eventBus.emit('canvas:mouseUp', e);
    });

    // 渲染完成
    this.canvas.on('after:render', () => {
      eventBus.emit('canvas:rendered');
    });

    // 窗口大小变化
    window.addEventListener('resize', () => {
      this._updateCanvasSize();
    });

    // 使用 ResizeObserver 监听容器变化
    const container = this.canvas.wrapperEl?.parentElement;
    if (container && window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        this._updateCanvasSize();
      });
      observer.observe(container);
    }
  }
}

export default CanvasManager;
