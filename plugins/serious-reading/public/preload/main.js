/**
 * 主窗 preload —— CommonJS，不参与编译打包。
 * 职责：文件读取/解码、EPUB 解析（含封面）、PDF 取 ArrayBuffer、
 *      创建并持有悬浮阅读窗 BrowserWindow、转发 IPC（真隐藏等）。
 */
const fs = require('fs')
const path = require('path')
const { ipcRenderer } = require('electron')
const DB_PREFIX = 'serious_reading/'
const BOOKS_DOC_ID = DB_PREFIX + 'books'

// 第三方依赖放 preload/node_modules，原样提交，不压缩
const iconv = require('./node_modules/iconv-lite')
const AdmZip = require('./node_modules/adm-zip')
let jschardet = null
try {
  jschardet = require('./node_modules/jschardet')
} catch (e) {
  /* jschardet 缺失时退化为 BOM+GBK */
}

/* ---------------- 编码检测 + 解码 ---------------- */

function detectByBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
  return null
}

function detectEncoding(buf) {
  const bom = detectByBom(buf)
  if (bom) return bom
  if (jschardet && buf.length > 0) {
    try {
      const sample = buf.length > 2500 ? buf.subarray(0, 2500) : buf
      const r = jschardet.detect(Buffer.from(sample))
      if (r && r.confidence > 0.5 && r.encoding) return r.encoding.toLowerCase()
    } catch (e) {}
  }
  // 无 BOM 的中文小说大概率 GBK（GB18030 为 GBK 超集，iconv 的 gbk 解码器兼容）
  return 'gbk'
}

function decodeBuffer(buf) {
  const enc = detectEncoding(buf)
  try {
    return iconv.decode(buf, enc)
  } catch (e) {
    return iconv.decode(buf, 'utf-8')
  }
}

/* ---------------- 暴露给渲染进程的服务 ---------------- */

