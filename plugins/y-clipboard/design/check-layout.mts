/**
 * 动态行高度量回归测试
 *   node --experimental-strip-types design/check-layout.mts
 *
 * 覆盖两件事（虚拟化滚动正确性的基础）：
 *   1. rowHeightOf 的比例换算与限幅是否符合预期
 *   2. 前缀和 + 二分查找能否准确定位任意偏移所在的行
 */
import { IMG_SCALES, imageRatio, maxHeightOf, rowHeightOf, ROW_GAP, type ImgScale } from '../src/utils/layout.ts'
import type { ClipboardRecord, ItemKind } from '../src/types.ts'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        期望 ${expected}，实际 ${actual}`)
  ok ? pass++ : fail++
}

function rec(kind: ItemKind, resolution?: string): ClipboardRecord {
  return {
    id: 'x', kind, rawType: kind, content: 'x',
    resolution, createdAt: 0
  }
}

const W = 600 // 典型插件窗口宽度
const H = 600 // 典型插件窗口高度

console.log('\n--- 宽高比解析 ---')
check('512 * 512 → 1', imageRatio(rec('image', '512 * 512')), 1)
check('1080 * 1920 → 0.5625', imageRatio(rec('image', '1080 * 1920')), 0.5625)
check('2560 * 720 → 3.5556', +imageRatio(rec('image', '2560 * 720')).toFixed(4), 3.5556)
check('无 resolution 时兜底 1.5', imageRatio(rec('image')), 1.5)
check('非法 resolution 兜底 1.5', imageRatio(rec('image', 'abc')), 1.5)

console.log('\n--- 行高：文本类恒定 ---')
const rowText = rowHeightOf(rec('text'), W, 'md')
check('文本行 = 72 + 间距', rowText, 72 + ROW_GAP)
check('链接行与文本行等高', rowHeightOf(rec('link'), W, 'lg'), rowText)

console.log('\n--- 行高：图片按档位限幅 ---')
const avail = W - 40
const maxMd = maxHeightOf('md', H)

// 竖图：真实换算 995px，远超上限 → 必须被 max 截住
const tallH = rowHeightOf(rec('image', '1080 * 1920'), W, 'md')
check(`竖图 md 被上限截住（期望 ${maxMd + ROW_GAP}）`, tallH, maxMd + ROW_GAP)
check('竖图 sm 更小', rowHeightOf(rec('image', '1080 * 1920'), W, 'sm') < tallH, true)
check('竖图 lg 更大', rowHeightOf(rec('image', '1080 * 1920'), W, 'lg') > tallH, true)

// 超宽图：真实换算 157px，落在 [min,max] 内 → 应如实反映比例
const wideH = rowHeightOf(rec('image', '2560 * 720'), W, 'md')
const wideExpect = Math.round(avail / (2560 / 720)) + ROW_GAP
check(`超宽图 md 按比例（期望 ${wideExpect}）`, wideH, wideExpect)

// 方图：换算后超过上限 → 截到 max
check(
  `方图 md 被上限截住（期望 ${maxMd + ROW_GAP}）`,
  rowHeightOf(rec('image', '512 * 512'), W, 'md'),
  maxMd + ROW_GAP
)

// 宽图在宽容器里应当撑到接近满宽（不能出现大片留白）
const wideFillH = rowHeightOf(rec('image', '2560 * 720'), 1000, 'md') - ROW_GAP
check('超宽图不被上限截断（宽度决定高度）', wideFillH, Math.round((1000 - 40) / (2560 / 720)))

console.log('\n--- 高度上限随视口高度自适应 ---')
check('小窗口上限更小', maxHeightOf('md', 400) < maxHeightOf('md', 900), true)
check('大窗口被 hardMax 截住', maxHeightOf('md', 3000), IMG_SCALES.md.hardMax)
check('极小视口上限不低于 min', maxHeightOf('md', 10), IMG_SCALES.md.min)
check(
  '小窗口竖图 ≤ 视口 55%',
  rowHeightOf(rec('image', '1080 * 1920'), 600, 'md', 400) - ROW_GAP <= 400 * 0.55 + 0.5,
  true
)
check(
  '大窗口竖图更大',
  rowHeightOf(rec('image', '1080 * 1920'), 600, 'md', 900) >
    rowHeightOf(rec('image', '1080 * 1920'), 600, 'md', 400),
  true
)

console.log('\n--- 档位边界：不得越界 ---')
for (const scale of ['sm', 'md', 'lg'] as ImgScale[]) {
  const min = IMG_SCALES[scale].min
  const max = maxHeightOf(scale, H)
  const kinds = ['512 * 512', '1080 * 1920', '2560 * 720', '100 * 2000', '4000 * 30']
  let ok = true
  for (const res of kinds) {
    const h = rowHeightOf(rec('image', res), W, scale, H) - ROW_GAP
    if (h < min || h > max) ok = false
  }
  check(`${scale} 档所有形态都落在 [${min}, ${max}]`, ok, true)
}

console.log('\n--- 虚拟滚动：前缀和 + 二分定位 ---')

function build(items: ClipboardRecord[], width: number, scale: ImgScale) {
  const heights = items.map((r) => rowHeightOf(r, width, scale))
  const offsets = new Array<number>(heights.length + 1)
  offsets[0] = 0
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i]
  return { heights, offsets, total: offsets[heights.length] }
}

function indexAt(offsets: number[], n: number, y: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

// 混合队列：文本行与各种比例的图片行交错
const mixed: ClipboardRecord[] = []
const patterns: Array<[ItemKind, string | undefined]> = [
  ['text', undefined],
  ['image', '512 * 512'],
  ['code', undefined],
  ['image', '1080 * 1920'],
  ['image', '2560 * 720'],
  ['link', undefined],
  ['image', undefined],
  ['file', undefined],
  ['image', '800 * 600'],
  ['text', undefined]
]
for (let i = 0; i < 30; i++) {
  const [kind, res] = patterns[i % patterns.length]
  mixed.push({ ...rec(kind, res), id: 'r' + i })
}

const { offsets, heights, total } = build(mixed, W, 'md')

check('总数与队列长度一致', offsets.length, mixed.length + 1)
check('总高 = 各行高之和', total, heights.reduce((a, b) => a + b, 0))
check('前缀和单调不减', offsets.every((v, i) => i === 0 || v >= offsets[i - 1]), true)

// 每行起点必须精确定位到本行
let startOk = true
let midOk = true
let endOk = true
for (let i = 0; i < mixed.length; i++) {
  if (indexAt(offsets, mixed.length, offsets[i]) !== i) startOk = false
  const mid = offsets[i] + heights[i] / 2
  if (indexAt(offsets, mixed.length, mid) !== i) midOk = false
  if (indexAt(offsets, mixed.length, offsets[i + 1] - 1) !== i) endOk = false
}
check('行顶部 → 命中该行', startOk, true)
check('行中部 → 命中该行', midOk, true)
check('行尾部前一像素 → 命中该行', endOk, true)

check('偏移 0 → 第 0 行', indexAt(offsets, mixed.length, 0), 0)
// 越过末尾时返回 n 作为"越界哨兵"，由调用方用 Math.min 收敛为最后一行
check('偏移超出末尾 → 哨兵 n', indexAt(offsets, mixed.length, total + 999), mixed.length)

const sentinel = indexAt(offsets, mixed.length, total + 999)
const lastClamped = Math.min(mixed.length, sentinel + 4 + 1)
check('调用方收敛后不越界', lastClamped <= mixed.length, true)
check('哨兵越界时不产生多余行', sentinel - Math.min(mixed.length, sentinel + 5), 0)

// 可见区间必须连续覆盖，不留缝隙、不重叠
let coverOk = true
for (let step = 0; step < total; step += 17) {
  const first = Math.max(0, indexAt(offsets, mixed.length, step) - 4)
  const last = Math.min(mixed.length, indexAt(offsets, mixed.length, step + 400) + 5)
  if (first > last || first < 0 || last > mixed.length) coverOk = false
  // 窗口起始位置不能落后于视口顶部太多
  if (offsets[first] > step && first > 0) coverOk = false
}
check('任意滚动位置的窗口区间合法', coverOk, true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
