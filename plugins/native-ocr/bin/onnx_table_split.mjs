// 表格行切列规划（纯函数，无第三方依赖）。
//
// 背景：PP-OCR det 对带网格线的表格常把"一整行"识别成一个宽 box，
// 导致下游按 box 中心聚类时所有列塌缩成 1 列（列分割线消失）。
//
// 思路：宽高比大且 x 范围彼此对齐的行（≥2 条）视为"表格行块"；
// 对每行裁剪图做垂直暗像素投影，找两类分隔特征：
//   1) 空白带 —— 连续若干列无暗像素（无框线表格的列间距，允许被竖线的窄暗峰打断）；
//   2) 竖线峰 —— 某一窄列的暗像素占比极高、且左右紧邻列干净（有线表格的格线）。
// 再对全块的分裂点做投票，只有被"足够多行"支持的列位置才真正切分
// （避免把标题/落款等偶发间隙、以及单个汉字的竖笔画误切）。
//
// 坐标约定：box 为源图像素坐标（左上原点），与 server 协议一致。

const ASPECT_MIN = 3;            // 宽/高达到该值才视为"宽行"候选
const EXTENT_TOL_RATIO = 0.02;   // 行块成员的左右边界容差（相对源图宽）
// 行块最少成员数：3 → 2。只有 2 行内容的小表格（最常见的最小有线表格）此前
// 直接被 GROUP_MIN 过滤掉、永远不切列，是"整行压成单列"的高频成因。
// 放宽到 2 的前提是投票仍然逐行计数（见 supportMin），两行必须都同意才切。
const GROUP_MIN = 2;
const DARK_RATIO_MAX = 0.02;     // 列暗像素占比 ≤ 此值视为空白列
const LUMA_THRESHOLD = 150;      // 亮度低于此值算暗像素
// 分裂点最少支持行数。行块成员不足 3 行时按实际成员数放宽（supportMin），
// 因此对 ≥3 行的行块该阈值仍然是 3 —— 原有能正常切分的用例结果不变。
const SUPPORT_MIN = 3;
const MIN_SEGMENT_PX = 6;        // 切出的子段最小宽度
const MAX_SEGMENTS_PER_LINE = 12;

// —— 第二类分隔特征：竖线峰 ——
const LINE_RATIO_MIN = 0.85;     // 单列暗占比 ≥ 此值才算竖线列（贯穿整行高）
const LINE_RUN_MAX_RATIO = 0.3;  // 竖线列连续宽度上限（相对行高），更宽视为实心图块
const LINE_NEIGHBOR_MAX = 0.6;   // 竖线左右隔离带内允许的暗占比上限（排除文字笔画）
const LINE_ISOLATION_GAP = 2;    // 隔离带宽度（px）

function polygonBBox(box) {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys)
  };
}

function columnDarkRatios(image) {
  const { data, width, height } = image;
  const dark = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = row + x * 4;
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma < LUMA_THRESHOLD) dark[x] += 1;
    }
  }
  const ratios = new Float64Array(width);
  for (let x = 0; x < width; x += 1) ratios[x] = dark[x] / height;
  return ratios;
}

// 找空白带中心（裁剪图内坐标）。允许被 ≤ spikeMax 宽的暗峰（竖网格线）打断。
function findBlankBandCenters(ratios, { spikeMax, bandMin }) {
  const width = ratios.length;
  const blank = new Array(width);
  for (let x = 0; x < width; x += 1) blank[x] = ratios[x] <= DARK_RATIO_MAX;
  // 合并被窄暗峰隔开的空白段
  const merged = [...blank];
  let x = 0;
  while (x < width) {
    if (!merged[x]) {
      let end = x;
      while (end < width && !merged[end]) end += 1;
      const runLen = end - x;
      const beforeBlank = x > 0 && merged[x - 1];
      const afterBlank = end < width && merged[end];
      if (runLen <= spikeMax && beforeBlank && afterBlank) {
        for (let i = x; i < end; i += 1) merged[i] = true;
      }
      x = end;
    } else {
      x += 1;
    }
  }
  // 收集空白带
  const bands = [];
  x = 0;
  while (x < width) {
    if (merged[x]) {
      let end = x;
      while (end < width && merged[end]) end += 1;
      if (end - x >= bandMin) bands.push([(x + end - 1) / 2, x, end]);
      x = end;
    } else {
      x += 1;
    }
  }
  return bands;
}

