const { clipboard, nativeImage, shell } = require('electron')
const { execFile, execSync, spawn } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

// ==================== 剪贴板历史（本机持久化，不走同步库） ====================
// 全局用户目录下带 ideadock 标识，避免污染 home 根目录
const CLIP_DIR = path.join(os.homedir(), '.ideadock', 'clipboard')
const CLIP_HISTORY_FILE = path.join(CLIP_DIR, 'history.json')
let _clipLastSig            // 上次剪贴板签名；undefined 表示尚未初始化（首轮只记基线不入库）

function ensureClipDir() {
  if (!fs.existsSync(CLIP_DIR)) fs.mkdirSync(CLIP_DIR, { recursive: true })
  return CLIP_DIR
}

// 读复制的文件路径。Windows 下复制文件是 CF_HDROP，FileNameW 稳取「第一个」文件；
// 多选暂只取首个（拿全需解析 HDROP，后续再说）
function readClipboardFiles() {
  try {
    if (process.platform !== 'win32') return []
    const buf = clipboard.readBuffer('FileNameW')
    if (!buf || !buf.length) return []
    const s = buf.toString('ucs2').replace(/\0+$/, '').trim()
    return s ? [s] : []
  } catch { return [] }
}

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex')
}

function getDbStorage() {
  const host = window.utools || window.ztools
  return host && host.dbStorage ? host.dbStorage : null
}

function getHostApi() {
  return window.utools || window.ztools || null
}

function getHostDb() {
  const host = getHostApi()
  return host && host.db ? host.db : null
}

function storeGet(key) {
  const db = getDbStorage()
  if (!db || typeof db.getItem !== 'function') return null
  try {
    const value = db.getItem(key)
    return value !== undefined ? value : null
  } catch {
    return null
  }
}

function storeSet(key, value) {
  const db = getDbStorage()
  if (!db || typeof db.setItem !== 'function') return
  try { db.setItem(key, value) } catch {}
}

function storeRemove(key) {
  const db = getDbStorage()
  if (!db || typeof db.removeItem !== 'function') return
  try { db.removeItem(key) } catch {}
}

function backupTimestamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function cleanFilePart(name, fallback = 'text') {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '') || fallback
}

function extForLang(lang) {
  return ({ json: 'json', yaml: 'yaml', python: 'py', js: 'js', html: 'html', markdown: 'md', csv: 'csv' }[lang] || 'txt')
}

function splitBackupName(item, index) {
  const fallback = cleanFilePart(item.name || `text-${index + 1}`)
  const filename = String(item.filename || '').trim()
  const parsed = filename ? path.parse(filename) : null
  const base = cleanFilePart(parsed && parsed.name ? parsed.name : fallback, `text-${index + 1}`)
  const ext = cleanFilePart(parsed && parsed.ext ? parsed.ext.slice(1) : (item.ext || extForLang(item.lang)), 'txt')
  return { base, ext }
}

