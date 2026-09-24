// 标注对象模型：样式设置、对象工厂、马赛克生成与撤销/重做栈。

import { findAnnotationAt } from './hit-test.js';

export const DEFAULT_TOOL_SETTINGS = Object.freeze({
  color: '#ff4d4f',
  lineWidth: 3,
  fontSize: 28,
  fontBold: true,
  fontItalic: false,
  shapeKind: 'rect',
  shapeFill: false,
  arrowKind: 'end',
  markerOpacity: 0.4,
  mosaicSize: 12
});

const SETTINGS_KEY = 'dagu-capture-tool-settings';
const LEGACY_KEYS = {
  color: 'annotate_color',
  lineWidth: 'annotate_line_width',
  fontSize: 'annotate_font_size'
};

function readStorage(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

export function loadToolSettings(storage = globalThis.localStorage) {
  const settings = { ...DEFAULT_TOOL_SETTINGS };
  const stored = readStorage(storage, SETTINGS_KEY);
  if (stored) {
    try {
      Object.assign(settings, JSON.parse(stored));
    } catch {
      // 忽略损坏的设置，回退到默认值。
    }
  }
  for (const [field, legacyKey] of Object.entries(LEGACY_KEYS)) {
    if (stored) break;
    const legacyValue = readStorage(storage, legacyKey);
    if (legacyValue === null || legacyValue === '') continue;
    settings[field] = field === 'color' ? legacyValue : Number(legacyValue) || settings[field];
  }
  return settings;
}

export function saveToolSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用时忽略，仅影响下次启动的默认值。
  }
}

function annotationBase(extra = {}) {
  return {
    strokeUniform: true,
    objectCaching: false,
    ...extra
  };
}

export function createRectAnnotation({ fabric, rect, settings }) {
  return new fabric.Rect(annotationBase({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    fill: settings.shapeFill ? settings.color : 'transparent',
    stroke: settings.color,
    strokeWidth: settings.lineWidth
  }));
}

export function createEllipseAnnotation({ fabric, rect, settings }) {
  return new fabric.Ellipse(annotationBase({
    left: rect.left,
    top: rect.top,
    rx: rect.width / 2,
    ry: rect.height / 2,
    fill: settings.shapeFill ? settings.color : 'transparent',
    stroke: settings.color,
    strokeWidth: settings.lineWidth
  }));
}

function arrowHead({ fabric, point, angle, settings }) {
  const size = Math.max(10, settings.lineWidth * 4);
  return new fabric.Triangle(annotationBase({
    left: point.x,
    top: point.y,
    width: size,
    height: size,
    fill: settings.color,
    angle: (angle * 180) / Math.PI + 90,
    originX: 'center',
    originY: 'center'
  }));
}

export function createLineAnnotation({ fabric, start, end, settings }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const line = new fabric.Line([start.x, start.y, end.x, end.y], annotationBase({
    stroke: settings.color,
    strokeWidth: settings.lineWidth,
    strokeLineCap: 'round'
  }));
  if (settings.arrowKind === 'none') return line;
  const parts = [line, arrowHead({ fabric, point: end, angle, settings })];
  if (settings.arrowKind === 'both') {
    parts.push(arrowHead({ fabric, point: start, angle: angle + Math.PI, settings }));
  }
  return new fabric.Group(parts, { objectCaching: false });
}

function pointsToPath(points) {
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')}`.trim();
}

export function createFreehandAnnotation({ fabric, points, settings, options = {} }) {
  const opacity = options.opacity ?? 1;
  return new fabric.Path(pointsToPath(points), annotationBase({
    fill: '',
    stroke: options.color || settings.color,
    strokeWidth: options.lineWidth || settings.lineWidth,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    opacity
  }));
}

