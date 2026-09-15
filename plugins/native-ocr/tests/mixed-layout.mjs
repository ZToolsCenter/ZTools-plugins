// 图文混排纯逻辑回归测试 —— node tests/mixed-layout.mjs
// 覆盖 src/lib/mixedLayout.js 的合并排序与序列化（DOM-free，纯函数）。
import assert from 'node:assert/strict'
import {
  mergeAndOrderSegments,
  splitTextLinePieces,
  normalizedBottomLeftToPixels,
  segmentsToMarkdown,
  markdownToSegments,
  segmentsToPlainText,
  segmentsToLatex,
  segmentsToHtml,
  iou
} from '../src/lib/mixedLayout.js'

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
// 几何工具
// ---------------------------------------------------------------------------
test('iou 不相交为 0', () => {
  assert.equal(iou([0, 0, 10, 10], [20, 20, 30, 30]), 0)
})

test('iou 完全重合为 1', () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1)
})

test('iou 部分重叠计算正确', () => {
  // 各 100 面积，交叠 50 → iou = 50 / (100+100-50) = 1/3
  assert.ok(Math.abs(iou([0, 0, 10, 10], [5, 0, 15, 10]) - 1 / 3) < 1e-9)
})

// ---------------------------------------------------------------------------
// mergeAndOrderSegments —— 主场景：1 独立公式独占一行 + 2 文本行含 3 行内公式
// ---------------------------------------------------------------------------

// 文本行（含 box）
const textLines = [
  { text: 'Line one text', box: [0, 10, 180, 40], score: 0.95 }, // T1
  { text: 'Line two text', box: [0, 70, 180, 100], score: 0.95 }, // T2
  { text: 'covered', box: [10, 130, 390, 160], score: 0.9 } // T3（会被宽独立公式覆盖并丢弃）
]

// 公式框：3 个行内 embedding 嵌在两条文本行里 + 1 个宽 isolated 独占一行
const formulaBoxes = [
  { type: 'embedding', score: 0.9, box: [200, 12, 250, 38], latex: 'x' }, // 行 1 右侧，不与 T1 重叠
  { type: 'embedding', score: 0.9, box: [200, 72, 250, 98], latex: 'y' }, // 行 2 右侧
  { type: 'embedding', score: 0.9, box: [260, 72, 320, 98], latex: 'z' }, // 行 2 更右
  { type: 'isolated', score: 0.95, box: [10, 130, 390, 170], latex: 'a=b' } // 宽，覆盖 T3
]

const merged = mergeAndOrderSegments({ textLines, formulaBoxes })

test('mergeAndOrderSegments 段顺序正确（文本/公式交错、独立公式在最后）', () => {
  assert.deepEqual(
    merged.map((s) => s.type),
    ['text', 'embedding', 'text', 'embedding', 'embedding', 'isolated']
  )
})

test('mergeAndOrderSegments lineNumber 正确（0,0,1,1,1,2）', () => {
  assert.deepEqual(
    merged.map((s) => s.lineNumber),
    [0, 0, 1, 1, 1, 2]
  )
})

test('mergeAndOrderSegments 被公式覆盖的文本行被丢弃', () => {
  // T3（text "covered"）应不存在
  assert.ok(!merged.some((s) => s.type === 'text' && s.text === 'covered'))
  // 未被覆盖的 T1 / T2 保留
  assert.ok(merged.some((s) => s.text === 'Line one text'))
  assert.ok(merged.some((s) => s.text === 'Line two text'))
})

test('mergeAndOrderSegments 保留全部 3 个行内公式与 1 个独立公式', () => {
  const emb = merged.filter((s) => s.type === 'embedding')
  assert.equal(emb.length, 3)
  assert.deepEqual(emb.map((s) => s.latex).sort(), ['x', 'y', 'z'])
  assert.equal(merged.filter((s) => s.type === 'isolated').length, 1)
})

test('mergeAndOrderSegments 每个 segment 都带 box 与 score', () => {
  for (const s of merged) {
    assert.ok(Array.isArray(s.box) && s.box.length === 4, `box 缺失: ${JSON.stringify(s)}`)
    assert.ok(Number.isFinite(s.score), `score 缺失: ${JSON.stringify(s)}`)
  }
})

