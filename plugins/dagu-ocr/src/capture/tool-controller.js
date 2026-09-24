// 交互引擎：选区拖拽、缩放平移、各标注工具的绘制与对象操作。

import {
  MIN_SELECTION_SIZE,
  moveSelection,
  normalizeRect,
  resizeSelection,
  roundRect
} from './geometry.js';
import {
  createEllipseAnnotation,
  createFreehandAnnotation,
  createLineAnnotation,
  createMosaicAnnotation,
  createRectAnnotation
} from './annotations.js';

const CLICK_TOLERANCE = 3;
const HANDLE_RADIUS = 10;

export function createToolController({
  fabric,
  canvas,
  stage,
  store,
  selection,
  getSettings,
  getTool,
  textEditor,
  onStatus = () => {},
  onSelectionChange = () => {},
  onViewAdjusted = () => {},
  onRequestCopy = () => {}
}) {
  const container = canvas.wrapperEl?.parentElement;
  let mode = 'idle';
  let startImage = null;
  let startViewport = null;
  let draft = null;
  let strokePoints = [];
  let spacePressed = false;
  let resizeDirection = '';
  let selectedObject = null;
  let dragTarget = null;
  let dragOrigin = null;

  canvas.skipTargetFind = true;

  const outline = new fabric.Rect({
    fill: 'transparent',
    stroke: '#1e90ff',
    strokeWidth: 1,
    strokeDashArray: [5, 3],
    selectable: false,
    evented: false,
    excludeFromExport: true,
    visible: false,
    objectCaching: false
  });
  canvas.add(outline);

  const settings = () => getSettings();
  const tool = () => getTool();

  const showOutline = (object) => {
    if (!object) {
      outline.visible = false;
      canvas.requestRenderAll();
      return;
    }
    const bounds = object.getBoundingRect?.(true);
    if (!bounds) {
      outline.visible = false;
      canvas.requestRenderAll();
      return;
    }
    const scale = stage.zoomScale() || 1;
    outline.set({
      left: bounds.left - 3 / scale,
      top: bounds.top - 3 / scale,
      width: bounds.width + 6 / scale,
      height: bounds.height + 6 / scale,
      strokeWidth: 1 / scale,
      strokeDashArray: [5 / scale, 3 / scale],
      visible: true
    });
    canvas.bringToFront(outline);
    canvas.requestRenderAll();
  };

  const setSelected = (object) => {
    selectedObject = object || null;
    showOutline(selectedObject);
  };

  const commit = (object) => {
    if (!object) return;
    store.add(object);
    selection.raise();
    canvas.bringToFront(outline);
  };

  // fabric.Polyline 不支持在原对象上扩展点集，草稿用重建保证包围盒与偏移一致。
  const createStrokeDraft = (current, points) => {
    const style = settings();
    return new fabric.Polyline(points, {
      fill: '',
      stroke: style.color,
      strokeWidth: current === 'marker' ? style.lineWidth * 4 : style.lineWidth,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      opacity: current === 'marker' ? style.markerOpacity : 1,
      selectable: false,
      evented: false
    });
  };

  const beginDraw = (imagePoint) => {
    const style = settings();
    const current = tool();
    if (current === 'shape') {
      draft = style.shapeKind === 'ellipse'
        ? createEllipseAnnotation({ fabric, rect: { left: imagePoint.x, top: imagePoint.y, width: 1, height: 1 }, settings: style })
        : createRectAnnotation({ fabric, rect: { left: imagePoint.x, top: imagePoint.y, width: 1, height: 1 }, settings: style });
      draft.set({ selectable: false, evented: false });
      canvas.add(draft);
    } else if (current === 'line') {
      draft = new fabric.Line([imagePoint.x, imagePoint.y, imagePoint.x, imagePoint.y], {
        stroke: style.color,
        strokeWidth: style.lineWidth,
        strokeLineCap: 'round',
        selectable: false,
        evented: false
      });
      canvas.add(draft);
    } else if (current === 'pen' || current === 'marker') {
      strokePoints = [{ x: imagePoint.x, y: imagePoint.y }];
      draft = createStrokeDraft(current, strokePoints);
      canvas.add(draft);
    } else if (current === 'mosaic') {
      draft = new fabric.Rect({
        left: imagePoint.x,
        top: imagePoint.y,
        width: 1,
        height: 1,
        fill: 'rgba(255,255,255,.12)',
        stroke: '#ffffff',
        strokeWidth: 1 / (stage.zoomScale() || 1),
        strokeDashArray: [6, 4],
        selectable: false,
        evented: false
      });
      canvas.add(draft);
    }
    showOutline(null);
    canvas.requestRenderAll();
  };

  const updateDraw = (imagePoint) => {
    if (!draft || !startImage) return;
    const current = tool();
    if (current === 'shape') {
      const rect = normalizeRect(startImage, imagePoint);
      if (settings().shapeKind === 'ellipse') {
        draft.set({ left: rect.left, top: rect.top, rx: Math.max(0.5, rect.width / 2), ry: Math.max(0.5, rect.height / 2) });
      } else {
        draft.set({ left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
      }
    } else if (current === 'line') {
      draft.set({ x2: imagePoint.x, y2: imagePoint.y });
      draft.setCoords();
    } else if (current === 'pen' || current === 'marker') {
      const last = strokePoints[strokePoints.length - 1];
      if (Math.abs(last.x - imagePoint.x) < 1.5 && Math.abs(last.y - imagePoint.y) < 1.5) return;
      strokePoints.push({ x: imagePoint.x, y: imagePoint.y });
      const previous = draft;
      draft = createStrokeDraft(current, strokePoints.map((point) => ({ ...point })));
      if (previous) canvas.remove(previous);
      canvas.add(draft);
    } else if (current === 'mosaic') {
      const rect = normalizeRect(startImage, imagePoint);
      draft.set({ left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
      draft.setCoords();
    }
    canvas.requestRenderAll();
  };

  const endDraw = (imagePoint) => {
    const style = settings();
    const current = tool();
    const start = startImage;
    const draftObject = draft;
    const points = strokePoints;
    draft = null;
    strokePoints = [];
    if (!start || !draftObject) return;
    const rect = normalizeRect(start, imagePoint);
    // 阈值按屏幕像素判断，小图上放大编辑时也能正常落笔。
    const zoom = stage.zoomScale() || 1;
    const tooSmall = rect.width * zoom < CLICK_TOLERANCE && rect.height * zoom < CLICK_TOLERANCE;
    canvas.remove(draftObject);
    if (current === 'shape' && !tooSmall) {
      commit(style.shapeKind === 'ellipse'
        ? createEllipseAnnotation({ fabric, rect, settings: style })
        : createRectAnnotation({ fabric, rect, settings: style }));
    } else if (current === 'line' && !tooSmall) {
      commit(createLineAnnotation({ fabric, start, end: imagePoint, settings: style }));
    } else if ((current === 'pen' || current === 'marker') && points.length > 1) {
      commit(createFreehandAnnotation({
        fabric,
        points,
        settings: style,
        options: current === 'marker'
          ? { color: style.color, lineWidth: style.lineWidth * 4, opacity: style.markerOpacity }
          : {}
      }));
    } else if (current === 'mosaic' && !tooSmall) {
      commit(createMosaicAnnotation({ fabric, source: stage.imageElement, rect, settings: style }));
    }
    canvas.requestRenderAll();
  };

  const startText = (imagePoint, existing = null) => {
    if (!textEditor) return;
    if (existing) setSelected(existing);
    textEditor.open(imagePoint, existing);
  };

  const eraseAt = (imagePoint) => {
    const target = store.findAt(imagePoint, 6 / (stage.zoomScale() || 1));
    if (!target) {
      onStatus('未命中标注对象');
      return;
    }
    setSelected(null);
    store.remove(target);
    onStatus('已擦除标注');
  };

  const handlePointerDown = (event) => {
    if (event.button === 2) return;
    const imagePoint = stage.clientToImage(event.clientX, event.clientY);
    const current = tool();
    if (textEditor?.isOpen()) return;

    if (event.button === 1 || spacePressed) {
      mode = 'panning';
      startViewport = { x: event.clientX, y: event.clientY };
      canvas.defaultCursor = 'grabbing';
      return;
    }

    if (current === 'select') {
      const direction = selection.hitHandle(imagePoint, HANDLE_RADIUS / (stage.zoomScale() || 1));
      if (direction) {
        mode = 'resizing';
        resizeDirection = direction;
        return;
      }
      const target = store.findAt(imagePoint, 6 / (stage.zoomScale() || 1));
      if (target) {
        mode = 'dragging-object';
        dragTarget = target;
        dragOrigin = { left: target.left, top: target.top, point: imagePoint };
        store.beginChange();
        setSelected(target);
        canvas.defaultCursor = 'move';
        return;
      }
      if (selection.contains(imagePoint)) {
        mode = 'moving';
        startImage = imagePoint;
        setSelected(null);
        return;
      }
      setSelected(null);
      mode = 'selecting';
      startImage = imagePoint;
      selection.set({ left: imagePoint.x, top: imagePoint.y, width: 1, height: 1 });
      onSelectionChange(selection.rect);
      return;
    }

    if (current === 'text') {
      // 阻止默认的焦点转移，避免这一下点击立刻把输入框 blur 掉。
      event.preventDefault();
      startText(imagePoint);
      return;
    }

    if (current === 'eraser') {
      eraseAt(imagePoint);
      return;
    }

    mode = 'drawing';
    startImage = imagePoint;
    beginDraw(imagePoint);
  };

  const handlePointerMove = (event) => {
    const imagePoint = stage.clientToImage(event.clientX, event.clientY);
    if (mode === 'panning') {
      stage.panBy({ x: event.clientX - startViewport.x, y: event.clientY - startViewport.y });
      onViewAdjusted();
      return;
    }
    if (mode === 'selecting') {
      selection.set(normalizeRect(startImage, imagePoint));
      onSelectionChange(selection.rect);
      return;
    }
    if (mode === 'moving') {
      const delta = { x: imagePoint.x - startImage.x, y: imagePoint.y - startImage.y };
      startImage = imagePoint;
      selection.set(moveSelection(selection.rect, delta, stage.imageSize()));
      onSelectionChange(selection.rect);
      return;
    }
    if (mode === 'resizing') {
      selection.set(resizeSelection(selection.rect, resizeDirection, imagePoint, { minSize: MIN_SELECTION_SIZE }));
      onSelectionChange(selection.rect);
      return;
    }
    if (mode === 'dragging-object' && dragTarget && dragOrigin) {
      dragTarget.set({
        left: dragOrigin.left + (imagePoint.x - dragOrigin.point.x),
        top: dragOrigin.top + (imagePoint.y - dragOrigin.point.y)
      });
      dragTarget.setCoords();
      showOutline(dragTarget);
      canvas.requestRenderAll();
      return;
    }
    if (mode === 'drawing') {
      updateDraw(imagePoint);
    }
  };

  const handlePointerUp = (event) => {
    const imagePoint = stage.clientToImage(event.clientX, event.clientY);
    if (mode === 'selecting') {
      const rect = selection.rect;
      const zoom = stage.zoomScale() || 1;
      if (rect && rect.width * zoom < CLICK_TOLERANCE && rect.height * zoom < CLICK_TOLERANCE) {
        selection.clear();
      }
      onSelectionChange(selection.rect);
    } else if (mode === 'drawing') {
      endDraw(imagePoint);
    } else if (mode === 'dragging-object') {
      store.commitChange();
      showOutline(dragTarget);
    } else if (mode === 'resizing' || mode === 'moving') {
      onSelectionChange(selection.rect);
    }
    if (mode === 'panning') canvas.defaultCursor = 'crosshair';
    mode = 'idle';
    resizeDirection = '';
    startImage = null;
    dragTarget = null;
    dragOrigin = null;
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const focus = stage.clientToViewport(event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const scale = stage.zoom(factor, focus);
    selection.setScale(scale);
    showOutline(selectedObject);
    onViewAdjusted();
    onStatus(`缩放 ${Math.round(scale * 100)}%`);
  };

  const handleDoubleClick = (event) => {
    const imagePoint = stage.clientToImage(event.clientX, event.clientY);
    if (tool() === 'select' && selection.contains(imagePoint) && !store.findAt(imagePoint)) {
      onRequestCopy();
      return;
    }
    const target = store.findAt(imagePoint, 6 / (stage.zoomScale() || 1));
    if (target && target.type === 'i-text') {
      startText(imagePoint, target);
    }
  };

  const handleKey = (event, isDown) => {
    if (event.code !== 'Space') return;
    spacePressed = isDown;
    canvas.defaultCursor = isDown ? 'grab' : 'crosshair';
  };

  const deleteSelected = () => {
    if (!selectedObject) return false;
    if (store.remove(selectedObject)) {
      setSelected(null);
      onStatus('已删除标注');
      return true;
    }
    return false;
  };

  const listeners = [];
  if (container) {
    const onDown = (event) => handlePointerDown(event);
    const onMove = (event) => handlePointerMove(event);
    const onUp = (event) => handlePointerUp(event);
    const onWheel = (event) => handleWheel(event);
    const onDouble = (event) => handleDoubleClick(event);
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('dblclick', onDouble);
    listeners.push(
      () => container.removeEventListener('pointerdown', onDown),
      () => container.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => container.removeEventListener('wheel', onWheel),
      () => container.removeEventListener('dblclick', onDouble)
    );
  }

  return {
    deleteSelected,
    handleKey,
    get mode() {
      return mode;
    },
    get selected() {
      return selectedObject;
    },
    refreshOverlay() {
      selection.raise();
      showOutline(selectedObject);
    },
    destroy() {
      listeners.forEach((remove) => remove());
      if (draft && draft.canvas) canvas.remove(draft);
      draft = null;
      strokePoints = [];
    }
  };
}