// 找竖线峰中心（裁剪图内坐标）。用于「列间有可见竖线、但没有空白带」的粗边框表格：
// 这类表格的列间距被格线填满，findBlankBandCenters 找不到任何空白带，只有投影上的窄峰。
// 三条判据缺一不可：
//   1) 暗占比 ≥ lineMin —— 竖线贯穿整行裁剪高度（汉字竖笔画通常只覆盖 0.6~0.8）；
//   2) 连续宽度 ≤ runMax —— 粗边框仍可命中，但实心图块/反色整黑图会被排除；
//   3) 左右各 gap 列暗占比 ≤ neighborMax —— 竖线两侧是单元格留白，文字笔画两侧仍有墨。
// 单行内的误判（例如某行刚好有一条竖笔画）由调用方的跨行投票兜底：只有多行在
// 同一 x 上同时出现竖线峰才会真正切列。
function findLinePeakCenters(ratios, { lineMin, runMax, neighborMax, gap }) {
  const width = ratios.length;
  const centers = [];
  let x = 0;
  while (x < width) {
    if (ratios[x] >= lineMin) {
      let end = x;
      while (end < width && ratios[end] >= lineMin) end += 1;
      let isolated = true;
      for (let k = 1; k <= gap && isolated; k += 1) {
        const left = x - k;
        const right = end - 1 + k;
        if (left >= 0 && ratios[left] > neighborMax) isolated = false;
        if (right < width && ratios[right] > neighborMax) isolated = false;
      }
      if (end - x <= runMax && isolated) centers.push((x + end - 1) / 2);
      x = end;
    } else {
      x += 1;
    }
  }
  return centers;
}

