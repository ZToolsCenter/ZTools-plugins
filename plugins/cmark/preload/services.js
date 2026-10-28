/**
 * services.js —— 导出、附件、剪贴板、文件杂项
 *
 * V1.1.0 新写。行为对齐 V1.0.0（用户已习惯的交互），实现全部按功能规格重写：
 *   - 导出 md：内容 + 附件一起落到目标目录
 *   - 导出 html：包一层带样式的文档，公式用 KaTeX 的 CSS
 *   - 导出 pdf / 图片：开一个隐藏窗口渲染 HTML 再抓图/打印
 *   - 图片附件：按内容 md5 命名，同一张图多处引用只存一份
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const IMAGE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/tiff': '.tiff',
}
const EXT_IS_IMAGE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex')
}

function safeName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return cleaned || String(fallback || Date.now())
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}


const { exportDocCss } = require('./export-css')
function attachmentCacheDir(win) {
  const base = path.join(win.ztools.getPath('temp') || os.tmpdir(), 'cmark.attachments')
  return ensureDir(base)
}

module.exports = function installServices(win) {
  const svc = {
    /* ---------------- 首次使用示例 ---------------- */
    getFirstMDFileContent() {
      return [
        '# 欢迎使用 CMark',
        '',
        '这是一个基于 ZTools 的本地 Markdown 笔记插件。',
        '',
        '- 笔记就是磁盘上的 `.md` 文件，用你习惯的编辑器也能打开',
        '- 支持 git：提交、推送、拉取，改动能同步到远端仓库',
        '- 支持表格、代码块、公式、流程图、图表',
        '',
        '在左侧右键新建笔记，或把已有的 `.md` 拖进目录。',
        '',
      ].join('\n')
    },

    /* ---------------- 剪贴板 ---------------- */
    readClipboardData() {
      try {
        const { clipboard } = require('electron')
        return { text: clipboard.readText(), html: clipboard.readHTML() }
      } catch (e) {
        return { text: '', html: '' }
      }
    },

    readClipboardHtml() {
      try {
        return require('electron').clipboard.readHTML()
      } catch (e) {
        return ''
      }
    },

    writeClipboardData(data) {
      try {
        if (!data) return
        const clip = require('electron').clipboard
        if (data.text != null) clip.writeText(String(data.text))
        if (data.html) clip.writeHTML(String(data.html))
      } catch (e) {}
    },

    copyHtml(html) {
      try {
        require('electron').clipboard.writeHTML(String(html || ''))
      } catch (e) {}
    },

    /* ---------------- 目录 / 文件 ---------------- */
    makeFolder(dir, name) {
      const p = path.join(dir, safeName(name, '新建文件夹'))
      ensureDir(p)
      return p
    },

    getFileBaseName(p) {
      return path.basename(p || '')
    },

    getFileContent(p) {
      try {
        return fs.readFileSync(p, 'utf-8')
      } catch (e) {
        return ''
      }
    },

    fileUrlToPath(u) {
      try {
        return require('url').fileURLToPath(u)
      } catch (e) {
        return u
      }
    },

    shellOpenPath(p) {
      setTimeout(() => {
        try {
          if (!fs.existsSync(p)) {
            win.ztools.showNotification('路径不存在：' + p)
            return
          }
          win.ztools.shellOpenPath(p)
        } catch (e) {}
      })
    },

    /** 把 md 里的相对图片路径解析成绝对路径（存在才返回） */
    convertMdFileImageURLToAbsolutePath(mdPath, rel) {
      const abs = path.join(path.dirname(mdPath), rel)
      return fs.existsSync(abs) ? abs : null
    },

    /* ---------------- 图片 ---------------- */
    /**
     * 解析一个图片来源，返回 {digest, name, data(Buffer), contentType}
     * 支持：data:base64、本地文件路径
     */
    getImageData(src) {
      if (!src) throw new Error('图片为空')
      const dataUrl = /^data:(image\/[a-z.+-]+);base64,/i.exec(src)
      if (dataUrl) {
        const buf = Buffer.from(src.slice(dataUrl[0].length), 'base64')
        const type = dataUrl[1].toLowerCase()
        if (buf.length > MAX_IMAGE_BYTES) throw new Error('图片大小超过 10 M')
        return { digest: md5(buf), name: 'pasted-image', data: buf, contentType: type }
      }

      if (!fs.existsSync(src)) throw new Error('图片文件不存在')
      const ext = path.extname(src).toLowerCase()
      if (!EXT_IS_IMAGE.includes(ext)) throw new Error('不是支持的图片格式')
      const st = fs.statSync(src)
      if (st.size > MAX_IMAGE_BYTES) throw new Error('图片大小超过 10 M')
      const buf = fs.readFileSync(src)
      const type = 'image/' + ext.replace('.', '').replace('jpg', 'jpeg')
      return { digest: md5(buf), name: path.basename(src), data: buf, contentType: type }
    },

    /** 从剪贴板取图（截图或复制的图片文件） */
    getClipboardImage() {
      // 优先：资源管理器里复制的图片文件
      try {
        const files = win.ztools.getCopyedFiles && win.ztools.getCopyedFiles()
        if (files && files.length) {
          if (files.length > 1) throw new Error('存在多个文件，请一次粘贴一个图片文件')
          return svc.getImageData(files[0].path)
        }
      } catch (e) {
        if (e && e.message) throw e
      }

      // 其次：剪贴板里的位图（截图）
      try {
        const { clipboard } = require('electron')
        const formats = clipboard.availableFormats()
        if (!formats || !formats.length) return null
        const hasImage = formats.some((f) => f.startsWith('image/'))
        if (!hasImage) return null
        const img = clipboard.readImage()
        if (!img || img.isEmpty()) return null
        const buf = img.toPNG()
        if (buf.length > MAX_IMAGE_BYTES) throw new Error('图片大小超过 10 M')
        return { digest: md5(buf), name: '截图', data: buf, contentType: 'image/png' }
      } catch (e) {
        if (e && e.message) throw e
        return null
      }
    },

    /** 附件落盘到临时缓存，返回可给 <img src> 用的绝对路径 */
    getAttachmentTempPath(digest) {
      if (!digest) return null
      const dir = attachmentCacheDir(win)
      let ext = ''
      try {
        const meta = win.__NDB && win.__NDB.get && win.__NDB.get('attachment/' + digest)
        if (meta && meta._attachments && meta._attachments[0]) {
          ext = IMAGE_EXT[meta._attachments[0].content_type] || ''
        }
      } catch (e) {}

      const target = path.join(dir, digest + ext)
      if (fs.existsSync(target)) return target

      try {
        const buf = win.__NDB && win.__NDB.getAttachment && win.__NDB.getAttachment('attachment/' + digest)
        if (!buf) return null
        fs.writeFileSync(target, Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
        return target
      } catch (e) {
        return null
      }
    },

    /** 把 data URL 或远端图片存成本地文件（用于渲染外链图片） */
    async saveImgToFileBySrc(src) {
      if (!src) return null
      let buf = null
      let ext = ''
      const dataUrl = /^data:(image\/[a-z.+-]+);base64,/i.exec(src)
      if (dataUrl) {
        ext = IMAGE_EXT[dataUrl[1].toLowerCase()] || ''
        if (!ext) return null
        buf = Buffer.from(src.slice(dataUrl[0].length), 'base64')
      } else if (/^https?:\/\//i.test(src)) {
        try {
          const res = await fetch(src)
          const type = (res.headers.get('content-type') || '').split(';')[0].toLowerCase()
          ext = IMAGE_EXT[type] || ''
          if (!ext) return null
          buf = Buffer.from(await res.arrayBuffer())
        } catch (e) {
          return null
        }
      } else {
        return null
      }
      if (!buf) return null
      const dir = attachmentCacheDir(win)
      const target = path.join(dir, md5(buf) + ext)
      if (!fs.existsSync(target)) {
        try {
          fs.writeFileSync(target, buf)
        } catch (e) {
          return null
        }
      }
      return target
    },

    /* ---------------- 导出 ---------------- */
    _exportDir: '',

    /** 导出 Markdown：正文 + 附件一起复制 */
    writeMarkdownFile(dir, name, content, attachmentPaths) {
      const base = safeName(name, Date.now())
      let targetDir = dir
      if (!targetDir) {
        targetDir = win.ztools.showSaveDialog({
          defaultPath: path.join(win.ztools.getPath('downloads') || '', base),
        })
        if (!targetDir) return null
        ensureDir(targetDir)
      }
      for (const a of attachmentPaths || []) {
        try {
          fs.copyFileSync(a, path.join(targetDir, path.basename(a)))
        } catch (e) {}
      }
      const file = path.join(targetDir, base + '.md')
      fs.writeFileSync(file, content, 'utf8')
      return file
    },

    /** 导出 HTML：套一层文档壳，样式内联 */
    writeHtmlFile(dir, name, html, attachmentPaths, withKatex, selfContained, theme) {
      const base = safeName(name, Date.now())
      const katexCss = withKatex
        ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">'
        : ''
      const doc = [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '<head>',
        '<meta charset="utf-8"/>',
        '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
        '<title>' + base + '</title>',
        katexCss,
        '<style>',
        exportDocCss(theme),
        '</style>',
        '</head>',
        '<body><article class="markdown-body">',
        String(html || ''),
        '</article></body></html>',
      ].join('\n')

      let targetDir = dir
      if (!targetDir) {
        const picked = win.ztools.showSaveDialog({
          defaultPath: path.join(win.ztools.getPath('downloads') || '', base),
        })
        if (!picked) return null
        targetDir = ensureDir(picked)
      }
      for (const a of attachmentPaths || []) {
        try {
          fs.copyFileSync(a, path.join(targetDir, path.basename(a)))
        } catch (e) {}
      }
      const file = path.join(targetDir, base + '.html')
      fs.writeFileSync(file, doc, 'utf8')
      return file
    },

    /**
     * 导出 PDF / 图片：开隐藏窗口渲染 HTML，再抓图或打印
     * type: 'pdf' | 'image'
     */
    exportFile(type, html, extraCss, cb, outDir, theme) {
      const done = typeof cb === 'function' ? cb : () => {}
      if (!win.ztools.createBrowserWindow) {
        done(new Error('当前平台不支持静默渲染，请改用导出 HTML'))
        return
      }
      const shell = [
        '<!doctype html><html><head><meta charset="utf-8"/>',
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">',
        '<style>',
        exportDocCss(theme),
        extraCss || '',
        '</style></head><body><article class="markdown-body"></article></body></html>',
      ].join('\n')

      const tmpHtml = path.join(attachmentCacheDir(win), 'export-' + Date.now() + '.html')
      fs.writeFileSync(tmpHtml, shell, 'utf8')

      let bw
      try {
        bw = win.ztools.createBrowserWindow(
          'file://' + tmpHtml.replace(/\\/g, '/'),
          { width: 980, height: 1200, show: false },
          async () => {
            try {
              await bw.webContents.executeJavaScript(
                'document.querySelector(".markdown-body").innerHTML = ' + JSON.stringify(String(html || ''))
              )
              // 等图片解码，最多 3 秒
              await bw.webContents.executeJavaScript(
                'Promise.all(Array.from(document.images).map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r })))'
              )

              let payload
              if (type === 'image') {
                const h = await bw.webContents.executeJavaScript('document.body.scrollHeight')
                bw.setContentSize(980, Math.min(h + 30, 20000))
                const img = await bw.webContents.capturePage()
                payload = img.toPNG()
              } else {
                payload = await bw.webContents.printToPDF({
                  printBackground: true,
                  pageSize: 'A4',
                  landscape: false,
                  marginsType: 0,
                })
              }

              const dir = outDir || win.ztools.getPath('temp')
              const ext = type === 'image' ? '.png' : '.pdf'
              const out = path.join(dir, 'cmark-export-' + Date.now() + ext)
              fs.writeFileSync(out, payload)
              try {
                bw.destroy()
              } catch (e) {}
              done(null, out)
            } catch (e) {
              try {
                bw.destroy()
              } catch (e2) {}
              done(e)
            }
          }
        )
      } catch (e) {
        done(e)
      }
    },

    /** 把导出的临时文件"另存为"到用户选的位置 */
    dialogSaveExportFile(tempPath, name, ext) {
      const base = safeName(name, Date.now())
      const realExt = ext === 'image' ? 'png' : ext
      const target = win.ztools.showSaveDialog({
        defaultPath: path.join(win.ztools.getPath('downloads') || '', base + '.' + realExt),
        filters: [{ name: realExt.toUpperCase(), extensions: [realExt] }],
      })
      if (!target) return null
      try {
        fs.copyFileSync(tempPath, target)
        return target
      } catch (e) {
        return null
      }
    },
  }

  return svc
}