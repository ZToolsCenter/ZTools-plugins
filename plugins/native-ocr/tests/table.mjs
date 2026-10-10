// 表格切列 + 网格序列化回归测试 —— node tests/table.mjs
//
// 覆盖：
//   bin/onnx_table_split.mjs  planTableSplits —— 此前完全没有单测，是本 bug 长期未发现的原因
//   src/lib/tableModel.js     gridToTsv / gridToMarkdown
//
// 全部使用合成数据（Uint8Array 手工画图），不依赖真实图片与 ONNX 模型文件，
// 因此可以在干净环境直接跑。
import assert from 'node:assert/strict'
import { planTableSplits } from '../bin/onnx_table_split.mjs'
import {
  buildGrid,
  clusterTable,
  extractCells,
  gridToCsv,
  gridToMarkdown,
  gridToTsv
} from '../src/lib/tableModel.js'

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

// ---------------------------------------------------------------------------
// 合成裁剪图工具
// ---------------------------------------------------------------------------

// 白底 RGBA 图；rects 为半开区间矩形 {x0,x1,y0,y1}（像素），命中处涂黑。
function makeImageRaw(width, height, rects = []) {
  const data = new Uint8Array(width * height * 4).fill(255)
  for (const r of rects) {
    for (let y = Math.max(0, r.y0); y < Math.min(height, r.y1); y += 1) {
      for (let x = Math.max(0, r.x0); x < Math.min(width, r.x1); x += 1) {
        const i = (y * width + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
      }
    }
  }
  return { data, width, height }
}

const makeImage = (args) => ({ data: args.data, width: args.width, height: args.height })

// 源图像素坐标 polygon box（左上原点），与 server 协议一致
function pxBox(left, top, w, h) {
  return [[left, top], [left + w, top], [left + w, top + h], [left, top + h]]
}

// 一「行」= { image, box }，形状与 Detection.run 输出一致
function rowLine(image, box) {
  return { image, box }
}

const CROP_W = 300
const CROP_H = 40
const SRC_W = 1000
const TEXT_Y0 = 8
const TEXT_Y1 = 32 // 文字块高 24/40 = 0.6，既不构成空白带，也不构成竖线峰

// 竖线（贯穿整行高）与文字块的列布局
const LAYOUT_WIRED = [ // 有线表格：仅靠竖线分隔，无空白带
  [2, 94], [104, 194], [204, 298]
]
const LAYOUT_BLANK = [ // 无框线表格：靠 20px 空白带分隔
  [0, 90], [110, 200], [220, 300]
]

function cropWithLayout(cells, lines = []) {
  const rects = cells.map(([x0, x1]) => ({ x0, x1, y0: TEXT_Y0, y1: TEXT_Y1 }))
  for (const x of lines) rects.push({ x0: x, x1: x + 3, y0: 0, y1: CROP_H })
  return makeImageRaw(CROP_W, CROP_H, rects)
}

function buildRows(count, { cells = LAYOUT_WIRED, lines = [], extra = null } = {}) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const image = i === 0 && extra ? extra : cropWithLayout(cells, lines)
    rows.push(rowLine(image, pxBox(50, i * 60, CROP_W, CROP_H)))
  }
  return rows
}

// 取子段 box 的左右 x（subPolygon 输出为 4 点多边形）
const spanOf = (box) => [box[0][0], box[1][0]]

// ---------------------------------------------------------------------------
// planTableSplits：有线表格（有竖线、无空白带）—— 本次新增能力
// ---------------------------------------------------------------------------

console.log('[planTableSplits]')

test('有线表格（3 行 / 2 条竖线 / 无空白带）→ 切成 3 列', () => {
  const rows = buildRows(3, { lines: [98, 198] })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 9, '3 行 × 3 列')
  assert.equal(plan.boxes.length, 9)
  const spans = plan.boxes.map(spanOf)
  // 第 0 行：竖线中心在 99 / 199（crop 坐标）→ 源图 x = 50 + cropX
  assert.deepEqual(spans.slice(0, 3), [[50, 149], [149, 249], [249, 350]])
  // 每一行的切分位置一致
  assert.deepEqual(spans.slice(3, 6), spans.slice(0, 3))
  assert.deepEqual(spans.slice(6, 9), spans.slice(0, 3))
})

test('回归：无框线表格（3 行 / 20px 空白带）切分与改动前一致', () => {
  // 该样例不存在竖线峰（所有文字块暗占比 0.6 < 0.85），因此候选集合与改动前
  // 完全相同（只有空白带中心）；行块 3 行 → supportMin 仍为 3。
  const rows = buildRows(3, { cells: LAYOUT_BLANK })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 9)
  // 空白带中心 99.5 / 209.5 → round 后 100 / 210（旧实现即如此）
  assert.deepEqual(plan.boxes.map(spanOf).slice(0, 3), [[50, 150], [150, 260], [260, 350]])
  assert.deepEqual(plan.boxes.map(spanOf).slice(3, 6), [[50, 150], [150, 260], [260, 350]])
})

