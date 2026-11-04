// Windows 系统 OCR 的 stdout 传输协议回归测试 —— node tests/winrt-payload.mjs
//
// 覆盖 public/winrt-payload.cjs：
//   1. 新协议 NOCR1:<base64> 的中文往返（这是「Windows OCR 中文乱码」的直接回归项）
//   2. **核心不变量**：线上字节必须全部 < 0x80 —— 只有这样，936/950/932/1252
//      任何代码页写出的字节才完全相同，编码问题才从根上消失
//   3. 旧协议（明文 JSON / 带 BOM / 前面有 PowerShell warning）仍可解析
//   4. PowerShell 把单元素数组折叠成对象时的容错
//   5. 失败信封优先于被代码页搞乱的 stderr
//
// 不依赖 Windows、PowerShell 或真实图片，纯字节级测试。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  PROTOCOL_PREFIX,
  decodeWinRtStdout,
  payloadToOcrResult,
  errorMessageFromOutput
} = require('../public/winrt-payload.cjs')

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

// 复刻 ocr-winrt.ps1 的 Write-Payload：JSON → UTF-8 → Base64，再拼前缀。
function wire(payload) {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  return Buffer.from(`${PROTOCOL_PREFIX}${b64}\r\n`, 'latin1')
}

const SAMPLE = {
  ok: true,
  width: 800,
  height: 600,
  lines: [
    { text: '第一行：中文识别', box: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 } },
    { text: '第二行 with English 混排，标点「」、破折号——以及 emoji 😀', box: { x: 0.1, y: 0.6, w: 0.8, h: 0.1 } }
  ]
}

// ---------------------------------------------------------------------------
// 1. 新协议：中文往返
// ---------------------------------------------------------------------------

test('新协议：中文 / 混排 / emoji 往返完全一致', () => {
  const payload = decodeWinRtStdout(wire(SAMPLE))
  const result = payloadToOcrResult(payload)
  assert.equal(result.lines.length, 2)
  assert.equal(result.lines[0].text, '第一行：中文识别')
  assert.equal(result.lines[1].text, SAMPLE.lines[1].text)
  assert.equal(result.text, SAMPLE.lines.map((l) => l.text).join('\n'))
})

test('新协议：box 被规范化为 number', () => {
  const { lines } = payloadToOcrResult(decodeWinRtStdout(wire(SAMPLE)))
  assert.deepEqual(lines[0].box, { x: 0.1, y: 0.8, w: 0.5, h: 0.1 })
  assert.equal(typeof lines[0].box.x, 'number')
})

test('新协议：非法 box 被忽略但文本保留', () => {
  const payload = { ok: true, lines: [{ text: '没有框' }, { text: '坏框', box: { x: 'NaN' } }] }
  const { lines } = payloadToOcrResult(decodeWinRtStdout(wire(payload)))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].box, undefined)
  assert.equal(lines[1].box, undefined)
})

// ---------------------------------------------------------------------------
// 2. 核心不变量：线上字节必须是纯 ASCII
// ---------------------------------------------------------------------------

test('线上字节全部 < 0x80（任何代码页写出的字节相同）', () => {
  const buf = wire(SAMPLE)
  const bad = [...buf].filter((b) => b > 0x7f)
  assert.equal(bad.length, 0, `存在非 ASCII 字节: ${bad.slice(0, 8).join(',')}`)
})

test('同一份线上字节，按 utf8 / latin1 / ascii 三种方式交给解码器，结果一致', () => {
  const buf = wire(SAMPLE)
  const expected = JSON.stringify(payloadToOcrResult(decodeWinRtStdout(buf)))
  for (const enc of ['utf8', 'latin1', 'ascii']) {
    const got = JSON.stringify(payloadToOcrResult(decodeWinRtStdout(buf.toString(enc))))
    assert.equal(got, expected, `encoding=${enc} 结果不一致`)
  }
})