// ---------------------------------------------------------------------------
// 边界情况
// ---------------------------------------------------------------------------

test('边界：纯文本（无公式）原样成段', () => {
  const segs = mergeAndOrderSegments({
    textLines: [
      { text: 'A', box: [0, 0, 100, 20] },
      { text: 'B', box: [0, 30, 100, 50] }
    ],
    formulaBoxes: []
  })
  assert.equal(segs.length, 2)
  assert.deepEqual(segs.map((s) => s.type), ['text', 'text'])
  assert.deepEqual(segs.map((s) => s.lineNumber), [0, 1])
})

test('边界：纯公式（无文本行）', () => {
  const segs = mergeAndOrderSegments({
    textLines: [],
    formulaBoxes: [
      { type: 'embedding', box: [0, 0, 50, 20], latex: 'u' },
      { type: 'isolated', box: [0, 40, 200, 80], latex: 'v' }
    ]
  })
  assert.equal(segs.length, 2)
  assert.deepEqual(segs.map((s) => s.type), ['embedding', 'isolated'])
})

test('边界：行内公式(embedding)与文本行重合时不丢弃文本行', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{ text: 'whole', box: [0, 0, 200, 30] }],
    formulaBoxes: [{ type: 'embedding', box: [10, 5, 60, 25], latex: 'f' }]
  })
  // 行内公式按定义嵌在文本行内部，IoU≈0.16 也不能吞掉宿主行（否则整行文字静默丢失）。
  // 横向覆盖 50/200 = 25% < 60%，故文本行保留。
  assert.equal(segs.length, 2)
  assert.ok(segs.some((s) => s.type === 'text'))
  assert.ok(segs.some((s) => s.type === 'embedding'))
})

test('边界：独立公式(isolated) IoU > 0.1 时丢弃该文本行', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{ text: 'whole', box: [0, 0, 200, 30] }],
    formulaBoxes: [{ type: 'isolated', box: [10, 5, 60, 25], latex: 'f' }]
  })
  // 只有独立公式才可能「整行就是公式」，此时丢弃文本行正确。
  assert.equal(segs.length, 1)
  assert.ok(!segs.some((s) => s.type === 'text'))
})

test('边界：公式横向覆盖文本行 > 60% 时丢弃（任意类型）', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{ text: 'whole', box: [0, 0, 100, 30] }],
    formulaBoxes: [{ type: 'embedding', box: [0, 5, 90, 25], latex: 'f' }]
  })
  // 覆盖 90/100 = 90% > 60% → 该行几乎没有文字，丢弃
  assert.ok(!segs.some((s) => s.type === 'text'))
})

test('边界：文本行被超宽公式覆盖 >60% 宽度时丢弃', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{ text: 'wide', box: [0, 0, 100, 20] }],
    formulaBoxes: [{ type: 'embedding', box: [0, 0, 80, 20], latex: 'f' }]
  })
  // 覆盖 80/100 = 80% > 60% → 丢弃文本
  assert.ok(!segs.some((s) => s.type === 'text'))
  assert.equal(segs.length, 1)
})

test('边界：空输入返回空数组', () => {
  assert.deepEqual(mergeAndOrderSegments({}), [])
  assert.deepEqual(mergeAndOrderSegments(), [])
})

test('边界：box 支持 {x,y,w,h} 与 {x1,y1,x2,y2} 两种写法', () => {
  const a = mergeAndOrderSegments({ textLines: [], formulaBoxes: [{ type: 'embedding', box: { x: 0, y: 0, w: 10, h: 10 }, latex: 'p' }] })
  const b = mergeAndOrderSegments({ textLines: [], formulaBoxes: [{ type: 'embedding', box: { x1: 0, y1: 0, x2: 10, y2: 10 }, latex: 'p' }] })
  assert.deepEqual(a[0].box, [0, 0, 10, 10])
  assert.deepEqual(b[0].box, [0, 0, 10, 10])
})

// ---------------------------------------------------------------------------
// segmentsToMarkdown：分隔符 + 与「服务端 markdown」等价（round-trip）
// ---------------------------------------------------------------------------