window.services = {
  _readerWin: null,

  readTxt(filePath) {
    try {
      const buf = fs.readFileSync(filePath)
      let s = decodeBuffer(buf)
      if (s.charCodeAt(0) === 0xfeff) s = s.substring(1)
      return s
    } catch (e) {
      return null
    }
  },

  readPdf(filePath) {
    try {
      const buf = fs.readFileSync(filePath)
      // 转 ArrayBuffer 交给 pdfjs
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch (e) {
      return null
    }
  },

  readBuffer(filePath) {
    try {
      return fs.readFileSync(filePath)
    } catch (e) {
      return null
    }
  },

  readEpub(filePath) {
    try {
      const zip = new AdmZip(filePath)
      const containerXml = zip.readAsText('META-INF/container.xml')
      if (!containerXml) return null
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/)
      if (!opfPathMatch) return null
      const opfPath = opfPathMatch[1]
      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''
      const opfXml = zip.readAsText(opfPath)
      if (!opfXml) return null

      // manifest（属性顺序不固定，逐个提取）
      const manifest = {}
      const itemRegex = /<item\s+([^>]+)[\/]?>/g
      let mMatch
      while ((mMatch = itemRegex.exec(opfXml)) !== null) {
        const attrs = mMatch[1]
        const idM = attrs.match(/id="([^"]+)"/)
        const hrefM = attrs.match(/href="([^"]+)"/)
        const typeM = attrs.match(/media-type="([^"]+)"/)
        if (idM && hrefM && typeM) manifest[idM[1]] = { href: hrefM[1], type: typeM[1] }
      }
      // spine
      const spineItems = []
      const spineRegex = /<itemref\s+idref="([^"]+)"/g
      let sMatch
      while ((sMatch = spineRegex.exec(opfXml)) !== null) spineItems.push(sMatch[1])
      // ncx toc（不要求 playOrder）
      const ncxIdMatch = opfXml.match(/<spine[^>]*toc="([^"]+)"/)
      const toc = []
      if (ncxIdMatch) {
        const ncxItem = manifest[ncxIdMatch[1]]
        if (ncxItem) {
          const ncxXml = zip.readAsText(opfDir + ncxItem.href)
          if (ncxXml) {
            const navRegex = /<navPoint[\s\S]*?<text>([^<]+)<\/text>[\s\S]*?<content\s+src="([^"]+)"/g
            let npMatch
            while ((npMatch = navRegex.exec(ncxXml)) !== null) {
              toc.push({ title: npMatch[1], src: npMatch[2] })
            }
          }
        }
      }
      // 封面（metadata.cover 指向 manifest id）
      let cover = null
      const coverMeta = opfXml.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/)
      if (coverMeta && manifest[coverMeta[1]]) {
        try {
          cover = zip.readFile(opfDir + manifest[coverMeta[1]].href)
        } catch (e) {}
      }

      const chapters = []
      spineItems.forEach(function (id) {
        const item = manifest[id]
        if (!item || !item.type.match(/html|xhtml/)) return
        const html = zip.readAsText(opfDir + item.href)
        if (!html) return
        let title = ''
        const tocItem = toc.find((t) => t.src && t.src.includes(item.href))
        if (tocItem) title = tocItem.title
        if (!title) title = '第 ' + (chapters.length + 1) + ' 章'
        chapters.push({ title: title, content: html, index: chapters.length })
      })

      const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/)
      return {
        title: titleMatch ? titleMatch[1] : extractName(filePath),
        filePath: filePath,
        format: 'epub',
        chapters: chapters,
        totalChapters: chapters.length,
        cover: cover,
      }
    } catch (e) {
      return null
    }
  },

  showOpenDialog(options) {
    return window.ztools.showOpenDialog(options)
  },

  /* ---------------- 悬浮阅读窗管理 ---------------- */

  createReaderWindow(state) {
    window.services._readerState = state
    if (window.services._readerWin && !window.services._readerWin.isDestroyed()) {
      try {
        window.services._readerWin.show()
        window.services._readerWin.focus()
        window.services._readerWin.webContents.send('sr:reading-state', state)
      } catch (e) {}
      return window.services._readerWin
    }
    const settings = state.settings || {}
    const saved = window.ztools.dbStorage.getItem('serious_reading/winpos') || {}
    const w = saved.width || settings.window?.width || 520
    const h = saved.height || settings.window?.height || 780
    const x = saved.x != null ? saved.x : window.screenLeft + 90
    const y = saved.y != null ? saved.y : window.screenTop + 180

    const readerUrl = window.ztools && window.ztools.isDev ? (window.ztools.isDev() ? 'http://localhost:5173/reader.html' : 'reader.html') : 'reader.html'

    const readerPreloadPath = path.join(__dirname, 'reader.js')

    const win = window.ztools.createBrowserWindow(readerUrl, {
      width: w,
      height: h,
      x: x,
      y: y,
      title: '',
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      backgroundColor: 'rgba(255,255,255,0.01)',
      skipTaskbar: true,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closeable: true,
      webPreferences: { preload: readerPreloadPath },
    }, function () {
      if (!win) return
      win.webContents.send('sr:reading-state', state)
      try { win.setAlwaysOnTop(true, 'screen-saver') } catch (e) {}
    })
    if (!win) { console.warn('[SR] createReaderWindow returned null (readerUrl=' + readerUrl + ')'); return null }

    // 保存窗口位置/尺寸
    let saveTimer = null
    const scheduleSave = function () {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(function () {
        if (!win || win.isDestroyed()) { try { console.log('[SR] win destroyed, skip save') } catch(e) {}; return }
        try {
          const p = win.getPosition()
          const s = win.getSize()
          if (s[0] > 120 && s[1] > 120 && s[0] < 8000 && s[1] < 8000) {
            window.ztools.dbStorage.setItem('serious_reading/winpos', { x: p[0], y: p[1], width: s[0], height: s[1] })
          }
        } catch (e) {}
      }, 300)
    }
    try { win.on('move', scheduleSave) } catch (e) {}
    try { win.on('resize', scheduleSave) } catch (e) {}
    try { win.on('resized', scheduleSave) } catch (e) {}
    try { win.on('moved', scheduleSave) } catch (e) {}

    window.services._readerWin = win
    return win
  },

  sendToReader(channel, data) {
    const win = window.services._readerWin
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, data) } catch (e) {}
    }
  },

  showReader() {
    const win = window.services._readerWin
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show()
      win.focus()
      window.services.sendToReader('sr:show-reader')
      return true
    }
    return false
  },

  toggleReader() {
    const win = window.services._readerWin
    if (win && !win.isDestroyed()) {
      if (win.isVisible()) win.hide()
      else { win.show(); win.focus(); window.services.sendToReader('sr:show-reader') }
      return true
    }
    return false
  },
}

