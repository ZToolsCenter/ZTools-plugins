// 组装并（可选）发布 @jspatrick/f-provider-latex npm 包。
//
// 输入：GitHub Release 上的三个产物（由 .github/workflows/release.yml 产出）
//   - latex-ort-win.zip    顶层 onnxruntime-node/（Windows 原生二进制）
//   - latex-ort-mac.zip    顶层 onnxruntime-node/（macOS 原生二进制）
//   - latex-models.zip     顶层 models/（encoder/decoder/image_resizer + tokenizer）
//
// 去重思路：models 跨平台一致只放一份；onnxruntime-node 按平台分目录。组装后
// 一个 universal tgz 同时服务 Win/Mac，安装时 latexDownload 按当前平台选取
// onnxruntime-node-* 目录装配 <userData>/f-provider/latex/。
//
// npm tgz 布局（npm pack 产出，latexDownload 直接消费）：
//   package/
//     package.json
//     dist/
//       models/                 <- 来自 latex-models.zip
//       onnxruntime-node-win/   <- 来自 latex-ort-win.zip（重命名自 onnxruntime-node/）
//       onnxruntime-node-mac/   <- 来自 latex-ort-mac.zip（重命名自 onnxruntime-node/）
//
// 用法（在仓库根目录执行）：
//   node scripts/pack-latex-tgz.mjs --tag v1.0.0              # 用 gh 下载 Release 产物并打 tgz
//   node scripts/pack-latex-tgz.mjs --tag v1.0.0 --publish    # 额外执行 npm publish --access public
//   node scripts/pack-latex-tgz.mjs --dir ./latex-artifacts   # 用本地已下载的 3 个 zip
//   node scripts/pack-latex-tgz.mjs --dir ./latex-artifacts --version 1.0.0 --publish
//
// 依赖：使用 --tag 时需要已认证的 GitHub `gh` CLI（gh 会从 git remote 推断仓库）。
//       版本号需与 plugin.json 的 nativeLatex.version 及 downloadUrl 中的一致。
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_NAME = '@jspatrick/f-provider-latex'
const ARTIFACTS = {
  'latex-ort-win.zip': 'onnxruntime-node-win',
  'latex-ort-mac.zip': 'onnxruntime-node-mac',
  'latex-models.zip': 'models'
}
const EXPECTED = [
  'models/encoder.onnx',
  'models/decoder.onnx',
  'models/image_resizer.onnx',
  'models/tokenizer.json',
  'onnxruntime-node-win/package.json',
  'onnxruntime-node-mac/package.json'
]

// Windows 下 spawn npm/gh 需要 shell 解析 .cmd/.exe（PATHEXT）；macOS 直接执行。
const SHELL = process.platform === 'win32'

function parseArgs(argv) {
  const out = { tag: '', dir: '', version: '', publish: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tag') out.tag = argv[++i]
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--version') out.version = argv[++i]
    else if (a === '--publish') out.publish = true
  }
  return out
}

// 解压 zip 到目标目录（幂等覆盖）。复用 services.js 同款平台差异处理。
function unzip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true })
  let r
  if (process.platform === 'darwin') {
    r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], {
      encoding: 'utf8',
      shell: false
    })
  } else {
    const ps = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      shell: false
    })
  }
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').toString().trim()
    throw new Error('解压失败 ' + zipPath + (detail ? ': ' + detail : ''))
  }
}

// 在解压结果里找到唯一的顶层目录条目（忽略隐藏文件 / __MACOSX 等元数据目录）。
function pickTopDir(extractDir) {
  const entries = readdirSync(extractDir).filter(
    (n) => !n.startsWith('.') && n !== '__MACOSX'
  )
  for (const n of entries) {
    try {
      if (statSync(join(extractDir, n)).isDirectory()) return join(extractDir, n)
    } catch (_) {}
  }
  return join(extractDir, entries[0])
}

// 把 srcDir 整体复制到 destParent/targetName（覆盖）。
function moveInto(destParent, srcDir, targetName) {
  mkdirSync(destParent, { recursive: true })
  const target = join(destParent, targetName)
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  cpSync(srcDir, target, { recursive: true, force: true })
}

