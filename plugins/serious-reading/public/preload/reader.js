/**
 * 阅读窗 preload —— CommonJS，不参与编译打包。
 * 职责：为阅读窗提供文件读取/解码能力（阅读窗自闭环，无需回主窗读章节），
 *      暴露 ipcRenderer 用于接收主窗推送的状态、回主窗请求真隐藏/保存进度。
 */
const fs = require('fs')
const { ipcRenderer } = require('electron')
const iconv = require('./node_modules/iconv-lite')
const AdmZip = require('./node_modules/adm-zip')
let jschardet = null
try { jschardet = require('./node_modules/jschardet') } catch (e) {}

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
  return 'gbk'
}

function decodeBuffer(buf) {
  try { return iconv.decode(buf, detectEncoding(buf)) } catch (e) { return iconv.decode(buf, 'utf-8') }
}

window.services = {
  readTxt(filePath) {
    try {
      const buf = fs.readFileSync(filePath)
      let s = decodeBuffer(buf)
      if (s.charCodeAt(0) === 0xfeff) s = s.substring(1)
      return s
    } catch (e) { return null }
  },

  readPdf(filePath) {
    try {
      const buf = fs.readFileSync(filePath)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch (e) { return null }
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
      const chapters = []
      spineItems.forEach(function (id) {
        const item = manifest[id]
        if (!item || !item.type.match(/html|xhtml/)) return
        const html = zip.readAsText(opfDir + item.href)
        if (!html) return
        let title = ''
        const tocItem = toc.find(function (t) { return t.src && t.src.includes(item.href) })
        if (tocItem) title = tocItem.title
        if (!title) title = '第 ' + (chapters.length + 1) + ' 章'
        chapters.push({ title: title, content: html, index: chapters.length })
      })
      const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/)
      return {
        title: titleMatch ? titleMatch[1] : extractName(filePath),
        filePath: filePath, format: 'epub', chapters: chapters, totalChapters: chapters.length,
      }
    } catch (e) { return null }
  },
}

function extractName(p) {
  return (p.split(/[\\/]/).pop() || p).replace(/\.[^.]+$/, '')
}

window._ipcRenderer = ipcRenderer

// 捕获主窗发来的 reply 句柄，用于阅读窗 → 主窗回传 IPC
let _replyToParent = null
const _origOn = ipcRenderer.on.bind(ipcRenderer)
ipcRenderer.on = function (channel, handler) {
  _origOn(channel, function (event) {
    if (typeof event.reply === 'function') {
      _replyToParent = event.reply.bind(event)
    }
    handler.apply(null, arguments)
  })
}

// 阅读窗 → 主窗：优先用 event.reply，回退 sendTo(parentId)/send
window._sendToParent = function (channel, data) {
  try {
    if (_replyToParent) {
      _replyToParent(channel, data)
    } else if (window.ztools && window.ztools.sendToParent) {
      window.ztools.sendToParent(channel, data)
    } else {
      ipcRenderer.send(channel, data)
    }
  } catch (e) {}
}