// 选区视觉层：蓝色边框 + 8 个手柄，随缩放反向缩放以保持屏幕尺寸稳定。

import { HANDLE_DIRECTIONS, handleAnchors, hitTestHandle, rectContains, roundRect } from './geometry.js';

export const SELECTION_STROKE = '#1e90ff';
const BASE_HANDLE_SIZE = 10;
const BASE_STROKE_WIDTH = 1.5;

export function createSelection({ fabric, canvas, stroke = SELECTION_STROKE }) {
  if (!fabric || !canvas) throw new Error('缺少 fabric 画布');

  let rect = null;
  let scale = 1;
  let attached = false;

  const baseStyle = {
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    visible: false
  };

  const border = new fabric.Rect({
    ...baseStyle,
    fill: 'transparent',
    stroke,
    strokeWidth: BASE_STROKE_WIDTH
  });

  const handles = HANDLE_DIRECTIONS.map(() => new fabric.Circle({
    ...baseStyle,
    radius: BASE_HANDLE_SIZE / 2,
    fill: '#ffffff',
    stroke,
    strokeWidth: BASE_STROKE_WIDTH,
    originX: 'center',
    originY: 'center'
  }));

  const render = () => {
    const visible = Boolean(rect);
    border.visible = visible;
    handles.forEach((handle) => { handle.visible = visible; });
    if (rect) {
      border.set({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        strokeWidth: BASE_STROKE_WIDTH / scale
      });
      const anchors = handleAnchors(rect);
      HANDLE_DIRECTIONS.forEach((direction, index) => {
        handles[index].set({
          left: anchors[direction].x,
          top: anchors[direction].y,
          radius: BASE_HANDLE_SIZE / 2 / scale,
          strokeWidth: BASE_STROKE_WIDTH / scale
        });
      });
    }
    canvas.requestRenderAll();
  };

  const attach = () => {
    if (attached) return;
    attached = true;
    canvas.add(border, ...handles);
    render();
  };

  const api = {
    get rect() {
      return rect ? { ...rect } : null;
    },

    set(nextRect) {
      rect = nextRect ? roundRect(nextRect) : null;
      render();
      return api.rect;
    },

    clear() {
      rect = null;
      render();
    },

    setScale(nextScale) {
      scale = nextScale || 1;
      render();
    },

    contains(imagePoint, padding = 0) {
      return rect ? rectContains(rect, imagePoint, padding) : false;
    },

    hitHandle(imagePoint, radius = BASE_HANDLE_SIZE / scale) {
      return rect ? hitTestHandle(rect, imagePoint, radius) : '';
    },

    attach,

    // 标注对象变化后需要把选区视觉层重新置顶。
    raise() {
      attach();
      canvas.bringToFront(border);
      handles.forEach((handle) => canvas.bringToFront(handle));
    }
  };

  return api;
}