function runInherit(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: SHELL, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
  return r
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.tag && !opts.dir) {
    console.error(
      '用法: node scripts/pack-latex-tgz.mjs --tag v1.0.0 [--publish]  或  --dir <含3个zip的目录> [--version 1.0.0] [--publish]'
    )
    process.exit(2)
  }
  const version = opts.version || (opts.tag ? opts.tag.replace(/^v/, '') : '')
  if (!version) {
    console.error('缺少版本号（用 --version 或 --tag v1.0.0）')
    process.exit(2)
  }

  const work = mkdtempSync(join(tmpdir(), 'f-provider-latex-pkg-'))
  const distDir = join(work, 'dist')
  mkdirSync(distDir, { recursive: true })

  // 把单个 zip 解压并放置到 dist/<targetName>/
  function placeZip(zipPath, targetName) {
    const ex = mkdtempSync(join(tmpdir(), 'f-provider-latex-ex-'))
    try {
      unzip(zipPath, ex)
      moveInto(distDir, pickTopDir(ex), targetName)
    } finally {
      try { rmSync(ex, { recursive: true, force: true }) } catch (_) {}
    }
  }

  if (opts.tag) {
    // 用 gh 从指定 Release 下载三个产物
    const raw = join(work, 'raw')
    mkdirSync(raw, { recursive: true })
    for (const zip of Object.keys(ARTIFACTS)) {
      console.log(`[pack-latex] gh 下载 ${zip}（tag ${opts.tag}）...`)
      const r = spawnSync(
        'gh',
        ['release', 'download', opts.tag, '--pattern', zip, '--dir', raw, '--clobber'],
        { encoding: 'utf8', shell: SHELL, stdio: 'inherit' }
      )
      if (r.status !== 0 || !existsSync(join(raw, zip))) {
        throw new Error(`下载 ${zip} 失败（确认 Release 已上传该产物，且 gh 已登录）`)
      }
      placeZip(join(raw, zip), ARTIFACTS[zip])
    }
  } else {
    for (const zip of Object.keys(ARTIFACTS)) {
      const p = resolve(opts.dir, zip)
      if (!existsSync(p)) throw new Error('未找到 ' + p)
      placeZip(p, ARTIFACTS[zip])
    }
  }

  // 校验 dist 结构齐全
  for (const rel of EXPECTED) {
    if (!existsSync(join(distDir, rel))) throw new Error('组装缺失: dist/' + rel)
  }

  // 写 package.json
  const pkgJson = {
    name: PKG_NAME,
    version,
    description:
      'LaTeX (pix2tex ONNX) OCR engine assets for the f-provider ZTools plugin (dedup: shared models + per-platform onnxruntime-node)',
    files: ['dist']
  }
  writeFileSync(join(work, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n')
  console.log(`[pack-latex] package.json written (${PKG_NAME}@${version})`)

  // npm pack → tgz
  console.log('[pack-latex] npm pack ...')
  runInherit('npm', ['pack'], work)
  const tgzName = `${PKG_NAME.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
  const tgzPath = join(work, tgzName)
  if (!existsSync(tgzPath)) throw new Error('未找到 npm pack 产物: ' + tgzName)
  const sizeMB = (statSync(tgzPath).size / 1024 / 1024).toFixed(1)
  console.log(`[pack-latex] tgz 产物: ${tgzPath} (${sizeMB} MB)`)

  if (opts.publish) {
    console.log('[pack-latex] npm publish --access public ...')
    runInherit('npm', ['publish', tgzPath, '--access', 'public'], work)
    console.log('[pack-latex] 发布完成。npmmirror 会在数分钟内同步。')
  } else {
    console.log('[pack-latex] 未带 --publish，仅打 tgz。确认无误后执行：')
    console.log(`  npm publish "${tgzPath}" --access public`)
  }

  // 保留工作目录便于检查产物
  console.log('[pack-latex] 工作目录: ' + work)
}

main().catch((e) => {
  console.error('[pack-latex] 失败:', e && e.message ? e.message : String(e))
  process.exit(1)
})