function cropColumns(image, x0, x1, makeImage) {
  const { data, width, height } = image;
  const w = x1 - x0;
  const out = new Uint8Array(w * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcRow = y * width * 4;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const si = srcRow + (x0 + x) * 4;
      const di = dstRow + x * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return makeImage({ data: out, width: w, height });
}

function subPolygon(bbox, cropWidth, cropX0, cropX1) {
  const { left, right, top, bottom } = bbox;
  const x0 = left + (cropX0 / cropWidth) * (right - left);
  const x1 = left + (cropX1 / cropWidth) * (right - left);
  return [[x0, top], [x1, top], [x1, bottom], [x0, bottom]];
}

/**
 * 规划表格行切分。
 * @param lineImages  Detection.run 的输出 [{ image, box }]
 * @param options.sourceWidth/sourceHeight  源图尺寸（px）
 * @param options.makeImage  ({data,width,height}) => ImageRaw 实例
 * @returns { images, boxes }  拍平后的最终 lineImages 与对应源图 box（像素）
 *   images[i] 为 { image, box } 形状（与 Recognition.run 入参一致）
 */
export function planTableSplits(lineImages, { sourceWidth = 0, sourceHeight = 0, makeImage }) {
  const items = (lineImages || []).map((lineImage) => {
    const box = Array.isArray(lineImage.box) && lineImage.box.length >= 2 ? lineImage.box : null;
    const bbox = box ? polygonBBox(box) : null;
    const cropW = lineImage.image ? lineImage.image.width : 0;
    const cropH = lineImage.image ? lineImage.image.height : 0;
    return {
      lineImage,
      box,
      bbox,
      aspect: cropH > 0 ? cropW / cropH : 0
    };
  });

  const tol = EXTENT_TOL_RATIO * (sourceWidth || 0);
  const candidates = tol > 0
    ? items.filter((item) => item.aspect >= ASPECT_MIN && item.bbox)
    : [];

  // 1. 按 (left, right) 边界就近分组
  const groups = [];
  for (const item of candidates) {
    const group = groups.find((g) => Math.abs(item.bbox.left - g.left) <= tol
      && Math.abs(item.bbox.right - g.right) <= tol);
    if (group) {
      group.members.push(item);
      group.left = group.members.reduce((s, m) => s + m.bbox.left, 0) / group.members.length;
      group.right = group.members.reduce((s, m) => s + m.bbox.right, 0) / group.members.length;
    } else {
      groups.push({ left: item.bbox.left, right: item.bbox.right, members: [item] });
    }
  }
  const rowBlocks = groups.filter((g) => g.members.length >= GROUP_MIN);

  // 2. 行块内逐行做一次投影，找分隔特征（空白带 + 竖线峰），再投票
  //    投影是纯函数且与「投票 / 切点匹配」无关，因此每个 item 只算一次并缓存复用。
  const splitMap = new Map(); // item -> [cropX...]
  for (const group of rowBlocks) {
    const clusterTol = Math.max(5, Math.round(sourceWidth * 0.01));
    // 行块不足 SUPPORT_MIN 行时按实际成员数放宽（2 行表格需要两行都同意才切），
    // ≥3 行的行块仍是 SUPPORT_MIN，保持原有切分行为。
    const supportMin = Math.min(SUPPORT_MIN, group.members.length);
    const prepared = []; // { item, centers } —— 本行全部候选分隔位置的投影结果
    const voteCenters = [];
    for (const item of group.members) {
      const img = item.lineImage.image;
      const spikeMax = Math.max(3, Math.round(img.height * 0.2));
      const bandMin = Math.max(4, Math.round(img.height * 0.5));
      const ratios = columnDarkRatios(img);
      const margin = Math.round(img.width * 0.02);
      const inMargin = (center) => center >= margin && center <= img.width - margin;
      // 特征 1：空白带中心（无框线表格）
      const centers = findBlankBandCenters(ratios, { spikeMax, bandMin })
        .map(([center]) => center)
        .filter(inMargin);
      // 特征 2：竖线峰中心（有线表格）；同一行内与空白带位置相近的去重，
      // 避免同一处边界被记两票而让「投票」失去按行计数的意义。
      const peaks = findLinePeakCenters(ratios, {
        lineMin: LINE_RATIO_MIN,
        runMax: Math.max(2, Math.round(img.height * LINE_RUN_MAX_RATIO)),
        neighborMax: LINE_NEIGHBOR_MAX,
        gap: LINE_ISOLATION_GAP
      }).filter(inMargin);
      for (const peak of peaks) {
        if (centers.every((center) => Math.abs(center - peak) > clusterTol)) centers.push(peak);
      }
      prepared.push({ item, centers });
      for (const center of centers) voteCenters.push(center);
    }
    // 投票：相近的候选中心归为一簇，被足够多行支持的位置才生效
    const centers = voteCenters.sort((a, b) => a - b);
    const supported = [];
    let i = 0;
    while (i < centers.length) {
      let j = i;
      while (j + 1 < centers.length && centers[j + 1] - centers[j] <= clusterTol) j += 1;
      const count = j - i + 1;
      if (count >= supportMin) {
        supported.push(centers.slice(i, j + 1).reduce((s, v) => s + v, 0) / count);
      }
      i = j + 1;
    }
    if (!supported.length) continue;
    // 每行取自己落在支持位置附近的候选作为切点（复用上面缓存的行投影结果）
    for (const { item, centers: lineCenters } of prepared) {
      const points = [];
      for (const position of supported) {
        let best = null;
        let bestDist = Infinity;
        for (const center of lineCenters) {
          const dist = Math.abs(center - position);
          if (dist < bestDist) {
            bestDist = dist;
            best = center;
          }
        }
        if (best != null && bestDist <= clusterTol) points.push(best);
      }
      points.sort((a, b) => a - b);
      if (points.length && points.length < MAX_SEGMENTS_PER_LINE) {
        splitMap.set(item, points);
      }
    }
  }

  // 3. 按切点拍平
  const images = [];
  const boxes = [];
  for (const item of items) {
    const points = splitMap.get(item);
    if (!points || !item.bbox) {
      images.push({ image: item.lineImage.image, box: item.lineImage.box });
      boxes.push(item.lineImage.box || null);
      continue;
    }
    const img = item.lineImage.image;
    const bounds = [0, ...points, img.width];
    let emitted = 0;
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      const x0 = Math.round(bounds[k]);
      const x1 = Math.round(bounds[k + 1]);
      if (x1 - x0 < MIN_SEGMENT_PX) continue;
      images.push({
        image: cropColumns(img, x0, x1, makeImage),
        box: subPolygon(item.bbox, img.width, x0, x1)
      });
      boxes.push(subPolygon(item.bbox, img.width, x0, x1));
      emitted += 1;
    }
    if (!emitted) {
      images.push({ image: item.lineImage.image, box: item.lineImage.box });
      boxes.push(item.lineImage.box || null);
    }
  }
  return { images, boxes };
}