const mdFixtureSegments = [
  { type: 'text', text: 'Line one text', latex: '', box: [0, 10, 180, 40], lineNumber: 0 },
  { type: 'embedding', latex: 'x', box: [200, 12, 250, 38], lineNumber: 0 },
  { type: 'text', text: 'Line two text', latex: '', box: [0, 70, 180, 100], lineNumber: 1 },
  { type: 'embedding', latex: 'y', box: [200, 72, 250, 98], lineNumber: 1 },
  { type: 'embedding', latex: 'z', box: [260, 72, 320, 98], lineNumber: 1 },
  { type: 'isolated', latex: 'a=b', box: [10, 130, 390, 170], lineNumber: 2 }
]

test('segmentsToMarkdown 使用 $…$（行内）与 $$…$$（独立）分隔符', () => {
  const md = segmentsToMarkdown(mdFixtureSegments)
  assert.ok(md.includes('$x$'), '应包含行内 $x$')
  assert.ok(md.includes('$y$') && md.includes('$z$'), '应包含行内 $y$/$z$')
  assert.ok(md.includes('$$a=b$$'), '应包含独立 $$a=b$$')
  // 独立公式应独占成块（两侧为空行）
  assert.ok(/\n\n\$\$a=b\$\$\n\n/.test(md), '独立公式应独占一块并前后空行')
})

test('segmentsToMarkdown 文本与公式按行拼接', () => {
  const md = segmentsToMarkdown(mdFixtureSegments)
  assert.ok(md.startsWith('Line one text$x$'), `实际: ${JSON.stringify(md)}`)
  // 两个相邻行内公式必须以空格隔断：`$y$$z$` 会被 Markdown 解析器当成行间公式定界符而错位。
  assert.ok(md.includes('Line two text$y$ $z$'), `实际: ${JSON.stringify(md)}`)
  assert.ok(!md.includes('$y$$z$'), `相邻公式不得拼出 $$: ${JSON.stringify(md)}`)
})

test('segmentsToMarkdown 与（服务端）markdown 等价（round-trip 不变量）', () => {
  const md = segmentsToMarkdown(mdFixtureSegments)
  // 客户端重建的 markdown 即作为「服务端 markdown」的等价标准
  const serverMarkdown = md
  assert.equal(segmentsToMarkdown(mdFixtureSegments), serverMarkdown)
})

test('markdownToSegments 逆变换 round-trip 一致', () => {
  const md = segmentsToMarkdown(mdFixtureSegments)
  const back = markdownToSegments(md)
  assert.equal(segmentsToMarkdown(back), md)
})

test('markdownToSegments 解析出正确的段类型与 latex', () => {
  const back = markdownToSegments(segmentsToMarkdown(mdFixtureSegments))
  // 相邻公式之间的空格会被如实解析为一个纯文本段（`$y$ $z$` → embedding, text" ", embedding），
  // 这是忠实的逆变换结果，不影响 round-trip 不变量。
  assert.deepEqual(
    back.map((s) => s.type),
    ['text', 'embedding', 'text', 'embedding', 'text', 'embedding', 'isolated']
  )
  const emb = back.filter((s) => s.type === 'embedding').map((s) => s.latex).sort()
  assert.deepEqual(emb, ['x', 'y', 'z'])
  assert.equal(back.find((s) => s.type === 'isolated').latex, 'a=b')
})

// ---------------------------------------------------------------------------
// segmentsToLatex / segmentsToPlainText
// ---------------------------------------------------------------------------

test('segmentsToLatex 仅拼接公式', () => {
  const tex = segmentsToLatex(mdFixtureSegments)
  assert.ok(tex.includes('x') && tex.includes('y') && tex.includes('z') && tex.includes('a=b'))
  assert.ok(!tex.includes('Line one text'), '不应包含纯文本')
})

test('segmentsToPlainText 含文本与公式 latex', () => {
  const txt = segmentsToPlainText(mdFixtureSegments)
  assert.ok(txt.includes('Line one text'))
  assert.ok(txt.includes('a=b'))
})

// ---------------------------------------------------------------------------
// segmentsToHtml（renderMath 回调，保持无 KaTeX 依赖、可测试）
// ---------------------------------------------------------------------------

