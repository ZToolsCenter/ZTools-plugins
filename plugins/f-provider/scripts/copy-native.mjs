// Post-build: copy the native addon + platform runtime into dist/ so the
// packaged plugin can load wechat_ocr.node and find its OCR runtime, then
// produce a per-platform distributable zip.
//
// 产物按平台区分（两条独立流程，各自 CI 产出各自的包）：
//   - Windows: native-win.zip  (wechat_ocr.node + wco_data/)
//   - macOS:   native-mac.zip  (wechat_ocr.node + wechat-ocr-mac/{lib,models})
//
// Layout after copy + zip（以 mac 为例）:
//   dist/
//     native/                        <- 解压版，方便开发调试
//       index.js
//       package.json
//       build/Release/wechat_ocr.node
//       wechat-ocr-mac/  (libwxocr.dylib, libmmmojo.dylib, models/)
//     native-mac.zip                 <- 分发版（顶层含 native/ 目录，解压即还原）
//     preload/services.js   (vite already copied from public/)
//
// 设计：插件初始不带 native，用户在前端点击「下载」后下载对应平台的 zip 并解压到
// 插件根目录（顶层 native/ 解压后落到 <pluginRoot>/native/）。
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const nativeDir = join(root, 'native')
const distDir = join(root, 'dist')
const distNative = join(distDir, 'native')
const isMac = process.platform === 'darwin'
const zipName = isMac ? 'native-mac.zip' : 'native-win.zip'
const distZip = join(distDir, zipName)

if (!existsSync(distDir)) {
  console.warn('[copy-native] dist/ not found, skipping')
  process.exit(0)
}

mkdirSync(distNative, { recursive: true })

// Copy only what the packaged plugin needs at runtime — NOT the build
// intermediate files (.obj/.tlog/node_modules) which are large and useless
// outside the build.
cpSync(join(nativeDir, 'index.js'), join(distNative, 'index.js'), { force: true })
cpSync(join(nativeDir, 'package.json'), join(distNative, 'package.json'), { force: true })

// The compiled addon.
const nodeSrc = join(nativeDir, 'build', 'Release', 'wechat_ocr.node')
if (existsSync(nodeSrc)) {
  mkdirSync(join(distNative, 'build', 'Release'), { recursive: true })
  cpSync(nodeSrc, join(distNative, 'build', 'Release', 'wechat_ocr.node'), { force: true })
}

// 复制当前平台的专有运行时（只打对应平台，不混装）。
if (isMac) {
  // macOS 微信 OCR 运行时（libwxocr.dylib + libmmmojo.dylib + models），
  // 由 native/scripts/fetch-mac-vendor.cjs 从 npm 包拉取到 native/wechat-ocr-mac/。
  const macVendorSrc = join(nativeDir, 'wechat-ocr-mac')
  if (existsSync(macVendorSrc)) {
    cpSync(macVendorSrc, join(distNative, 'wechat-ocr-mac'), { recursive: true, force: true })
  }
} else {
  // Windows 专有运行时（wco_data），由 native/scripts/fetch-wco-data.cjs 从 NuGet 拉取。
  const wcoSrc = join(nativeDir, 'wco_data')
  if (existsSync(wcoSrc)) {
    cpSync(wcoSrc, join(distNative, 'wco_data'), { recursive: true, force: true })
  }
}

// Sanity check: warn if the addon or runtime files are missing.
const nodeFile = join(distNative, 'build', 'Release', 'wechat_ocr.node')
let nodeReady = existsSync(nodeFile)
if (!nodeReady) {
  console.warn('[copy-native] WARNING: build/Release/wechat_ocr.node not found.')
  console.warn('             Run `npm run build:native` first.')
}

// 运行时资源就绪判定：macOS 看 libwxocr.dylib，Windows 看 WeChatOCR.exe。
let runtimeReady
if (isMac) {
  const dylib = join(distNative, 'wechat-ocr-mac', 'lib', 'libwxocr.dylib')
  runtimeReady = existsSync(dylib)
  if (!runtimeReady) {
    console.warn('[copy-native] WARNING: wechat-ocr-mac/lib/libwxocr.dylib not found.')
    console.warn('             Copy the macOS WeChat OCR runtime into native/wechat-ocr-mac.')
  }
} else {
  const exe = join(distNative, 'wco_data', 'WeChatOCR.exe')
  runtimeReady = existsSync(exe)
  if (!runtimeReady) {
    console.warn('[copy-native] WARNING: wco_data/WeChatOCR.exe not found.')
    console.warn('             Run `cd native && npm run build` to auto-fetch wco_data from NuGet.')
  }
}

console.log('[copy-native] native assets copied to dist/native')

// ── 打包分发 zip（native-mac.zip / native-win.zip）─────────────────────
// zip 顶层包含 native/ 目录，用户下载后解压到插件根目录即可还原结构。
// native/ 缺关键文件时跳过打包并告警（避免分发残缺包）。
if (nodeReady && runtimeReady) {
  // 清理旧的 zip
  if (existsSync(distZip)) rmSync(distZip, { force: true })

  let r
  if (isMac) {
    // macOS：用系统 zip，在 dist/ 目录内对 native 打包，保留顶层 native/ 目录。
    // -r 递归、-q 静默、-y 保留符号链接（dylib 可能带 symlink）。
    r = spawnSync('zip', ['-r', '-q', '-y', zipName, 'native'], {
      cwd: distDir,
      encoding: 'utf8',
      shell: false
    })
  } else {
    // Windows：Compress-Archive 的 -Path 指向 dist\native（目录本身），
    // 保留顶级 native/ 目录，解压到插件根目录即还原结构。
    const psScript = `Compress-Archive -Path '${distNative.replace(/'/g, "''")}' -DestinationPath '${distZip.replace(/'/g, "''")}' -Force`
    r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      encoding: 'utf8',
      shell: false
    })
  }

  if (r.status !== 0 || !existsSync(distZip)) {
    console.warn(`[copy-native] WARNING: 生成 ${zipName} 失败。`)
    if (r.stderr) console.warn('             ' + r.stderr.trim())
    if (r.stdout) console.warn('             ' + r.stdout.trim())
  } else {
    const sizeMB = (statSync(distZip).size / 1024 / 1024).toFixed(1)
    console.log(`[copy-native] dist/${zipName} generated (${sizeMB} MB)`)
  }
} else {
  console.warn(`[copy-native] native assets incomplete, skipping ${zipName} packaging.`)
}
