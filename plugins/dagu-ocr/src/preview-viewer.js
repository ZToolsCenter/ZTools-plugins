// 主窗口图片预览的缩放与拖动：纯函数负责变换计算，DOM 绑定只负责应用结果。

export const PREVIEW_MIN_SCALE = 1;
export const PREVIEW_MAX_SCALE = 8;

const WHEEL_SENSITIVITY = 0.0015;

export function clampPreviewScale(scale) {
  if (!Number.isFinite(scale)) return PREVIEW_MIN_SCALE;
  return Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, scale));
}

// 图片按 object-fit: contain 适配到预览框后的显示尺寸。
export function fittedPreviewSize(viewport, naturalSize) {
  const naturalWidth = Number(naturalSize?.width) || 0;
  const naturalHeight = Number(naturalSize?.height) || 0;
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  if (!naturalWidth || !naturalHeight || !width || !height) return { width: 0, height: 0 };
  const ratio = Math.min(width / naturalWidth, height / naturalHeight);
  return { width: naturalWidth * ratio, height: naturalHeight * ratio };
}

// 内容小于预览框时保持居中，大于预览框时不允许拖出空白。
export function clampPreviewOffset(offset, { content, viewport } = {}) {
  const limitX = Math.max(0, ((content?.width || 0) - (viewport?.width || 0)) / 2);
  const limitY = Math.max(0, ((content?.height || 0) - (viewport?.height || 0)) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, Number(offset?.x) || 0)),
    y: Math.min(limitY, Math.max(-limitY, Number(offset?.y) || 0))
  };
}

export function scaleFromWheelDelta(deltaY) {
  return Math.exp(-(Number(deltaY) || 0) * WHEEL_SENSITIVITY);
}

// view: { scale, x, y }，x/y 为以预览框中心为原点的平移量。
export function scaledContentView(view, { viewport, naturalSize }) {
  const fitted = fittedPreviewSize(viewport, naturalSize);
  const scale = clampPreviewScale(view?.scale);
  return { width: fitted.width * scale, height: fitted.height * scale };
}

export function zoomedPreviewView(view, { anchor, viewport, naturalSize, factor }) {
  const scale = clampPreviewScale(view?.scale);
  const nextScale = clampPreviewScale(scale * factor);
  if (nextScale === scale) return { scale, x: Number(view?.x) || 0, y: Number(view?.y) || 0 };
  const ratio = nextScale / scale;
  const x = Number(anchor?.x) || 0;
  const y = Number(anchor?.y) || 0;
  const offset = clampPreviewOffset({
    x: x - (x - (Number(view?.x) || 0)) * ratio,
    y: y - (y - (Number(view?.y) || 0)) * ratio
  }, { content: scaledContentView({ scale: nextScale }, { viewport, naturalSize }), viewport });
  return { scale: nextScale, ...offset };
}

export function pannedPreviewView(view, delta, { viewport, naturalSize }) {
  return {
    scale: clampPreviewScale(view?.scale),
    ...clampPreviewOffset({
      x: (Number(view?.x) || 0) + (Number(delta?.x) || 0),
      y: (Number(view?.y) || 0) + (Number(delta?.y) || 0)
    }, { content: scaledContentView(view, { viewport, naturalSize }), viewport })
  };
}

export function previewTransform(view) {
  const scale = clampPreviewScale(view?.scale);
  const x = Number(view?.x) || 0;
  const y = Number(view?.y) || 0;
  if (scale === PREVIEW_MIN_SCALE && !x && !y) return '';
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
}

// 绑定预览框：滚轮以光标为锚点缩放，按住拖动平移；折叠/展开重建图片元素时重新绑定。
export function createPreviewViewer({ frame, win = globalThis.window } = {}) {
  if (!frame) return { setImage() {}, reset() {}, get view() { return { scale: 1, x: 0, y: 0 }; }, dispose() {} };

  let image = null;
  let view = { scale: PREVIEW_MIN_SCALE, x: 0, y: 0 };
  let drag = null;

  const viewport = () => ({ width: frame.clientWidth, height: frame.clientHeight });
  const naturalSize = () => ({
    width: image?.naturalWidth || 0,
    height: image?.naturalHeight || 0
  });

  const apply = () => {
    if (!image) return;
    image.style.transform = previewTransform(view);
    image.style.transformOrigin = 'center center';
    frame.classList.toggle('is-zoomed', view.scale > PREVIEW_MIN_SCALE);
  };

  const setView = (next) => {
    view = next;
    apply();
  };

  const reset = () => setView({ scale: PREVIEW_MIN_SCALE, x: 0, y: 0 });

  const anchorOf = (event) => {
    const rect = frame.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2
    };
  };

  const onWheel = (event) => {
    if (!image) return;
    event.preventDefault();
    setView(zoomedPreviewView(view, {
      anchor: anchorOf(event),
      viewport: viewport(),
      naturalSize: naturalSize(),
      factor: scaleFromWheelDelta(event.deltaY)
    }));
  };

  const onPointerDown = (event) => {
    if (!image || view.scale <= PREVIEW_MIN_SCALE || event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, offset: { x: view.x, y: view.y } };
    frame.classList.add('is-dragging');
    frame.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!drag) return;
    setView(pannedPreviewView({ ...view, ...drag.offset }, {
      x: event.clientX - drag.x,
      y: event.clientY - drag.y
    }, { viewport: viewport(), naturalSize: naturalSize() }));
  };

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    frame.classList.remove('is-dragging');
    frame.releasePointerCapture?.(event.pointerId);
  };

  frame.addEventListener('wheel', onWheel, { passive: false });
  frame.addEventListener('pointerdown', onPointerDown);
  frame.addEventListener('pointermove', onPointerMove);
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  frame.addEventListener('pointerleave', endDrag);

  return {
    setImage(nextImage) {
      const next = nextImage || null;
      if (image === next) return;
      image = next;
      reset();
    },
    reset,
    get view() {
      return { ...view };
    },
    dispose() {
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('pointerdown', onPointerDown);
      frame.removeEventListener('pointermove', onPointerMove);
      frame.removeEventListener('pointerup', endDrag);
      frame.removeEventListener('pointercancel', endDrag);
      frame.removeEventListener('pointerleave', endDrag);
      image = null;
      drag = null;
    }
  };
}
