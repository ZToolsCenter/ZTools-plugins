import BaseModule from './BaseModule.js';
import eventBus from '../EventBus.js';
import { clamp, requestRender as _requestRender, createClipPathFromSource, normalizeBounds, intersectBounds, getPointsBounds } from '../utils/helpers.js';

const SELECTION_FILL = 'rgba(47,127,134,0.16)';
const SELECTION_STROKE = '#2f7f86';
const SELECTION_STROKE_SOFT = 'rgba(47,127,134,0.52)';

/**
 * 马赛克模块 — 矩形/自由选区/画笔三种交互方式，马赛克 + 模糊两种效果
 *
 * 框选模式 (rect)：拖拽矩形选区应用马赛克/模糊
 * 自由选区 (lasso)：拖拽闭合非矩形选区应用马赛克/模糊
 * 画笔模式 (brush)：自由涂抹马赛克/模糊，释放时对涂抹覆盖区域（包围盒+画笔半径）应用效果
 */
class MosaicModule extends BaseModule {
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    super(canvasManager, historyManager, {
      mode: 'mosaic',       // 效果类型: 'mosaic' | 'blur'
      drawMode: 'rect',     // 交互方式: 'rect' | 'lasso' | 'brush'
      mosaicSize: 12,       // 马赛克块大小，默认对应“中马赛克”预设
      blurRadius: 8,        // 模糊半径
      brushSize: 20,        // 画笔直径
      ...defaultOptions,
    });

    this._isDrawing = false;
    this._startPoint = null;
    this._selectionRect = null;   // 框选模式的虚线矩形
    this._lassoPoints = [];       // 自由选区的轮廓点
    this._lassoPreview = null;    // 自由选区预览轮廓
    this._brushPoints = [];       // 画笔模式的轨迹点
    this._brushPreview = null;    // 画笔预览圆圈
    this._liveBrushOverlay = null; // 画笔模式拖动中的实时马赛克层
    this._detachedCanvasClipPath = null;
    this._clipPathDetached = false;
    this._objectClipPathBackups = null;

    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundMouseOut = this._onMouseOut.bind(this);
    this._boundObjectMoving = this._onObjectMoving.bind(this);
    this._refreshingDynamicMosaic = false;
    this._eventBusUnsubscribers = [];
    this._refreshDynamicRafId = null;

