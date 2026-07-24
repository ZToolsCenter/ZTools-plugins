/**
 * 公共工具函数 — 消除各模块间的重复实现
 */

export function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function escapeAttr(value) {
  return escapeHTML(value);
}

export function normalizeColor(color, fallback = '#000000', allowTransparent = false) {
  if (allowTransparent && color === 'transparent') return 'transparent';

  if (typeof color !== 'string') return fallback;

  const value = color.trim().toLowerCase();
  if (value.startsWith('rgba')) return value;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return '#' + value.slice(1).split('').map(ch => ch + ch).join('');
  }

  return fallback;
}

export function requestRender(canvas) {
  if (!canvas) return;
  if (typeof canvas.requestRenderAll === 'function') {
    canvas.requestRenderAll();
  } else {
    canvas.renderAll();
  }
}

export function createClipPathFromSource(source) {
  const width = Math.max(1, source.width || (source.rx || 0) * 2 || 0);
  const height = Math.max(1, source.height || (source.ry || 0) * 2 || 0);
  const isEllipse = source.type === 'ellipse';
  const commonOptions = {
    left: source.left || 0,
    top: source.top || 0,
    scaleX: source.scaleX == null ? 1 : source.scaleX,
    scaleY: source.scaleY == null ? 1 : source.scaleY,
    angle: source.angle || 0,
    skewX: source.skewX || 0,
    skewY: source.skewY || 0,
    flipX: !!source.flipX,
    flipY: !!source.flipY,
    originX: source.originX || 'left',
    originY: source.originY || 'top',
    fill: '#000',
    stroke: null,
    strokeWidth: 0,
    absolutePositioned: true,
    objectCaching: false,
  };

  const clipPath = isEllipse
    ? new fabric.Ellipse({
      ...commonOptions,
      width,
      height,
      rx: width / 2,
      ry: height / 2,
    })
    : new fabric.Rect({
      ...commonOptions,
      width,
      height,
      rx: source.rx || 0,
      ry: source.ry || 0,
    });

  if (source.clipPath) {
    clipPath.clipPath = createClipPathFromSource(source.clipPath);
  }
  clipPath.setCoords();
  return clipPath;
}

export function normalizeBounds(bounds) {
  const left = bounds.left;
  const top = bounds.top;
  const width = Math.max(0, bounds.width || 0);
  const height = Math.max(0, bounds.height || 0);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function intersectBounds(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function getPointsBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { left: minX, top: minY, right: maxX, bottom: maxY };
}
