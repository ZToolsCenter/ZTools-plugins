// Post-build: stage the LaTeX OCR engine assets and produce per-part
// distributable zips for the GitHub Release (assembled into the npm tgz
// separately by scripts/pack-latex-tgz.mjs).
//
// 为什么去重：models（~179MB，encoder/decoder/image_resizer/tokenizer）跨平台
// 完全一致，只放一份；onnxruntime-node 的原生二进制随平台不同，按平台各打
// 一个小 zip。这样一个 universal 的 npm tgz 即可同时服务 Win/Mac，体积约为
// 「每平台各塞一份 models」方案的一半，稳定落在 npm 可接受区间。
//
// 产物（上传到 GitHub Release，供 pack-latex-tgz.mjs 组装 npm tgz）：
//   dist/latex/
//     onnxruntime-node/   <- 从当前平台 node_modules 复制（当前平台原生二进制）
//     models/             <- 由 native/scripts/fetch-latex-models.cjs 拉取
//   dist/latex-ort-{win,mac}.zip   <- 顶层 onnxruntime-node/（平台 ORT，小）
//   dist/latex-models.zip          <- 顶层 models/（共享模型，~179MB，仅上传一次）
//
// 最终 npm tgz（@jspatrick/f-provider-latex）布局（universal）：
//   package/dist/
//     models/                 <- 来自 latex-models.zip
//     onnxruntime-node-win/   <- 来自 latex-ort-win.zip（重命名自 onnxruntime-node/）
//     onnxruntime-node-mac/   <- 来自 latex-ort-mac.zip（重命名自 onnxruntime-node/）
// 安装时 latexDownload 按当前平台选取 onnxruntime-node-* 目录，与 models 组装
// 成 <userData>/f-provider/latex/{onnxruntime-node, models}。
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distDir = join(root, 'dist')
const staging = join(distDir, 'latex')
const isMac = process.platform === 'darwin'
const ortZipName = isMac ? 'latex-ort-mac.zip' : 'latex-ort-win.zip'
const modelsZipName = 'latex-models.zip'

if (!existsSync(distDir)) {
  console.warn('[copy-latex] dist/ not found, skipping')
  process.exit(0)
}

mkdirSync(staging, { recursive: true })

// 1) 复制 onnxruntime-node（当前平台的完整包，含原生二进制）
const ortSrc = join(root, 'node_modules', 'onnxruntime-node')
const ortDst = join(staging, 'onnxruntime-node')
if (!existsSync(ortSrc)) {
  console.warn('[copy-latex] WARNING: node_modules/onnxruntime-node not found.')
  console.warn('             Run `npm install` first.')
} else {
  if (existsSync(ortDst)) rmSync(ortDst, { recursive: true, force: true })
  cpSync(ortSrc, ortDst, { recursive: true, force: true })
  console.log('[copy-latex] onnxruntime-node copied to dist/latex/onnxruntime-node')

  // 连带复制 onnxruntime-common:onnxruntime-node 运行时 require 它
  // (dist/index.js 与 binding.js),不带上解压到 userData 后会报
  // Cannot find module 'onnxruntime-common'。落点放其内部 node_modules/,
  // 保持 npm 标准布局,require 解析沿路径向上即命中。common 无依赖不链式。
  // (adm-zip / global-agent 仅 postinstall 用,运行时不需要,不带。)
  const commonSrc = join(root, 'node_modules', 'onnxruntime-common')
  const commonDst = join(ortDst, 'node_modules', 'onnxruntime-common')
  if (!existsSync(commonSrc)) {
    console.warn('[copy-latex] WARNING: node_modules/onnxruntime-common not found.')
    console.warn('             onnxruntime-node 运行时 require 它,缺失会导致识别报错。')
  } else {
    mkdirSync(join(ortDst, 'node_modules'), { recursive: true })
    cpSync(commonSrc, commonDst, { recursive: true, force: true })
    console.log('[copy-latex] onnxruntime-common copied to dist/latex/onnxruntime-node/node_modules/')
  }
}

// 2) 校验 models/（由 fetch-latex-models.cjs 拉取到 dist/latex/models/）
const modelsDir = join(staging, 'models')
const required = ['encoder.onnx', 'decoder.onnx', 'image_resizer.onnx', 'tokenizer.json']
let modelsReady = true
for (const f of required) {
  if (!existsSync(join(modelsDir, f))) {
    console.warn(`[copy-latex] WARNING: models/${f} not found.`)
    console.warn('             Run `npm run fetch:latex` first.')
    modelsReady = false
  }
}
if (modelsReady) console.log('[copy-latex] LaTeX OCR models present')

const ortReady = existsSync(join(ortDst, 'package.json'))
const commonReady = existsSync(join(ortDst, 'node_modules', 'onnxruntime-common', 'package.json'))
if (!ortReady || !commonReady || !modelsReady) {
  if (!ortReady) console.warn('[copy-latex] WARNING: onnxruntime-node/package.json not found.')
  if (!commonReady) console.warn('[copy-latex] WARNING: onnxruntime-node/node_modules/onnxruntime-common/package.json not found.')
  console.warn('[copy-latex] latex assets incomplete, skipping zip packaging.')
  process.exit(0)
}

// 3) 打包单个目录为 zip（保留顶层目录名）
//    parentDir/baseName 是要打包的目录；zip 顶层条目为 baseName/。
function zipDir(parentDir, baseName, zipPath, label) {
  if (existsSync(zipPath)) rmSync(zipPath, { force: true })
  let r
  if (isMac) {
    // macOS：cwd 到父目录、用相对名打 zip，保留顶层 baseName/ 目录
    r = spawnSync('zip', ['-r', '-q', '-y', zipPath, baseName], {
      cwd: parentDir,
      encoding: 'utf8',
      shell: false
    })
  } else {
    // Windows：Compress-Archive 指向目录本身，保留顶级 baseName/ 目录
    const src = join(parentDir, baseName).replace(/'/g, "''")
    const dst = zipPath.replace(/'/g, "''")
    const ps = `Compress-Archive -Path '${src}' -DestinationPath '${dst}' -Force`
    r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      shell: false
    })
  }
  if (r.status !== 0 || !existsSync(zipPath)) {
    console.warn(`[copy-latex] WARNING: 生成 ${label} 失败。`)
    if (r.stderr) console.warn('             ' + r.stderr.toString().trim())
    if (r.stdout) console.warn('             ' + r.stdout.toString().trim())
    return false
  }
  const sizeMB = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`[copy-latex] ${label} generated (${sizeMB} MB)`)
  return true
}

// 4) 产出分发 zip：平台 ORT + 共享 models
//    models zip 在两个 runner 上都会生成（copy:latex 平台无关），但 release.yml
//    只在 win job 上传，避免 Release 里出现重复的同名产物。
zipDir(staging, 'onnxruntime-node', join(distDir, ortZipName), ortZipName)
zipDir(staging, 'models', join(distDir, modelsZipName), modelsZipName)
