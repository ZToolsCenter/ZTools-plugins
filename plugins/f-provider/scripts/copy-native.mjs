// Post-build: copy the native addon + wco_data into dist/ so the packaged
// plugin can load wechat_ocr.node and find WeChatOCR.exe + Model at runtime,
// then produce a distributable native.zip.
//
// Layout after copy + zip:
//   dist/
//     native/                        <- 解压版，方便开发调试
//       index.js
//       package.json
//       build/Release/wechat_ocr.node
//       wco_data/  (mmmojo_64.dll, WeChatOCR.exe, Model/, ...)
//     native.zip                     <- 分发版（顶层含 native/ 目录，解压即还原）
//     preload/services.js   (vite already copied from public/)
//
// 设计：插件初始不带 native，用户在前端点击「下载」后下载 native.zip 并解压到
// 插件根目录（顶层 native/ 解压后落到 <pluginRoot>/native/）。
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const nativeDir = join(root, 'native')
const distDir = join(root, 'dist')
const distNative = join(distDir, 'native')
const distZip = join(distDir, 'native.zip')

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

// The proprietary runtime files (wco_data), if present.
const wcoSrc = join(nativeDir, 'wco_data')
if (existsSync(wcoSrc)) {
  cpSync(wcoSrc, join(distNative, 'wco_data'), { recursive: true, force: true })
}

// Sanity check: warn if the addon or runtime files are missing.
const nodeFile = join(distNative, 'build', 'Release', 'wechat_ocr.node')
let nodeReady = existsSync(nodeFile)
if (!nodeReady) {
  console.warn('[copy-native] WARNING: build/Release/wechat_ocr.node not found.')
  console.warn('             Run `npm run build:native` first.')
}
const exe = join(distNative, 'wco_data', 'WeChatOCR.exe')
let wcoReady = existsSync(exe)
if (!wcoReady) {
  console.warn('[copy-native] WARNING: wco_data/WeChatOCR.exe not found.')
  console.warn('             Run `cd native && npm run build` to auto-fetch wco_data from NuGet.')
}

console.log('[copy-native] native assets copied to dist/native')

// ── 打包 native.zip（分发版）──────────────────────────────────────────
// zip 顶层包含 native/ 目录，用户下载后解压到插件根目录即可还原结构。
// native/ 缺关键文件时跳过打包并告警（避免分发残缺包）。
if (nodeReady && wcoReady) {
  // 清理旧的 zip
  if (existsSync(distZip)) rmSync(distZip, { force: true })

  // Compress-Archive 的 -Path 参数带通配，但 dist/ 下只有 native 一个目录，
  // 直接传 dist/native 的父目录 + native 会打包成 顶层/native/... 不对。
  // 正确做法：对 dist/ 执行，-Path 指向 native 子目录（含末尾通配 * 不带顶级），
  // 但我们需要保留顶级 native/ 目录，所以传 dist\native（目录本身）。
  const psScript = `Compress-Archive -Path '${distNative.replace(/'/g, "''")}' -DestinationPath '${distZip.replace(/'/g, "''")}' -Force`
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf8',
    shell: false
  })
  if (r.status !== 0 || !existsSync(distZip)) {
    console.warn('[copy-native] WARNING: 生成 native.zip 失败。')
    if (r.stderr) console.warn('             ' + r.stderr.trim())
    if (r.stdout) console.warn('             ' + r.stdout.trim())
  } else {
    const sizeMB = (statSync(distZip).size / 1024 / 1024).toFixed(1)
    console.log(`[copy-native] dist/native.zip generated (${sizeMB} MB)`)
  }
} else {
  console.warn('[copy-native] native assets incomplete, skipping native.zip packaging.')
}
