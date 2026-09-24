// 表格行切列规划（纯函数，无第三方依赖）。
//
// 背景：PP-OCR det 对带网格线的表格常把"一整行"识别成一个宽 box，
// 导致下游按 box 中心聚类时所有列塌缩成 1 列（列分割线消失）。
//
// 思路：宽高比大且 x 范围彼此对齐的行（≥3 条）视为"表格行块"；
// 对每行裁剪图做垂直暗像素投影，找单元格间的空白带（允许被
// 竖直网格线的窄暗峰打断）；再对全块的分裂点做投票，只有被
// ≥3 行支持的列位置才真正切分（避免把标题/落款等偶发间隙误切）。
//
// 坐标约定：box 为源图像素坐标（左上原点），与 server 协议一致。

const ASPECT_MIN = 3;            // 宽/高达到该值才视为"宽行"候选
const EXTENT_TOL_RATIO = 0.02;   // 行块成员的左右边界容差（相对源图宽）
const GROUP_MIN = 3;             // 行块最少成员数
const DARK_RATIO_MAX = 0.02;     // 列暗像素占比 ≤ 此值视为空白列
const LUMA_THRESHOLD = 150;      // 亮度低于此值算暗像素
const SUPPORT_MIN = 3;           // 分裂点至少被这么多行支持才生效
const MIN_SEGMENT_PX = 6;        // 切出的子段最小宽度
const MAX_SEGMENTS_PER_LINE = 12;

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

  // 2. 行块内逐行找空白带，再做分裂点投票
  const splitMap = new Map(); // item -> [cropX...]
  for (const group of rowBlocks) {
    const allBands = []; // { item, center }
    for (const item of group.members) {
      const img = item.lineImage.image;
      const spikeMax = Math.max(3, Math.round(img.height * 0.2));
      const bandMin = Math.max(4, Math.round(img.height * 0.5));
      const ratios = columnDarkRatios(img);
      const margin = Math.round(img.width * 0.02);
      for (const [center] of findBlankBandCenters(ratios, { spikeMax, bandMin })) {
        if (center >= margin && center <= img.width - margin) {
          allBands.push({ item, center });
        }
      }
    }
    // 投票：相近的带中心归为一簇
    const clusterTol = Math.max(5, Math.round(sourceWidth * 0.01));
    const centers = allBands.map((b) => b.center).sort((a, b) => a - b);
    const supported = [];
    let i = 0;
    while (i < centers.length) {
      let j = i;
      while (j + 1 < centers.length && centers[j + 1] - centers[j] <= clusterTol) j += 1;
      const count = j - i + 1;
      if (count >= SUPPORT_MIN) {
        supported.push(centers.slice(i, j + 1).reduce((s, v) => s + v, 0) / count);
      }
      i = j + 1;
    }
    if (!supported.length) continue;
    // 每行取自己落在支持位置附近的带作为切点
    for (const item of group.members) {
      const img = item.lineImage.image;
      const spikeMax = Math.max(3, Math.round(img.height * 0.2));
      const bandMin = Math.max(4, Math.round(img.height * 0.5));
      const ratios = columnDarkRatios(img);
      const margin = Math.round(img.width * 0.02);
      const bands = findBlankBandCenters(ratios, { spikeMax, bandMin })
        .filter(([center]) => center >= margin && center <= img.width - margin);
      const points = [];
      for (const position of supported) {
        let best = null;
        let bestDist = Infinity;
        for (const [center] of bands) {
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
