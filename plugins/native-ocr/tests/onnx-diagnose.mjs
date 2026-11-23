// ONNX 子进程启动失败的诊断回归测试 —— node tests/onnx-diagnose.mjs
//
// 覆盖 public/onnx-diagnose.cjs。背景：onnx_ocr_server.mjs 顶层静态 import
// 'onnxruntime-node'，原生模块加载失败会在任何 try/catch 之前杀掉进程，stdout
// 无输出，用户只看到「服务启动失败」。本测试锁定：
//   1. stderr 尾部必须被带进错误信息（否则永远查不出原因）
//   2. Windows 上缺 VC++ 运行库时，必须给出可执行提示而非原始英文报错
//   3. 非 Windows / 非加载失败场景不得误报运行库问题
//   4. 平台二进制目录按 <runtime>/node_modules/onnxruntime-node/bin/napi-v3/<platform>/<arch> 组装
//
// 不依赖 Windows 或真实原生模块，纯字符串与路径测试（existsSync 注入）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  VC_RUNTIME_DLLS,
  nativeBinDir,
  missingVcRuntimeDlls,
  isNativeLoadFailure,
  tailSnippet,
  startupErrorDetail
} = require('../public/onnx-diagnose.cjs')

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

// 「所有运行库都在」与「一个都没有」两种环境
const allPresent = () => true
const nonePresent = () => false

// 真实的 Node 原生模块加载失败长这样（Node 打印的是英文原文）
const DLOPEN_ERR = [
  "node:internal/modules/cjs/loader:1386",
  "  throw err;",
  "",
  "Error: The specified module could not be found.",
  "\\\\?\\C:\\Users\\u\\AppData\\Roaming\\ZTools\\plugins-data\\native-ocr\\onnx-runtime\\node_modules\\onnxruntime-node\\bin\\napi-v3\\win32\\x64\\onnxruntime_binding.node",
  "    at Module._extensions..node (node:internal/modules/cjs/loader:1396:18)",
  "    at Module.load (node:internal/modules/cjs/loader:1180:32)",
  "Node.js v22.22.2"
].join("\n")

test('平台二进制目录按 napi-v3/<platform>/<arch> 组装', () => {
  const dir = nativeBinDir('/rt', 'win32', 'x64')
  assert.equal(dir, path.join('/rt', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64'))
  assert.ok(dir.endsWith(path.join('napi-v3', 'win32', 'x64')))
})

test('arm64 与 x64 的目录互不相同（架构裁剪不会串）', () => {
  assert.notEqual(nativeBinDir('/rt', 'win32', 'x64'), nativeBinDir('/rt', 'win32', 'arm64'))
})

test('缺运行库时列出具体文件名', () => {
  const missing = missingVcRuntimeDlls('C:\\Windows', nonePresent)
  assert.deepEqual(missing, VC_RUNTIME_DLLS)
})

test('运行库齐全时不报缺失', () => {
  assert.deepEqual(missingVcRuntimeDlls('C:\\Windows', allPresent), [])
})

test('systemRoot 为空时不误判（非 Windows 调用方）', () => {
  assert.deepEqual(missingVcRuntimeDlls('', nonePresent), [])
})

test('识别原生模块加载失败', () => {
  assert.equal(isNativeLoadFailure(DLOPEN_ERR), true)
  assert.equal(isNativeLoadFailure('not a valid Win32 application'), true)
  assert.equal(isNativeLoadFailure('ERR_DLOPEN_FAILED'), true)
})

test('普通业务错误不当作加载失败', () => {
  assert.equal(isNativeLoadFailure('imagePath is required'), false)
  assert.equal(isNativeLoadFailure('ONNX 引擎组件缺失或版本不兼容'), false)
})

test('stderr 尾部去掉栈帧与 Node 版本噪声', () => {
  const s = tailSnippet(DLOPEN_ERR, 5000)
  assert.ok(s.includes('The specified module could not be found'))
  assert.ok(!s.includes('node:internal'), '不应保留 node:internal 行')
  assert.ok(!s.includes('at Module.load'), '不应保留栈帧')
  assert.ok(!s.includes('Node.js v'), '不应保留版本行')
})

test('stderr 尾部超长时保留末尾（原因通常在最后）', () => {
  const long = `${'x'.repeat(400)}TAIL_MARK`
  const s = tailSnippet(long, 50)
  assert.ok(s.startsWith('…'))
  assert.ok(s.endsWith('TAIL_MARK'))
  assert.ok(s.length <= 51)
})

test('空 stderr 返回空串', () => {
  assert.equal(tailSnippet(''), '')
  assert.equal(tailSnippet(null), '')
})

test('★ 进程崩溃时错误信息必须包含 stderr 原因', () => {
  const msg = startupErrorDetail({
    stderrTail: DLOPEN_ERR,
    exitCode: 1,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    existsSync: allPresent,
    fallback: 'ONNX OCR 服务进程已退出'
  })
  assert.ok(msg.includes('ONNX OCR 服务进程已退出'))
  assert.ok(msg.includes('退出码 1'))
  assert.ok(msg.includes('The specified module could not be found'), '必须带出真实原因')
})

test('★ Windows 缺 VC++ 运行库时给出可执行提示', () => {
  const msg = startupErrorDetail({
    stderrTail: DLOPEN_ERR,
    exitCode: 1,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    existsSync: nonePresent,
    fallback: 'ONNX OCR 服务进程已退出'
  })
  assert.ok(msg.includes('vc_redist.x64.exe'))
  assert.ok(msg.includes('vcruntime140.dll'))
})

test('运行库齐全时不再提示安装（避免误导）', () => {
  const msg = startupErrorDetail({
    stderrTail: DLOPEN_ERR,
    exitCode: 1,
    platform: 'win32',
    systemRoot: 'C:\\Windows',
    existsSync: allPresent,
    fallback: 'ONNX OCR 服务进程已退出'
  })
  assert.ok(!msg.includes('vc_redist'), '不该让用户去装已经装过的运行库')
})

test('macOS 上不做 Windows 运行库推断', () => {
  const msg = startupErrorDetail({
    stderrTail: DLOPEN_ERR,
    exitCode: 1,
    platform: 'darwin',
    systemRoot: '',
    existsSync: nonePresent,
    fallback: 'ONNX OCR 服务进程已退出'
  })
  assert.ok(!msg.includes('vc_redist'))
})

test('无 stderr 时保持简洁，不加空括号', () => {
  const msg = startupErrorDetail({ stderrTail: '', exitCode: null, fallback: 'ONNX OCR 服务启动失败' })
  assert.equal(msg, 'ONNX OCR 服务启动失败')
})

test('信号退出（被杀）也能表达', () => {
  const msg = startupErrorDetail({ stderrTail: '', exitCode: null, signal: 'SIGKILL', fallback: '服务已退出' })
  assert.ok(msg.includes('SIGKILL'))
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exitCode = failed ? 1 : 0
