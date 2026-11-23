// 微信 OCR（Windows）返回值的解析回归测试 —— node tests/wechat-result.mjs
//
// 覆盖 public/wechat-result.cjs。微信 wxocr.dll 回调的 JSON 结构没有公开契约，
// 不同版本会出现在 results / ocr_result / lines 等不同键下，框也可能是多边形或
// x/y/w/h。本测试锁定「容错范围」与「坐标系约定」，避免以后收窄到只认一种形状。
//
// 不依赖微信、Windows 或真实图片，纯字符串/字节测试。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  decodeResultBytes,
  toPixelBox,
  normalizeBox,
  parseWeChatResult
} = require('../public/wechat-result.cjs')

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

// 「中」「文」的 GBK 编码，用来验证编码回退（Node 只有 GBK 解码能力，没有编码器）
const GBK_ZHONG = [0xd6, 0xd0]
const GBK_WEN = [0xce, 0xc4]

test('results 形状 + 多边形框 → 归一化包围盒', () => {
  const payload = {
    results: [
      { text: '你好', box: [[100, 50], [300, 50], [300, 150], [100, 150]] }
    ]
  }
  const out = parseWeChatResult(JSON.stringify(payload), { width: 1000, height: 500 })
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].text, '你好')
  assert.deepEqual(out.lines[0].box, { x: 0.1, y: 0.7, w: 0.2, h: 0.2 })
})

test('ocr_result 形状 + {x,y,w,h} 框', () => {
  const payload = {
    ocr_result: [
      { text: 'A', box: { x: 200, y: 100, w: 100, h: 50 } }
    ]
  }
  const out = parseWeChatResult(JSON.stringify(payload), { width: 1000, height: 500 })
  assert.deepEqual(out.lines[0].box, { x: 0.2, y: 0.7, w: 0.1, h: 0.1 })
})

test('根直接是数组', () => {
  const out = parseWeChatResult(JSON.stringify([{ text: 'x' }]))
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].text, 'x')
})

test('扁平 x/y/w/h 也能识别', () => {
  const out = parseWeChatResult(JSON.stringify({ lines: [{ text: 't', x: 0, y: 0, w: 100, h: 50 }] }), { width: 100, height: 100 })
  assert.deepEqual(out.lines[0].box, { x: 0, y: 0.5, w: 1, h: 0.5 })
})

test('大写的 Text 键也接受', () => {
  const out = parseWeChatResult(JSON.stringify({ results: [{ Text: '大写' }] }))
  assert.equal(out.lines[0].text, '大写')
})

test('无框时保留文本、不造坐标', () => {
  const out = parseWeChatResult(JSON.stringify({ results: [{ text: 'only' }] }), { width: 10, height: 10 })
  assert.equal(out.lines[0].text, 'only')
  assert.equal(out.lines[0].box, undefined)
})

test('空文本项被丢弃', () => {
  const out = parseWeChatResult(JSON.stringify({ results: [{ text: '   ' }, { text: 'keep' }] }))
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].text, 'keep')
})

test('★ 坐标系为原点左下（y 由 bottom 翻转）', () => {
  // 顶边 0、底边 50 的框在图片最上方 → 归一化 y 应接近 1
  const box = normalizeBox({ left: 0, top: 0, right: 10, bottom: 50 }, 10, 100)
  assert.ok(Math.abs(box.y - 0.5) < 1e-9)
  const top = normalizeBox({ left: 0, top: 0, right: 10, bottom: 10 }, 10, 100)
  assert.ok(top.y > 0.8, `最上方的框 y 应接近 1，实际 ${top.y}`)
})

test('坐标越界会被夹到 0..1', () => {
  const box = normalizeBox({ left: -50, top: -50, right: 200, bottom: 200 }, 100, 100)
  assert.ok(box.x >= 0 && box.x <= 1)
  assert.ok(box.w >= 0 && box.w <= 1)
  assert.ok(box.y >= 0 && box.y <= 1)
  assert.ok(box.h >= 0 && box.h <= 1)
})

test('errcode 非 0 必须抛错（不能伪装成「图里没字」）', () => {
  assert.throws(
    () => parseWeChatResult(JSON.stringify({ errcode: 3, errmsg: 'bad image' })),
    /3.*bad image/
  )
})

test('errcode 为 0 正常放行', () => {
  const out = parseWeChatResult(JSON.stringify({ errcode: 0, results: [{ text: 'ok' }] }))
  assert.equal(out.lines[0].text, 'ok')
})

test('非 JSON 返回带片段报错', () => {
  assert.throws(() => parseWeChatResult('not json at all'), /不是 JSON/)
})

test('空返回报错', () => {
  assert.throws(() => parseWeChatResult(''), /没有返回任何内容/)
})

test('★ GBK 字节回退（UTF-8 严格解失败后按 936 解）', () => {
  const head = Buffer.from('{"results":[{"text":"', 'utf8')
  const tail = Buffer.from('"}]}', 'utf8')
  const bytes = Buffer.concat([head, Buffer.from([...GBK_ZHONG, ...GBK_WEN]), tail])
  const out = parseWeChatResult(bytes)
  assert.equal(out.lines[0].text, '中文')
})

test('UTF-8 字节正常解，不被 GBK 抢走', () => {
  const out = parseWeChatResult(Buffer.from(JSON.stringify({ results: [{ text: '中文' }] }), 'utf8'))
  assert.equal(out.lines[0].text, '中文')
})

test('尺寸优先用调用方给的图片尺寸', () => {
  const out = parseWeChatResult(
    JSON.stringify({ width: 999, height: 999, results: [{ text: 't', x: 0, y: 0, w: 10, h: 10 }] }),
    { width: 100, height: 100 }
  )
  assert.equal(out.width, 100)
  assert.equal(out.height, 100)
})

test('没有尺寸时用返回值自带的尺寸', () => {
  const out = parseWeChatResult(JSON.stringify({ width: 200, height: 100, results: [{ text: 't', x: 0, y: 0, w: 20, h: 10 }] }))
  assert.equal(out.width, 200)
  assert.equal(out.height, 100)
})

test('完全没有尺寸时按最大坐标兜底', () => {
  const out = parseWeChatResult(JSON.stringify({ results: [{ text: 't', x: 0, y: 0, w: 40, h: 20 }] }))
  assert.equal(out.width, 40)
  assert.equal(out.height, 20)
})

test('toPixelBox 对非法输入返回 null', () => {
  assert.equal(toPixelBox(null), null)
  assert.equal(toPixelBox({ text: 'no box' }), null)
  assert.equal(toPixelBox({ box: [[1, 2]] }), null)
})

test('decodeResultBytes 接受字符串原样返回', () => {
  assert.equal(decodeResultBytes('{"a":1}'), '{"a":1}')
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exitCode = failed ? 1 : 0