test('模拟 4 种 Windows 代码页：ASCII payload 在各代码页下字节不变', () => {
  // GBK/GB18030、Big5、Shift_JIS、windows-1252 对 0x00-0x7F 的映射都与 ASCII 相同，
  // 因此「输出纯 ASCII」等价于「对所有代码页免疫」。这里用 Buffer 校验这一前提。
  const buf = wire(SAMPLE)
  assert.ok(buf.every((b) => b < 0x80))
  // 反证：如果把中文直接写进 stdout（旧行为），在 GBK 下就是高位字节
  const naive = Buffer.from(JSON.stringify(SAMPLE), 'utf8')
  assert.ok(naive.some((b) => b > 0x7f), '对照组应当含高位字节，否则测试失去意义')
})

// ---------------------------------------------------------------------------
// 3. 旧协议兼容
// ---------------------------------------------------------------------------

test('旧协议：明文 JSON（utf8）仍可解析', () => {
  const buf = Buffer.from(`{"width":10,"height":20,"lines":[{"text":"旧版中文"}]}`, 'utf8')
  const { text } = payloadToOcrResult(decodeWinRtStdout(buf))
  assert.equal(text, '旧版中文')
})

test('旧协议：带 UTF-8 BOM 仍可解析', () => {
  const buf = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('{"width":1,"height":1,"lines":[{"text":"BOM 之后"}]}', 'utf8')
  ])
  const { text } = payloadToOcrResult(decodeWinRtStdout(buf))
  assert.equal(text, 'BOM 之后')
})

test('新协议：payload 前有 PowerShell warning 行仍能定位', () => {
  const body = wire(SAMPLE)
  const buf = Buffer.concat([Buffer.from('WARNING: something noisy\r\n', 'latin1'), body])
  const { text } = payloadToOcrResult(decodeWinRtStdout(buf))
  assert.equal(text, SAMPLE.lines.map((l) => l.text).join('\n'))
})

test('新协议：PowerShell 把单元素 lines 折叠成对象时仍解析', () => {
  const payload = { ok: true, lines: { text: '只有一行', box: { x: 0, y: 0, w: 1, h: 1 } } }
  const { lines, text } = payloadToOcrResult(decodeWinRtStdout(wire(payload)))
  assert.equal(lines.length, 1)
  assert.equal(text, '只有一行')
})

// ---------------------------------------------------------------------------
// 4. 失败路径
// ---------------------------------------------------------------------------

test('failure 信封：ok:false 抛出原始 message（中文不乱码）', () => {
  const buf = wire({ ok: false, code: 4, message: 'ocr engine unavailable: 请安装语言包' })
  assert.throws(
    () => payloadToOcrResult(decodeWinRtStdout(buf)),
    /ocr engine unavailable: 请安装语言包/
  )
})

test('空输出 → 空结果，不抛错', () => {
  assert.deepEqual(payloadToOcrResult(decodeWinRtStdout(Buffer.alloc(0))), { text: '', lines: [] })
  assert.deepEqual(payloadToOcrResult(decodeWinRtStdout(Buffer.from('   \r\n '))), { text: '', lines: [] })
})

test('失败时优先用信封里的 message，即使 stderr 已被代码页搞成乱码', () => {
  const buf = wire({ ok: false, code: 5, message: '识别失败：图片损坏' })
  const garbledStderr = 'ocr failed: \uFFFD\uFFFD\uFFFD'
  assert.equal(errorMessageFromOutput(buf, garbledStderr, '兜底'), '识别失败：图片损坏')
})

test('只有乱码 stderr 时返回兜底文案，不把替换字符抛给用户', () => {
  const out = errorMessageFromOutput(Buffer.alloc(0), 'ocr failed: \uFFFD\uFFFD', 'Windows OCR 识别失败')
  assert.equal(out, 'Windows OCR 识别失败')
  assert.ok(!out.includes('\uFFFD'))
})

test('stderr 可读（无替换字符）时原样返回', () => {
  const out = errorMessageFromOutput(Buffer.alloc(0), '  image not found  ', '兜底')
  assert.equal(out, 'image not found')
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exitCode = failed ? 1 : 0
