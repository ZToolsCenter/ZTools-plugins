// 选区与视口的纯几何计算：坐标换算、手柄命中、拖拽调整、缩放锚点。

export const HANDLE_DIRECTIONS = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
export const MIN_SELECTION_SIZE = 4;
export const DEFAULT_ZOOM_LIMITS = Object.freeze({ min: 0.2, max: 8 });

export function createTransform(scale = 1, offsetX = 0, offsetY = 0) {
  return { scale, offsetX, offsetY };
}

export function imageToViewport(point, transform) {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY
  };
}

export function viewportToImage(point, transform) {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale
  };
}

export function clampZoom(scale, limits = DEFAULT_ZOOM_LIMITS) {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

// 以 focus（视口坐标）为锚点缩放，保证锚点下的图像内容不动。
export function zoomAt(transform, factor, focus, limits = DEFAULT_ZOOM_LIMITS) {
  const scale = clampZoom(transform.scale * factor, limits);
  const imagePoint = viewportToImage(focus, transform);
  return {
    scale,
    offsetX: focus.x - imagePoint.x * scale,
    offsetY: focus.y - imagePoint.y * scale
  };
}

export function normalizeRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

export function roundRect(rect) {
  const left = Math.round(rect.left);
  const top = Math.round(rect.top);
  return {
    left,
    top,
    width: Math.max(1, Math.round(rect.left + rect.width) - left),
    height: Math.max(1, Math.round(rect.top + rect.height) - top)
  };
}

export function clampRectToBounds(rect, bounds) {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    left: Math.min(Math.max(0, rect.left), Math.max(0, bounds.width - width)),
    top: Math.min(Math.max(0, rect.top), Math.max(0, bounds.height - height)),
    width,
    height
  };
}

export function rectContains(rect, point, padding = 0) {
  return point.x >= rect.left - padding
    && point.x <= rect.left + rect.width + padding
    && point.y >= rect.top - padding
    && point.y <= rect.top + rect.height + padding;
}

export function rectCenter(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function handleAnchors(rect) {
  const left = rect.left;
  const right = rect.left + rect.width;
  const top = rect.top;
  const bottom = rect.top + rect.height;
  const cx = left + rect.width / 2;
  const cy = top + rect.height / 2;
  return {
    nw: { x: left, y: top },
    n: { x: cx, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: cy },
    se: { x: right, y: bottom },
    s: { x: cx, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: cy }
  };
}

export function hitTestHandle(rect, point, radius) {
  const anchors = handleAnchors(rect);
  for (const direction of HANDLE_DIRECTIONS) {
    const anchor = anchors[direction];
    if (Math.abs(point.x - anchor.x) <= radius && Math.abs(point.y - anchor.y) <= radius) {
      return direction;
    }
  }
  return '';
}

// 拖动某个手柄调整选区：对边保持不动，最小尺寸受 minSize 约束。
export function resizeSelection(rect, direction, point, { minSize = MIN_SELECTION_SIZE } = {}) {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  if (direction.includes('w')) left = Math.min(point.x, right - minSize);
  if (direction.includes('e')) right = Math.max(point.x, left + minSize);
  if (direction.includes('n')) top = Math.min(point.y, bottom - minSize);
  if (direction.includes('s')) bottom = Math.max(point.y, top + minSize);
  return roundRect({ left, top, width: right - left, height: bottom - top });
}

export function moveSelection(rect, delta, bounds) {
  return clampRectToBounds({ ...rect, left: rect.left + delta.x, top: rect.top + delta.y }, bounds);
}

export function selectionSizeLabel(rect) {
  return `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
}

// 工具栏优先贴在选区下方，放不下时改到上方，并始终限制在视口内。
export function nextToolbarPlacement({ selection, toolbar, viewport, gap = 10, margin = 8 }) {
  const below = selection.top + selection.height + gap;
  const fitsBelow = below + toolbar.height <= viewport.height - margin;
  const top = fitsBelow
    ? below
    : Math.max(margin, selection.top - toolbar.height - gap);
  const maxLeft = Math.max(margin, viewport.width - toolbar.width - margin);
  const left = Math.min(Math.max(margin, selection.left), maxLeft);
  return { left, top, placement: fitsBelow ? 'below' : 'above' };
}