test('只有 2 行内容的有线表格 → 能切（GROUP_MIN 放宽到 2 的新能力）', () => {
  const rows = buildRows(2, { lines: [98, 198] })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 6, '2 行 × 3 列')
  assert.deepEqual(plan.boxes.map(spanOf).slice(0, 3), [[50, 149], [149, 249], [249, 350]])
})

test('只有 2 行内容的无框线表格 → 能切', () => {
  const rows = buildRows(2, { cells: LAYOUT_BLANK })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 6)
  assert.deepEqual(plan.boxes.map(spanOf).slice(0, 3), [[50, 150], [150, 260], [260, 350]])
})

test('单行（无法投票）保守不切，不抛错', () => {
  const rows = buildRows(1, { lines: [98, 198] })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 1)
  assert.deepEqual(plan.boxes[0], rows[0].box)
})

// ---------------------------------------------------------------------------
// planTableSplits：保守性（没有分隔特征就不切）
// ---------------------------------------------------------------------------

test('完全无分隔特征（整行均匀文字）→ 不切，不抛错', () => {
  const rows = buildRows(3, { cells: [[0, 300]] })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 3, '仍按 3 行原样输出')
  for (let i = 0; i < 3; i += 1) assert.deepEqual(plan.boxes[i], rows[i].box)
})

test('全黑裁剪图（整列暗占比 1.0）视为实心块，不切', () => {
  const rows = buildRows(3, { cells: [[0, 300]], extra: makeImageRaw(CROP_W, CROP_H, [{ x0: 0, x1: CROP_W, y0: 0, y1: CROP_H }]) })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 3)
})

test('仅 1 行存在汉字竖笔画 → 投票不足，不切（不误切）', () => {
  // 第 0 行有一条贯穿 95% 行高、宽 2px 的竖笔画（会通过竖线峰的全部判据），
  // 但另外两行没有 → 只有 1 票 < supportMin(3) → 不切。
  const stroke = makeImageRaw(CROP_W, CROP_H, [
    { x0: 0, x1: CROP_W, y0: TEXT_Y0, y1: TEXT_Y1 },
    { x0: 149, x1: 151, y0: 1, y1: CROP_H - 1 }
  ])
  const rows = buildRows(3, { cells: [[0, 300]], extra: stroke })
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, sourceHeight: 300, makeImage })
  assert.equal(plan.images.length, 3)
})

test('空输入 / 非法输入不抛错', () => {
  const empty = planTableSplits([], { sourceWidth: SRC_W, makeImage })
  assert.deepEqual(empty, { images: [], boxes: [] })
  assert.deepEqual(planTableSplits(undefined, { sourceWidth: SRC_W, makeImage }), { images: [], boxes: [] })
  assert.deepEqual(planTableSplits(null, {}), { images: [], boxes: [] })
  // 无 sourceWidth（tol = 0）→ 不做任何行块判定，原样返回
  const rows = buildRows(3, { lines: [98, 198] })
  const noTol = planTableSplits(rows, { sourceWidth: 0, makeImage })
  assert.equal(noTol.images.length, 3)
})

test('非宽行（aspect < 3）不参与切列', () => {
  // 裁剪图 60×40 → aspect 1.5 < 3（aspect 取自裁剪图尺寸）。图内本身有两条可命中的
  // 竖线，若没有 ASPECT_MIN 这一关就会被切成 3 段，据此证明是 aspect 挡住的。
  const narrow = makeImageRaw(60, CROP_H, [
    { x0: 0, x1: 60, y0: TEXT_Y0, y1: TEXT_Y1 },
    { x0: 10, x1: 13, y0: 0, y1: CROP_H },
    { x0: 40, x1: 43, y0: 0, y1: CROP_H }
  ])
  const rows = [0, 1, 2].map((i) => rowLine(narrow, pxBox(50, i * 60, CROP_W, CROP_H)))
  const plan = planTableSplits(rows, { sourceWidth: SRC_W, makeImage })
  assert.equal(plan.images.length, 3)
})

// ---------------------------------------------------------------------------
// gridToTsv：制表符/换行转义
// ---------------------------------------------------------------------------

console.log('[gridToTsv]')

test('多行表格正常输出不变', () => {
  const grid = [['A', 'B'], ['1', 'x,y']]
  assert.equal(gridToTsv(grid), 'A\tB\n1\tx,y')
})

test('单元格含制表符 → 不破坏列结构', () => {
  const grid = [['a\tb', 'c'], ['d', 'e']]
  const out = gridToTsv(grid)
  const lines = out.split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].split('\t').length, 2)
  assert.equal(lines[0], 'a b\tc')
})

