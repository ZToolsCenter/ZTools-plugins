// 图像坐标系中的标注命中测试：优先精确多边形命中，失败时退回包围盒。

export function annotationContains(object, point, tolerance = 6) {
  try {
    if (typeof object.containsPoint === 'function' && object.containsPoint(point, null, true)) {
      return true;
    }
  } catch {
    // 命中测试失败时退回到包围盒判断。
  }
  try {
    const bounds = object.getBoundingRect?.(true);
    if (!bounds) return false;
    return point.x >= bounds.left - tolerance
      && point.x <= bounds.left + bounds.width + tolerance
      && point.y >= bounds.top - tolerance
      && point.y <= bounds.top + bounds.height + tolerance;
  } catch {
    return false;
  }
}

export function findAnnotationAt(objects, point, tolerance = 6) {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (annotationContains(object, point, tolerance)) return object;
  }
  return null;
}