function langForExt(ext) {
  return ({ json: 'json', yaml: 'yaml', yml: 'yaml', py: 'python', js: 'js', mjs: 'js', cjs: 'js', html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', csv: 'csv' }[String(ext || '').toLowerCase()] || '')
}

function mimeForExt(ext) {
  return ({ webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[String(ext || '').toLowerCase()] || 'application/octet-stream')
}

function getAttachmentMime(db, id, fallback = 'image/webp') {
  if (!db || typeof db.getAttachmentType !== 'function') return fallback
  const typeInfo = db.getAttachmentType(id)
  if (typeof typeInfo === 'string') return typeInfo || fallback
  return (typeInfo && typeof typeInfo.type === 'string' && typeInfo.type) || fallback
}

function postBackupAsset(filePath) {
  const db = getHostDb()
  if (!db || typeof db.postAttachment !== 'function') return null
  try {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const id = `imgatt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const res = db.postAttachment(id, fs.readFileSync(filePath), mimeForExt(ext))
    return (res && (res.ok || res.id)) ? id : null
  } catch {
    return null
  }
}

function restoreMarkdownAssets(text, baseDir) {
  const assetsDir = path.join(baseDir, 'assets')
  if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) return text
  let out = text
  const files = fs.readdirSync(assetsDir).filter(name => fs.statSync(path.join(assetsDir, name)).isFile())
  files.forEach(name => {
    const id = postBackupAsset(path.join(assetsDir, name))
    if (!id) return
    const assetPath = `assets/${name}`
    out = out.split(assetPath).join(`img://${id}`)
  })
  return out
}

window.textTool = {
  readClipboard() {
    return clipboard.readText()
  },
  writeClipboard(text) {
    clipboard.writeText(text)
  },
  writePlainClipboard(text) {
    const value = String(text || '')
    try { clipboard.clear() } catch {}
    clipboard.writeText(value)
    _clipLastSig = 'T:' + value
  },

  // 轮询系统剪贴板：有「新」内容返回一条 entry，否则 null。类型优先级 文件 > 文本 > 图片。
  // 首次调用只记基线不返回，避免把启动时已在剪贴板里的内容当成新复制。
  pollClipboard() {
    let type, sig, entry
    const files = readClipboardFiles()
    const text = (() => { try { return clipboard.readText() || '' } catch { return '' } })()
    if (files.length) {
      type = 'file'; sig = 'F:' + files.join('|')
      entry = { type, paths: files }
    } else if (text) {
      type = 'text'; sig = 'T:' + text
      entry = { type, text }
    } else {
      // 仅当无文件无文本时才解码图片，避免正常复制文字被拖慢
      let png = null
      try {
        const img = clipboard.readImage()
        if (img && !img.isEmpty()) { png = img.toPNG(); var size = img.getSize() }
      } catch {}
      if (!png || !png.length) { _clipLastSig = ''; return null }
      sig = 'I:' + md5(png)
      if (sig === _clipLastSig) return null
      if (_clipLastSig === undefined) { _clipLastSig = sig; return null }
      _clipLastSig = sig
      const file = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.png`
      try {
        ensureClipDir()
        fs.writeFileSync(path.join(CLIP_DIR, file), png)
      } catch { return null }
      return { type: 'image', file, w: size.width, h: size.height, sig, ts: Date.now() }
    }
    if (sig === _clipLastSig) return null
    if (_clipLastSig === undefined) { _clipLastSig = sig; return null }
    _clipLastSig = sig
    entry.sig = sig
    entry.ts = Date.now()
    return entry
  },

  loadClipHistory() {
    try { return JSON.parse(fs.readFileSync(CLIP_HISTORY_FILE, 'utf8')) || [] } catch { return [] }
  },
  saveClipHistory(list) {
    try {
      ensureClipDir()
      fs.writeFileSync(CLIP_HISTORY_FILE, JSON.stringify(list || []), 'utf8')
    } catch {}
  },
  loadClipImage(file) {
    try {
      const buf = fs.readFileSync(path.join(CLIP_DIR, file))
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch { return null }
  },
  deleteClipImage(file) {
    try { fs.unlinkSync(path.join(CLIP_DIR, file)) } catch {}
  },

  // 卡片「复制」：把该条写回系统剪贴板，并同步 _clipLastSig 防止轮询把自己刚写回的当新内容
  copyEntryText(text) {
    clipboard.writeText(String(text || ''))
    _clipLastSig = 'T:' + String(text || '')
  },
  copyEntryImage(file) {
    try {
      const img = nativeImage.createFromPath(path.join(CLIP_DIR, file))
      if (img.isEmpty()) return false
      clipboard.writeImage(img)
      // 以「写回后剪贴板实际内容」的签名为准：经 OS 剪贴板可能重新编码，
      // 直接用原文件 md5 会与轮询读回时不一致，导致把自己刚复制的当成新内容
      try { _clipLastSig = 'I:' + md5(clipboard.readImage().toPNG()) } catch { _clipLastSig = 'I:' + md5(img.toPNG()) }
      return true
    } catch { return false }
  },
  copyEntryFiles(paths) {
    const list = Array.isArray(paths) ? paths : [paths]
    try {
      const host = getHostApi()
      if (host && typeof host.copyFile === 'function') {
        host.copyFile(list.length === 1 ? list[0] : list)
        _clipLastSig = 'F:' + list.join('|')
        return true
      }
    } catch {}
    return false
  },
  openPath(p) {
    try { shell.openPath(p) } catch {}
  },

  // 图片存入 uTools DB 附件（随账号同步、独立于暂存槽文本），返回短 id 供 img://id 引用
  saveImage(bytes, mime) {
    const db = getHostDb()
    if (!db || typeof db.postAttachment !== 'function') return null
    try {
      const id = `imgatt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const res = db.postAttachment(id, Buffer.from(bytes), mime || 'image/webp')
      return (res && (res.ok || res.id)) ? id : null
    } catch { return null }
  },

  // 由 id 取回附件并转成 data URI 供 <img> 显示；取不到返回 null
  getImageDataUrl(id) {
    const db = getHostDb()
    if (!id || !db || typeof db.getAttachment !== 'function') return null
    try {
      const buf = db.getAttachment(id)
      if (!buf) return null
      const mime = getAttachmentMime(db, id)
      return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
    } catch { return null }
  },

  // 清扫孤儿图片附件：删掉「无任何文本引用」且「创建超过 maxAgeMs」的 imgatt_ 附件。
  // 年龄宽限用于避开多设备同步竞态（新图可能尚未同步过引用它的槽）。返回删除数量。
  cleanupOrphanImages(usedIds, maxAgeMs) {
    const db = getHostDb()
    if (!db || typeof db.allDocs !== 'function' || typeof db.remove !== 'function') return 0
    try {
      const used = new Set(usedIds || [])
      const now = Date.now()
      const grace = typeof maxAgeMs === 'number' ? maxAgeMs : 86400000
      const docs = db.allDocs('imgatt_') || []
      let removed = 0
      for (const doc of docs) {
        const id = doc && doc._id
        if (!id || used.has(id)) continue
        const m = /^imgatt_([0-9a-z]+)_/.exec(id)   // 解析 id 里的 base36 时间戳
        if (!m) continue
        const ts = parseInt(m[1], 36)
        if (!Number.isFinite(ts) || now - ts < grace) continue   // 太新，跳过
        try { db.remove(doc); removed++ } catch (e) {}
      }
      return removed
    } catch (e) { return 0 }
  },

  // 插件根目录（开发模式为文件夹路径），供 Python 定位 textpack 包
  getPluginDir() {
    return __dirname
  },

  // 执行 Python 代码，返回 Promise<{ stdout, stderr }>
  runPython(code, timeoutSec = 5, pythonBin = '') {
    return new Promise((resolve) => {
      const tmpFile = path.join(os.tmpdir(), `ideadock_run_${Date.now()}.py`)
      fs.writeFileSync(tmpFile, code, 'utf8')
      const cmds = pythonBin ? [pythonBin] : (process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])

      // __dirname 在 .asar 打包后指向归档内部，Python 无法直接读取；改为从 .asar 内读取内容后写到 tmpdir
      const runner = path.join(os.tmpdir(), 'ideadock_python_runner.py')
      if (!fs.existsSync(runner)) {
        fs.writeFileSync(runner, fs.readFileSync(path.join(__dirname, 'python_runner.py'), 'utf8'), 'utf8')
      }

      const trySpawn = (cmdList) => {
        const cmd = cmdList[0]
        const rest = cmdList.slice(1)
        const proc = spawn(cmd, [runner, tmpFile], {
          timeout: timeoutSec * 1000,
          shell: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        })
        let stdout = '', stderr = ''
        proc.stdout.on('data', d => { stdout += d.toString() })
        proc.stderr.on('data', d => { stderr += d.toString() })
        proc.on('close', (exitCode, signal) => {
          if (signal === 'SIGTERM' || exitCode === null) {
            try { fs.unlinkSync(tmpFile) } catch {}
            resolve({ stdout, stderr: stderr + '\n[超时已中断]' })
            return
          }
          // cmd.exe 找不到命令时 stderr 是 GBK 乱码，包含替换字符 �，且 stdout 为空
          const notFound = exitCode !== 0 && !stdout.trim() && stderr.includes('�')
          if (notFound && rest.length > 0) {
            trySpawn(rest)
          } else {
            try { fs.unlinkSync(tmpFile) } catch {}
            if (notFound) {
              resolve({ stdout: '', stderr: '启动失败：未找到 Python，请确认系统已安装 Python 并可通过命令行访问' })
            } else {
              resolve({ stdout, stderr })
            }
          }
        })
        proc.on('error', (err) => {
          if (rest.length > 0) { trySpawn(rest); return }
          try { fs.unlinkSync(tmpFile) } catch {}
          resolve({ stdout: '', stderr: `启动失败：${err.message}\n请确认系统已安装 Python 并可通过命令行访问` })
        })
        window.textTool._currentProc = proc
      }

      trySpawn(cmds)
    })
  },

  killPython() {
    if (this._currentProc) {
      try { this._currentProc.kill() } catch {}
      this._currentProc = null
    }
  },

  runJs(code, timeoutSec = 30, nodeBin = '') {
    return new Promise((resolve) => {
      const tmpFile = path.join(os.tmpdir(), `ideadock_js_${Date.now()}.js`)
      fs.writeFileSync(tmpFile, code, 'utf8')
      const proc = spawn(nodeBin || 'node', [tmpFile], {
        timeout: timeoutSec * 1000,
        shell: true
      })
      let stdout = '', stderr = ''
      proc.stdout.on('data', d => { stdout += d.toString() })
      proc.stderr.on('data', d => { stderr += d.toString() })
      proc.on('close', (exitCode, signal) => {
        try { fs.unlinkSync(tmpFile) } catch {}
        if (signal === 'SIGTERM' || exitCode === null) {
          resolve({ stdout, stderr: stderr + '\n[超时已中断]' })
        } else {
          resolve({ stdout, stderr })
        }
      })
      proc.on('error', (err) => {
        try { fs.unlinkSync(tmpFile) } catch {}
        resolve({ stdout: '', stderr: `启动失败：${err.message}\n请确认系统已安装 Node.js 并可通过命令行访问` })
      })
      window.textTool._currentJsProc = proc
    })
  },

  killJs() {
    if (this._currentJsProc) {
      try { this._currentJsProc.kill() } catch {}
      this._currentJsProc = null
    }
  },

  getDocumentsPath() {
    const docs = path.join(os.homedir(), 'Documents')
    return fs.existsSync(docs) ? docs : os.homedir()
  },

  // 选择可执行文件，返回文件路径或 null
  pickExecutable(title) {
    const host = getHostApi()
    if (!host || typeof host.showOpenDialog !== 'function') return null
    const filters = process.platform === 'win32'
      ? [{ name: '可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: '所有文件', extensions: ['*'] }]
    const result = host.showOpenDialog({
      title: title || '选择可执行文件',
      properties: ['openFile'],
      filters
    })
    if (!result || !result.length) return null
    return result[0]
  },

  // 选择导出目录，返回目录路径或 null
  pickDirectory(opts) {
    const host = getHostApi()
    if (!host || typeof host.showOpenDialog !== 'function') return null
    const options = typeof opts === 'string' ? { title: opts } : (opts || {})
    const result = host.showOpenDialog({
      title: options.title || '选择导出目录',
      defaultPath: options.defaultPath || this.getDocumentsPath(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result || !result.length) return null
    return result[0]
  },

  // 直接写入 savePath；opts: { encoding: 'utf8' | 'utf8bom' | 'utf16le', eol: 'keep' | 'crlf' | 'lf' }
  listDirectory(dir) {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: '目录不存在' }
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(ent => !ent.name.startsWith('.'))
        .slice(0, 300)
        .map(ent => ({
          name: ent.name,
          path: path.join(dir, ent.name),
          isDir: ent.isDirectory()
        }))
        .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name))
      return { entries }
    } catch (e) {
      return { error: e.message }
    }
  },

  readTextFile(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return { error: '文件不存在' }
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_TEXT_FILE_BYTES) return { error: '文件过大，暂不直接打开（超过 5MB）' }
      return { name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8'), size: stat.size }
    } catch (e) {
      return { error: e.message }
    }
  },
  importBackup(dir) {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: '备份目录不存在' }
      const supported = new Set(['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'py', 'js', 'mjs', 'cjs', 'html', 'htm', 'css', 'csv', 'xml', 'log'])
      const items = []
      const readDoc = (filePath, bundleDir) => {
        const stat = fs.statSync(filePath)
        if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) return
        const filename = path.basename(filePath)
        const ext = path.extname(filename).slice(1).toLowerCase()
        if (!supported.has(ext)) return
        let text = fs.readFileSync(filePath, 'utf8')
        if ((ext === 'md' || ext === 'markdown') && bundleDir) text = restoreMarkdownAssets(text, bundleDir)
        items.push({
          name: path.basename(filename, path.extname(filename)),
          filename,
          text,
          lang: langForExt(ext)
        })
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      entries.forEach(ent => {
        const full = path.join(dir, ent.name)
        if (ent.isFile()) {
          readDoc(full, null)
          return
        }
        if (!ent.isDirectory() || ent.name === 'assets') return
        const preferred = path.join(full, `${ent.name}.md`)
        if (fs.existsSync(preferred)) {
          readDoc(preferred, full)
          return
        }
        const md = fs.readdirSync(full).find(name => /\.(md|markdown)$/i.test(name))
        if (md) readDoc(path.join(full, md), full)
      })
      return { ok: true, items }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },
  saveFile(content, savePath, opts) {
    const { encoding = 'utf8', eol = 'keep' } = opts || {}
    try {
      // 换行：先统一为 \n，再按需转换
      let text = content
      if (eol === 'crlf') text = content.replace(/\r\n|\r|\n/g, '\r\n')
      else if (eol === 'lf') text = content.replace(/\r\n|\r|\n/g, '\n')
      // 编码：组装字节
      let buf
      if (encoding === 'utf8bom') {
        buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')])
      } else if (encoding === 'utf16le') {
        buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
      } else {
        buf = Buffer.from(text, 'utf8')
      }
      const dir = path.dirname(savePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(savePath, buf)
      return { ok: true, path: savePath }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  // 生成不冲突的完整保存路径：同名已存在则依次尝试 base(1).ext、base(2).ext…
  uniqueSavePath(dir, base, ext) {
    try {
      const clean = String(base).replace(/[\\/:*?"<>|]/g, '').trim() || 'ideadock'
      let p = path.join(dir, `${clean}.${ext}`)
      let i = 1
      while (fs.existsSync(p)) {
        p = path.join(dir, `${clean}(${i}).${ext}`)
        i++
      }
      return p
    } catch {
      return path.join(dir, `${base}.${ext}`)
    }
  },

  // 导出带图 Markdown：整体放进 dir/base/ 独立文件夹（base.md + assets/ 子目录），
  // img://id 改写为相对路径 assets/xxx.webp，得到可整体移动、任意 Markdown 阅读器（含 GitHub）
  // 都能正常显示图片的自包含目录。返回 { ok, path, images }（path 为文件夹路径）
  exportMarkdown(text, dir, base, opts) {
    const { encoding = 'utf8', eol = 'keep' } = opts || {}
    const mimeExt = m => ({ 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[m] || 'png')
    try {
      const clean = String(base).replace(/[\\/:*?"<>|]/g, '').trim() || 'ideadock'
      // 独立容器文件夹；同名已存在则加 (1)(2)…
      let container = path.join(dir, clean)
      let i = 1
      while (fs.existsSync(container)) { container = path.join(dir, `${clean}(${i})`); i++ }
      fs.mkdirSync(container, { recursive: true })

      const ids = new Set()
      text.replace(/img:\/\/([A-Za-z0-9_]+)/g, (_, id) => { ids.add(id); return _ })
      let out = text
      let written = 0
      const db = getHostDb()
      if (ids.size && db && typeof db.getAttachment === 'function') {
        const assetsDir = path.join(container, 'assets')
        fs.mkdirSync(assetsDir, { recursive: true })
        for (const id of ids) {
          const buf = db.getAttachment(id)
          if (!buf) continue
          const mime = getAttachmentMime(db, id)
          const fname = `${id}.${mimeExt(mime)}`
          fs.writeFileSync(path.join(assetsDir, fname), Buffer.from(buf))
          out = out.split(`img://${id}`).join(`assets/${fname}`)
          written++
        }
      }
      const res = this.saveFile(out, path.join(container, `${clean}.md`), { encoding, eol })
      return res.ok ? { ok: true, path: container, images: written } : res
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  exportBackup(items, dir, opts) {
    const { encoding = 'utf8', eol = 'keep' } = opts || {}
    try {
      const list = Array.isArray(items) ? items : []
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: '导出目录不存在' }
      let root = path.join(dir, `ideadoc-${backupTimestamp()}`)
      let i = 1
      while (fs.existsSync(root)) { root = path.join(dir, `ideadoc-${backupTimestamp()}(${i})`); i++ }
      fs.mkdirSync(root, { recursive: true })

      let files = 0
      let bundles = 0
      let images = 0
      list.forEach((item, index) => {
        const text = String(item.text || '')
        if (!text) return
        const { base, ext } = splitBackupName(item, index)
        const isImageMd = (item.lang === 'markdown' || ext.toLowerCase() === 'md' || ext.toLowerCase() === 'markdown') && /img:\/\//.test(text)
        if (isImageMd && this.exportMarkdown) {
          const res = this.exportMarkdown(text, root, base, { encoding, eol })
          if (!res.ok) throw new Error(res.error || `导出失败：${base}`)
          bundles++
          images += res.images || 0
        } else {
          const savePath = this.uniqueSavePath(root, base, ext)
          const res = this.saveFile(text, savePath, { encoding, eol })
          if (!res.ok) throw new Error(res.error || `导出失败：${base}`)
          files++
        }
      })
      return { ok: true, path: root, files, bundles, images }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  detectBinaries() {
    const isWin = process.platform === 'win32'
    const result = {}
    const resolve = (cmd) => {
      try {
        const out = execSync(isWin ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe', timeout: 3000, shell: true }).toString().trim()
        return out.split(/\r?\n/)[0].trim() || ''
      } catch { return '' }
    }
    for (const cmd of (isWin ? ['python', 'python3'] : ['python3', 'python'])) {
      const p = resolve(cmd)
      if (p) { result.python = p; break }
    }
    const n = resolve('node')
    if (n) result.node = n
    const codex = resolve('codex')
    if (codex) result.codex = codex
    const claude = resolve('claude')
    if (claude) result.claude = claude
    return result
  },

  // 用 black 格式化 Python 代码
  formatPython(code, pythonBin = '') {
    return new Promise((resolve) => {
      const cmds = pythonBin ? [pythonBin] : (process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])

      const trySpawn = (cmdList) => {
        const cmd = cmdList[0]
        const rest = cmdList.slice(1)
        const args = ['-m', 'black', '--line-length', '88', '-q', '-']
        const proc = spawn(cmd, args, {
          shell: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
        })
        let out = '', err = ''
        proc.stdout.on('data', d => { out += d.toString() })
        proc.stderr.on('data', d => { err += d.toString() })
        proc.stdin.write(code)
        proc.stdin.end()
        proc.on('close', (exitCode) => {
          const notFound = exitCode !== 0 && !out && err.includes('�')
          if (notFound && rest.length > 0) { trySpawn(rest); return }
          if (exitCode === 0) resolve({ ok: true, result: out })
          else resolve({ ok: false, error: err || '格式化失败，请确认已安装 black（pip install black）' })
        })
        proc.on('error', () => {
          if (rest.length > 0) { trySpawn(rest); return }
          resolve({ ok: false, error: '未找到 Python，请确认系统已安装 Python' })
        })
      }

      trySpawn(cmds)
    })
  },

  runAi(opts = {}) {
    const provider = opts.provider || 'codex'
    if (provider === 'url') return runAiUrl(opts)
    return runAiCommand(opts)
  },

  saveTextToSlot({ text, name } = {}) {
    return saveTextToSlotShared({ text, name, pin: false })
  },

  saveAndPinText({ text, name } = {}) {
    return saveTextToSlotShared({ text, name, pin: true })
  },

  getActiveSlotText() {
    return getActiveSlotTextShared()
  },

  appendToActiveSlot({ text, separator } = {}) {
    return appendToActiveSlotShared({ text, separator })
  }
}

function runAiCommand(opts) {
  return new Promise((resolve) => {
    const command = String(opts.command || (opts.provider === 'claude' ? 'claude -p' : 'codex exec -')).trim()
    const prompt = String(opts.prompt || opts.instruction || '')
    if (!command) {
      resolve({ ok: false, error: 'AI command is empty' })
      return
    }
    const bin = firstCommandToken(command)
    if (bin && !commandExists(bin)) {
      resolve({ ok: false, error: missingAiCommandMessage(opts.provider || 'codex', bin) })
      return
    }
    const spawnOpts = {
      shell: true,
      timeout: opts.mode === 'agent' ? 600000 : 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    }
    if (opts.mode === 'agent') {
      const cwd = String(opts.cwd || '').trim()
      if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        resolve({ ok: false, error: 'Agent workspace is not available' })
        return
      }
      spawnOpts.cwd = cwd
    }
    const proc = spawn(command, [], spawnOpts)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', (exitCode, signal) => {
      if (signal === 'SIGTERM' || exitCode === null) {
        resolve({ ok: false, error: 'AI command timed out' })
        return
      }
      if (exitCode === 0) resolve({ ok: true, text: stdout.trim() })
      else resolve({ ok: false, error: (stderr || stdout || `AI command exited with code ${exitCode}`).trim() })
    })
    proc.on('error', err => resolve({ ok: false, error: missingAiCommandMessage(opts.provider || 'codex', bin) || err.message }))
    try {
      proc.stdin.write(prompt)
      proc.stdin.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
}

function firstCommandToken(command) {
  const value = String(command || '').trim()
  if (!value) return ''
  const quote = value[0]
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1)
    return end > 1 ? value.slice(1, end) : value.slice(1)
  }
  return value.split(/\s+/)[0] || ''
}

function commandExists(bin) {
  const value = String(bin || '').trim()
  if (!value) return false
  if (/[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) return fs.existsSync(value)
  if (!/^[\w.-]+$/.test(value)) return true
  try {
    const cmd = process.platform === 'win32' ? `where ${value}` : `command -v ${value}`
    execSync(cmd, { stdio: 'ignore', timeout: 3000, shell: true })
    return true
  } catch {
    return false
  }
}

function missingAiCommandMessage(provider, bin) {
  const name = String(provider || '').toLowerCase() === 'claude' ? 'Claude CLI' : 'Codex CLI'
  const commandName = String(bin || '').trim() || (name === 'Claude CLI' ? 'claude' : 'codex')
  return `未找到 ${name}：无法执行 ${commandName}。请先安装并确认该命令可以在终端中访问，或在设置里修改 AI 命令路径。`
}

function runAiUrl(opts) {
  return new Promise((resolve) => {
    try {
      const endpoint = normalizeAiEndpoint(String(opts.url || '').trim())
      if (!endpoint) {
        resolve({ ok: false, error: 'AI URL is empty' })
        return
      }
      const urlObj = new URL(endpoint)
      const lib = urlObj.protocol === 'https:' ? require('https') : require('http')
      const body = JSON.stringify({
        model: opts.model || undefined,
        messages: [
          { role: 'system', content: 'You edit text. Return only the final answer unless asked otherwise.' },
          { role: 'user', content: String(opts.prompt || '') }
        ],
        stream: false
      })
      const req = lib.request({
        method: 'POST',
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {})
        },
        timeout: 120000
      }, res => {
        let raw = ''
        res.on('data', d => { raw += d.toString() })
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ ok: false, error: raw || `HTTP ${res.statusCode}` })
            return
          }
          try {
            const json = JSON.parse(raw)
            const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? json.output_text ?? json.text ?? raw
            resolve({ ok: true, text: String(text).trim() })
          } catch {
            resolve({ ok: true, text: raw.trim() })
          }
        })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, error: 'AI URL request timed out' })
      })
      req.on('error', err => resolve({ ok: false, error: err.message }))
      req.write(body)
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
}

function normalizeAiEndpoint(endpoint) {
  if (!endpoint) return ''
  try {
    const urlObj = new URL(endpoint)
    const path = urlObj.pathname.replace(/\/+$/, '')
    if (!path) {
      urlObj.pathname = '/v1/chat/completions'
      return urlObj.toString()
    }
    if (/\/api\/vi\/chat$/i.test(path)) {
      urlObj.pathname = path.replace(/\/api\/vi\/chat$/i, '/v1/chat/completions')
      return urlObj.toString()
    }
    if (/\/api\/v1\/chat$/i.test(path) || /\/v1\/chat$/i.test(path)) {
      urlObj.pathname = path.replace(/\/api\/v1\/chat$/i, '/v1/chat/completions').replace(/\/v1\/chat$/i, '/v1/chat/completions')
      return urlObj.toString()
    }
    return endpoint
  } catch {
    return endpoint
  }
}

// ==================== MCP 工具注册 ====================

const SLOTS_KEY = 'ideadock.slots'
const ACTIVE_KEY = 'ideadock.activeSlot'

function loadSlotsRaw() {
  let slots = []
  try {
    const raw = storeGet(SLOTS_KEY)
    if (raw) slots = JSON.parse(raw)
  } catch {}
  if (!slots || slots.length === 0) slots = [{ id: 1, name: '暂存1', text: '' }]
  return slots
}

function nextSlotId(slots) {
  return slots.reduce((max, slot) => Math.max(max, Number(slot.id) || 0), 0) + 1
}

function nextDefaultSlotName(slots) {
  const used = new Set()
  slots.forEach(slot => {
    const match = /^暂存(\d+)$/.exec(slot.name || '')
    if (match) used.add(Number(match[1]))
  })
  let n = 1
  while (used.has(n)) n++
  return `暂存${n}`
}

function notifySlotsChanged() {
  if (typeof window._reloadSlotsFromStorage === 'function') {
    try { window._reloadSlotsFromStorage() } catch {}
  }
}

function saveTextToSlotShared({ text, name, pin } = {}) {
  const slots = loadSlotsRaw()
  const id = nextSlotId(slots)
  const slotName = name || nextDefaultSlotName(slots)
  const slot = { id, name: slotName, text: text || '' }
  if (name) slot.named = true
  slots.push(slot)
  storeSet(SLOTS_KEY, JSON.stringify(slots))
  storeSet(ACTIVE_KEY, String(id))
  if (pin && typeof window._pinSlot === 'function') window._pinSlot(id)
  notifySlotsChanged()
  return { id, name: slotName, pinned: !!pin }
}

function getActiveSlotTextShared() {
  const slots = loadSlotsRaw()
  const activeId = parseInt(storeGet(ACTIVE_KEY), 10)
  const slot = slots.find(s => s.id === activeId) || slots[0]
  return { id: slot.id, name: slot.name, text: slot.text }
}

function appendToActiveSlotShared({ text, separator } = {}) {
  const slots = loadSlotsRaw()
  const activeId = parseInt(storeGet(ACTIVE_KEY), 10)
  const slot = slots.find(s => s.id === activeId) || slots[0]
  const sep = separator !== undefined ? String(separator) : (slot.text ? '\n' : '')
  slot.text = String(slot.text || '') + sep + String(text || '')
  storeSet(SLOTS_KEY, JSON.stringify(slots))
  storeSet(ACTIVE_KEY, String(slot.id))
  notifySlotsChanged()
  return { id: slot.id, name: slot.name, text: slot.text }
}

const toolHost = getHostApi()
if (toolHost && typeof toolHost.registerTool === 'function') {
  const registerTool = toolHost.registerTool.bind(toolHost)
  registerTool('save_text_to_slot', async ({ text, name } = {}) => {
    return saveTextToSlotShared({ text, name, pin: false })
  })

  registerTool('save_and_pin_text', async ({ text, name } = {}) => {
    return saveTextToSlotShared({ text, name, pin: true })
  })

  registerTool('get_active_slot_text', async () => {
    return getActiveSlotTextShared()
  })

  registerTool('append_to_active_slot', async ({ text, separator } = {}) => {
    return appendToActiveSlotShared({ text, separator })
  })
}
