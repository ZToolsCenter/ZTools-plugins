export interface DragPoint {
  x: number;
  y: number;
}

let dragStartPoint: DragPoint | null = null;

/**
 * 记录拖拽开始时的鼠标位置。
 * 操作区会从这里向右上 / 右下展开，之后保持固定，避免图标跟着鼠标跑导致无法命中。
 */
export function rememberDragStart(point: { clientX: number; clientY: number }) {
  // 个别环境拿不到坐标时，退回使用拖拽源元素的位置。
  if (point.clientX === 0 && point.clientY === 0) {
    dragStartPoint = null;
    return;
  }

  dragStartPoint = { x: point.clientX, y: point.clientY };
}

export function getDragStartPoint(): DragPoint | null {
  return dragStartPoint;
}

export function clearDragStartPoint() {
  dragStartPoint = null;
}