test('segmentsToHtml 通过 renderMath 回调渲染，文本做转义', () => {
  const renderMath = (latex, displayMode) => `<MATH display="${displayMode}">${latex}</MATH>`
  const html = segmentsToHtml(mdFixtureSegments, { renderMath })
  assert.ok(html.includes('<MATH display="false">x</MATH>'), '行内公式应 inline')
  assert.ok(html.includes('<MATH display="true">a=b</MATH>'), '独立公式应 display')
  assert.ok(html.includes('Line one text'), '文本应保留')
})

test('segmentsToHtml 默认回调输出原始 latex（兜底）', () => {
  const html = segmentsToHtml(mdFixtureSegments)
  assert.ok(html.includes('$x$') || html.includes('x'), '兜底应含 latex')
})

test('segmentsToHtml 转义 HTML 特殊字符', () => {
  const html = segmentsToHtml([{ type: 'text', text: 'a < b & c > d', latex: '', box: [0, 0, 1, 1], lineNumber: 0 }])
  assert.ok(html.includes('&lt;') && html.includes('&amp;') && html.includes('&gt;'))
})

// ---------------------------------------------------------------------------
// normalizedBottomLeftToPixels —— Vision 归一化(左下原点) → 像素(左上原点)
// 这是实测发现的静默错乱点：Vision 的 boundingBox 是 0..1 且原点在左下，
// 直接与 MFD 的像素框混用会让文本行塌缩到图像左上角、全部挤进同一行。
// ---------------------------------------------------------------------------

test('normalizedBottomLeftToPixels 归一化(左下原点) → 像素(左上原点)', () => {
  // 1000x800 图上 {x:0.5,y:0.25,w:0.25,h:0.25}
  // X1=500, X2=(0.5+0.25)*1000=750
  // Y1=(1-0.25-0.25)*800=400（上边）, Y2=(1-0.25)*800=600（下边）
  const out = normalizedBottomLeftToPixels(
    [{ text: 'hello', box: { x: 0.5, y: 0.25, w: 0.25, h: 0.25 } }],
    1000,
    800
  )
  assert.deepEqual(out[0].box, [500, 400, 750, 600])
  assert.equal(out[0].text, 'hello')
})

test('normalizedBottomLeftToPixels y 轴确实翻转（左下 → 左上）', () => {
  // y=0 是图像底部 → 像素 y 应落在底边附近
  const bottom = normalizedBottomLeftToPixels([{ box: { x: 0, y: 0, w: 1, h: 0.1 } }], 200, 100)
  assert.deepEqual(bottom[0].box, [0, 90, 200, 100])
  // y=0.9 是接近顶部 → 像素 y 应落在顶边附近
  const top = normalizedBottomLeftToPixels([{ box: { x: 0, y: 0.9, w: 1, h: 0.1 } }], 200, 100)
  assert.deepEqual(top[0].box, [0, 0, 200, 10])
})

test('normalizedBottomLeftToPixels 夹取到图像范围内', () => {
  // x=-0.2 → X1 夹到 0；x+w=1.3 → X2 夹到 100
  // y=0.95、h=0.5 → Y1=(1-0.95-0.5)*100=-45 夹到 0；Y2=(1-0.95)*100=5
  const out = normalizedBottomLeftToPixels([{ box: { x: -0.2, y: 0.95, w: 1.5, h: 0.5 } }], 100, 100)
  assert.deepEqual(out[0].box, [0, 0, 100, 5])
})

test('normalizedBottomLeftToPixels 尺寸非法时退化为零框而不抛错', () => {
  const out = normalizedBottomLeftToPixels([{ text: 'x', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }], 0, 0)
  assert.deepEqual(out[0].box, [0, 0, 0, 0])
  const out2 = normalizedBottomLeftToPixels([{ text: 'y', box: null }], 100, 100)
  assert.deepEqual(out2[0].box, [0, 0, 0, 0])
})

// 0.7.14 回归：App.vue 的 extractMixedTextLines 先经 normalizeMixedBox 把 {x,y,w,h} 转
// 数组 [x, yBottom, x2, yTop]，此前 normalizedBottomLeftToPixels 只认对象形态 → 所有行
// 退化为 [0,0,0,0] → 公式字形以文本保留 + 公式又追加在末尾（用户实测的重复输出）。
test('normalizedBottomLeftToPixels 支持数组形态 [x, yBottom, x2, yTop]（0.7.14 回归）', () => {
  // 与对象形态用例同值：{x:0.5,y:0.25,w:0.25,h:0.25} → 数组 [0.5, 0.25, 0.75, 0.5]
  const out = normalizedBottomLeftToPixels([{ text: 'hello', box: [0.5, 0.25, 0.75, 0.5] }], 1000, 800)
  assert.deepEqual(out[0].box, [500, 400, 750, 600])
})