    this._bindDynamicMosaicEvents();
  }

  _bindDynamicMosaicEvents() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.on('object:moving', this._boundObjectMoving);
      canvas.on('object:scaling', this._boundObjectMoving);
      canvas.on('object:rotating', this._boundObjectMoving);
    }

    this._eventBusUnsubscribers.push(
      eventBus.on('canvas:objectModified', (target) => {
        if (this._refreshingDynamicMosaic) return;

        const targets = this._getDynamicMosaicTargets(target);
        if (targets.length > 0) {
          targets.forEach(obj => this._refreshDynamicMosaicOverlay(obj, { render: false }));
          this._requestRender();
          return;
        }

        this.refreshDynamicMosaics();
      }),
      eventBus.on('canvas:restored', () => this.refreshDynamicMosaics()),
      eventBus.on('canvas:objectAdded', (target) => {
        if (target === this._selectionRect || target === this._brushPreview || target === this._lassoPreview) return;
        if (target && this._isDynamicMosaic(target)) return;
        this.refreshDynamicMosaics();
      }),
      eventBus.on('canvas:objectRemoved', () => this.refreshDynamicMosaics()),
      eventBus.on('layer:visibilityChanged', () => this.refreshDynamicMosaics()),
      eventBus.on('layer:reordered', () => this.refreshDynamicMosaics()),
      eventBus.on('mosaic:refreshDynamic', () => this.refreshDynamicMosaics({ render: true }))
    );

    // 通过正式方法注册回调，而非动态注入
    this.canvasManager.setRefreshDynamicMosaics((options) => this.refreshDynamicMosaics(options));
  }

  // ── 生命周期 ──

  activate(options = {}) {
    super.activate(options);

    const canvas = this.canvasManager.canvas;
    canvas.defaultCursor = this._getCursorForDrawMode();
    this._detachCanvasClipPath();

    canvas.on('mouse:down', this._boundMouseDown);
    canvas.on('mouse:move', this._boundMouseMove);
    canvas.on('mouse:up', this._boundMouseUp);
    canvas.on('mouse:out', this._boundMouseOut);

    eventBus.emit('module:activated', 'mosaic');
  }

  deactivate() {
    const canvas = this.canvasManager.canvas;

    canvas.off('mouse:down', this._boundMouseDown);
    canvas.off('mouse:move', this._boundMouseMove);
    canvas.off('mouse:up', this._boundMouseUp);
    canvas.off('mouse:out', this._boundMouseOut);
    this._cleanupRect();
    this._cleanupLasso();
    this._cleanupLiveBrushOverlay();
    this._cleanupBrush();
    this._restoreDetachedCanvasClipPath(false);
    canvas.renderAll();

    super.deactivate();
  }

  destroy() {
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.off('object:moving', this._boundObjectMoving);
      canvas.off('object:scaling', this._boundObjectMoving);
      canvas.off('object:rotating', this._boundObjectMoving);
    }
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
    // 清除动态马赛克回调
    this.canvasManager.setRefreshDynamicMosaics(null);
  }

  // ── 参数设置 ──

  setMode(mode) {
    this.options.mode = mode;
  }

  setDrawMode(mode) {
    if (!['rect', 'lasso', 'brush'].includes(mode)) return;
    if (this.options.drawMode !== mode) {
      this._isDrawing = false;
      this._startPoint = null;
      this._brushPoints = [];
      this._cleanupRect();
      this._cleanupLasso();
      this._cleanupLiveBrushOverlay();
      this._cleanupBrush();
    }

    this.options.drawMode = mode;
    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.defaultCursor = this._getCursorForDrawMode();
    }
  }

  setMosaicSize(size) {
    this.options.mosaicSize = Math.max(2, Math.min(50, parseInt(size)));
  }

  setBlurRadius(radius) {
    this.options.blurRadius = Math.max(1, Math.min(30, parseInt(radius)));
  }

  setBrushSize(size) {
    this.options.brushSize = Math.max(4, Math.min(100, parseInt(size)));
    if (this._brushPreview) {
      const center = this._getBrushPreviewCenter();
      if (center) this._updateBrushPreview(center);
    }
  }

  // ── 鼠标事件分发 ──

  _onMouseDown(e) {
    if (this.options.drawMode === 'brush') {
      this._startBrush(e);
    } else if (this.options.drawMode === 'lasso') {
      this._startLasso(e);
    } else {
      this._startRect(e);
    }
  }

  _onMouseMove(e) {
    if (this.options.drawMode === 'brush') {
      if (this._isDrawing) {
        this._continueBrush(e);
      } else {
        this._updateBrushPreview(this.canvasManager.canvas.getPointer(e.e));
      }
      return;
    }

    if (!this._isDrawing) return;

    if (this.options.drawMode === 'lasso') {
      this._continueLasso(e);
    } else {
      this._updateRect(e);
    }
  }

  _onMouseOut() {
    if (!this._isDrawing && this.options.drawMode === 'brush') {
      this._cleanupBrush();
    }
  }

  _onMouseUp(e) {
    if (!this._isDrawing) return;

    if (this.options.drawMode === 'brush') {
      this._finishBrush(e);
    } else if (this.options.drawMode === 'lasso') {
      this._finishLasso(e);
    } else {
      this._finishRect(e);
    }
  }

  _getCursorForDrawMode() {
    return this.options.drawMode === 'brush' ? 'none' : 'crosshair';
  }

  // ═══════════════════════════════════════
  // 框选模式 (rect) — 拖拽矩形选区
  // ═══════════════════════════════════════

  _startRect(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    this._isDrawing = true;
    this._startPoint = pointer;

    this._selectionRect = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      fill: SELECTION_FILL,
      stroke: SELECTION_STROKE,
      strokeWidth: 1.5,
      strokeDashArray: [4, 3],
      selectable: false,
      evented: false,
    });
    this.canvasManager.canvas.add(this._selectionRect);
  }

  _updateRect(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    const left = Math.min(this._startPoint.x, pointer.x);
    const top = Math.min(this._startPoint.y, pointer.y);
    const width = Math.abs(pointer.x - this._startPoint.x);
    const height = Math.abs(pointer.y - this._startPoint.y);

    this._selectionRect.set({ left, top, width, height });
    this.canvasManager.canvas.renderAll();
  }

  _finishRect(e) {
    this._isDrawing = false;

    if (!this._selectionRect) return;

    const rect = this._selectionRect;
    const width = rect.width * rect.scaleX;
    const height = rect.height * rect.scaleY;

    const mosaicRect = {
      left: rect.left,
      top: rect.top,
      width: Math.round(width),
      height: Math.round(height),
    };

    // 先移除选区框，否则 getImageData 会把提示色读进去
    this._cleanupRect();

    if (mosaicRect.width < 5 || mosaicRect.height < 5) return;

    this.applyMosaic(mosaicRect);
  }

  _cleanupRect() {
    if (this._selectionRect) {
      this.canvasManager.canvas.remove(this._selectionRect);
      this._selectionRect = null;
    }
    this.canvasManager.canvas.renderAll();
  }

  // ═══════════════════════════════════════
  // 自由选区 (lasso) — 拖拽闭合非矩形选区
  // ═══════════════════════════════════════

  _startLasso(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    this._isDrawing = true;
    this._lassoPoints = [{ x: pointer.x, y: pointer.y }];

    this._lassoPreview = new fabric.Polygon(this._getLassoPreviewPoints(), {
      fill: SELECTION_FILL,
      stroke: SELECTION_STROKE,
      strokeWidth: 1.5,
      strokeDashArray: [4, 3],
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    this.canvasManager.canvas.add(this._lassoPreview);
    this.canvasManager.canvas.renderAll();
  }

  _continueLasso(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    if (this._appendLassoPoint(pointer)) {
      this._updateLassoPreview();
    }
  }

  _finishLasso(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    this._appendLassoPoint(pointer);
    this._isDrawing = false;

    const points = this._lassoPoints.slice();
    this._cleanupLasso();

    if (points.length < 3 || this._getPolygonArea(points) < 25) return;

    const bounds = this._getPointsBounds(points);
    if (!bounds) return;

    const rect = this._clipRectToEditableImage({
      left: Math.floor(bounds.left),
      top: Math.floor(bounds.top),
      width: Math.ceil(bounds.right - bounds.left),
      height: Math.ceil(bounds.bottom - bounds.top),
    });

    if (!rect || rect.width < 5 || rect.height < 5) return;

    this._saveStateWithCanvasClipPath();
    this._createDynamicMosaicOverlay({
      rect,
      maskType: 'lasso',
      lassoPoints: points.map(p => ({
        x: Math.round(p.x - rect.left),
        y: Math.round(p.y - rect.top),
      })),
    });
  }

  _appendLassoPoint(pointer) {
    const last = this._lassoPoints[this._lassoPoints.length - 1];
    if (!last) {
      this._lassoPoints.push({ x: pointer.x, y: pointer.y });
      return true;
    }

    const dx = pointer.x - last.x;
    const dy = pointer.y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) <= 2) return false;

    this._lassoPoints.push({ x: pointer.x, y: pointer.y });
    return true;
  }

  _getLassoPreviewPoints() {
    if (this._lassoPoints.length > 1) {
      return this._lassoPoints.map(p => ({ x: p.x, y: p.y }));
    }

    const p = this._lassoPoints[0] || { x: 0, y: 0 };
    return [{ x: p.x, y: p.y }, { x: p.x, y: p.y }];
  }

  _updateLassoPreview() {
    if (!this._lassoPreview) return;

    this._lassoPreview.set({ points: this._getLassoPreviewPoints() });
    if (typeof this._lassoPreview._setPositionDimensions === 'function') {
      this._lassoPreview._setPositionDimensions({});
    }
    this._lassoPreview.setCoords();
    this._lassoPreview.dirty = true;
    this._requestRender();
  }

  _cleanupLasso() {
    if (this._lassoPreview) {
      this.canvasManager.canvas.remove(this._lassoPreview);
      this._lassoPreview = null;
    }
    this._lassoPoints = [];
    this.canvasManager.canvas.renderAll();
  }

  _getPointsBounds(points) {
    return getPointsBounds(points);
  }

  _getPolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  // ═══════════════════════════════════════
  // 画笔模式 (brush) — 自由涂抹
  // ═══════════════════════════════════════

  _startBrush(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    this._isDrawing = true;
    this._brushPoints = [{ x: pointer.x, y: pointer.y }];

    this._saveStateWithCanvasClipPath();
    this._updateLiveBrushOverlay();
    this._updateBrushPreview(pointer);
  }

  _updateBrushPreview(pointer) {
    if (!pointer) return;

    const strokeWidth = 1;
    const r = Math.max(1, (this.options.brushSize - strokeWidth) / 2);

    if (!this._brushPreview) {
      this._brushPreview = new fabric.Circle({
        left: pointer.x - r,
        top: pointer.y - r,
        radius: r,
        fill: 'transparent',
        stroke: SELECTION_STROKE,
        strokeWidth,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      this.canvasManager.canvas.add(this._brushPreview);
    } else {
      this._brushPreview.set({
        left: pointer.x - r,
        top: pointer.y - r,
        radius: r,
        strokeWidth,
      });
    }

    this._brushPreview.setCoords();
    this._bringBrushPreviewToFront();
    this._requestRender();
  }

  _getBrushPreviewCenter() {
    if (!this._brushPreview) return null;

    const r = this._brushPreview.radius || 0;
    return {
      x: (this._brushPreview.left || 0) + r,
      y: (this._brushPreview.top || 0) + r,
    };
  }

  _bringBrushPreviewToFront() {
    if (!this._brushPreview) return;

    const canvas = this.canvasManager.canvas;
    if (typeof canvas?.bringToFront === 'function') {
      canvas.bringToFront(this._brushPreview);
    } else if (typeof this._brushPreview.bringToFront === 'function') {
      this._brushPreview.bringToFront();
    }
  }

  _continueBrush(e) {
    const pointer = this.canvasManager.canvas.getPointer(e.e);
    this._updateBrushPreview(pointer);

    // 采样优化：距离上个点超过一定距离才记录，避免点过密
    const last = this._brushPoints[this._brushPoints.length - 1];
    const dx = pointer.x - last.x;
    const dy = pointer.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 2) {
      this._brushPoints.push({ x: pointer.x, y: pointer.y });
      this._updateLiveBrushOverlay();
    }
  }

  _finishBrush(e) {
    this._isDrawing = false;
    this._updateBrushPreview(this.canvasManager.canvas.getPointer(e.e));
    this._updateLiveBrushOverlay();

    if (this._brushPoints.length === 0) return;
    this._brushPoints = [];

    if (!this._liveBrushOverlay) return;

    this._liveBrushOverlay = null;
  }

  _updateLiveBrushOverlay() {
    if (this._brushPoints.length === 0) return;

    const rect = this._getBrushStrokeRect(this._brushPoints);
    if (!rect || rect.width < 1 || rect.height < 1) {
      this._cleanupLiveBrushOverlay();
      return;
    }

    const brushPoints = this._brushPoints.map(p => ({
      x: Math.round(p.x - rect.left),
      y: Math.round(p.y - rect.top),
    }));

    if (!this._liveBrushOverlay) {
      this._liveBrushOverlay = this._createDynamicMosaicOverlay({
        rect,
        maskType: 'brush',
        brushPoints,
        brushSize: this.options.brushSize,
      });
      this._bringBrushPreviewToFront();
      this._requestRender();
      return;
    }

    this._liveBrushOverlay.set({
      left: rect.left,
      top: rect.top,
      scaleX: 1,
      scaleY: 1,
    });
    this._liveBrushOverlay._mosaicMode = this.options.mode;
    this._liveBrushOverlay._mosaicSize = this.options.mosaicSize;
    this._liveBrushOverlay._mosaicBlurRadius = this.options.blurRadius;
    this._liveBrushOverlay._mosaicWidth = Math.max(1, Math.round(rect.width));
    this._liveBrushOverlay._mosaicHeight = Math.max(1, Math.round(rect.height));
    this._liveBrushOverlay._mosaicMaskType = 'brush';
    this._liveBrushOverlay._mosaicBrushPoints = brushPoints;
    this._liveBrushOverlay._mosaicBrushSize = this.options.brushSize;
    this._liveBrushOverlay._mosaicMaskCanvas = null;
    this._liveBrushOverlay._layerKind = 'mosaic';
    this._liveBrushOverlay._layerPresetName = this._getCurrentLayerPresetName();
    this._liveBrushOverlay.setCoords();

    this._refreshDynamicMosaicOverlay(this._liveBrushOverlay, { render: false });
    this._bringBrushPreviewToFront();
    this._requestRender();
  }

  _getBrushStrokeRect(points) {
    const bounds = this._getPointsBounds(points);
    if (!bounds) return null;

    const padding = this.options.brushSize / 2;
    return this._clipRectToEditableImage({
      left: Math.round(bounds.left - padding),
      top: Math.round(bounds.top - padding),
      width: Math.round(bounds.right - bounds.left + padding * 2),
      height: Math.round(bounds.bottom - bounds.top + padding * 2),
    });
  }

  _cleanupLiveBrushOverlay() {
    if (this._liveBrushOverlay) {
      this.canvasManager.canvas.remove(this._liveBrushOverlay);
      this._liveBrushOverlay = null;
    }
  }

  _cleanupBrush() {
    if (this._brushPreview) {
      this.canvasManager.canvas.remove(this._brushPreview);
      this._brushPreview = null;
    }
    this.canvasManager.canvas.renderAll();
  }

  /**
   * 马赛克效果 — 对阵列像素进行块化处理
   * 只处理蒙版覆盖区域内的像素
   */
  _mosaicPixels(data, w, h, mask = null, mosaicSize = this.options.mosaicSize) {
    const defaultSize = this.options.mosaicSize || 12;
    const rawSizeX = typeof mosaicSize === 'object' ? mosaicSize?.width : mosaicSize;
    const rawSizeY = typeof mosaicSize === 'object' ? mosaicSize?.height : mosaicSize;
    const sizeX = Math.max(1, Math.round(Number(rawSizeX) || defaultSize));
    const sizeY = Math.max(1, Math.round(Number(rawSizeY) || defaultSize));

    for (let y = 0; y < h; y += sizeY) {
      for (let x = 0; x < w; x += sizeX) {
        // 检查该块是否有蒙版区域；矩形模式没有蒙版时整块处理。
        let hasMask = !mask;
        if (mask) {
          for (let dy = 0; dy < sizeY && y + dy < h && !hasMask; dy++) {
            for (let dx = 0; dx < sizeX && x + dx < w && !hasMask; dx++) {
              const mi = ((y + dy) * w + (x + dx)) * 4;
              if (mask[mi + 3] > 0) hasMask = true;
            }
          }
        }
        if (!hasMask) continue;

        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let dy = 0; dy < sizeY && y + dy < h; dy++) {
          for (let dx = 0; dx < sizeX && x + dx < w; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            a += data[idx + 3];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        a = Math.round(a / count);

        for (let dy = 0; dy < sizeY && y + dy < h; dy++) {
          for (let dx = 0; dx < sizeX && x + dx < w; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4;
            if (!mask || mask[idx + 3] > 0) {
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = a;
            }
          }
        }
      }
    }
  }

  /**
   * 模糊效果 — 使用 Canvas2D filter
   */
  _blurPixels(data, originalImgData, w, h, mask = null, blurRadius = this.options.blurRadius) {
    const radius = blurRadius || this.options.blurRadius || 8;

    // 源 canvas：放原始像素
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    srcCtx.putImageData(new ImageData(data, w, h), 0, 0);

    // 目标 canvas：避免自绘制预乘 alpha 色偏
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = w;
    dstCanvas.height = h;
    const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    dstCtx.filter = `blur(${radius}px)`;
    dstCtx.drawImage(srcCanvas, 0, 0);
    dstCtx.filter = 'none';

    const blurred = dstCtx.getImageData(0, 0, w, h);

    // 只拷贝蒙版区域的模糊像素；矩形模式没有蒙版时整块处理。
    for (let i = 0; i < data.length; i += 4) {
      if (!mask || mask[i + 3] > 0) {
        data[i] = blurred.data[i];
        data[i + 1] = blurred.data[i + 1];
        data[i + 2] = blurred.data[i + 2];
        data[i + 3] = blurred.data[i + 3];
      }
    }
  }

  // ═══════════════════════════════════════
  // 核心马赛克方法
  // ═══════════════════════════════════════

  /**
   * 对指定矩形区域应用马赛克/模糊（框选模式使用）
   */
  applyMosaic(rect) {
    rect = this._clipRectToEditableImage(rect);
    if (!rect || rect.width < 1 || rect.height < 1) return;

    this._saveStateWithCanvasClipPath();
    this._createDynamicMosaicOverlay({ rect, maskType: 'rect' });
  }

  _createDynamicMosaicOverlay({ rect, maskType, brushPoints = null, brushSize = null, lassoPoints = null }) {
    const canvas = this.canvasManager.canvas;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.max(1, Math.round(rect.width));
    tempCanvas.height = Math.max(1, Math.round(rect.height));

    const img = new fabric.Image(tempCanvas, {
      left: rect.left,
      top: rect.top,
      selectable: false,
      evented: false,
      id: 'mosaic_' + Date.now(),
      objectCaching: false,
    });

    img._mosaicDynamic = true;
    img._mosaicMode = this.options.mode;
    img._mosaicSize = this.options.mosaicSize;
    img._mosaicBlurRadius = this.options.blurRadius;
    img._mosaicWidth = tempCanvas.width;
    img._mosaicHeight = tempCanvas.height;
    img._mosaicMaskType = maskType;
    img._mosaicBrushPoints = brushPoints;
    img._mosaicBrushSize = brushSize;
    img._mosaicLassoPoints = lassoPoints;
    img._layerKind = 'mosaic';
    img._layerPresetName = this._getCurrentLayerPresetName();

    this._attachCurrentCropClipPath(img);
    this._refreshDynamicMosaicOverlay(img, { render: false });

    if (this._selectionRect) {
      canvas.remove(this._selectionRect);
      this._selectionRect = null;
    }

    canvas.add(img);
    canvas.renderAll();
    return img;
  }

  refreshDynamicMosaics(options = {}) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const objects = canvas.getObjects();
    let changed = false;

    this._refreshingDynamicMosaic = true;
    try {
      for (const obj of objects) {
        if (this._isDynamicMosaic(obj)) {
          changed = this._refreshDynamicMosaicOverlay(obj, { render: false }) || changed;
        }
      }
    } finally {
      this._refreshingDynamicMosaic = false;
    }

    if (changed && options.render !== false) {
      canvas.renderAll();
    }
  }

  _onObjectMoving(e) {
    if (this._refreshingDynamicMosaic) return;

    const targets = this._getDynamicMosaicTargets(e.target);
    if (targets.length === 0) return;

    // 使用 RAF 防抖，避免在拖动过程中频繁重算
    if (this._refreshDynamicRafId) {
      cancelAnimationFrame(this._refreshDynamicRafId);
    }

    this._refreshDynamicRafId = requestAnimationFrame(() => {
      this._refreshDynamicRafId = null;
      this._refreshingDynamicMosaic = true;
      try {
        targets.forEach(obj => this._refreshDynamicMosaicOverlay(obj, { render: false }));
        this._requestRender();
      } finally {
        this._refreshingDynamicMosaic = false;
      }
    });
  }

  _getDynamicMosaicTargets(target) {
    if (!target) return [];
    const canvas = this.canvasManager.canvas;
    if (!canvas) return [];

    let explicitTargets = [];
    if (this._isDynamicMosaic(target)) {
      explicitTargets = [target];
    }

    if (target.type === 'activeSelection' && typeof target.getObjects === 'function') {
      explicitTargets = target.getObjects().filter(obj => this._isDynamicMosaic(obj));
    }

    if (explicitTargets.length === 0) return [];

    const objects = canvas.getObjects();
    const firstIndex = explicitTargets.reduce((min, obj) => {
      const index = objects.indexOf(obj);
      return index >= 0 ? Math.min(min, index) : min;
    }, objects.length);

    return objects.filter((obj, index) => index >= firstIndex && this._isDynamicMosaic(obj));
  }

  _isDynamicMosaic(obj) {
    return !!obj && obj._mosaicDynamic === true;
  }

  _refreshDynamicMosaicOverlay(obj, options = {}) {
    if (!this._isDynamicMosaic(obj)) return false;

    const dimensions = this._getDynamicMosaicDimensions(obj);
    if (!dimensions) return false;

    const { width, height } = dimensions;
    const element = this._ensureDynamicMosaicElement(obj, width, height);
    const ctx = element.getContext('2d', { willReadFrequently: true });
    const imgData = this._captureDynamicMosaicSource(obj, width, height);
    const maskData = this._getDynamicMosaicMaskData(obj, width, height);

    if ((obj._mosaicMode || 'mosaic') === 'mosaic') {
      this._mosaicPixels(imgData.data, width, height, maskData, this._getLocalMosaicBlockSize(obj));
    } else {
      this._blurPixels(imgData.data, imgData, width, height, maskData, this._getLocalBlurRadius(obj));
    }

    if (maskData) {
      this._applyAlphaMask(imgData.data, maskData);
    }

    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(imgData, 0, 0);
    obj.dirty = true;

    if (options.render !== false) {
      this._requestRender();
    }

    return true;
  }

  _getDynamicMosaicDimensions(obj) {
    const width = Math.max(1, Math.round(obj._mosaicWidth || obj.width || 0));
    const height = Math.max(1, Math.round(obj._mosaicHeight || obj.height || 0));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height };
  }

  _ensureDynamicMosaicElement(obj, width, height) {
    let element = typeof obj.getElement === 'function' ? obj.getElement() : obj._element;
    const needsCanvas = !element || element.nodeName?.toLowerCase() !== 'canvas';
    const needsResize = !needsCanvas && (element.width !== width || element.height !== height);

    if (needsCanvas) {
      element = document.createElement('canvas');
      if (typeof obj.setElement === 'function') {
        obj.setElement(element);
      } else {
        obj._element = element;
        obj._originalElement = element;
      }
    }

    if (needsCanvas || needsResize) {
      element.width = width;
      element.height = height;
      obj.set({ width, height });
      obj._mosaicWidth = width;
      obj._mosaicHeight = height;
    }

    return element;
  }

  _captureDynamicMosaicSource(obj, width, height) {
    const sourceCanvas = this._renderObjectsBelow(obj);
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    const matrix = this._getDynamicMosaicSamplingMatrix(obj, width, height);
    const inverse = matrix ? this._invertTransform(matrix) : null;

    if (inverse) {
      sampleCtx.save();
      sampleCtx.setTransform(inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5]);
      sampleCtx.drawImage(sourceCanvas, 0, 0);
      sampleCtx.restore();
    } else {
      this._captureDynamicMosaicSourceFallback(sampleCtx, sourceCanvas, obj, width, height);
    }

    return sampleCtx.getImageData(0, 0, width, height);
  }

  _captureDynamicMosaicSourceFallback(sampleCtx, sourceCanvas, obj, width, height) {
    const left = Math.round(obj.left || 0);
    const top = Math.round(obj.top || 0);
    const sampleWidth = Math.max(1, Math.round(width * Math.abs(obj.scaleX || 1)));
    const sampleHeight = Math.max(1, Math.round(height * Math.abs(obj.scaleY || 1)));
    const sx = Math.max(0, left);
    const sy = Math.max(0, top);
    const ex = Math.min(sourceCanvas.width, left + sampleWidth);
    const ey = Math.min(sourceCanvas.height, top + sampleHeight);
    const sw = Math.max(0, ex - sx);
    const sh = Math.max(0, ey - sy);

    if (sw <= 0 || sh <= 0) return;

    sampleCtx.drawImage(
      sourceCanvas,
      sx,
      sy,
      sw,
      sh,
      (sx - left) * width / sampleWidth,
      (sy - top) * height / sampleHeight,
      sw * width / sampleWidth,
      sh * height / sampleHeight
    );
  }

  _getDynamicMosaicSamplingMatrix(obj, width, height) {
    const matrix = this._getObjectTransformMatrix(obj);
    if (!matrix) return null;

    return this._multiplyTransformMatrices(matrix, [1, 0, 0, 1, -width / 2, -height / 2]);
  }

  _getObjectTransformMatrix(obj) {
    if (typeof obj?.calcTransformMatrix === 'function') {
      const matrix = obj.calcTransformMatrix();
      if (this._isValidTransformMatrix(matrix)) return matrix;
    }

    return null;
  }

  _getLocalMosaicBlockSize(obj) {
    const baseSize = Math.max(1, Math.round(obj._mosaicSize || this.options.mosaicSize || 12));
    const scale = this._getDynamicMosaicTransformScale(obj);

    return {
      width: Math.max(1, Math.round(baseSize / scale.x)),
      height: Math.max(1, Math.round(baseSize / scale.y)),
    };
  }

  _getLocalBlurRadius(obj) {
    const radius = Math.max(1, Math.round(obj._mosaicBlurRadius || this.options.blurRadius || 8));
    const scale = this._getDynamicMosaicTransformScale(obj);
    const averageScale = Math.max(0.0001, Math.sqrt(scale.x * scale.y));
    return Math.max(1, radius / averageScale);
  }

  _getDynamicMosaicTransformScale(obj) {
    const matrix = this._getObjectTransformMatrix(obj);
    if (!matrix) {
      return {
        x: Math.max(0.0001, Math.abs(obj?.scaleX || 1)),
        y: Math.max(0.0001, Math.abs(obj?.scaleY || 1)),
      };
    }

    return {
      x: Math.max(0.0001, Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1])),
      y: Math.max(0.0001, Math.sqrt(matrix[2] * matrix[2] + matrix[3] * matrix[3])),
    };
  }

  _isValidTransformMatrix(matrix) {
    return Array.isArray(matrix)
      && matrix.length >= 6
      && matrix.slice(0, 6).every(value => Number.isFinite(value));
  }

  _multiplyTransformMatrices(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }

  _invertTransform(matrix) {
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;

    return [
      matrix[3] / determinant,
      -matrix[1] / determinant,
      -matrix[2] / determinant,
      matrix[0] / determinant,
      (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
      (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
    ];
  }

  _renderObjectsBelow(obj) {
    const canvas = this.canvasManager.canvas;
    const width = Math.max(1, Math.ceil(canvas.width || 1));
    const height = Math.max(1, Math.ceil(canvas.height || 1));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });

    this._renderSourceBackground(ctx, width, height);

    const objects = canvas.getObjects();
    const objectIndex = objects.indexOf(obj);
    const endIndex = objectIndex === -1 ? objects.length : objectIndex;

    for (let i = 0; i < endIndex; i++) {
      const candidate = objects[i];
      if (!candidate || candidate === obj || candidate.visible === false) continue;
      if (candidate === this._selectionRect || candidate === this._brushPreview || candidate === this._lassoPreview) continue;

      try {
        ctx.save();
        candidate.render(ctx);
        ctx.restore();
      } catch (err) {
        ctx.restore();
        console.warn('[MosaicModule] 渲染动态马赛克底层失败:', err);
      }
    }

    return sourceCanvas;
  }

  _renderSourceBackground(ctx, width, height) {
    const backgroundColor = this.canvasManager.canvas?.backgroundColor;
    if (!backgroundColor || backgroundColor === 'transparent') return;
    if (typeof backgroundColor !== 'string') return;

    ctx.save();
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  _getDynamicMosaicMaskData(obj, width, height) {
    if (obj._mosaicMaskType !== 'brush' && obj._mosaicMaskType !== 'lasso') return null;

    if (!obj._mosaicMaskCanvas
      || obj._mosaicMaskCanvas.width !== width
      || obj._mosaicMaskCanvas.height !== height) {
      obj._mosaicMaskCanvas = obj._mosaicMaskType === 'lasso'
        ? this._createLassoMaskCanvas(width, height, obj._mosaicLassoPoints || [])
        : this._createBrushMaskCanvas(
          width,
          height,
          obj._mosaicBrushPoints || [],
          obj._mosaicBrushSize || this.options.brushSize
        );
    }

    const maskCtx = obj._mosaicMaskCanvas.getContext('2d', { willReadFrequently: true });
    return maskCtx.getImageData(0, 0, width, height).data;
  }

  _createBrushMaskCanvas(width, height, points, brushSize) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const brushR = Math.max(1, (brushSize || this.options.brushSize) / 2);

    maskCtx.fillStyle = '#ffffff';
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      maskCtx.beginPath();
      maskCtx.arc(p.x, p.y, brushR, 0, Math.PI * 2);
      maskCtx.fill();
    }

    return maskCanvas;
  }

  _createLassoMaskCanvas(width, height, points) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const validPoints = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (validPoints.length < 3) return maskCanvas;

    maskCtx.fillStyle = '#ffffff';
    maskCtx.beginPath();
    maskCtx.moveTo(validPoints[0].x, validPoints[0].y);
    for (let i = 1; i < validPoints.length; i++) {
      maskCtx.lineTo(validPoints[i].x, validPoints[i].y);
    }
    maskCtx.closePath();
    maskCtx.fill();

    return maskCanvas;
  }

  _applyAlphaMask(data, maskData) {
    for (let i = 0; i < data.length; i += 4) {
      const alpha = maskData[i + 3];
      if (alpha <= 0) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else if (alpha < 255) {
        data[i + 3] = Math.round(data[i + 3] * alpha / 255);
      }
    }
  }

  _clipRectToEditableImage(rect) {
    const bounds = this._getEditableImageBounds();
    if (!bounds) return rect;

    const left = this._clamp(rect.left, bounds.left, bounds.right);
    const top = this._clamp(rect.top, bounds.top, bounds.bottom);
    const right = this._clamp(rect.left + rect.width, bounds.left, bounds.right);
    const bottom = this._clamp(rect.top + rect.height, bounds.top, bounds.bottom);

    if (right <= left || bottom <= top) return null;
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  _getEditableImageBounds() {
    const imageBounds = this._getImageBounds();
    if (!imageBounds) return null;

    const cropBounds = this._getCurrentCropBounds();
    return cropBounds ? this._intersectBounds(imageBounds, cropBounds) : imageBounds;
  }

  _getImageBounds() {
    const image = this.canvasManager.originalImage;
    if (!image) return null;

    return this._normalizeBounds(image.getBoundingRect(true, true));
  }

  _getCurrentCropBounds() {
    return this._getClipPathBounds(this._getActiveCropClipPath());
  }

  _getClipPathBounds(clipPath) {
    if (!clipPath) return null;

    const bounds = this._normalizeBounds(clipPath.getBoundingRect(true, true));
    const nested = this._getClipPathBounds(clipPath.clipPath);
    return nested ? this._intersectBounds(bounds, nested) : bounds;
  }

  _normalizeBounds(bounds) {
    return normalizeBounds(bounds);
  }

  _intersectBounds(a, b) {
    return intersectBounds(a, b);
  }

  _clamp(value, min, max) {
    return clamp(value, min, max);
  }

  _getActiveCropClipPath() {
    return this._detachedCanvasClipPath || this.canvasManager.canvas?.clipPath || null;
  }

  _detachCanvasClipPath() {
    const canvas = this.canvasManager.canvas;
    if (!canvas?.clipPath) return;

    this._detachedCanvasClipPath = canvas.clipPath;
    this._clipPathDetached = true;
    canvas.clipPath = null;
    this._applyTemporaryObjectClipPaths(this._detachedCanvasClipPath, false);
    this._requestRender();
  }

  _applyTemporaryObjectClipPaths(clipPath, render = true) {
    const canvas = this.canvasManager.canvas;
    if (!canvas || !clipPath) return;

    this._clearTemporaryObjectClipPaths(false);
    this._objectClipPathBackups = canvas.getObjects()
      .filter(obj => obj !== this._selectionRect && obj !== this._brushPreview && obj !== this._lassoPreview)
      .map(obj => ({ obj, clipPath: obj.clipPath || null }));

    this._objectClipPathBackups.forEach(({ obj }) => {
      obj.set('clipPath', this._createClipPathFromSource(clipPath));
      obj.dirty = true;
    });

    if (render) this._requestRender();
  }

  _clearTemporaryObjectClipPaths(render = true) {
    if (!this._objectClipPathBackups) return;

    this._objectClipPathBackups.forEach(({ obj, clipPath }) => {
      obj.set('clipPath', clipPath || null);
      obj.dirty = true;
    });
    this._objectClipPathBackups = null;

    if (render) this._requestRender();
  }

  _restoreDetachedCanvasClipPath(render = true) {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    this._clearTemporaryObjectClipPaths(false);
    if (this._clipPathDetached) {
      canvas.clipPath = this._detachedCanvasClipPath;
    }
    this._detachedCanvasClipPath = null;
    this._clipPathDetached = false;

    if (render) this._requestRender();
  }

  _saveStateWithCanvasClipPath() {
    const canvas = this.canvasManager.canvas;
    if (!canvas) {
      this.history.saveState();
      return;
    }

    const transientObjects = [this._selectionRect, this._brushPreview, this._lassoPreview]
      .filter(obj => obj && obj.canvas === canvas);
    transientObjects.forEach(obj => canvas.remove(obj));

    try {
      if (!this._clipPathDetached) {
        this.history.saveState();
        return;
      }

      const currentClipPath = canvas.clipPath;
      this._clearTemporaryObjectClipPaths(false);
      canvas.clipPath = this._detachedCanvasClipPath;
      try {
        this.history.saveState();
      } finally {
        canvas.clipPath = currentClipPath;
        this._applyTemporaryObjectClipPaths(this._detachedCanvasClipPath, false);
      }
    } finally {
      transientObjects.forEach(obj => canvas.add(obj));
      this._bringBrushPreviewToFront();
      if (transientObjects.length > 0) this._requestRender();
    }
  }

  _requestRender() {
    _requestRender(this.canvasManager.canvas);
  }

  _attachCurrentCropClipPath(obj) {
    const clipPath = this._getActiveCropClipPath();
    if (!obj || !clipPath) return;

    obj.set('clipPath', this._createClipPathFromSource(clipPath));
    obj.dirty = true;
  }

  _createClipPathFromSource(source) {
    return createClipPathFromSource(source);
  }

  /**
   * 清除所有马赛克覆盖层
   */
  clearAllMosaics() {
    const canvas = this.canvasManager.canvas;
    const overlays = canvas.getObjects().filter(
      o => o.id && o.id.startsWith('mosaic_')
    );
    if (overlays.length === 0) return;

    // 先保存当前状态（含马赛克覆盖层），以便用户撤销清除操作
    this._saveStateWithCanvasClipPath();
    overlays.forEach(o => canvas.remove(o));
    canvas.renderAll();
  }

  applyPreset(presetName) {
    const presets = {
      'mosaic-light': { mode: 'mosaic', mosaicSize: 6 },
      'mosaic-standard': { mode: 'mosaic', mosaicSize: 12 },
      'mosaic-heavy': { mode: 'mosaic', mosaicSize: 24 },
      'blur-light': { mode: 'blur', blurRadius: 6 },
      'blur-standard': { mode: 'blur', blurRadius: 12 },
      'blur-strong': { mode: 'blur', blurRadius: 18 },
      'mosaic-draw-rect': { drawMode: 'rect' },
      'mosaic-draw-lasso': { drawMode: 'lasso' },
      'mosaic-draw-brush': { drawMode: 'brush' },
    };

    const preset = presets[presetName];
    if (!preset) return;

    if (preset.mode) this.setMode(preset.mode);
    if (preset.mosaicSize) this.setMosaicSize(preset.mosaicSize);
    if (preset.blurRadius) this.setBlurRadius(preset.blurRadius);
    if (preset.drawMode) this.setDrawMode(preset.drawMode);
  }

  _getCurrentLayerPresetName() {
    if (this.options.mode === 'blur') {
      const blurMap = {
        6: '轻模糊',
        12: '中模糊',
        18: '强模糊',
      };
      return blurMap[Math.round(Number(this.options.blurRadius))] || '';
    }

    const mosaicMap = {
      6: '轻马赛克',
      12: '中马赛克',
      24: '重马赛克',
    };
    return mosaicMap[Math.round(Number(this.options.mosaicSize))] || '';
  }

  // ═══════════════════════════════════════
  // 预设栏 HTML
  // ═══════════════════════════════════════

  getOptionsBarHTML() {
    const isLight = this.options.mode === 'mosaic' && this.options.mosaicSize === 6;
    const isStandard = this.options.mode === 'mosaic' && this.options.mosaicSize === 12;
    const isHeavy = this.options.mode === 'mosaic' && this.options.mosaicSize === 24;
    const isLightBlur = this.options.mode === 'blur' && this.options.blurRadius === 6;
    const isStandardBlur = this.options.mode === 'blur' && this.options.blurRadius === 12;
    const isStrongBlur = this.options.mode === 'blur' && this.options.blurRadius === 18;
    const drawMode = this.options.drawMode || 'rect';
    return `
      <div class="options-group">
        <span class="options-label">选区</span>
        <button class="options-btn options-btn-sm ${drawMode === 'rect' ? 'active' : ''}" data-preset="mosaic-draw-rect">矩形</button>
        <button class="options-btn options-btn-sm ${drawMode === 'lasso' ? 'active' : ''}" data-preset="mosaic-draw-lasso">自由选区</button>
        <button class="options-btn options-btn-sm ${drawMode === 'brush' ? 'active' : ''}" data-preset="mosaic-draw-brush">画笔</button>
      </div>
      <div class="options-group">
        <button class="options-btn options-btn-sm ${isLight ? 'active' : ''}" data-preset="mosaic-light">轻马赛克</button>
        <button class="options-btn options-btn-sm ${isStandard ? 'active' : ''}" data-preset="mosaic-standard">中马赛克</button>
        <button class="options-btn options-btn-sm ${isHeavy ? 'active' : ''}" data-preset="mosaic-heavy">重马赛克</button>
        <button class="options-btn options-btn-sm ${isLightBlur ? 'active' : ''}" data-preset="blur-light">轻模糊</button>
        <button class="options-btn options-btn-sm ${isStandardBlur ? 'active' : ''}" data-preset="blur-standard">中模糊</button>
        <button class="options-btn options-btn-sm ${isStrongBlur ? 'active' : ''}" data-preset="blur-strong">强模糊</button>
      </div>
    `;
  }

  getPropertyPanelHTML() {
    const effectMode = this.options.mode;
    const drawMode = this.options.drawMode || 'rect';
    let html = `
      <div class="property-section-title">马赛克工具</div>
      <div class="property-item property-item--wide">
        <label>选区</label>
        <select class="property-select" data-module-prop="drawMode" data-refresh-property="true">
          <option value="rect" ${drawMode === 'rect' ? 'selected' : ''}>矩形</option>
          <option value="lasso" ${drawMode === 'lasso' ? 'selected' : ''}>自由选区</option>
          <option value="brush" ${drawMode === 'brush' ? 'selected' : ''}>画笔</option>
        </select>
      </div>
      <div class="property-item property-item--wide">
        <label>效果</label>
        <select class="property-select" data-module-prop="mode" data-refresh-property="true">
          <option value="mosaic" ${effectMode === 'mosaic' ? 'selected' : ''}>马赛克</option>
          <option value="blur" ${effectMode === 'blur' ? 'selected' : ''}>模糊</option>
        </select>
      </div>
    `;

    if (effectMode === 'mosaic') {
      html += `
        <div class="property-item property-item--wide">
          <label>块大小</label>
          <input type="range" class="property-range" data-module-prop="mosaicSize" min="2" max="40" value="${this.options.mosaicSize}" />
          <span class="property-value">${this.options.mosaicSize}px</span>
        </div>
      `;
    } else {
      html += `
        <div class="property-item property-item--wide">
          <label>模糊强度</label>
          <input type="range" class="property-range" data-module-prop="blurRadius" min="1" max="30" value="${this.options.blurRadius}" />
          <span class="property-value">${this.options.blurRadius}px</span>
        </div>
      `;
    }

    if (drawMode === 'brush') {
      html += `
        <div class="property-item property-item--wide">
          <label>画笔大小</label>
          <input type="range" class="property-range" data-module-prop="brushSize" min="4" max="100" value="${this.options.brushSize}" />
          <span class="property-value">${this.options.brushSize}px</span>
        </div>
      `;
    }

    return html;
  }

  onToolPropertyChange(key, value) {
    switch (key) {
      case 'mode':
        this.setMode(value);
        return true;
      case 'drawMode':
        this.setDrawMode(value);
        return true;
      case 'mosaicSize':
        this.setMosaicSize(value);
        return true;
      case 'blurRadius':
        this.setBlurRadius(value);
        return true;
      case 'brushSize':
        this.setBrushSize(value);
        return true;
      default:
        return false;
    }
  }
}

export default MosaicModule;