export function createTextAnnotation({ fabric, point, text = '', settings, scale = 1 }) {
  return new fabric.IText(text, annotationBase({
    left: point.x,
    top: point.y,
    fontSize: Math.round(settings.fontSize * scale),
    fill: settings.color,
    fontWeight: settings.fontBold ? 'bold' : 'normal',
    fontStyle: settings.fontItalic ? 'italic' : 'normal',
    fontFamily: 'Inter, "Microsoft YaHei", sans-serif'
  }));
}

// 从冻结画面采样并生成像素化补丁，作为马赛克标注的图像来源。
export function createMosaicPatch(source, rect, blockSize) {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const block = Math.max(2, Math.round(blockSize));
  const patch = document.createElement('canvas');
  patch.width = width;
  patch.height = height;
  const context = patch.getContext('2d');
  const reduced = document.createElement('canvas');
  reduced.width = Math.max(1, Math.ceil(width / block));
  reduced.height = Math.max(1, Math.ceil(height / block));
  const reducedContext = reduced.getContext('2d');
  reducedContext.imageSmoothingEnabled = false;
  reducedContext.drawImage(source, rect.left, rect.top, width, height, 0, 0, reduced.width, reduced.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(reduced, 0, 0, reduced.width, reduced.height, 0, 0, width, height);
  return patch;
}

export function createMosaicAnnotation({ fabric, source, rect, settings }) {
  const patch = createMosaicPatch(source, rect, settings.mosaicSize);
  return new fabric.Image(patch, annotationBase({
    left: rect.left,
    top: rect.top,
    selectable: true
  }));
}

function enlivenObjects(fabric, snapshot) {
  if (typeof fabric.util.enlivenObjects === 'function') {
    return new Promise((resolve) => {
      fabric.util.enlivenObjects(snapshot, (objects) => resolve(objects.filter(Boolean)));
    });
  }
  return Promise.resolve([]);
}

// 维护标注对象列表与撤销/重做历史（快照基于 fabric 序列化）。
export function createAnnotationStore({ canvas, fabric, onChange, limit = 60 }) {
  let objects = [];
  let undoStack = [];
  let redoStack = [];
  let pending = null;

  const notify = () => {
    if (typeof onChange === 'function') onChange();
  };

  const snapshot = () => objects.map((object) => object.toObject());

  // 记录变更前状态，撤销时回到上一步；提交前的中间态不覆盖。
  const beginChange = () => {
    pending = pending || snapshot();
  };

  const commitChange = () => {
    if (!pending) return;
    undoStack.push(pending);
    if (undoStack.length > limit) undoStack.shift();
    redoStack = [];
    pending = null;
    notify();
  };

  const detach = () => {
    const removed = objects;
    removed.forEach((object) => canvas.remove(object));
    objects = [];
    return removed;
  };

  const attach = (list) => {
    objects = list;
    objects.forEach((object) => canvas.add(object));
    canvas.requestRenderAll();
  };

  const store = {
    get objects() {
      return objects.slice();
    },

    add(object) {
      beginChange();
      canvas.add(object);
      objects.push(object);
      commitChange();
    },

    // 外部直接改动对象（如拖动位置）：开始时 beginChange，结束时 commitChange。
    beginChange,
    commitChange,

    remove(object) {
      const index = objects.indexOf(object);
      if (index === -1) return false;
      beginChange();
      objects.splice(index, 1);
      canvas.remove(object);
      commitChange();
      return true;
    },

    findAt(point, tolerance = 6) {
      return findAnnotationAt(objects, point, tolerance);
    },

    clear() {
      if (!objects.length) return false;
      beginChange();
      detach();
      commitChange();
      return true;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    async undo() {
      if (!undoStack.length) return false;
      const current = snapshot();
      const target = undoStack.pop();
      redoStack.push(current);
      detach();
      attach(await enlivenObjects(fabric, target));
      notify();
      return true;
    },

    async redo() {
      if (!redoStack.length) return false;
      const current = snapshot();
      const target = redoStack.pop();
      undoStack.push(current);
      detach();
      attach(await enlivenObjects(fabric, target));
      notify();
      return true;
    }
  };

  return store;
}
