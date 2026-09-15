// native-ocr 表格模型回归测试 —— node tests/run.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bandIndexFor,
  buildGrid,
  clusterTable,
  extractCells,
  LOW_CONFIDENCE_THRESHOLD,
  median
} from '../src/lib/tableModel.js'
import { sanitizeLatexForRender } from '../src/lib/latexRepair.js'
import { resizeGray } from '../bin/onnx_gray_resize.mjs'
import {
  letterbox,
  computeTarget,
  nms,
  iou,
  decodeBoxes,
  inverseLetterbox,
  clampBoxPad,
  isTinyTextLatex,
  isTinyTextLatexLoose,
  isTrivialFormulaLatex
} from '../bin/onnx_mfd_core.mjs'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${error.message}`)
  }
}

function makeLines(rows, cols, score = null) {
  // 生成 rows×cols 的归一化坐标行（行距 0.35，列距 0.3，居中）
  const lines = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const line = {
        text: `R${r + 1}C${c + 1}`,
        box: {
          x: 0.2 + c * 0.3,
          y: 1 - (0.25 + r * 0.35) - 0.12,
          w: 0.12,
          h: 0.12
        }
      }
      if (score !== null) line.score = score
      lines.push(line)
    }
  }
  return lines
}

function autoSeps(lines) {
  const cells = extractCells(lines)
  const rowThreshold = median(cells.map((c) => c.h)) * 0.6
  const colThreshold = median(cells.map((c) => c.w)) * 0.6
  const { rowClusters, colClusters } = clusterTable(lines, 0.6)
  const rowSeps = []
  for (let i = 0; i < rowClusters.length - 1; i += 1) {
    rowSeps.push((rowClusters[i].cy + rowClusters[i + 1].cy) / 2)
  }
  const colSeps = []
  for (let i = 0; i < colClusters.length - 1; i += 1) {
    colSeps.push((colClusters[i].cx + colClusters[i + 1].cx) / 2)
  }
  void rowThreshold
  void colThreshold
  return {
    rowSeps: rowSeps.sort((a, b) => a - b),
    colSeps: colSeps.sort((a, b) => a - b)
  }
}

console.log('[tableModel]')

test('median 奇偶长度', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})

test('自动聚类等价分隔线模型（2×3）', () => {
  const lines = makeLines(2, 3)
  const auto = clusterTable(lines, 0.6)
  const { rowSeps, colSeps } = autoSeps(lines)
  const cells = extractCells(lines)
  const model = buildGrid(cells, rowSeps, colSeps)
  assert.deepEqual(model.grid, auto.grid)
  assert.deepEqual(model.grid, [['R1C1', 'R1C2', 'R1C3'], ['R2C1', 'R2C2', 'R2C3']])
})

test('拖动行分隔线重排（移到边缘产生空带）', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const dragged = [0.05]
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, dragged, auto.colSeps)
  assert.equal(grid.length, 2)
  assert.equal(grid[0].join('|'), 'R1C1 R2C1|R1C2 R2C2|R1C3 R2C3')
  assert.ok(grid[1].every((cell) => cell === ''))
})

test('双击删线合并行列', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, auto.rowSeps, auto.colSeps.slice(1))
  assert.equal(grid[0].length, 2)
  assert.equal(grid[0][0], 'R1C1 R1C2')
  assert.equal(grid[0][1], 'R1C3')
  assert.equal(grid[1][0], 'R2C1 R2C2')
})

test('+列线在最大空隙插入产生空列', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const bounds = [0, ...auto.colSeps, 1]
  let bestGap = -1
  let bestPos = 0.5
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const gap = bounds[i + 1] - bounds[i]
    if (gap > bestGap) {
      bestGap = gap
      bestPos = (bounds[i] + bounds[i + 1]) / 2
    }
  }
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, auto.rowSeps, [...auto.colSeps, bestPos].sort((a, b) => a - b))
  assert.equal(grid[0].length, 4)
  const emptyIndex = grid[0].findIndex((cell) => cell === '')
  assert.ok(emptyIndex >= 0, '应存在一个空列')
  const filled = grid[0].filter((cell) => cell)
  assert.deepEqual(filled, ['R1C1', 'R1C2', 'R1C3'])
})

test('单元格编辑覆盖', () => {
  const lines = makeLines(2, 3)
  const { rowSeps, colSeps } = autoSeps(lines)
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, rowSeps, colSeps, { '0-1': '校对后' })
  assert.equal(grid[0][1], '校对后')
  assert.equal(grid[1][2], 'R2C3')
})

test('低置信度单元格标记', () => {
  const low = makeLines(2, 3, 0.6)
  const high = makeLines(2, 3, 0.95)
  const { rowSeps, colSeps } = autoSeps(low)
  const lowResult = buildGrid(extractCells(low), rowSeps, colSeps)
  const highResult = buildGrid(extractCells(high), rowSeps, colSeps)
  assert.equal(lowResult.lowCells.size, 6)
  assert.equal(highResult.lowCells.size, 0)
  assert.ok(LOW_CONFIDENCE_THRESHOLD === 0.85)
})

test('bandIndexFor 边界', () => {
  assert.equal(bandIndexFor(0.5, []), 0)
  assert.equal(bandIndexFor(0.2, [0.3, 0.6]), 0)
  assert.equal(bandIndexFor(0.4, [0.3, 0.6]), 1)
  assert.equal(bandIndexFor(0.9, [0.3, 0.6]), 2)
})

test('无 box 行不影响提取', () => {
  const lines = [{ text: 'no box' }, ...makeLines(1, 1)]
  assert.equal(extractCells(lines).length, 1)
})

// —— onnx_text_order（阅读顺序排序）——

import { sortReadingOrder } from '../bin/onnx_text_order.mjs'

// 构造像素 polygon box（top-left origin）：[[x,y]x4]
function pxBox(left, top, w = 60, h = 24) {
  return [[left, top], [left + w, top], [left + w, top + h], [left, top + h]]
}

test('sortReadingOrder 倒序输入恢复自上而下', () => {
  // det 常见输出顺序：自下而上
  const items = [
    { text: 'C3', box: pxBox(200, 240) },
    { text: 'C2', box: pxBox(100, 120) },
    { text: 'C1', box: pxBox(0, 0) }
  ]
  const sorted = sortReadingOrder(items)
  assert.deepEqual(sorted.map((i) => i.text), ['C1', 'C2', 'C3'])
})

test('sortReadingOrder 行内自左向右', () => {
  const items = [
    { text: 'B', box: pxBox(100, 0) },
    { text: 'A', box: pxBox(0, 0) }
  ]
  assert.deepEqual(sortReadingOrder(items).map((i) => i.text), ['A', 'B'])
})

test('sortReadingOrder 同行中线偏差归组', () => {
  // 第二个 box 略低（中线差 6px < 平均高 24/2），应视为同一行
  const items = [
    { text: 'B', box: pxBox(100, 6) },
    { text: 'A', box: pxBox(0, 0) }
  ]
  const sorted = sortReadingOrder(items)
  assert.deepEqual(sorted.map((i) => i.text), ['A', 'B'])
})

test('sortReadingOrder 不同行中线偏差超阈值分行', () => {
  // 中线差 30px > 平均高 24/2=12，应分两行，上行的 B 排在前
  const items = [
    { text: 'B', box: pxBox(0, 30) },
    { text: 'A', box: pxBox(100, 0) }
  ]
  assert.deepEqual(sortReadingOrder(items).map((i) => i.text), ['A', 'B'])
})

test('sortReadingOrder 无 box 项保持相对顺序排最后', () => {
  const items = [
    { text: 'X1' },
    { text: 'A', box: pxBox(0, 0) },
    { text: 'X2', box: null },
    { text: 'B', box: pxBox(100, 50) }
  ]
  const sorted = sortReadingOrder(items)
  assert.deepEqual(sorted.map((i) => i.text), ['A', 'B', 'X1', 'X2'])
})

test('sortReadingOrder 不足两个 box 时原样返回', () => {
  const items = [{ text: 'B', box: pxBox(100, 0) }, { text: 'A', box: pxBox(0, 0) }]
  assert.deepEqual(sortReadingOrder([items[0]]).map((i) => i.text), ['B'])
  assert.deepEqual(sortReadingOrder([]), [])
  assert.deepEqual(sortReadingOrder(undefined), [])
})

// --- LaTeX 容错修复（公式预览） ---
test('sanitizeLatexForRender 修复双下标', () => {
  assert.equal(sanitizeLatexForRender('x_a_b'), 'x_a{}_b')
  assert.equal(sanitizeLatexForRender('\\alpha_\\beta_\\gamma'), '\\alpha_\\beta{}_\\gamma')
})

test('sanitizeLatexForRender 修复双上标', () => {
  assert.equal(sanitizeLatexForRender('x^a^b'), 'x^a{}^b')
})

test('sanitizeLatexForRender 修复上标后重复下标', () => {
  assert.equal(
    sanitizeLatexForRender('\\sum_{i=0}^{n}_{j}'),
    '\\sum_{i=0}^{n}{}_{j}'
  )
})

test('sanitizeLatexForRender 修复真实识别错误样例', () => {
  const raw = '{\\Theta}^{j}\\overline{{{\\pi}}}_{\\Phi}_{\\Phi}_{\\Phi}^{j}'
  const fixed = sanitizeLatexForRender(raw)
  assert.equal(fixed, '{\\Theta}^{j}\\overline{{{\\pi}}}_{\\Phi}{}_{\\Phi}{}_{\\Phi}^{j}')
  assert.notEqual(fixed, raw)
})

test('sanitizeLatexForRender 不误伤合法 LaTeX', () => {
  const valid = [
    'x^{2}+y^{2}=1',
    'x={\\frac{-b\\pm{\\sqrt{b^{2}-4a c\\ }}}{2a}}',
    '{\\frac{x^{2}}{a^{2}}}-{\\frac{y^{2}}{b^{2}}}=1',
    'a_b^c',
    'e^{i\\pi}+1=0',
    '\\int_0^1 x^2 dx'
  ]
  for (const latex of valid) {
    assert.equal(sanitizeLatexForRender(latex), latex, `不应修改: ${latex}`)
  }
})

test('sanitizeLatexForRender 幂等（修复后可重复调用）', () => {
  const once = sanitizeLatexForRender('x_a_b_c')
  assert.equal(sanitizeLatexForRender(once), once)
})

test('sanitizeLatexForRender 处理空值', () => {
  assert.equal(sanitizeLatexForRender(''), '')
  assert.equal(sanitizeLatexForRender(null), '')
  assert.equal(sanitizeLatexForRender(undefined), '')
})

// --- 灰度缩放（公式识别预处理核心）---
// 基准由 PIL 12.2 生成（tests/fixtures/gray-resize-ref.json），断言 JS 与 PIL 一致。
// 这条覆盖的是一个真实事故：早期用「4 邻域点采样」缩图，宽图（>672px，触发降采样）
// 的细笔画被抽断，识别结果全错；窄图因为不降采样而恰好正常，所以长期没被发现。
const resizeRef = JSON.parse(
  readFileSync(new URL('./fixtures/gray-resize-ref.json', import.meta.url), 'utf8')
)

function maeOf(got, ref) {
  let sum = 0
  for (let i = 0; i < ref.length; i += 1) sum += Math.abs(got[i] - ref[i])
  return sum / ref.length
}

for (const [key, ref] of Object.entries(resizeRef.ref)) {
  test(`resizeGray 与 PIL 一致: ${key}`, () => {
    const [filterName, size] = key.split('-')
    const [w, h] = size.split('x').map(Number)
    const got = resizeGray(
      Uint8Array.from(resizeRef.src),
      resizeRef.wSrc,
      resizeRef.hSrc,
      w,
      h,
      filterName
    )
    assert.equal(got.length, ref.length)
    const mae = maeOf(got, Uint8Array.from(ref))
    // 实测 MAE ≤ 0.21、最大误差 1；放宽到 0.5/2 以吸收浮点与取整差异。
    assert.ok(mae <= 0.5, `MAE 过大: ${mae.toFixed(3)} (与 PIL 参考不一致)`)
    let maxErr = 0
    for (let i = 0; i < ref.length; i += 1) {
      maxErr = Math.max(maxErr, Math.abs(got[i] - ref[i]))
    }
    assert.ok(maxErr <= 2, `最大误差过大: ${maxErr}`)
  })
}

test('resizeGray 必须抗锯齿（对照无抗锯齿点采样）', () => {
  // 同一输入下，无抗锯齿点采样相对 PIL 的 MAE 在 24~62 量级；
  // 本实现须显著低于该量级，否则说明支撑域没有被放大（抗锯齿失效）。
  const src = Uint8Array.from(resizeRef.src)
  const ref = Uint8Array.from(resizeRef.ref['bilinear-16x12'])
  const good = maeOf(resizeGray(src, resizeRef.wSrc, resizeRef.hSrc, 16, 12, 'bilinear'), ref)
  assert.ok(good < 1, `抗锯齿失效，MAE=${good.toFixed(2)}`)

  // 复刻旧实现作为反例，确认它与基准差异巨大（证明这条测试有区分力）
  const naive = (() => {
    const [wSrc, hSrc] = [resizeRef.wSrc, resizeRef.hSrc]
    const [wDst, hDst] = [16, 12]
    const dst = new Uint8Array(wDst * hDst)
    const sx = wSrc / wDst
    const sy = hSrc / hDst
    for (let y = 0; y < hDst; y += 1) {
      const fy = Math.min(hSrc - 1, Math.max(0, (y + 0.5) * sy - 0.5))
      const y0 = Math.floor(fy)
      const y1 = Math.min(hSrc - 1, y0 + 1)
      const wy = fy - y0
      for (let x = 0; x < wDst; x += 1) {
        const fx = Math.min(wSrc - 1, Math.max(0, (x + 0.5) * sx - 0.5))
        const x0 = Math.floor(fx)
        const x1 = Math.min(wSrc - 1, x0 + 1)
        const wx = fx - x0
        const p00 = src[y0 * wSrc + x0]
        const p01 = src[y0 * wSrc + x1]
        const p10 = src[y1 * wSrc + x0]
        const p11 = src[y1 * wSrc + x1]
        dst[y * wDst + x] = Math.round(
          (p00 * (1 - wx) + p01 * wx) * (1 - wy) + (p10 * (1 - wx) + p11 * wx) * wy
        )
      }
    }
    return dst
  })()
  const bad = maeOf(naive, ref)
  assert.ok(bad > 10, `反例应显著偏离基准，实际 MAE=${bad.toFixed(2)}`)
})

test('resizeGray 尺寸不变时保持原样', () => {
  const src = Uint8Array.from(resizeRef.src)
  const same = resizeGray(src, resizeRef.wSrc, resizeRef.hSrc, resizeRef.wSrc, resizeRef.hSrc, 'lanczos')
  assert.ok(maeOf(same, src) <= 0.01)
})

test('resizeGray 边界与异常输入', () => {
  const src = Uint8Array.from(resizeRef.src)
  // 目标尺寸为 0 → 空输出
  assert.equal(resizeGray(src, resizeRef.wSrc, resizeRef.hSrc, 0, 0, 'lanczos').length, 0)
  assert.equal(resizeGray(src, resizeRef.wSrc, resizeRef.hSrc, 8, 0, 'lanczos').length, 0)
  // 源尺寸为 0 → 没有可采样数据，返回全 0（正常管线不会出现）
  const noSrc = resizeGray(src, 0, 0, 4, 4, 'lanczos')
  assert.equal(noSrc.length, 16)
  assert.ok(noSrc.every((v) => v === 0))
  // 放大（scale < 1）也应有输出，且不越界
  const up = resizeGray(src, resizeRef.wSrc, resizeRef.hSrc, 64, 48, 'bilinear')
  assert.equal(up.length, 64 * 48)
  let mn = 255
  let mx = 0
  for (const v of up) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  assert.ok(mn >= 0 && mx <= 255)
})

// --- MFD（图文混排）纯函数：letterbox / NMS / 反 letterbox / 解码 ---
console.log('[mfd-core]')

test('letterbox 1544x310 目标(154,768) → canvas 768x154, r≈0.496774, pad l/t=0', () => {
  const w = 1544, h = 310;
  const rgb = new Uint8ClampedArray(w * h * 3); // 内容无关，仅校验几何
  const lb = letterbox(rgb, w, h, 154, 768);
  assert.equal(lb.cw, 768);
  assert.equal(lb.ch, 154);
  assert.ok(Math.abs(lb.r - 0.496774) < 1e-5, `r=${lb.r}`);
  assert.ok(lb.left === 0, `left=${lb.left}`);
  assert.ok(lb.top === 0, `top=${lb.top}`);
})

test('computeTarget/letterbox 正方形 500x500 longSide=768 保持比例且不裁切', () => {
  const w = 500, h = 500;
  const { newW, newH } = computeTarget(w, h, 768);
  assert.equal(newW, 768);
  assert.equal(newH, 768);
  const lb = letterbox(new Uint8ClampedArray(w * h * 3), w, h, newH, newW);
  assert.ok(lb.cw >= lb.unpadW);
  assert.ok(lb.ch >= lb.unpadH);
  const ar = lb.unpadW / lb.unpadH;
  assert.ok(Math.abs(ar - w / h) / (w / h) < 0.02, `aspect ${ar}`);
})

test('computeTarget/letterbox 超长竖图 200x1000 longSide=768 保持比例且不裁切', () => {
  const w = 200, h = 1000;
  const { newW, newH } = computeTarget(w, h, 768);
  assert.equal(newH, 768);
  assert.ok(newW > 0 && newW < 768, `newW=${newW}`);
  const lb = letterbox(new Uint8ClampedArray(w * h * 3), w, h, newH, newW);
  assert.ok(lb.cw >= lb.unpadW);
  assert.ok(lb.ch >= lb.unpadH);
  const ar = lb.unpadW / lb.unpadH;
  assert.ok(Math.abs(ar - w / h) / (w / h) < 0.02, `aspect ${ar}`);
})

function mkBox(x1, y1, x2, y2, score, cls) {
  return { x1, y1, x2, y2, score, cls };
}

test('NMS 同框同类高重叠 → 仅留 1 个', () => {
  const out = nms([mkBox(0, 0, 100, 100, 0.9, 0), mkBox(2, 2, 102, 102, 0.8, 0)], 0.7);
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 0.9);
})

test('NMS 不同类 → 两个都留', () => {
  const out = nms([mkBox(0, 0, 100, 100, 0.9, 0), mkBox(2, 2, 102, 102, 0.8, 1)], 0.7);
  assert.equal(out.length, 2);
})

test('NMS IoU 恰为阈值边界 → 保留（条件为 <=）', () => {
  const a = mkBox(0, 0, 100, 100, 0.9, 0);
  const b = mkBox(0, 0, 100, 70, 0.8, 0); // 与 a 的 IoU 精确为 0.7
  assert.ok(Math.abs(iou(a, b) - 0.7) < 1e-9, `iou=${iou(a, b)}`);
  const out = nms([a, b], 0.7);
  assert.equal(out.length, 2, '阈值边界(<=0.7)应保留');
})

test('inverseLetterbox 公式往返误差 ≤ 1px', () => {
  const lb = { r: 0.496774, left: 0, top: 0, unpadW: 767, unpadH: 154, cw: 768, ch: 154 };
  const orig = [626, 120, 1383, 182];
  const canvas = [orig[0] * lb.r + lb.left, orig[1] * lb.r + lb.top, orig[2] * lb.r + lb.left, orig[3] * lb.r + lb.top];
  const back = inverseLetterbox(canvas, lb);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(back[i] - orig[i]) <= 1, `dim ${i}: ${back[i]} vs ${orig[i]}`);
  }
})

test('letterbox + inverseLetterbox 真实往返', () => {
  const w = 1544, h = 310;
  const lb = letterbox(new Uint8ClampedArray(w * h * 3), w, h, 154, 768);
  const orig = [300, 80, 900, 200];
  const canvas = [orig[0] * lb.r + lb.left, orig[1] * lb.r + lb.top, orig[2] * lb.r + lb.left, orig[3] * lb.r + lb.top];
  const back = inverseLetterbox(canvas, lb);
  for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(back[i] - orig[i]) <= 1e-6);
})

test('decodeBoxes 解码 [1,4+nc,N] 并过滤低分/选取最佳类', () => {
  const N = 2, nc = 2;
  const data = new Float32Array((4 + nc) * N);
  const set = (c, i, v) => { data[c * N + i] = v; };
  set(0, 0, 10); set(1, 0, 10); set(2, 0, 20); set(3, 0, 20);
  set(4, 0, 0.9); set(5, 0, 0.1); // 候选0 → cls0
  set(0, 1, 50); set(1, 1, 50); set(2, 1, 10); set(3, 1, 10);
  set(4, 1, 0.1); set(5, 1, 0.3); // 候选1 → cls1 (0.3>0.25 保留)
  const cands = decodeBoxes({ dims: [1, 4 + nc, N], data }, 0.25);
  assert.equal(cands.length, 2);
  assert.equal(cands[0].cls, 0);
  assert.ok(Math.abs(cands[0].x1 - 0) < 1e-6);
  assert.equal(cands[1].cls, 1);
})

test('clampBoxPad 缺参/非有限值 → 0', () => {
  assert.equal(clampBoxPad(), 0);
  assert.equal(clampBoxPad(null), 0);
  assert.equal(clampBoxPad(undefined), 0);
  assert.equal(clampBoxPad('abc'), 0);
  assert.equal(clampBoxPad(NaN), 0);
  assert.equal(clampBoxPad(-5), 0);
})

test('clampBoxPad 正常裁剪与默认上限', () => {
  assert.equal(clampBoxPad(2), 2);
  assert.equal(clampBoxPad('12'), 12);
  assert.equal(clampBoxPad(7.6), 8);
  assert.equal(clampBoxPad(100), 40); // 超过默认上限 40 被夹住
  assert.equal(clampBoxPad(40), 40);
})

test('clampBoxPad 自定义上限', () => {
  assert.equal(clampBoxPad(39.4, 40), 39);
  assert.equal(clampBoxPad(100, 20), 20);
  assert.equal(clampBoxPad(-1, 10), 0);
})

// --- isTinyTextLatex：疑似普通文字（纯 1–2 字母/数字）判定 ---
test('isTinyTextLatex 单/双字母与去空格', () => {
  assert.equal(isTinyTextLatex('1'), true);
  assert.equal(isTinyTextLatex('ab'), true);
  assert.equal(isTinyTextLatex('a b'), true); // 去空格后 "ab"
})

test('isTinyTextLatex 含数学结构或非 1–2 字符 → false', () => {
  assert.equal(isTinyTextLatex('x^2'), false);
  assert.equal(isTinyTextLatex('\\alpha'), false);
  assert.equal(isTinyTextLatex('x_{i}'), false);
  assert.equal(isTinyTextLatex('Softmax'), false);
})

test('isTinyTextLatex 空值/空串 → false', () => {
  assert.equal(isTinyTextLatex(''), false);
  assert.equal(isTinyTextLatex(null), false);
  assert.equal(isTinyTextLatex(undefined), false);
})

// --- isTinyTextLatexLoose：剥离 LaTeX 装饰命令后的激进判定（仅 embedding 用） ---
// 设计边界：装饰命令（\boldsymbol/\text/\mathrm…）与花括号/首尾标点可剥；
// 符号命令（\alpha/\gamma/\bigwedge\varepsilon…）是内容不是装饰，剥离后仍含 \ → 保留
//（希腊符号在正文中的误检由 conf 0.55 检测侧拦截 + 手动排除兜底，不在此过度过滤）。
test('isTinyTextLatexLoose 装饰包裹的英文字母 → true', () => {
  assert.equal(isTinyTextLatexLoose('\\boldsymbol{x}'), true);
  assert.equal(isTinyTextLatexLoose('{\\boldsymbol{x}}'), true);
  assert.equal(isTinyTextLatexLoose('{\\text{ab}}'), true);
  assert.equal(isTinyTextLatexLoose('\\mathrm{f}.') , true);
  assert.equal(isTinyTextLatexLoose('x'), true);
})

test('isTinyTextLatexLoose 符号命令/真数学结构 → false（不误杀真公式）', () => {
  assert.equal(isTinyTextLatexLoose('{\\textstyle\\bigwedge}\\varepsilon'), false); // 符号命令是内容
  assert.equal(isTinyTextLatexLoose('{\\boldsymbol{\\gamma}},'), false);            // \gamma 保留
  assert.equal(isTinyTextLatexLoose('\\alpha'), false);
  assert.equal(isTinyTextLatexLoose('x^2'), false);              // 上下标
  assert.equal(isTinyTextLatexLoose('x_{i}'), false);
  assert.equal(isTinyTextLatexLoose('a=b'), false);              // 比较符
  assert.equal(isTinyTextLatexLoose('\\frac{a}{b}'), false);
  assert.equal(isTinyTextLatexLoose('Softmax'), false);          // 长词
  assert.equal(isTinyTextLatexLoose(''), false);
})

// --- isTrivialFormulaLatex：按框类型分档（isolated 保守 / embedding 激进） ---
test('isTrivialFormulaLatex isolated 保守 / embedding 激进', () => {
  assert.equal(isTrivialFormulaLatex('{\\boldsymbol{\\gamma}},', 'isolated'), false); // 独立框保守：字面正则不放过的都保留
  assert.equal(isTrivialFormulaLatex('{\\boldsymbol{\\gamma}},', 'embedding'), false);// 希腊符号命令是内容，保留
  assert.equal(isTrivialFormulaLatex('\\boldsymbol{x}', 'isolated'), false);          // 独立框不激进
  assert.equal(isTrivialFormulaLatex('\\boldsymbol{x}', 'embedding'), true);          // 行内装饰字母剔除
  assert.equal(isTrivialFormulaLatex('ab', 'isolated'), true);
  assert.equal(isTrivialFormulaLatex('ab', 'embedding'), true);
  assert.equal(isTrivialFormulaLatex('\\alpha', 'embedding'), false);
})

// ===== P2-9：formulaExport.js 置信度分级 / 导出构建 =====
import {
  formulaScoreLevel,
  buildFormulaTexExport,
  buildFormulaMdExport,
  buildHistoryExportText
} from '../src/lib/formulaExport.js'
import { gridToTsv, gridToCsv, gridToMarkdown } from '../src/lib/tableModel.js'

test('formulaScoreLevel 三档分级与无分数', () => {
  assert.deepEqual(formulaScoreLevel({ decodeScore: -0.0843 }), { label: '高', cls: 'conf-high', tip: '解码置信度 -0.084（高）' });
  assert.equal(formulaScoreLevel({ decodeScore: -0.35 }).label, '高');   // 边界含高
  assert.equal(formulaScoreLevel({ decodeScore: -0.36 }).label, '中');
  assert.equal(formulaScoreLevel({ decodeScore: -0.8 }).label, '中');    // 边界含中
  assert.equal(formulaScoreLevel({ decodeScore: -0.81 }).label, '低');
  assert.equal(formulaScoreLevel({ decodeScore: null }), null);
  assert.equal(formulaScoreLevel({}), null);
  assert.equal(formulaScoreLevel(undefined), null);
})

test('buildFormulaTexExport/MdExport 过滤排除与空值', () => {
  const items = [
    { latex: 'x^2', excluded: false },
    { latex: '  ', excluded: false },
    { latex: 'y=mx+b', excluded: true },
    { latex: '\\alpha', excluded: false }
  ];
  assert.equal(buildFormulaTexExport(items), 'x^2\n\n\\alpha');
  assert.equal(buildFormulaMdExport(items), '$$\nx^2\n$$\n\n$$\n\\alpha\n$$');
  assert.equal(buildFormulaTexExport([]), '');
})

test('buildHistoryExportText 拼接与空集', () => {
  const items = [
    { engine: 'formula', ts: 1, text: 'x=1' },
    { engine: 'wechat', ts: 2, text: '' }
  ];
  const out = buildHistoryExportText(items, {
    engineLabel: (i) => i.engine,
    formatTime: (ts) => `t${ts}`
  });
  assert.equal(out, '=== formula · t1 ===\nx=1\n\n=== wechat · t2 ===\n(未识别到文字)');
  assert.equal(buildHistoryExportText([], { engineLabel: () => '', formatTime: () => '' }), '');
})

test('gridToTsv/Csv/Markdown 序列化', () => {
  const grid = [['A', 'B'], ['1', 'x,y']];
  assert.equal(gridToTsv(grid), 'A\tB\n1\tx,y');
  assert.equal(gridToCsv(grid), 'A,B\n1,"x,y"');
  assert.equal(gridToMarkdown(grid), '| A | B |\n| --- | --- |\n| 1 | x,y |');
  assert.equal(gridToMarkdown([['h', 'a|b']]), '| h | a\\|b |\n| --- | --- |');
  assert.equal(gridToMarkdown([]), '');
  assert.equal(gridToMarkdown([[null, undefined]]).startsWith('|  |  |'), true);
})

// ===== 0.7.8：onnx_mixed_merge.mjs 混排去重（公式字形不再重复输出为文本） =====
import { splitLinePieces, mergeSegments } from '../bin/onnx_mixed_merge.mjs'

test('splitLinePieces 公式框外扩：边缘字符归公式不残留文本', () => {
  // 公式框 [14,26] 较窄；字符 c=[27,33] 中心 30 在原框外，但外扩 pad=3 后（[11,29]+1 容差）归入公式
  const chars = [
    { c: 'a', box: [0, 0, 8, 20] },
    { c: 'x', box: [12, 0, 28, 20] },
    { c: 'c', box: [27, 0, 33, 20] }
  ];
  const ti = { text: 'axc', box: [0, 0, 40, 20], chars };
  const formulas = [{ type: 'embedding', score: 1, latex: 'x', box: [14, 0, 26, 20] }];
  const pieces = splitLinePieces(ti, formulas);
  assert.ok(Array.isArray(pieces));
  assert.equal(pieces.filter((p) => p.kind === 'text').map((p) => p.text).join(''), 'a'); // 只有 'a' 留在文本
  assert.equal(pieces.filter((p) => p.kind === 'formula').length, 1);
})

test('splitLinePieces 无外扩时的旧行为对照（远离框的字符留在文本）', () => {
  const chars = [
    { c: 'a', box: [0, 0, 8, 20] },
    { c: 'x', box: [12, 0, 28, 20] },
    { c: 'z', box: [36, 0, 44, 20] }
  ];
  const ti = { text: 'axz', box: [0, 0, 50, 20], chars };
  const formulas = [{ type: 'embedding', score: 1, latex: 'x', box: [14, 0, 26, 20] }];
  const pieces = splitLinePieces(ti, formulas);
  assert.equal(pieces.filter((p) => p.kind === 'text').map((p) => p.text).join(''), 'az');
})

test('mergeSegments 降级去重：无 chars 且公式覆盖 ≥0.35 丢弃文本行', () => {
  const boxes = [{ type: 'embedding', score: 1, latex: 'x', box: [0, 0, 40, 20] }];
  const textLines = [{ text: 'abcdef', box: [0, 0, 100, 20] }];
  const { segments } = mergeSegments(boxes, textLines);
  assert.equal(segments.some((s) => s.type === 'text'), false); // 文本不重复出现
  assert.equal(segments.filter((s) => s.type === 'embedding').length, 1); // 公式保留
})

test('mergeSegments 降级保留：覆盖 <0.35 的正文行不丢', () => {
  const boxes = [{ type: 'embedding', score: 1, latex: 'x', box: [0, 0, 20, 20] }];
  const textLines = [{ text: 'abcdef', box: [0, 0, 100, 20] }];
  const { segments } = mergeSegments(boxes, textLines);
  const textSegs = segments.filter((s) => s.type === 'text');
  assert.equal(textSegs.length, 1);
  assert.equal(textSegs[0].text, 'abcdef');
})

test('mergeSegments isolated IoU 丢弃规则保持', () => {
  const boxes = [{ type: 'isolated', score: 1, latex: 'y', box: [10, 0, 90, 20] }];
  const textLines = [{ text: 'formula line', box: [10, 0, 90, 20] }];
  const { segments } = mergeSegments(boxes, textLines);
  assert.equal(segments.some((s) => s.type === 'text'), false);
  assert.equal(segments.filter((s) => s.type === 'isolated').length, 1);
})

// ===== 0.7.13：降级丢弃分类型阈值（isolated 0.2 / embedding 0.35）+ warning 透传 =====
test('mergeSegments 降级丢弃 isolated 阈值降到 0.2', () => {
  // 几何约束：IoU 必须 ≤0.1（否则在规则2 就被丢，测不到降级路径）——公式框比文本行矮，
  // 垂直只盖住行下半部：cover=0.24 ≥0.2（isolated 新阈值）且 IoU≈0.06
  const boxes = [{ type: 'isolated', score: 1, latex: 'x', box: [0, 15, 60, 21] }];
  const textLines = [{ text: 'e1+1=0', box: [0, 0, 250, 20] }];
  const warnings = [];
  const { segments } = mergeSegments(boxes, textLines, warnings);
  assert.equal(segments.some((s) => s.type === 'text'), false);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('e1+1=0'));
})

test('mergeSegments 降级丢弃 embedding 保持 0.35 阈值', () => {
  const boxes = [{ type: 'embedding', score: 1, latex: 'x', box: [0, 0, 25, 20] }];
  const textLines = [{ text: 'abcdef', box: [0, 0, 100, 20] }];
  const { segments } = mergeSegments(boxes, textLines);
  assert.equal(segments.filter((s) => s.type === 'text').length, 1); // 覆盖 0.25 < 0.35，正文保留
})

test('mergeSegments 降级丢弃要求垂直重叠 >0.5', () => {
  // 公式框在文本行上方（仅边缘相切），不算同一视觉行，不丢弃
  const boxes = [{ type: 'isolated', score: 1, latex: 'x', box: [0, -20, 25, 0] }];
  const textLines = [{ text: 'abcdef', box: [0, 0, 100, 20] }];
  const { segments } = mergeSegments(boxes, textLines);
  assert.equal(segments.filter((s) => s.type === 'text').length, 1);
})

// ===== 0.7.14：filterCjkFormulaBoxes —— MFD 正文误检框（框内 CJK ≥2）剔除 =====
import { filterCjkFormulaBoxes } from '../bin/onnx_mixed_merge.mjs'

test('filterCjkFormulaBoxes 丢弃套在中文正文上的误检框', () => {
  // 正文行「五个最基本的常数」，误检框套住「五个」两字
  const boxes = [{ type: 'embedding', score: 0.58, box: [137, 128, 309, 156] }];
  const textLines = [{
    text: '五个最基本的数学常数',
    box: [136, 129, 400, 164],
    chars: [
      { c: '五', box: [140, 130, 160, 160] },
      { c: '个', box: [162, 130, 182, 160] },
      { c: 'a', box: [200, 132, 215, 158] }
    ]
  }];
  const warnings = [];
  const kept = filterCjkFormulaBoxes(boxes, textLines, warnings);
  assert.equal(kept.length, 0);
  assert.ok(warnings[0].includes('CJK'), '应输出丢弃警告');
})

test('filterCjkFormulaBoxes 保留真实公式框（框内无 CJK）', () => {
  const boxes = [{ type: 'embedding', score: 0.87, box: [135, 47, 309, 95] }];
  const textLines = [{
    text: 'e^{i\\pi}+1=0',
    box: [138, 54, 308, 90],
    chars: [
      { c: 'e', box: [140, 60, 160, 90] },
      { c: '=', box: [230, 62, 250, 88] },
      { c: '0', box: [280, 62, 300, 88] }
    ]
  }];
  const kept = filterCjkFormulaBoxes(boxes, textLines, []);
  assert.equal(kept.length, 1);
})

test('filterCjkFormulaBoxes 仅 1 个 CJK（边缘裁切）时保留', () => {
  const boxes = [{ type: 'embedding', score: 0.8, box: [190, 120, 320, 160] }];
  const textLines = [{
    text: 'x式',
    box: [136, 129, 400, 164],
    chars: [
      { c: 'x', box: [140, 130, 180, 160] },
      { c: '式', box: [200, 130, 240, 160] }
    ]
  }];
  assert.equal(filterCjkFormulaBoxes(boxes, textLines, []).length, 1);
})

test('filterCjkFormulaBoxes 无逐字符框时跳过过滤', () => {
  const boxes = [{ type: 'embedding', score: 0.58, box: [137, 128, 309, 156] }];
  const textLines = [{ text: '五个最基本的数学常数', box: [136, 129, 400, 164] }];
  assert.equal(filterCjkFormulaBoxes(boxes, textLines, []).length, 1);
  assert.equal(filterCjkFormulaBoxes(boxes, [], []).length, 1);
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
