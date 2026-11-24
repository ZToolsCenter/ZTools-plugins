// 微信 OCR（Windows）发现逻辑的静态回归测试 —— node tests/wechat-win-discovery.mjs
//
// 背景：Windows 侧「微信装了但仍提示不可用」排查过一次。根因有两个：
//   1. wechat_ocr() 需要的是**带版本号**的运行时目录（mmmojo_64.dll 所在处，
//      形如 ...\Tencent\Weixin\4.1.5.30），不是 Weixin.exe 所在的父目录。
//   2. 失败原因被压成一句话，用户拿不到任何判定依据；而「微信没装」「微信 3.x」
//      「微信装了但 OCR 插件没下载」「运行时目录缺失」四者的处置方式完全不同。
//
// PowerShell 无法在 macOS 上执行，所以这里对脚本做静态断言，锁定上述约定：
//   - 脚本必须保持纯 ASCII（PS 5.1 用 ANSI 码页读无 BOM 的 UTF-8）
//   - 必须用 mmmojo_64.dll 定位运行时目录
//   - 脚本吐出的每个 reasonCode，preload 的 WECHAT_WIN_REASONS 必须有中文文案
//     （否则用户会看到裸英文码）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const script = readFileSync(path.join(root, 'bin', 'ocr-wechat-win.ps1'))
const scriptText = script.toString('utf8')
const preloadText = readFileSync(path.join(root, 'public', 'preload.js'), 'utf8')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \u2713 ${name}`)
  } catch (error) {
    failed++
    console.log(`  \u2717 ${name}`)
    console.log(`      ${error.message}`)
  }
}

console.log('wechat-win-discovery')

// 脚本里所有可能被吐出的原因码。
function emittedReasonCodes() {
  const codes = new Set()
  const re = /\$reasonCode\s*=\s*"([a-z0-9-]+)"/g
  let m
  while ((m = re.exec(scriptText))) codes.add(m[1])
  // Fail 6 走的是 "$reasonCode:$detail"，reasonCode 来自上面的赋值。
  return [...codes].filter((c) => c !== 'ok')
}

// preload 里 WECHAT_WIN_REASONS 的键。
function localizedReasonCodes() {
  const block = preloadText.match(/const WECHAT_WIN_REASONS = \{([\s\S]*?)\n\};/)
  assert.ok(block, 'WECHAT_WIN_REASONS 未找到')
  const codes = new Set()
  const re = /"([a-z0-9-]+)"\s*:/g
  let m
  while ((m = re.exec(block[1]))) codes.add(m[1])
  return [...codes]
}

test('\u2605 脚本必须是纯 ASCII（PS 5.1 按 ANSI 码页读取无 BOM 文件）', () => {
  const offenders = []
  for (let i = 0; i < script.length; i++) {
    if (script[i] > 0x7f) {
      offenders.push(`${i}:0x${script[i].toString(16)}`)
      if (offenders.length >= 5) break
    }
  }
  assert.deepEqual(offenders, [], `存在非 ASCII 字节：${offenders.join(', ')}`)
})

test('\u2605 运行时目录用 mmmojo_64.dll 定位，而不是 Weixin.exe 的父目录', () => {
  assert.match(scriptText, /mmmojo_64\.dll/, '必须检查 mmmojo_64.dll')
  // Find-WeChatRuntime 必须先找 mmmojo，找不到才回退到客户端所在目录。
  const runtimeFn = scriptText.match(/function Find-WeChatRuntime \{[\s\S]*?\n\}/)
  assert.ok(runtimeFn, 'Find-WeChatRuntime 未找到')
  const mmojoAt = runtimeFn[0].indexOf('mmmojo_64.dll')
  const fallbackAt = runtimeFn[0].indexOf('Fallback')
  assert.ok(mmojoAt > 0, 'Find-WeChatRuntime 内未检查 mmmojo_64.dll')
  assert.ok(fallbackAt > mmojoAt, 'mmmojo 检查必须作为首选，回退逻辑在其后')
})

test('运行时目录不再复用会返回父目录的 Find-WeChatDir', () => {
  assert.doesNotMatch(scriptText, /Find-WeChatDir/, '旧的 Find-WeChatDir 应已移除')
})

test('\u2605 每个 reasonCode 都必须在 preload 里有中文文案', () => {
  const emitted = emittedReasonCodes()
  const localized = new Set(localizedReasonCodes())
  assert.ok(emitted.length >= 4, `原因码数量偏少：${JSON.stringify(emitted)}`)
  const missing = emitted.filter((code) => !localized.has(code))
  assert.deepEqual(missing, [], `缺少文案：${missing.join(', ')}`)
})

test('四种失败原因可区分（未装 / 3.x / 插件未下载 / 运行时缺失）', () => {
  const emitted = emittedReasonCodes()
  for (const code of ['wechat-not-found', 'legacy-wechat-3x', 'wxocr-dll-missing', 'wechat-dir-missing']) {
    assert.ok(emitted.includes(code), `未产出原因码 ${code}`)
  }
})

test('探测结果必须带出判定依据（detail / clientExe / pluginRoots）', () => {
  assert.match(scriptText, /detail\s*=\s*\$state\.detail/, 'probe 未回传 detail')
  assert.match(scriptText, /clientExe\s*=\s*\$state\.clientExe/, 'probe 未回传 clientExe')
  assert.match(scriptText, /pluginRoots\s*=\s*\$state\.pluginRoots/, 'probe 未回传 pluginRoots')
})

test('插件目录限定在 XPlugin 下，不递归整个 Tencent 数据目录', () => {
  // %APPDATA%\Tencent 里有聊天数据库，全量递归会慢到不可接受。
  assert.match(scriptText, /Tencent\\xwechat\\XPlugin/, '未包含 xwechat XPlugin 子树')
  const findDll = scriptText.match(/function Find-WxOcrDll \{[\s\S]*?\n\}/)
  assert.ok(findDll, 'Find-WxOcrDll 未找到')
  assert.doesNotMatch(findDll[0], /\$env:APPDATA\s*$/, '不得直接对 %APPDATA% 递归')
  assert.match(findDll[0], /Get-PluginRoots/, 'Find-WxOcrDll 应遍历 Get-PluginRoots')
})

test('脚本版本号可读（便于真机排查时确认加载的是哪一版）', () => {
  assert.match(scriptText, /\$scriptVersion = "\d+\.\d+\.\d+"/)
})

console.log(`${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