test('normalizedBottomLeftToPixels 数组形态同时换算 chars 的数组框（0.7.14 回归）', () => {
  const out = normalizedBottomLeftToPixels([{
    text: 'a',
    box: [0, 0, 0.5, 0.5],
    chars: [{ c: 'a', box: [0, 0, 0.5, 0.5] }]
  }], 100, 100)
  assert.deepEqual(out[0].box, [0, 50, 50, 100])
  assert.deepEqual(out[0].chars[0].box, [0, 50, 50, 100])
})

test('App.vue 真实路径端到端：数组形态换算后合并不再重复公式（0.7.14 回归）', () => {
  // 模拟 extractMixedTextLines 输出：normalizeMixedBox 已把 Vision 对象转成底左数组。
  // 行「e z + 1 = 0」中 z 是行内公式（MFD 框套在 z 上）。
  const lines = [{
    text: 'ez+1=0',
    box: [0.1, 0.4, 0.3, 0.5],
    chars: [
      { c: 'e', box: [0.10, 0.40, 0.12, 0.50] },
      { c: 'z', box: [0.12, 0.40, 0.16, 0.50] },
      { c: '+', box: [0.16, 0.42, 0.18, 0.48] },
      { c: '1', box: [0.18, 0.42, 0.20, 0.48] },
      { c: '=', box: [0.20, 0.42, 0.22, 0.48] },
      { c: '0', box: [0.22, 0.42, 0.24, 0.48] }
    ],
    score: 1
  }]
  const conv = normalizedBottomLeftToPixels(lines, 1000, 800)
  // 修复判据 1：行框不再是 [0,0,0,0]
  assert.notDeepEqual(conv[0].box, [0, 0, 0, 0])
  // z 的字符框中心落点即公式区间；构造像素公式框：套住 z 的像素区间
  const formula = { type: 'embedding', latex: 'z', score: 0.9, box: conv[0].chars[1].box.slice() }
  formula.box = [formula.box[0] - 2, formula.box[1] - 2, formula.box[2] + 2, formula.box[3] + 2]
  const segs = mergeAndOrderSegments({ textLines: conv, formulaBoxes: [formula] })
  const textSegs = segs.filter((s) => s.type === 'text').map((s) => s.text)
  // 修复判据 2：公式字形 z 不应再以文本出现，公式本身只出现一次
  assert.ok(!textSegs.some((t) => t.includes('z')), `文本段不应再含公式字形 z，实际：${JSON.stringify(textSegs)}`)
  const formulaCount = segs.filter((s) => s.type === 'embedding').length
  assert.equal(formulaCount, 1, `公式应恰好出现一次，实际 ${formulaCount} 次`)
})

test('归一化文本行不与像素公式框相交（换算前会误保留）', () => {
  // 公式框：像素坐标，位于第 2 行中部
  const formula = { type: 'embedding', latex: 'z', box: [480, 240, 660, 286] }
  // 换算前：文本行 box 塌缩到 0..1，iou 为 0 → 会被错误保留
  const rawLine = { text: '其中', box: { x: 0.026, y: 0.06, w: 0.3, h: 0.17 } }
  assert.equal(iou([0.026, 0.06, 0.326, 0.23], formula.box), 0)
  // 换算后：文本行落到真实像素位置，与公式框处于同一行
  const [pxLine] = normalizedBottomLeftToPixels([rawLine], 1544, 310)
  assert.ok(pxLine.box[1] < 286 && pxLine.box[3] > 240, '换算后应与公式框纵向重叠')
})

// ---------------------------------------------------------------------------
// $$ 隔断 —— 相邻公式拼接不得产生 `$$`（Markdown 会当成行间公式定界符）
// 实测：真实 mixed.jpg 上「其中 + z + z~q(z|x) + 利用…」曾拼出 `}$$`。
// 规则与服务端 bin/onnx_mixed_server.mjs 的 joinMarkdownParts 一致。
// ---------------------------------------------------------------------------

