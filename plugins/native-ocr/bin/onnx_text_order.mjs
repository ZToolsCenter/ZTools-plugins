// ONNX OCR 阅读顺序排序（纯函数，供 server 与测试共享）。
//
// 背景：PP-OCR 的 det 输出顺序不保证自上而下（常见自下而上），原
// Recognition.run 内部的 afAfRec 会做行分组排序，但逐单元格解码管线绕过了它。
// 这里按 box 几何位置恢复阅读顺序：行间自上而下、行内自左向右。
//
// box 约定：像素坐标 polygon [[x,y]x4]，top-left origin。

/**
 * 按阅读顺序重排 items（每个 item 需带 box，polygon 像素坐标）。
 * 无 box 的 item 保持相对顺序排到最后。
 * 行分组采用相邻间隙比较（当前与上一单元格的中线差 <= 平均高度/2 归入同行），
 * 避免滑动均值导致的聚类中心漂移吞行。
 * @param {Array<{text?: string, box?: Array<number[]> | null}>} items
 * @returns {Array} 排序后的新数组（不修改入参）
 */
export function sortReadingOrder(items) {
  const list = Array.isArray(items) ? items : [];
  const boxed = [];
  const loose = [];
  for (const item of list) {
    if (item && Array.isArray(item.box) && item.box.length >= 2) boxed.push(item);
    else loose.push(item);
  }
  if (boxed.length < 2) return [...list];

  const rects = boxed.map((item) => {
    const xs = item.box.map((p) => p[0]);
    const ys = item.box.map((p) => p[1]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { left, right, top, bottom, cy: (top + bottom) / 2 };
  });
  const avgH = rects.reduce((sum, r) => sum + (r.bottom - r.top), 0) / rects.length;
  if (!(avgH > 0) || !Number.isFinite(avgH)) return [...list];

  const order = rects.map((_, index) => index).sort((a, b) => rects[a].cy - rects[b].cy);
  const rows = [];
  for (const idx of order) {
    const lastRow = rows[rows.length - 1];
    const prevIdx = lastRow ? lastRow.members[lastRow.members.length - 1] : null;
    if (lastRow && prevIdx !== null && Math.abs(rects[idx].cy - rects[prevIdx].cy) <= avgH / 2) {
      lastRow.members.push(idx);
    } else {
      rows.push({ members: [idx] });
    }
  }
  rows.sort((a, b) => rects[a.members[0]].top - rects[b.members[0]].top);
  for (const row of rows) {
    row.members.sort((a, b) => rects[a].left - rects[b].left);
  }
  return [...rows.flatMap((row) => row.members.map((i) => boxed[i])), ...loose];
}