test('单元格含换行 → 不破坏行/列结构（可回读）', () => {
  const grid = [['a\nb', 'c'], ['d', 'e\r\nf']]
  const out = gridToTsv(grid)
  const lines = out.split('\n')
  assert.equal(lines.length, 2, '换行被压成空格，行数仍为 2')
  for (const line of lines) assert.equal(line.split('\t').length, 2)
  assert.equal(lines[0], 'a b\tc')
  assert.equal(lines[1], 'd\te f')
})

test('含分隔符的表格 round-trip 列数稳定', () => {
  const grid = [['x\ty', '1\n2'], ['', 'ok']]
  const rowsBack = gridToTsv(grid).split('\n').map((line) => line.split('\t'))
  assert.equal(rowsBack.length, 2)
  assert.deepEqual(rowsBack.map((r) => r.length), [2, 2])
})

test('null / undefined 单元格仍为空串', () => {
  assert.equal(gridToTsv([[null, undefined]]), '\t')
  assert.equal(gridToTsv([]), '')
  assert.equal(gridToTsv(undefined), '')
})

// ---------------------------------------------------------------------------
// gridToMarkdown：单行表格不再丢表体
// ---------------------------------------------------------------------------

console.log('[gridToMarkdown]')

test('多行表格输出逐字不变', () => {
  assert.equal(
    gridToMarkdown([['A', 'B'], ['1', 'x,y']]),
    '| A | B |\n| --- | --- |\n| 1 | x,y |'
  )
  assert.equal(gridToMarkdown([['h', 'a|b'], ['v', 'w']]), '| h | a\\|b |\n| --- | --- |\n| v | w |')
})

test('单行表格：空表头 + 数据行（内容不丢失）', () => {
  assert.equal(
    gridToMarkdown([['h', 'a|b']]),
    '|  |  |\n| --- | --- |\n| h | a\\|b |'
  )
})

test('单行单列 / 单行空值', () => {
  assert.equal(gridToMarkdown([['x']]), '|  |\n| --- |\n| x |')
  assert.equal(gridToMarkdown([[null, undefined]]), '|  |  |\n| --- | --- |\n|  |  |')
  assert.ok(gridToMarkdown([[null, undefined]]).startsWith('|  |  |'))
})

test('单行表格的每个数据行内容都出现在输出里', () => {
  const out = gridToMarkdown([['张三', '25', '北京']])
  for (const text of ['张三', '25', '北京']) assert.ok(out.includes(text), `缺少 ${text}`)
  assert.equal(out.split('\n').length, 3, '表头行 + 分隔行 + 数据行')
})

test('单行表格经 buildGrid → gridToMarkdown 不丢内容（端到端）', () => {
  // 真实路径：一格一行、无列分隔线 → buildGrid 得到 1×3 网格
  const lines = [
    { text: '姓名', box: { x: 0.1, y: 0.5, w: 0.1, h: 0.1 } },
    { text: '年龄', box: { x: 0.4, y: 0.5, w: 0.1, h: 0.1 } },
    { text: '城市', box: { x: 0.7, y: 0.5, w: 0.1, h: 0.1 } }
  ]
  const { grid } = buildGrid(extractCells(lines), [], [0.3, 0.6])
  assert.deepEqual(grid, [['姓名', '年龄', '城市']])
  const md = gridToMarkdown(grid)
  for (const text of ['姓名', '年龄', '城市']) assert.ok(md.includes(text), `缺少 ${text}`)
})

test('空网格 / 非法网格仍返回空串', () => {
  assert.equal(gridToMarkdown([]), '')
  assert.equal(gridToMarkdown(undefined), '')
  assert.equal(gridToMarkdown([[], null]), '')
})

// ---------------------------------------------------------------------------
// 序列化一致性：TSV / CSV / Markdown 对多行网格的列数一致
// ---------------------------------------------------------------------------

test('多行网格三种序列化的列数一致', () => {
  const grid = [['A', 'B', 'C'], ['1', '2', '3']]
  assert.equal(gridToTsv(grid).split('\n').length, 2)
  assert.equal(gridToCsv(grid).split('\n').length, 2)
  assert.equal(gridToMarkdown(grid).split('\n').length, 3) // 含表头分隔行
  // clusterTable 的网格也走同一条路径
  const { grid: auto } = clusterTable([
    { text: 'A', box: { x: 0.1, y: 0.5, w: 0.1, h: 0.1 } },
    { text: 'B', box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }
  ])
  assert.equal(gridToTsv(auto).split('\n').length, 1)
  assert.equal(gridToMarkdown(auto).split('\n').length, 3)
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exitCode = failed ? 1 : 0