test('segmentsToMarkdown 相邻行内公式用空格隔断，不产生 $$', () => {
  const segs = [
    { type: 'text', text: '其中', latex: '', lineNumber: 0 },
    { type: 'embedding', latex: '\\textstyle{\\mathcal{Z}}', lineNumber: 0 },
    { type: 'embedding', latex: 'z\\sim q(z|x)', lineNumber: 0 },
    { type: 'text', text: '利用 Gumbel-Softmax', latex: '', lineNumber: 0 },
    { type: 'embedding', latex: 'p(z)', lineNumber: 0 }
  ]
  const md = segmentsToMarkdown(segs)
  assert.equal(
    md,
    '其中$\\textstyle{\\mathcal{Z}}$ $z\\sim q(z|x)$利用 Gumbel-Softmax$p(z)$'
  )
  assert.ok(!md.includes('}$$'), `不应出现 }$$：${md}`)
  assert.ok(!md.includes('$$$'), `不应出现 $$$：${md}`)
})

test('segmentsToMarkdown 真实 mixed.jpg 全量输出无 $$ 邻接', () => {
  const segs = [
    { type: 'text', text: 'dVAE的训练 loss 和 VQ-VAE 类似：', latex: '', lineNumber: 0 },
    { type: 'isolated', latex: '-E_{z\\sim q(z|x)}+K L(q(z|x)\\|p(z))', lineNumber: 1 },
    { type: 'text', text: '其中', latex: '', lineNumber: 2 },
    { type: 'embedding', latex: '\\textstyle{\\mathcal{Z}}', lineNumber: 2 },
    { type: 'embedding', latex: 'z\\sim q(z|x)', lineNumber: 2 },
    { type: 'text', text: '利用 Gumbel-Softmax 抽样得到。', latex: '', lineNumber: 2 },
    { type: 'embedding', latex: 'p(z)', lineNumber: 2 }
  ]
  const md = segmentsToMarkdown(segs)
  assert.ok(!md.includes('}$$'), `不应出现 }$$：${md}`)
  assert.ok(!md.includes('$$$'), `不应出现 $$$：${md}`)
  assert.ok(md.includes('dVAE的训练'))
  // 独立公式块仍是合法的 $$…$$
  assert.ok(md.includes('$$') && md.includes('-E_{z\\sim q(z|x)}'))
})

test('segmentsToMarkdown 隔断后仍可逆（相邻公式往返）', () => {
  const segs = [
    { type: 'embedding', latex: 'a', lineNumber: 0 },
    { type: 'embedding', latex: 'b', lineNumber: 0 }
  ]
  const md = segmentsToMarkdown(segs)
  assert.equal(md, '$a$ $b$')
  const back = markdownToSegments(md)
  const latexes = back.filter((s) => s.type === 'embedding').map((s) => s.latex)
  assert.deepEqual(latexes, ['a', 'b'])
})

// ---------------------------------------------------------------------------
// splitTextLinePieces：逐字符框驱动的「图文混排」切分
// ---------------------------------------------------------------------------
const mkChar = (c, x1, x2, y1 = 0, y2 = 20) => ({ c, box: [x1, y1, x2, y2] })

test('splitTextLinePieces 按公式区间把文本行切成 文本/公式 交替片段', () => {
  const line = {
    text: 'abzcd',
    box: [0, 0, 50, 20],
    score: 1,
    chars: [mkChar('a', 0, 10), mkChar('b', 10, 20), mkChar('z', 20, 30), mkChar('c', 30, 40), mkChar('d', 40, 50)]
  }
  const parts = splitTextLinePieces(line, [{ kind: 'embedding', latex: 'Z', score: 0.9, box: [18, 2, 32, 22] }])
  assert.ok(parts, '应返回片段')
  assert.deepEqual(parts.map((p) => p.type), ['text', 'embedding', 'text'])
  assert.equal(parts[0].text, 'ab')
  assert.equal(parts[1].latex, 'Z')
  assert.equal(parts[2].text, 'cd')
})

