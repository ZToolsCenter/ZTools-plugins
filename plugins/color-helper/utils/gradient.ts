/**
 * 渐变几何计算
 *
 * 纯数学、零依赖的独立模块, 供 pages/GradientsPage.tsx 使用;
 * 回归风险最高, 配了 tests/gradient-geometry.test.ts 专门锁住。
 */

/**
 * 计算渐变线的起止坐标(用于 Canvas 渲染)
 * 必须与 CSS linear-gradient(angle) 的渐变线一致:
 *  - 方向向量 d = (sin a, -cos a) (CSS 中 0deg 指向上, y 轴向下)
 *  - 渐变线长度 L = |w·sin a| + |h·cos a| (不是对角线)
 *  - 以画布中心为中点, 向两侧各延伸 L/2
 * 否则 Canvas 会在端点外钳制色值, 导出图上出现大片纯色区
 */
export function calculateGradientLine(width: number, height: number, angle: number) {
  const rad = angle * Math.PI / 180;
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  const half = (Math.abs(width * dirX) + Math.abs(height * dirY)) / 2;
  return {
    tx: width / 2 - dirX * half,
    ty: height / 2 - dirY * half,
    bx: width / 2 + dirX * half,
    by: height / 2 + dirY * half,
  };
}
