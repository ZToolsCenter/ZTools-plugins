import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';

/**
 * 橡皮擦模块 - 默认擦除当前图层，并把擦除结果固化为位图。
 */
class EraserModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, {
      width: 20,
      ...defaultOptions,
    });

    this._targetObject = null;
    this._strokeTarget = null;
    this._isDrawing = false;
    this._lastPointer = null;
    this._previewImage = null;
    this._previewCtx = null;
    this._previewBounds = null;
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundLayerSelected = this._onLayerSelected.bind(this);
  }

  activate(options = {}) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const initialTarget = this._getErasableObject(canvas.getActiveObject());
    super.activate(options);

    this._targetObject = initialTarget;
    canvas.discardActiveObject();
    canvas.isDrawingMode = false;
    canvas.defaultCursor = 'crosshair';
    canvas.freeDrawingCursor = 'crosshair';
    canvas.on('mouse:down', this._boundMouseDown);
    canvas.on('mouse:move', this._boundMouseMove);
    canvas.on('mouse:up', this._boundMouseUp);
    eventBus.on('layer:selected', this._boundLayerSelected);

    eventBus.emit('module:activated', 'eraser');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.off('mouse:down', this._boundMouseDown);
      canvas.off('mouse:move', this._boundMouseMove);
      canvas.off('mouse:up', this._boundMouseUp);
      this._commitLivePreview();
      canvas.isDrawingMode = false;
      canvas.freeDrawingCursor = 'crosshair';
      this._targetObject = null;
      this._strokeTarget = null;
      this._isDrawing = false;
      this._lastPointer = null;
    }
    eventBus.off('layer:selected', this._boundLayerSelected);

    super.deactivate();
  }

  setWidth(width) {
    const parsed = parseInt(width, 10);
    this.options.width = this._clamp(Number.isFinite(parsed) ? parsed : this.options.width, 1, 120);
    this._applyBrushOptions();
  }

  applyPreset(presetName) {
    const presets = {
      'eraser-thin': 8,
      'eraser-medium': 20,
      'eraser-thick': 40,
      'eraser-heavy': 64,
    };

    const width = presets[presetName];
    if (!width) return;

    this.setWidth(width);
  }

  getOptionsBarHTML() {
    const width = this.options.width;

    return `
      <div class="options-group">
        <button class="options-btn options-btn-sm ${width === 8 ? 'active' : ''}" data-preset="eraser-thin">细</button>
        <button class="options-btn options-btn-sm ${width === 20 ? 'active' : ''}" data-preset="eraser-medium">中</button>
        <button class="options-btn options-btn-sm ${width === 40 ? 'active' : ''}" data-preset="eraser-thick">粗</button>
        <button class="options-btn options-btn-sm ${width === 64 ? 'active' : ''}" data-preset="eraser-heavy">特粗</button>
      </div>
    `;
  }

  getPropertyPanelHTML() {
    return `
      <div class="property-section-title">橡皮擦工具</div>
      <div class="property-item property-item--wide">
        <label>大小</label>
        <input type="range" class="property-range" data-module-prop="width" min="1" max="120" value="${this.options.width}" />
        <span class="property-value">${this.options.width}px</span>
      </div>
      <div class="property-empty">默认擦除进入工具前选中的当前图层；未选中图层时，会擦除鼠标下方最上层可编辑图层。</div>
    `;
  }

  onToolPropertyChange(key, value) {
    if (key !== 'width') return false;

    this.setWidth(value);
    return true;
  }

  _onMouseDown(e) {
    const nativeEvent = e?.e;
    if (nativeEvent && typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;
    if (this._isDrawing) return;

    const target = this._getStrokeTarget(e);
    this._strokeTarget = target;
    if (!target) return;

    this.history.saveState();

    const canvas = this.canvasManager.canvas;
    const pointer = canvas.getPointer(e.e);
    if (!this._beginLivePreview(target)) {
      this._resetStrokeState();
      return;
    }

    this._isDrawing = true;
    this._lastPointer = pointer;
    this._drawErasePoint(pointer);
    this._refreshPreview();
  }

  _onMouseMove(e) {
    if (!this._isDrawing || !this._lastPointer) return;
    if (typeof e?.e?.buttons === 'number' && e.e.buttons === 0) {
      this._onMouseUp();
      return;
    }

    const canvas = this.canvasManager.canvas;
    const pointer = canvas.getPointer(e.e);
    this._drawEraseSegment(this._lastPointer, pointer);
    this._lastPointer = pointer;
    this._refreshPreview();
  }

  _onMouseUp() {
    if (!this._isDrawing) return;

    this._commitLivePreview();
    this._resetStrokeState();
  }

  _onLayerSelected(meta) {
    if (!this.active) return;
    if (this._isDrawing) return;

    this._targetObject = this._getErasableObject(meta?.fabricObj || null);
    const canvas = this.canvasManager.canvas;
    if (canvas) canvas.discardActiveObject();
  }

  _beginLivePreview(target) {
    const canvas = this.canvasManager.canvas;
    if (!canvas || !this._isErasableObject(target)) return false;

    try {
      target.setCoords();
      const bounds = target.getBoundingRect(true, true);
      const cropLeft = Math.floor(bounds.left);
      const cropTop = Math.floor(bounds.top);
      const cropRight = Math.ceil(bounds.left + bounds.width);
      const cropBottom = Math.ceil(bounds.top + bounds.height);
      const cropWidth = Math.max(1, cropRight - cropLeft);
      const cropHeight = Math.max(1, cropBottom - cropTop);
      const rasterCanvas = this._renderTargetRegion(target, cropLeft, cropTop, cropWidth, cropHeight);
      const rasterCtx = rasterCanvas.getContext('2d');
      const previewImage = this._createRasterImage(target, rasterCanvas, cropLeft, cropTop);
      const targetIndex = canvas.getObjects().indexOf(target);

      canvas.remove(target);
      if (targetIndex >= 0) {
        canvas.insertAt(previewImage, targetIndex);
      } else {
        canvas.add(previewImage);
      }

      this._previewImage = previewImage;
      this._previewCtx = rasterCtx;
      this._previewBounds = { left: cropLeft, top: cropTop };
      this._targetObject = previewImage;
      this._strokeTarget = previewImage;
      canvas.discardActiveObject();
      canvas.requestRenderAll?.();
      return true;
    } catch (err) {
      console.error('[EraserModule] 创建实时擦除预览失败:', err);
      return false;
    }
  }

  _createRasterImage(target, rasterCanvas, left, top) {
    const layerName = typeof target._layerName === 'string' ? target._layerName : '';
    const image = new fabric.Image(rasterCanvas, {
      left,
      top,
      width: rasterCanvas.width,
      height: rasterCanvas.height,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      originX: 'left',
      originY: 'top',
      opacity: 1,
      id: target.id,
      selectable: false,
      evented: false,
      objectCaching: false,
    });

    if (layerName) {
      image._layerName = layerName;
      image._layerNameAuto = false;
      image._layerBaseName = '';
    }

    image.setCoords();
    return image;
  }

  _drawErasePoint(point) {
    const ctx = this._previewCtx;
    const bounds = this._previewBounds;
    if (!ctx || !bounds) return;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(point.x - bounds.left, point.y - bounds.top, this.options.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawEraseSegment(from, to) {
    const ctx = this._previewCtx;
    const bounds = this._previewBounds;
    if (!ctx || !bounds) return;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = this.options.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(from.x - bounds.left, from.y - bounds.top);
    ctx.lineTo(to.x - bounds.left, to.y - bounds.top);
    ctx.stroke();
    ctx.restore();
  }

  _refreshPreview() {
    const canvas = this.canvasManager.canvas;
    if (!canvas || !this._previewImage) return;

    this._previewImage.dirty = true;
    canvas.requestRenderAll?.();
  }

  _commitLivePreview() {
    if (!this._previewImage) return;

    const canvas = this.canvasManager.canvas;
    this._previewImage.setCoords();
    this._targetObject = this._previewImage;
    this._strokeTarget = this._previewImage;
    this._previewCtx = null;
    this._previewBounds = null;
    this._previewImage = null;
    this._isDrawing = false;
    this._lastPointer = null;

    if (canvas) {
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }

  _renderTargetRegion(target, left, top, width, height) {
    const canvas = this.canvasManager.canvas;
    const objects = canvas.getObjects();
    const visibilityBackups = objects.map(obj => ({ obj, visible: obj.visible }));
    const viewportTransform = canvas.viewportTransform?.slice();
    const backgroundColor = canvas.backgroundColor;

    try {
      canvas.discardActiveObject();
      objects.forEach(obj => {
        obj.visible = obj === target;
      });
      canvas.backgroundColor = null;
      canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
      canvas.calcViewportBoundaries?.();

      return canvas.toCanvasElement(1, {
        left,
        top,
        width,
        height,
        enableRetinaScaling: false,
      });
    } finally {
      visibilityBackups.forEach(({ obj, visible }) => {
        obj.visible = visible;
      });
      if (viewportTransform) {
        canvas.viewportTransform = viewportTransform;
      }
      canvas.backgroundColor = backgroundColor;
      canvas.calcViewportBoundaries?.();
      canvas.requestRenderAll?.();
    }
  }

  _getStrokeTarget(e) {
    if (this._isErasableObject(this._targetObject)) return this._targetObject;

    const canvas = this.canvasManager.canvas;
    const active = this._getErasableObject(canvas?.getActiveObject?.());
    if (active) {
      this._targetObject = active;
      return active;
    }

    const pointer = e ? canvas.getPointer(e.e) : null;
    const hit = pointer ? this._findTopmostObjectAt(pointer) : null;
    this._targetObject = hit;
    return hit;
  }

  _getErasableObject(obj) {
    if (!obj) return null;

    if (obj.type === 'activeSelection' && typeof obj.getObjects === 'function') {
      return this._pickTopmostObject(obj.getObjects());
    }

    return this._isErasableObject(obj) ? obj : null;
  }

  _isErasableObject(obj) {
    const canvas = this.canvasManager.canvas;
    if (!obj || !canvas?.getObjects().includes(obj)) return false;

    // 排除背景原图
    if (obj === this.canvasManager.originalImage) return false;

    // 排除工具临时对象
    if (obj.excludeFromHistory || obj.excludeFromLayer) return false;

    // 排除旧版/误残留的橡皮擦路径
    if (typeof obj.id === 'string' && obj.id.startsWith('eraser_')) return false;
    if (obj.globalCompositeOperation === 'destination-out') return false;

    return true;
  }

  _findTopmostObjectAt(pointer) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return null;

    const objects = canvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!this._isErasableObject(obj) || obj.visible === false) continue;
      if (obj.containsPoint?.(pointer)) return obj;
    }

    return null;
  }

  _pickTopmostObject(objects) {
    const canvasObjects = this.canvasManager.canvas?.getObjects() || [];
    let result = null;
    let resultIndex = -1;

    objects.forEach(obj => {
      if (!this._isErasableObject(obj)) return;
      const index = canvasObjects.indexOf(obj);
      if (index > resultIndex) {
        result = obj;
        resultIndex = index;
      }
    });

    return result;
  }

  _resetStrokeState() {
    this._strokeTarget = null;
    this._isDrawing = false;
    this._lastPointer = null;
  }

  _applyBrushOptions() {
    // 实时橡皮擦直接写入预览 canvas，宽度在下一段轨迹生效。
  }

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}

export default EraserModule;