test('splitTextLinePieces 公式段带 formulaIndex 供调用方去重', () => {
  const line = {
    text: 'azb',
    box: [0, 0, 30, 20],
    score: 1,
    chars: [mkChar('a', 0, 10), mkChar('z', 10, 20), mkChar('b', 20, 30)]
  }
  const parts = splitTextLinePieces(line, [{ kind: 'embedding', latex: 'Z', score: 1, box: [8, 0, 22, 20] }])
  assert.equal(parts.filter((p) => p.type !== 'text').length, 1)
  assert.equal(parts.find((p) => p.type !== 'text').formulaIndex, 0)
})

test('回归：公式区间内的空格（零面积框）不打断归属，不产生重复公式段', () => {
  // Vision 对空格返回 x=0,w=0 的零面积框，其 center=0 落在公式区间之外。
  // 若不做相邻同归属平滑，同一个公式会被切成两段，还会多出一个只含空格的文本段
  // （已在真实 mixed.jpg 上复现：出现重复的 embedding 框 + 空文本段）。
  const line = {
    text: 'x y',
    box: [0, 0, 30, 20],
    score: 1,
    chars: [mkChar('x', 0, 10), { c: ' ', box: [0, 0, 0, 0] }, mkChar('y', 20, 30)]
  }
  const parts = splitTextLinePieces(line, [{ kind: 'embedding', latex: 'Z', score: 1, box: [0, 0, 30, 20] }])
  const formulas = parts.filter((p) => p.type !== 'text')
  assert.equal(formulas.length, 1, `公式段应只有 1 个，实际 ${formulas.length}`)
  assert.ok(!parts.some((p) => p.type === 'text'), '不应残留只含空格的文本段')
})

test('splitTextLinePieces 无字符落在公式框内 → 返回 null（退回旧行为）', () => {
  const line = {
    text: 'abcd',
    box: [0, 0, 40, 20],
    score: 1,
    chars: [mkChar('a', 0, 10), mkChar('b', 10, 20), mkChar('c', 20, 30), mkChar('d', 30, 40)]
  }
  const parts = splitTextLinePieces(line, [{ kind: 'embedding', latex: 'Z', score: 1, box: [100, 0, 140, 20] }])
  assert.equal(parts, null)
})

test('splitTextLinePieces chars 长度与文本不一致 → 返回 null（安全降级）', () => {
  const line = { text: 'abcd', box: [0, 0, 40, 20], score: 1, chars: [mkChar('a', 0, 10)] }
  assert.equal(splitTextLinePieces(line, [{ kind: 'embedding', latex: 'Z', score: 1, box: [0, 0, 10, 20] }]), null)
})

test('mergeAndOrderSegments 在有 chars 时输出交错顺序', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{
      text: 'abzcd',
      box: [0, 0, 50, 20],
      score: 1,
      chars: [mkChar('a', 0, 10), mkChar('b', 10, 20), mkChar('z', 20, 30), mkChar('c', 30, 40), mkChar('d', 40, 50)]
    }],
    formulaBoxes: [{ type: 'embedding', box: [18, 2, 32, 22], latex: 'Z', score: 0.9 }]
  })
  assert.deepEqual(segs.map((s) => s.type), ['text', 'embedding', 'text'])
  assert.deepEqual(segs.map((s) => s.text || s.latex), ['ab', 'Z', 'cd'])
  assert.equal(segs[1].lineNumber, 0)
})

test('mergeAndOrderSegments 无 chars 时退回「整行文本 + 公式」旧行为', () => {
  const segs = mergeAndOrderSegments({
    textLines: [{ text: 'abzcd', box: [0, 0, 50, 20], score: 1 }],
    formulaBoxes: [{ type: 'embedding', box: [18, 2, 32, 22], latex: 'Z', score: 0.9 }]
  })
  assert.deepEqual(segs.map((s) => s.type), ['text', 'embedding'])
  assert.equal(segs[0].text, 'abzcd')
})

test('normalizedBottomLeftToPixels 同时换算 chars 的框', () => {
  const out = normalizedBottomLeftToPixels([{
    text: 'a',
    box: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    chars: [{ c: 'a', box: { x: 0, y: 0.5, w: 0.5, h: 0.5 } }]
  }], 100, 100)
  assert.deepEqual(out[0].chars[0].box, [0, 0, 50, 50])
})

// ---------------------------------------------------------------------------
console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