window._ipcRenderer = ipcRenderer

// 阅读窗 → 主窗：保存进度 + 更新书架 lastChapter
ipcRenderer.on('sr:save-progress', function (e, pg) {
  if (!pg || !pg.filePath) return
  // 保存 ReadingProgress
  try { window.ztools.dbStorage.setItem(DB_PREFIX + 'progress/' + pg.filePath, pg) } catch (e2) {}
  // 更新书架书籍的 lastChapter
  try {
    const doc = window.ztools.db.get(BOOKS_DOC_ID)
    if (doc && Array.isArray(doc.data)) {
      const idx = doc.data.findIndex(function (b) { return b.path === pg.filePath })
      if (idx >= 0) {
        doc.data[idx].lastChapter = pg.chapterIndex
        if (pg.chapterTitle) doc.data[idx].lastChapterTitle = pg.chapterTitle
        doc.data[idx].progress = pg.charOffset
        doc.data[idx].lastRead = Date.now()
        if (pg.totalChapters != null) doc.data[idx].totalChapters = pg.totalChapters
        window.ztools.db.put(doc)
      }
    }
  } catch (e2) {}
  // 通知渲染进程刷新书架
  try { window.dispatchEvent(new CustomEvent('sr:shelf-changed')) } catch (e3) {}
})

// 阅读窗 → 主窗：真隐藏
ipcRenderer.on('sr:hide-reader', function () {
  const win = window.services._readerWin
  if (win && !win.isDestroyed()) { try { win.hide() } catch (e) {} }
})

// 阅读窗 → 主窗：保存窗口位置/尺寸
ipcRenderer.on('sr:save-bounds', function (e, data) {
  if (data && data.x != null && data.width > 0) {
    try { window.ztools.dbStorage.setItem('serious_reading/winpos', data) } catch (e2) {}
  }
})

// 阅读窗 → 主窗：纯 JS 窗口移动 / 缩放（不依赖 -webkit-app-region:drag）
let _winStartBounds = null
ipcRenderer.on('sr:win-start', function () {
  const win = window.services._readerWin
  if (win && !win.isDestroyed()) { try { _winStartBounds = win.getBounds() } catch (e) {} }
})
ipcRenderer.on('sr:win-delta', function (e, data) {
  const win = window.services._readerWin
  if (!win || win.isDestroyed() || !_winStartBounds) return
  const { type, dx, dy } = data || {}
  if (!type) return
  const b = _winStartBounds
  let { x, y, width, height } = b
  if (type === 'move') {
    x = b.x + dx
    y = b.y + dy
  } else {
    if (type.includes('e')) width = b.width + dx
    if (type.includes('w')) { width = b.width - dx; x = b.x + dx }
    if (type.includes('s')) height = b.height + dy
    if (type.includes('n')) { height = b.height - dy; y = b.y + dy }
    const MINW = 100, MINH = 50
    if (width < MINW) { if (type.includes('w')) x = b.x + b.width - MINW; width = MINW }
    if (height < MINH) { if (type.includes('n')) y = b.y + b.height - MINH; height = MINH }
  }
  try { win.setBounds({ x, y, width, height }) } catch (e2) {}
})
ipcRenderer.on('sr:win-end', function () {
  _winStartBounds = null
  const win = window.services._readerWin
  if (win && !win.isDestroyed()) {
    try {
      const b = win.getBounds()
      window.ztools.dbStorage.setItem('serious_reading/winpos', { x: b.x, y: b.y, width: b.width, height: b.height })
    } catch (e) {}
  }
})

function extractName(p) {
  return (p.split(/[\\/]/).pop() || p).replace(/\.[^.]+$/, '')
}