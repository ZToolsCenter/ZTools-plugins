const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')
const crypto = require('node:crypto')
const { URL } = require('node:url')

// native.zip 下载加速镜像前缀。下载前对它们并发竞速（谁先返回响应头谁胜出），
// 用选中的镜像走完整下载，规避 GitHub Release 直连慢的问题。
// 格式为「前缀 + 完整原始 URL」，如：
//   https://gh-proxy.org/https://github.com/Particaly/ztools-f-provider/releases/download/v1.0.0/native.zip
const {
  resolveEngineDownloadUrls,
  resumeDownloadHeaders,
  shouldResumePartial
} = require('./engineDownload.cjs')
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
const GH_PROXY_HOSTS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://mirror.ghproxy.com/',
  'https://gitclone.com/github.com/'
]

// ─── multipart/form-data body 构造（图床文件上传用）──────────────────────────
function _buildMultipartBody(boundary, multipart) {
  const parts = []
  const enc = (s) => Buffer.from(s, 'utf8')
  if (multipart.fields) {
    for (const [k, v] of Object.entries(multipart.fields)) {
      parts.push(enc(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + k + '"\r\n\r\n' +
        String(v) + '\r\n'
      ))
    }
  }
  if (multipart.files) {
    for (const [k, f] of Object.entries(multipart.files)) {
      const fn = (f && f.filename) || 'upload.bin'
      const ct = (f && f.contentType) || 'application/octet-stream'
      const data = f && f.data
      if (!Buffer.isBuffer(data)) continue
      parts.push(enc(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + k + '"; filename="' + fn + '"\r\n' +
        'Content-Type: ' + ct + '\r\n\r\n'
      ))
      parts.push(data)
      parts.push(enc('\r\n'))
    }
  }
  parts.push(enc('--' + boundary + '--\r\n'))
  return Buffer.concat(parts)
}

// ─── 图床适配器注册表（可扩展）─────────────────────────────────────────────
const IMAGE_HOST_ADAPTORS = {
  'img-scdn': {
    name: 'img.scdn.io',
    description: '免鉴权图床，支持 Cloudflare R2 存储（storage_destination=r2）',
    async upload(buf, ext, mime) {
      const filename = 'upload.' + (ext || 'png')
      const resp = await this._httpRequest('POST', 'https://img.scdn.io/api/v1.php', {
        multipart: {
          fields: { storage_destination: 'r2' },
          files: { image: { filename, contentType: mime, data: buf } }
        },
        timeoutMs: 30000
      })
      if (resp.status >= 400) {
        throw new Error('img.scdn.io 上传失败：HTTP ' + resp.status)
      }
      let json
      try { json = JSON.parse(resp.body) }
      catch (e) {
        throw new Error('img.scdn.io 返回非 JSON：' + String(resp.body).slice(0, 200))
      }
      if (!json || !json.success || !json.url) {
        const msg = (json && (json.message || json.error)) ? (json.message || json.error) : 'img.scdn.io 未返回 url'
        throw new Error(msg)
      }
      return { url: json.url }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// f-provider: 微信 OCR Provider
//
// 通过原生模块 wechat_ocr.node 调用本机微信内置 OCR 引擎
// （mmmojo.dll + WeChatOCR.exe）实现离线图片文字识别。
//
// 既作为 Provider（在 plugin.json 的 providers.ocr 声明）供主程序聚合调用，
// 也提供一个交互式 feature（拖入图片 → 识别 → 展示）作为可视化入口。
// ──────────────────────────────────────────────────────────────────────────

const { parsePaddleOutput } = require('./paddleParse.cjs')
const { findPaddleExe, paddleSpawnArgs } = require('./paddleLocate.cjs')

function providerMethods() {
  return {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 读图片二进制并返回 data URI（供 <img>/<canvas> 直接预览）。
  // 超级面板「选择文件」入口拿到的是本地 path，渲染进程无法直接加载，
  // 故由 preload（Node 侧）读取并编码为 base64 data URI 返回。
  readFileAsDataURL(file) {
    const buf = fs.readFileSync(file)
    // 取扩展名映射 mime；未知类型兜底为 image/png
    const ext = path.extname(file).toLowerCase().replace(/^\./, '')
    const mimeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      svg: 'image/svg+xml'
    }
    const mime = mimeMap[ext] || 'image/png'
    return 'data:' + mime + ';base64,' + buf.toString('base64')
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // 插件 logo 绝对路径（用于 createBrowserWindow 的 icon，让子窗口任务栏/标题栏用插件图标）。
  // logo.png 位于插件根目录（plugin.json 的 logo 字段）。
  pluginLogoPath() {
    return path.join(__dirname, '..', 'logo.png')
  },

  // 插件 logo 的 data URI（用于子窗口 <img> 展示图标，注入到渲染层）。
  pluginLogoDataUrl() {
    try {
      const p = path.join(__dirname, '..', 'logo.png')
      const buf = fs.readFileSync(p)
      return 'data:image/png;base64,' + buf.toString('base64')
    } catch (_) {
      return ''
    }
  },

  // 插件 logo 的 NativeImage 对象（用于 createBrowserWindow 的 icon）。
  // Windows 下传字符串路径时任务栏按钮仍按 AppID 取宿主 exe 图标，
  // 传 NativeImage 才能让任务栏真正显示插件图标。
  pluginLogoNativeImage() {
    try {
      // ZTools 在 preload 提供 require('electron').nativeImage
      const { nativeImage } = require('electron')
      return nativeImage.createFromPath(path.join(__dirname, '..', 'logo.png'))
    } catch (_) {
      return null
    }
  },

  // ─── 微信 OCR（基于 wechat_ocr.node 原生模块）─────────────────────────
  // 原生模块懒加载：首次调用时才 require + init，避免插件加载即拉起
  // WeChatOCR.exe 子进程（Windows）。
  //
  // 平台差异：
  //  - Windows: addon.init(dataDir) 拉起 WeChatOCR.exe 子进程；
  //             addon.ocr(imagePath) 异步返回 { ok, lines }。
  //  - macOS:   直接加载打包的微信 libwxocr.dylib，无子进程；
  //             addon.ocrMacWevisionJson({imagePath, wxocrLib, resourcesDir})
  //             同步返回 JSON 字符串（{ engine, text, lines }）。
  _ocrAddon: null,
  _ocrDataDir() {
    // wco_data 位于 native 数据目录下（Windows 运行时 WeChatOCR.exe 子进程）。
    return path.join(this._nativeDir(), 'wco_data')
  },
  // macOS vendor 目录：<nativeDir>/wechat-ocr-mac/{lib,models}
  _macVendorPaths() {
    const root = path.join(this._nativeDir(), 'wechat-ocr-mac')
    return {
      wxocrLib: path.join(root, 'lib', 'libwxocr.dylib'),
      resourcesDir: path.join(root, 'models')
    }
  },
  _ocrEnsure() {
    if (this._ocrAddon) return this._ocrAddon
    const nativeEntry = path.join(this._nativeDir(), 'index.js')
    this._ocrAddon = require(nativeEntry)
    // Windows 需要显式 init 拉起子进程；macOS 直接加载动态库，无需 init。
    if (process.platform === 'win32') {
      this._ocrAddon.init(this._ocrDataDir())
    }
    return this._ocrAddon
  },

  // 统一的单图识别：屏蔽平台差异，返回 { ok, taskId?, lines }。
  // lines 为带坐标的逐行结果（text/rate/left/top/right/bottom/boxPoints）。
  async _ocrRun(imagePath) {
    const addon = this._ocrEnsure()
    if (process.platform === 'darwin') {
      // macOS：同步调用，返回 JSON 字符串。
      const vendor = this._macVendorPaths()
      const json = addon.ocrMacWevisionJson({
        imagePath,
        wxocrLib: vendor.wxocrLib,
        resourcesDir: vendor.resourcesDir
      })
      const parsed = JSON.parse(json)
      return { ok: true, lines: parsed.lines || [] }
    }
    // Windows：异步 Promise，返回 { ok, taskId, lines }。
    return await addon.ocr(imagePath)
  },

  // 把任意 image 输入（本地路径 / data URI / http(s) URL）归一化为本地临时文件路径。
  // 识别完成后由调用方负责删除。
  async _ocrMaterialize(image) {
    if (typeof image !== 'string' || !image) throw new Error('image 为空')

    // 本地路径：直接返回
    if (!/^data:/i.test(image) && !/^https?:\/\//i.test(image)) {
      if (!fs.existsSync(image)) throw new Error('图片文件不存在: ' + image)
      return image
    }

    // data URI：解码写临时文件
    const dataMatch = /^data:image\/([a-z]{1,20});base64,/i.exec(image)
    if (dataMatch) {
      const ext = dataMatch[1] === 'jpeg' ? 'jpg' : dataMatch[1]
      const tmp = path.join(os.tmpdir(), `ztools-wechat-ocr-${Date.now()}.${ext}`)
      fs.writeFileSync(tmp, image.substring(dataMatch[0].length), { encoding: 'base64' })
      return tmp
    }

    // http(s) URL：下载到临时文件
    return new Promise((resolve, reject) => {
      const tmp = path.join(os.tmpdir(), `ztools-wechat-ocr-${Date.now()}.png`)
      const file = fs.createWriteStream(tmp)
      const client = image.startsWith('https') ? https : http
      const req = client.get(image, (res) => {
        if (res.statusCode !== 200) {
          file.close()
          try { fs.unlinkSync(tmp) } catch (_) {}
          reject(new Error('下载图片失败: HTTP ' + res.statusCode))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(tmp)))
      })
      req.on('error', (err) => {
        file.close()
        try { fs.unlinkSync(tmp) } catch (_) {}
        reject(err)
      })
    })
  },

  // 核心 OCR：image 为 本地路径 / data URI / http(s) URL。
  // 返回 provider 契约结构 { text, blocks?, confidence? }；失败抛错。
  async ocrRecognize(image /*, lang */) {
    const tmpFile = await this._ocrMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const result = await this._ocrRun(tmpFile)
      if (!result.ok) throw new Error(result.error || '微信 OCR 识别失败')
      const lines = result.lines || []
      return {
        text: lines.map((l) => l.text).join('\n'),
        blocks: lines.map((l) => l.text),
        confidence: lines.length
          ? lines.reduce((s, l) => s + (l.rate || 0), 0) / lines.length
          : 0
      }
    } finally {
      if (isTemp) {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
      }
    }
  },

  // 交互式 feature 使用的版本：返回带坐标的明细结构。
  async ocrImageDetail(image) {
    const tmpFile = await this._ocrMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const result = await this._ocrRun(tmpFile)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, taskId: result.taskId, lines: result.lines || [] }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), lines: [] }
    } finally {
      if (isTemp) {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
      }
    }
  },

  // 释放 OCR 引擎（Windows 停止 WeChatOCR.exe 子进程；macOS 卸载动态库）
  ocrDispose() {
    if (this._ocrAddon) {
      try {
        if (process.platform === 'darwin') {
          if (typeof this._ocrAddon.unload === 'function') this._ocrAddon.unload()
        } else if (typeof this._ocrAddon.dispose === 'function') {
          this._ocrAddon.dispose()
        }
      } catch (_) {}
      this._ocrAddon = null
    }
  },

  // ─── native 引擎下载/状态管理 ─────────────────────────────────────────
  // 插件初始不带 native；前端展示下载状态，用户点击下载后从 npmmirror 拉取
  // npm 包 @jspatrick/f-provider 的 tgz（内含 dist/native-{win,mac}.zip）：
  // 先解压到临时目录取出对应平台的 zip，再解压得到 native/，最后拷贝到用户
  // 数据目录。插件被打包成 asar 后插件目录只读，故 native 落盘于 userData 而非插件目录。
  _pluginRoot() {
    // preload 文件位于 <pluginRoot>/preload/services.js（asar 内，仅用于读 plugin.json）
    return path.join(__dirname, '..')
  },
  // native 产物所在的数据根目录（可写；独立于只读的 asar 插件目录）。
  _nativeDataRoot() {
    return path.join(window.ztools.getPath('userData'), 'snap-translate')
  },
  _nativeDir() {
    return path.join(this._nativeDataRoot(), 'native')
  },
  engineRoot() {
    return this._nativeDataRoot()
  },
  engineDir(kind) {
    const root = this._nativeDataRoot()
    if (kind === 'paddle') return path.join(root, 'paddle')
    if (kind === 'cache') return path.join(root, 'cache')
    return this._nativeDir()
  },
  engineCatalog() {
    const plat = process.platform === 'darwin' ? 'mac' : 'win'
    const native = this._nativeConfig() || {}
    let paddleUrl = ''
    try {
      const raw = fs.readFileSync(path.join(this._pluginRoot(), 'plugin.json'), 'utf8')
      const cfg = JSON.parse(raw)
      const p = ((cfg && cfg.nativePaddle) || {})[plat] || {}
      paddleUrl = p.downloadUrl || ''
    } catch (_) {}
    const root = this._nativeDataRoot()
    const nativeDir = this._nativeDir()
    const paddleDir = path.join(root, 'paddle')
    // 设置页展示前就建好空目录，避免用户看到不存在的路径
    try { fs.mkdirSync(nativeDir, { recursive: true }) } catch (_) {}
    try { fs.mkdirSync(paddleDir, { recursive: true }) } catch (_) {}
    return {
      root,
      native: {
        dir: nativeDir,
        url: native.downloadUrl || '',
        files:
          plat === 'mac'
            ? ['build/Release/wechat_ocr.node', 'wechat-ocr-mac/lib/libwxocr.dylib']
            : ['build/Release/wechat_ocr.node', 'wco_data/WeChatOCR.exe']
      },
      paddle: {
        dir: paddleDir,
        url: paddleUrl,
        files: ['PaddleOCR-json.exe']
      }
    }
  },
  openEngineDir(kind) {
    const dir =
      kind === 'root'
        ? this._nativeDataRoot()
        : this.engineDir(kind === 'cache' ? 'cache' : kind)
    fs.mkdirSync(dir, { recursive: true })
    try {
      if (typeof window.ztools.shellShowItemInFolder === 'function') {
        window.ztools.shellShowItemInFolder(dir)
      } else if (typeof window.ztools.shellOpenPath === 'function') {
        window.ztools.shellOpenPath(dir)
      }
    } catch (_) {
      /* ignore */
    }
    return dir
  },
  // 读 plugin.json 的 native 配置块（按平台，缓存）。
  // plugin.json 的 native 字段按平台分组：{ mac: {downloadUrl,sha256,version}, win: {...} }。
  // 兼容旧的扁平结构（无分组时整体作为当前平台配置）。
  _nativeConfig() {
    if (this._nativeConfigCache) return this._nativeConfigCache
    try {
      const raw = fs.readFileSync(path.join(this._pluginRoot(), 'plugin.json'), 'utf8')
      const cfg = JSON.parse(raw)
      const native = (cfg && cfg.native) || {}
      const key = process.platform === 'darwin' ? 'mac' : 'win'
      // 有平台分组则取对应平台；否则回退到扁平结构（向后兼容）。
      this._nativeConfigCache = native[key] || (native.mac || native.win ? {} : native)
    } catch (_) {
      this._nativeConfigCache = {}
    }
    return this._nativeConfigCache
  },
  _nativeConfigCache: null,

  // 检查 native 引擎是否就绪。真值来源 = 关键文件存在与否（不靠 dbStorage 记忆，避免漂移）。
  // 平台差异：
  //  - Windows: 需要编译产物 wechat_ocr.node + wco_data/WeChatOCR.exe 子进程。
  //  - macOS:   需要编译产物 wechat_ocr.node + 打包的 libwxocr.dylib + 模型文件。
  nativeStatus() {
    const dir = this._nativeDir()
    const nodeFile = path.join(dir, 'build', 'Release', 'wechat_ocr.node')
    const missing = []
    if (!fs.existsSync(nodeFile)) missing.push('build/Release/wechat_ocr.node')

    if (process.platform === 'darwin') {
      const vendor = this._macVendorPaths()
      const models = vendor.resourcesDir
      const checks = [
        [vendor.wxocrLib, 'wechat-ocr-mac/lib/libwxocr.dylib'],
        [path.join(dir, 'wechat-ocr-mac', 'lib', 'libmmmojo.dylib'), 'wechat-ocr-mac/lib/libmmmojo.dylib'],
        [path.join(models, 'text_det_fp16_v1.xnet'), 'wechat-ocr-mac/models/text_det_fp16_v1.xnet'],
        [path.join(models, 'text_rec_fp16_v2.xnet'), 'wechat-ocr-mac/models/text_rec_fp16_v2.xnet'],
        [path.join(models, 'charset_zh10798.txt'), 'wechat-ocr-mac/models/charset_zh10798.txt']
      ]
      for (const [file, label] of checks) {
        if (!fs.existsSync(file)) missing.push(label)
      }
    } else {
      const exe = path.join(dir, 'wco_data', 'WeChatOCR.exe')
      if (!fs.existsSync(exe)) missing.push('wco_data/WeChatOCR.exe')
    }

    return {
      ready: missing.length === 0,
      missing,
      version: this._nativeConfig().version || null
    }
  },

  // 并发竞速选最快的加速镜像。对每个代理前缀拼出完整 URL 并发 GET，谁先返回
  // 响应头谁胜出（不消费 body，立即 abort 其余）。返回选中的完整 URL。
  // 全部失败/超时则回退原始 URL（直连兜底，保证永不卡死）。
  // 仅对 github.com 的 URL 启用代理；其余域名原样返回。
  _pickFastestMirror(rawUrl, signal) {
    if (signal && signal.aborted) return Promise.resolve(rawUrl)
    try {
      const u = new URL(rawUrl)
      if (u.hostname !== 'github.com') {
        return Promise.resolve(rawUrl)
      }
    } catch (_) {
      return Promise.resolve(rawUrl)
    }

    const TIMEOUT_MS = 8000
    const candidates = GH_PROXY_HOSTS.map((prefix) => prefix + rawUrl)

    return new Promise((resolve) => {
      let settled = false
      const reqs = []
      const timers = []

      const finish = (url) => {
        if (settled) return
        settled = true
        timers.forEach((t) => clearTimeout(t))
        reqs.forEach((r) => { try { r.destroy() } catch (_) {} })
        resolve(url)
      }

      candidates.forEach((url) => {
        let parsed
        try { parsed = new URL(url) } catch (_) { return }
        const req = https.get(parsed, () => finish(url))
        reqs.push(req)
        req.on('error', () => {})
        const timer = setTimeout(() => { try { req.destroy() } catch (_) {} }, TIMEOUT_MS)
        timers.push(timer)
      })

      if (signal) {
        signal.raceReqs = reqs
        if (signal.aborted) { finish(rawUrl); return }
      }

      Promise.all(
        reqs.map(
          (r) =>
            new Promise((res) => {
              if (r.destroyed) return res()
              r.on('close', () => res())
              r.on('error', () => res())
            })
        )
      ).then(() => {
        if (!settled) finish(rawUrl)
      })
    })
  },

  async _applyGhProxy(rawUrl, hostIndex, signal) {
    try {
      const u = new URL(rawUrl)
      if (u.hostname !== 'github.com') return rawUrl
    } catch (_) {
      return rawUrl
    }
    if (hostIndex === -1) return rawUrl
    if (hostIndex != null && hostIndex >= 0 && hostIndex < GH_PROXY_HOSTS.length) {
      return GH_PROXY_HOSTS[hostIndex] + rawUrl
    }
    return this._pickFastestMirror(rawUrl, signal)
  },

  ghProxyHosts() {
    return GH_PROXY_HOSTS.slice()
  },

  // 下载文件到临时目录，支持 3xx 重定向跟随（兼容 GitHub release 跳 CDN）。
  // onProgress({ phase, percent, loaded, total }) 用于上报进度。
  // signal: 可选取消信号 { aborted, req }。
  _downloadFile(url, dest, onProgress, maxRedirects, signal) {
    maxRedirects = maxRedirects == null ? 8 : maxRedirects
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new Error('下载已取消'))
        return
      }
      let parsed
      try { parsed = new URL(url) } catch (e) { reject(e); return }
      let existing = 0
      try {
        if (fs.existsSync(dest)) existing = fs.statSync(dest).size
      } catch (_) {
        existing = 0
      }
      const headers = resumeDownloadHeaders(existing)
      const client = parsed.protocol === 'https:' ? https : http
      const req = client.get(
        parsed,
        {
          headers,
          timeout: 180000
        },
        (res) => {
        if (signal) {
          signal.req = req
          if (signal.aborted) {
            try { req.destroy() } catch (_) {}
            reject(new Error('下载已取消'))
            return
          }
        }
        if (signal && signal.aborted) {
          try { req.destroy() } catch (_) {}
          reject(new Error('下载已取消'))
          return
        }
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()
          if (maxRedirects <= 0) {
            reject(new Error('下载重定向次数过多'))
            return
          }
          const next = new URL(res.headers.location, parsed).toString()
          this._downloadFile(next, dest, onProgress, maxRedirects - 1, signal)
            .then(resolve, reject)
          return
        }
        const resume = shouldResumePartial(res.statusCode, existing)
        if (res.statusCode !== 200 && !resume) {
          res.resume()
          reject(new Error('下载失败: HTTP ' + res.statusCode))
          return
        }
        if (existing > 0 && res.statusCode === 200) {
          try { fs.unlinkSync(dest) } catch (_) {}
          existing = 0
        }
        const chunkTotal = Number(res.headers['content-length']) || 0
        const total = resume
          ? existing + chunkTotal
          : chunkTotal || existing
        let loaded = existing
        const file = fs.createWriteStream(dest, { flags: resume ? 'a' : 'w' })
        res.on('data', (chunk) => {
          loaded += chunk.length
          if (onProgress) {
            onProgress({
              phase: 'downloading',
              loaded,
              total,
              percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0
            })
          }
        })
        res.on('error', (err) => {
          try { file.destroy() } catch (_) {}
          reject(err)
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', (err) => {
          reject(err)
        })
      })
      req.on('error', reject)
      req.setTimeout(180000, () => {
        req.destroy(new Error('下载超时'))
      })
    })
  },

  async _downloadWithMirrors(rawUrl, dest, onProgress, signal) {
    const urls = resolveEngineDownloadUrls(rawUrl)
    if (!urls.length) throw new Error('下载地址为空')
    const errors = []
    for (const url of urls) {
      if (signal && signal.aborted) throw new Error('下载已取消')
      try {
        await this._downloadFile(url, dest, onProgress, undefined, signal)
        return url
      } catch (e) {
        errors.push((url.split('://')[1] || url).split('/')[0] + ': ' + String(e && e.message ? e.message : e))
      }
    }
    throw new Error('全部镜像失败: ' + errors.join(' | '))
  },

  // 流式 sha256 校验
  _sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', (d) => hash.update(d))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  },

  // 解压 .tgz（gzip tar）到目标目录（幂等覆盖）。
  // Windows 10 1803+ 与 macOS 均自带 tar（bsdtar），-xzf 一次完成 gunzip + untar。
  _extractTgz(tgzPath, destDir) {
    const { spawnSync } = require('node:child_process')
    const r = spawnSync('tar', ['-xzf', tgzPath, '-C', destDir], {
      encoding: 'utf8',
      shell: false
    })
    if (r.status !== 0) {
      const detail = (r.stderr || r.stdout || '').toString().trim()
      throw new Error('解压 tgz 失败' + (detail ? ': ' + detail : ''))
    }
  },

  // 解压 zip 到目标目录（幂等覆盖）。
  //  - Windows: PowerShell Expand-Archive -Force。
  //  - macOS:   系统 unzip -o（覆盖），并去掉 quarantine，避免 Gatekeeper 阻止 dlopen。
  _extractArchive(archivePath, destDir) {
    const ext = path.extname(archivePath).toLowerCase()
    if (ext === '.7z') {
      this._extract7z(archivePath, destDir)
      return
    }
    this._extractZip(archivePath, destDir)
  },

  _extract7z(archivePath, destDir) {
    const { spawnSync } = require('node:child_process')
    const candidates = []
    if (process.platform === 'win32') {
      candidates.push('7z')
      candidates.push(path.join(process.env['ProgramFiles'] || 'C:\\Program Files', '7-Zip', '7z.exe'))
      candidates.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'))
    } else {
      candidates.push('7z')
      candidates.push('7za')
    }
    let lastErr = '未找到 7z'
    for (const bin of candidates) {
      const r = spawnSync(bin, ['x', archivePath, '-o' + destDir, '-y'], {
        encoding: 'utf8',
        shell: false
      })
      if (r.error && r.error.code === 'ENOENT') continue
      if (r.status === 0) return
      lastErr = (r.stderr || r.stdout || r.error && r.error.message || '').toString().trim() || lastErr
    }
    throw new Error('解压 7z 失败: ' + lastErr + '。请安装 7-Zip，或改用 zip 包。')
  },

  _extractZip(zipPath, destDir) {
    const { spawnSync } = require('node:child_process')
    if (process.platform === 'darwin') {
      const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], {
        encoding: 'utf8',
        shell: false
      })
      if (r.status !== 0) {
        const detail = (r.stderr || r.stdout || '').toString().trim()
        throw new Error('解压失败' + (detail ? ': ' + detail : ''))
      }
      // 解压出的 dylib 带下载来源的 quarantine 属性时，dlopen 会被 Gatekeeper 拦截。
      spawnSync('xattr', ['-dr', 'com.apple.quarantine', path.join(destDir, 'native')], {
        stdio: 'ignore'
      })
      return
    }
    const psScript =
      'Expand-Archive -Path ' +
      "'" + zipPath.replace(/'/g, "''") + "'" +
      ' -DestinationPath ' +
      "'" + destDir.replace(/'/g, "''") + "'" +
      ' -Force'
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      encoding: 'utf8',
      shell: false
    })
    if (r.status !== 0) {
      const detail = (r.stderr || r.stdout || '').toString().trim()
      throw new Error('解压失败' + (detail ? ': ' + detail : ''))
    }
  },

  // 主流程：下载平台 native zip + 校验 + 解压 + 拷贝到数据目录 + 复检。
  // 对齐 f-provider 1.1.0：GitHub Release native-{win,mac}.zip，顶层含 native/。
  async nativeDownload(onProgress, hostIndex) {
    const cfg = this._nativeConfig()
    if (!cfg.downloadUrl) {
      return { ok: false, error: '未配置 native 下载地址，请在 plugin.json 中设置 native.{win,mac}.downloadUrl' }
    }
    this._nativeSignal = { aborted: false }
    const signal = this._nativeSignal
    if (this._ocrAddon) {
      try { this._ocrAddon.dispose() } catch (_) {}
      this._ocrAddon = null
    }
    const zipName = process.platform === 'darwin' ? 'native-mac.zip' : 'native-win.zip'
    const cacheDir = path.join(this._nativeDataRoot(), 'cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const tmpZip = path.join(cacheDir, zipName)
    const workDir = path.join(os.tmpdir(), `snap-translate-extract-${Date.now()}`)
    try {
      fs.mkdirSync(workDir, { recursive: true })

      if (onProgress) onProgress({ phase: 'downloading', percent: 0, loaded: 0, total: 0 })
      if (hostIndex != null) {
        const downloadUrl = await this._applyGhProxy(cfg.downloadUrl, hostIndex, signal)
        await this._downloadFile(downloadUrl, tmpZip, onProgress, undefined, signal)
      } else {
        await this._downloadWithMirrors(cfg.downloadUrl, tmpZip, onProgress, signal)
      }

      if (cfg.sha256) {
        const sum = await this._sha256File(tmpZip)
        if (sum.toLowerCase() !== String(cfg.sha256).toLowerCase()) {
          return { ok: false, error: '校验和不匹配，文件可能已损坏' }
        }
      }

      if (onProgress) onProgress({ phase: 'extracting', percent: 0, loaded: 0, total: 0 })
      this._extractZip(tmpZip, workDir)

      const staged = path.join(workDir, 'native')
      if (!fs.existsSync(staged)) {
        return { ok: false, error: '解压完成但未找到 native 目录' }
      }
      this._installNative(staged)

      const status = this.nativeStatus()
      if (!status.ready) {
        return {
          ok: false,
          error: '解压完成但缺少关键文件: ' + status.missing.join(', ')
        }
      }
      try { fs.unlinkSync(tmpZip) } catch (_) {}
      return { ok: true }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      if (signal.aborted || msg === '下载已取消') {
        return { ok: false, cancelled: true }
      }
      return { ok: false, error: msg }
    } finally {
      this._nativeSignal = null
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (_) {}
    }
  },

  // 把临时目录里解压好的 native/ 整体拷贝到数据目录（覆盖安装）。
  // cpSync 不传播 macOS quarantine，配合 _extractZip 解压阶段的去隔离，落地目录是干净的。
  _installNative(stagedNative) {
    const dest = this._nativeDir()
    fs.mkdirSync(this._nativeDataRoot(), { recursive: true })
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
    fs.cpSync(stagedNative, dest, { recursive: true, force: true })
  },

  // 删除已下载的 native 目录（便于重新下载/释放空间）。
  nativeRemove() {
    const dir = this._nativeDir()
    if (this._ocrAddon) {
      try { this._ocrAddon.dispose() } catch (_) {}
      this._ocrAddon = null
    }
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  },

  nativeCancel() {
    if (this._nativeSignal) {
      this._nativeSignal.aborted = true
      if (Array.isArray(this._nativeSignal.raceReqs)) {
        for (const r of this._nativeSignal.raceReqs) {
          try { r.destroy() } catch (_) {}
        }
      }
      if (this._nativeSignal.req) {
        try { this._nativeSignal.req.destroy(new Error('下载已取消')) } catch (_) {}
      }
    }
  },

  // ─── 翻译 Providers（百度/谷歌/有道/微软）──────────────────────────────────
// 契约（对齐宿主 src/shared/providerShared.ts TranslationInput/Output）：
//   input  { text, from?, to? }   from/to 为语言码字符串，缺省视为 'auto'
//   output { text, detectedFrom? }
//
// 凭据存储：
//   - 敏感字段（百度 AppID/AppKey、有道 AppKey/AppSecret）走 ztools.dbCryptoStorage
//   - 非敏感（微软鉴权模式、各 provider 是否启用）走 ztools.dbStorage
//   - 统一键名 'translate.<provider>'，值为对象
//
// 语言码使用宿主契约里的中性字符串（auto/zh-CN/zh-TW/en/ja/...），
// 各 provider 内部再映射到自家 API 的语种代码。

// 通用 HTTP 请求：支持 JSON / form-urlencoded / 查询参数 / 3xx 跟随。
// 返回 { status, headers, body }；非 2xx 抛错。
async _httpRequest(method, url, opts) {
  opts = opts || {}
  const maxRedirects = opts.maxRedirects == null ? 5 : opts.maxRedirects
  const timeoutMs = opts.timeoutMs || 15000

  const buildQS = (query) => {
    if (!query) return ''
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) sp.append(k, String(v))
    const s = sp.toString()
    return s ? '?' + s : ''
  }

  const doOnce = (targetUrl) =>
    new Promise((resolve, reject) => {
      let parsed
      try { parsed = new URL(targetUrl) } catch (e) { reject(e); return }
      const client = parsed.protocol === 'https:' ? https : http
      const headers = Object.assign({}, opts.headers || {})
      // 微软等端点会校验 User-Agent，缺省或 Node 默认 UA 会被拒（400 Client Browser Version not supported）。
      // 这里给一个 Chrome UA 兜底，调用方可显式覆盖。
      if (!headers['User-Agent'] && !headers['user-agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
      }
      let bodyBuf = null

      if (opts.json !== undefined) {
        bodyBuf = Buffer.from(JSON.stringify(opts.json), 'utf8')
        headers['Content-Type'] = headers['Content-Type'] || 'application/json'
        headers['Content-Length'] = bodyBuf.length
      } else if (opts.form !== undefined) {
        bodyBuf = Buffer.from(new URLSearchParams(opts.form).toString(), 'utf8')
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded'
        headers['Content-Length'] = bodyBuf.length
      } else if (opts.multipart !== undefined) {
        const boundary = '----ztools' + crypto.randomBytes(8).toString('hex')
        bodyBuf = _buildMultipartBody(boundary, opts.multipart)
        headers['Content-Type'] = headers['Content-Type'] || ('multipart/form-data; boundary=' + boundary)
        headers['Content-Length'] = bodyBuf.length
      } else if (opts.body !== undefined) {
        bodyBuf = Buffer.from(String(opts.body), 'utf8')
        headers['Content-Length'] = bodyBuf.length
      }

      const reqPath = parsed.pathname + (parsed.search || buildQS(opts.query))
      const reqOpts = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: reqPath,
        headers
      }
      const req = client.request(reqOpts, (res) => {
        // 3xx 跟随
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()
          if (maxRedirects <= 0) {
            reject(new Error('重定向次数过多'))
            return
          }
          const next = new URL(res.headers.location, parsed).toString()
          this._httpRequest(method, next, Object.assign({}, opts, { maxRedirects: maxRedirects - 1 }))
            .then(resolve, reject)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8') })
        })
      })
      req.on('error', reject)
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('请求超时'))
      })
      if (bodyBuf) req.write(bodyBuf)
      req.end()
    })

  const ret = await doOnce(url)
  if (ret.status >= 200 && ret.status < 300) return ret
  throw new Error(`HTTP ${ret.status}: ${ret.body.slice(0, 500)}`)
},

// 语言映射：把宿主中性语言码映射到各 provider 自家语种码。未映射返回 null（不支持）。
// 移植自 STranslate 四个翻译插件的 GetSourceLanguage/GetTargetLanguage。
TRANSLATE_LANG_MAP: {
  baidu: {
    auto: 'auto', 'zh-CN': 'zh', 'zh-TW': 'cht', yue: 'yue', en: 'en', ja: 'jp',
    ko: 'kor', fr: 'fra', es: 'spa', ru: 'ru', de: 'de', it: 'it', tr: 'tr',
    'pt-PT': 'pt', 'pt-BR': 'pot', vi: 'vie', id: 'id', th: 'th', ms: 'may',
    ar: 'ar', hi: 'hi', 'mn-Cyrl': null, 'mn-Mong': null, km: 'hkm',
    nb: 'nob', nn: 'nno', fa: 'per', sv: 'swe', pl: 'pl', nl: 'nl', uk: 'ukr', uz: 'uz'
  },
  google: {
    auto: 'auto', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', yue: 'yue', en: 'en', ja: 'ja',
    ko: 'ko', fr: 'fr', es: 'es', ru: 'ru', de: 'de', it: 'it', tr: 'tr',
    'pt-PT': 'pt', 'pt-BR': 'pt', vi: 'vi', id: 'id', th: 'th', ms: 'ms',
    ar: 'ar', hi: 'hi', 'mn-Cyrl': 'mn', 'mn-Mong': 'mn', km: 'km',
    nb: 'no', nn: 'no', fa: 'fa', sv: 'sv', pl: 'pl', nl: 'nl', uk: 'uk', uz: 'uz'
  },
  youdao: {
    auto: 'auto', 'zh-CN': 'zh-CHS', 'zh-TW': 'zh-CHT', yue: 'yue', en: 'en', ja: 'jp',
    ko: 'ko', fr: 'fr', es: 'es', ru: 'ru', de: 'de', it: 'it', tr: 'tr',
    'pt-PT': 'pt', 'pt-BR': 'pt', vi: 'vie', id: 'id', th: 'th', ms: 'ms',
    ar: 'ar', hi: 'hi', 'mn-Cyrl': 'mn', 'mn-Mong': 'mn', km: 'km',
    nb: 'no', nn: 'no', fa: 'fa', sv: 'sv', pl: 'pl', nl: 'nl', uk: 'uk', uz: 'uz'
  },
  microsoft: {
    auto: 'auto', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', yue: null, en: 'en', ja: 'ja',
    ko: 'ko', fr: 'fr', es: 'es', ru: 'ru', de: 'de', it: 'it', tr: 'tr',
    'pt-PT': 'pt-pt', 'pt-BR': 'pt', vi: 'vi', id: 'id', th: 'th', ms: 'ms',
    ar: 'ar', hi: null, 'mn-Cyrl': 'mn-Cyrl', 'mn-Mong': 'mn-Mong', km: 'km',
    nb: 'nb', nn: 'nb', fa: 'fa', sv: 'sv', pl: 'pl', nl: 'nl', uk: 'uk', uz: 'uz'
  }
},

// 敏感凭据 provider（百度/有道）走 dbCryptoStorage；非敏感（谷歌无凭据、微软 requestMode）走 dbStorage。
// 读时若 crypto 为空则尝试从 dbStorage 迁移一次，兼容早期明文落盘。
_isSensitiveTranslateProvider(provider) {
  return provider === 'baidu' || provider === 'youdao'
},
_readTranslateStored(provider) {
  const key = 'translate.' + provider
  if (this._isSensitiveTranslateProvider(provider) && window.ztools.dbCryptoStorage) {
    let stored = window.ztools.dbCryptoStorage.getItem(key)
    if (!stored || (typeof stored === 'object' && !Object.keys(stored).length)) {
      const plain = window.ztools.dbStorage.getItem(key)
      if (plain && typeof plain === 'object' && Object.keys(plain).length) {
        window.ztools.dbCryptoStorage.setItem(key, plain)
        try { window.ztools.dbStorage.removeItem(key) } catch (_) {}
        stored = plain
      }
    }
    return stored || {}
  }
  return window.ztools.dbStorage.getItem(key) || {}
},
_writeTranslateStored(provider, data) {
  const key = 'translate.' + provider
  if (this._isSensitiveTranslateProvider(provider) && window.ztools.dbCryptoStorage) {
    window.ztools.dbCryptoStorage.setItem(key, data)
    // 清除可能残留的明文副本
    try { window.ztools.dbStorage.removeItem(key) } catch (_) {}
    return
  }
  window.ztools.dbStorage.setItem(key, data)
},

// 读某 provider 的设置（合并默认值）。
// 微软：默认 signature。edge 端点会按 Chrome UA 版本号风控（旧版本号被拒 400
// Client Browser Version not supported），signature 走 HMACSHA256 不依赖 UA，更稳。
// 曾保存过 requestMode='edge' 的老用户在这里一次性迁移到 signature。
getTranslateSettings(provider) {
  const defaults = {
    baidu: { appID: '', appKey: '' },
    google: {},
    youdao: { appKey: '', appSecret: '' },
    microsoft: { requestMode: 'signature' }, // 'signature' | 'edge'
    'ai-translation': {
      model: '',
      systemPrompt: '你是一个专业翻译。将用户输入翻译成 {to}，只输出译文，不要解释或附加说明。'
    }
  }
  const base = defaults[provider] || {}
  const stored = this._readTranslateStored(provider)
  const merged = Object.assign({}, base, stored)
  if (provider === 'microsoft' && merged.requestMode === 'edge') {
    merged.requestMode = 'signature'
  }
  return merged
},

// 写某 provider 的设置（敏感凭据 → dbCryptoStorage，其余 → dbStorage）。
setTranslateSettings(provider, data) {
  data = data || {}
  this._writeTranslateStored(provider, data)
},

getOcrSettings(provider) {
  const defaults = {
    'ai-ocr': {
      model: '',
      systemPrompt: '识别图片中的所有文字，按原文逐行输出，只输出识别到的文字，不要解释或附加说明。'
    }
  }
  const base = defaults[provider] || {}
  const stored = window.ztools.dbStorage.getItem('ocr.' + provider) || {}
  return Object.assign({}, base, stored)
},

setOcrSettings(provider, data) {
  data = data || {}
  window.ztools.dbStorage.setItem('ocr.' + provider, data)
},

getImageHostSettings() {
  const defaults = { enabled: true, type: 'img-scdn' }
  const stored = window.ztools.dbStorage.getItem('ocr.image-host') || {}
  return Object.assign({}, defaults, stored)
},

setImageHostSettings(data) {
  data = data || {}
  window.ztools.dbStorage.setItem('ocr.image-host', data)
},

async uploadImage(image) {
  if (!image) return null
  const cfg = this.getImageHostSettings()
  if (!cfg || !cfg.enabled) { console.debug('[image-host] disabled, skip'); return null }
  const adapter = IMAGE_HOST_ADAPTORS[cfg.type]
  if (!adapter) { console.debug('[image-host] unknown type, skip:', cfg.type); return null }
  if (/^https?:\/\//i.test(image)) { console.debug('[image-host] http(s) url passthrough'); return image }
  let buf, ext, mime
  const mimeMap = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml'
  }
  if (/^data:/i.test(image)) {
    const m = /^data:([^;]+);base64,/i.exec(image)
    mime = (m && m[1]) || 'image/png'
    ext = (mime.split('/')[1] || 'png').replace('svg+xml', 'svg').toLowerCase()
    buf = Buffer.from(image.split(',')[1] || '', 'base64')
  } else {
    buf = fs.readFileSync(image)
    ext = (path.extname(image).replace(/^\./, '').toLowerCase()) || 'png'
    mime = mimeMap[ext] || 'image/png'
  }
  console.debug('[image-host] uploading', { type: cfg.type, ext, mime, bytes: buf.length })
  const t0 = Date.now()
  try {
    const out = await adapter.upload.call(this, buf, ext, mime)
    const url = (out && out.url) || null
    console.debug('[image-host] upload ok', { ms: Date.now() - t0, urlLen: url ? url.length : 0 })
    return url
  } catch (e) {
    console.warn('[image-host] upload failed (' + (Date.now() - t0) + 'ms), fallback to base64:', e && e.message ? e.message : e)
    return null
  }
},

async translateAi(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text)
  const { model, systemPrompt } = this.getTranslateSettings('ai-translation')
  const prompt = (systemPrompt || '')
    .replace(/\{from\}/g, from && from !== 'auto' ? from : '自动检测')
    .replace(/\{to\}/g, to)
  const res = await window.ztools.ai({
    model: model || undefined,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text || '' }
    ]
  })
  const out = (res && res.content ? String(res.content) : '').trim()
  if (!out) throw new Error('AI 翻译返回为空，请检查 ZTools AI 模型配置')
  return { text: out, detectedFrom: from }
},

async ocrAi(image, lang) {
  const { model, systemPrompt } = this.getOcrSettings('ai-ocr')
  if (!model) throw new Error('AI 识图未选择模型，请在「截图翻译设置」选择支持视觉的模型')
  if (!image) throw new Error('AI 识图未提供图片')
  let imageUrl = await this.uploadImage(image)
  if (!imageUrl) {
    if (!/^https?:\/\//i.test(image) && !/^data:/i.test(image)) {
      imageUrl = this.readFileAsDataURL(image)
    } else {
      imageUrl = image
    }
  }
  const res = await window.ztools.ai({
    model,
    messages: [
      { role: 'system', content: systemPrompt || '识别图片中的所有文字，只输出识别到的文字。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: lang ? `请识别这张图片中的文字（语言：${lang}）。` : '请识别这张图片中的所有文字。' },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } }
        ]
      }
    ]
  })
  const out = (res && res.content ? String(res.content) : '').trim()
  if (!out) throw new Error('AI 识图返回为空，请确认所选模型支持视觉输入')
  return { text: out }
},

// 把中性语言码映射到 provider 自家码；不支持的语种返回 null。
_mapLang(provider, lang) {
  if (!lang || lang === 'auto') return 'auto'
  const m = this.TRANSLATE_LANG_MAP[provider] || {}
  return Object.prototype.hasOwnProperty.call(m, lang) ? m[lang] : null
},

// 目标语言兜底：调用方（如超级面板）未传 to 时，按文本内容推断合理目标语言。
// 规则——以中文为主（CJK 占非空白字符 > 50%）→ 翻译到英文；其余（纯外文、或中外混合但中文不占多数）→ 翻译到中文。
// 阈值与宿主 translationManager.isMostlyChinese 保持一致，保证内置与插件翻译体验统一。
_resolveDefaultTargetLang(text) {
  const t = text || ''
  const cjkMatches = t.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)
  const nonWhitespace = t.replace(/\s/g, '').length
  const isMostlyChinese = cjkMatches && nonWhitespace > 0
    ? cjkMatches.length / nonWhitespace > 0.5
    : false
  return isMostlyChinese ? 'en' : 'zh-CN'
},

// 百度翻译：GET /api/trans/vip/translate，sign=md5(appid+q+salt+appkey)
async translateBaidu(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const { appID, appKey } = this.getTranslateSettings('baidu')
  if (!appID || !appKey) throw new Error('百度翻译未配置 AppID/AppKey，请在「翻译提供商」设置页填写')
  const sf = this._mapLang('baidu', from)
  const st = this._mapLang('baidu', to)
  if (sf === null) throw new Error('百度翻译不支持源语言: ' + from)
  if (st === null) throw new Error('百度翻译不支持目标语言: ' + to)
  const salt = String(Math.floor(Math.random() * 100000))
  const sign = crypto.createHash('md5').update(appID + text + salt + appKey, 'utf8').digest('hex')
  const resp = await this._httpRequest('GET',
    'https://fanyi-api.baidu.com/api/trans/vip/translate',
    { query: { q: text, from: sf, to: st, appid: appID, salt, sign } })
  const data = JSON.parse(resp.body)
  if (data.error_code) throw new Error(`${data.error_code}: ${data.error_msg || 'unknown'}`)
  if (!Array.isArray(data.trans_result)) throw new Error('百度翻译返回异常: ' + resp.body.slice(0, 200))
  const out = data.trans_result.map((x) => x.dst).join('\n')
  return { text: out, detectedFrom: from }
},

// 谷歌翻译：无凭据。优先 gtx 非官方端点；旧 deno 反代常 404（DEPLOYMENT_NOT_FOUND）作兜底。
// 日志根因（2026-08）：googlet.deno.dev → HTTP 404 DEPLOYMENT_NOT_FOUND，导致默认 google 时「翻译不可用」。
async translateGoogle(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const sf = this._mapLang('google', from)
  const st = this._mapLang('google', to)
  if (sf === null) throw new Error('谷歌翻译不支持源语言: ' + from)
  if (st === null) throw new Error('谷歌翻译不支持目标语言: ' + to)

  const errors = []

  // 1) Google translate_a gtx（免费非官方，可能 429 限流）
  try {
    const resp = await this._httpRequest(
      'GET',
      'https://translate.googleapis.com/translate_a/single',
      {
        query: { client: 'gtx', sl: sf || 'auto', tl: st, dt: 't', q: text },
        timeoutMs: 15000
      }
    )
    const data = JSON.parse(resp.body)
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const out = data[0].map((seg) => (seg && typeof seg[0] === 'string' ? seg[0] : '')).join('')
      if (out) {
        const detected = typeof data[2] === 'string' ? data[2] : from
        return { text: out, detectedFrom: detected }
      }
    }
    errors.push('gtx: 返回结构异常 ' + String(resp.body).slice(0, 120))
  } catch (e) {
    errors.push('gtx: ' + String(e && e.message ? e.message : e))
  }

  // 2) 旧 deno 反代（常已下线）
  try {
    const resp = await this._httpRequest('POST', 'https://googlet.deno.dev/translate', {
      json: { text, source_lang: sf, target_lang: st },
      timeoutMs: 12000
    })
    const data = JSON.parse(resp.body)
    if (typeof data.data === 'string' && data.data) {
      return { text: data.data, detectedFrom: from }
    }
    errors.push('deno: 返回异常 ' + String(resp.body).slice(0, 120))
  } catch (e) {
    errors.push('deno: ' + String(e && e.message ? e.message : e))
  }

  throw new Error('谷歌翻译全部端点失败: ' + errors.join(' | '))
},

// 有道翻译：POST openapi.youdao.com/api，form 表单
// sign = sha256(appKey + input(q) + salt + curtime + appSecret)
// input(q) = len<=20 ? q : q.slice(0,10)+len+q.slice(-10)
async translateYoudao(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const { appKey, appSecret } = this.getTranslateSettings('youdao')
  if (!appKey || !appSecret) throw new Error('有道翻译未配置 AppKey/AppSecret，请在「翻译提供商」设置页填写')
  const sf = this._mapLang('youdao', from)
  const st = this._mapLang('youdao', to)
  if (sf === null) throw new Error('有道翻译不支持源语言: ' + from)
  if (st === null) throw new Error('有道翻译不支持目标语言: ' + to)
  const salt = crypto.randomUUID()
  const curtime = String(Math.floor(Date.now() / 1000))
  const input = text.length <= 20 ? text : text.slice(0, 10) + text.length + text.slice(-10)
  const signStr = appKey + input + salt + curtime + appSecret
  const sign = crypto.createHash('sha256').update(signStr, 'utf8').digest('hex').toUpperCase()
  const resp = await this._httpRequest('POST', 'https://openapi.youdao.com/api', {
    form: { q: text, from: sf, to: st, appKey, salt, sign, signType: 'v3', curtime }
  })
  const data = JSON.parse(resp.body)
  if (data.errorCode && data.errorCode !== '0') {
    throw new Error('有道翻译错误码 ' + data.errorCode + ': ' + (data.msg || ''))
  }
  if (!Array.isArray(data.translation) || !data.translation.length) {
    throw new Error('有道翻译返回异常: ' + resp.body.slice(0, 200))
  }
  return { text: data.translation[0], detectedFrom: from }
},

// 微软翻译：两种鉴权方案（默认 signature）
//  - signature:   用 MSTranslatorAndroidApp + HMACSHA256 生成 X-MT-Signature，调 api.cognitive.microsofttranslator.com
//  - edge:        GET edge.microsoft.com/translate/auth 拿 Bearer token，再调 api-edge.cognitive.microsofttranslator.com
//                 edge 端点会按 Chrome UA 版本号风控，旧版本号被拒（400 Client Browser Version not supported），故仅作兜底。
// 两者都 POST /translate?api-version=3.0&to=<t>&from=<s>，body=[{Text}]
_msEdgeToken: null,
_msEdgeTokenExpiresAt: 0,
_msPrivateKey: Buffer.from([
  0xa2, 0x29, 0x3a, 0x3d, 0xd0, 0xdd, 0x32, 0x73,
  0x97, 0x7a, 0x64, 0xdb, 0xc2, 0xf3, 0x27, 0xf5,
  0xd7, 0xbf, 0x87, 0xd9, 0x45, 0x9d, 0xf0, 0x5a,
  0x09, 0x66, 0xc6, 0x30, 0xc6, 0x6a, 0xaa, 0x84,
  0x9a, 0x41, 0xaa, 0x94, 0x3a, 0xa8, 0xd5, 0x1a,
  0x6e, 0x4d, 0xaa, 0xc9, 0xa3, 0x70, 0x12, 0x35,
  0xc7, 0xeb, 0x12, 0xf6, 0xe8, 0x23, 0x07, 0x9e,
  0x47, 0x10, 0x95, 0x91, 0x88, 0x55, 0xd8, 0x17
]),

async _msGetEdgeToken() {
  const now = Date.now()
  if (this._msEdgeToken && now < this._msEdgeTokenExpiresAt - 60000) {
    return this._msEdgeToken
  }
  const resp = await this._httpRequest('GET', 'https://edge.microsoft.com/translate/auth', {
    timeoutMs: 10000
  })
  const token = resp.body.trim().replace(/^"|"$/g, '')
  if (!token) throw new Error('获取微软 Edge token 失败')
  this._msEdgeToken = token
  this._msEdgeTokenExpiresAt = now + 5 * 60 * 1000
  return token
},

_msBuildSignature(requestPath) {
  const guid = crypto.randomUUID().replace(/-/g, '')
  const escapedUrl = encodeURIComponent(requestPath)
  // 对齐 C# 实现：取 RFC1123 字符串，格式 "ddd, dd MMM yyyy HH:mm:ss GMT"
  const dateStr = (function () {
    const d = new Date()
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    return (
      days[d.getUTCDay()] + ', ' + pad(d.getUTCDate()) + ' ' + months[d.getUTCMonth()] +
      ' ' + d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) +
      ':' + pad(d.getUTCSeconds()) + ' GMT'
    )
  })()
  const signSrc = ('MSTranslatorAndroidApp' + escapedUrl + dateStr + guid).toLowerCase()
  const hash = crypto.createHmac('sha256', this._msPrivateKey).update(signSrc, 'utf8').digest('base64')
  return 'MSTranslatorAndroidApp::' + hash + '::' + dateStr + '::' + guid
},

async translateMicrosoft(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const { requestMode } = this.getTranslateSettings('microsoft')
  const sf = this._mapLang('microsoft', from)
  const st = this._mapLang('microsoft', to)
  if (st === null) throw new Error('微软翻译不支持目标语言: ' + to)
  // microsoft 不支持粤语；from=null 时不带 from 参数（API 自动检测）
  if (sf === null && from && from !== 'auto') throw new Error('微软翻译不支持源语言: ' + from)

  const endpoint = requestMode === 'signature'
    ? 'api.cognitive.microsofttranslator.com'
    : 'api-edge.cognitive.microsofttranslator.com'
  let path = `/translate?api-version=3.0&to=${encodeURIComponent(st)}`
  if (sf && sf !== 'auto') path += `&from=${encodeURIComponent(sf)}`

  // Edge Token / Signature 端点都会校验 User-Agent，必须带 Chrome UA。
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  }
  if (requestMode === 'signature') {
    headers['X-MT-Signature'] = this._msBuildSignature(endpoint + path)
  } else {
    const token = await this._msGetEdgeToken()
    headers['Authorization'] = 'Bearer ' + token
  }

  const resp = await this._httpRequest('POST', `https://${endpoint}${path}`, {
    json: [{ Text: text }],
    headers,
    timeoutMs: 15000
  })
  const arr = JSON.parse(resp.body)
  if (!Array.isArray(arr) || !arr.length || !arr[0].translations || !arr[0].translations.length) {
    throw new Error('微软翻译返回异常: ' + resp.body.slice(0, 200))
  }
  return { text: arr[0].translations[0].text, detectedFrom: from }
  },

  // ─── Paddle / RapidOCR-json 离线 OCR ────────────────────────────────
  // 无需凭证：设置页点下载，镜像拉取官方 Windows 包后自动记下 exe。
  _paddleDataDir() {
    return path.join(this._nativeDataRoot(), 'paddle')
  },
  _paddlePluginConfig() {
    try {
      const raw = fs.readFileSync(path.join(this._pluginRoot(), 'plugin.json'), 'utf8')
      const cfg = JSON.parse(raw)
      const native = (cfg && cfg.nativePaddle) || {}
      const key = process.platform === 'darwin' ? 'mac' : 'win'
      return native[key] || {}
    } catch (_) {
      return {}
    }
  },
  _findPaddleExe(root) {
    return findPaddleExe(root)
  },
  _paddleConfig() {
    return window.ztools.dbStorage.getItem('ocr.paddle') || { exePath: '' }
  },
  setPaddleSettings(data) {
    window.ztools.dbStorage.setItem('ocr.paddle', data || {})
  },
  getPaddleSettings() {
    return this._paddleConfig()
  },
  paddleStatus() {
    let { exePath } = this._paddleConfig()
    if ((!exePath || !fs.existsSync(exePath)) && fs.existsSync(this._paddleDataDir())) {
      exePath = this._findPaddleExe(this._paddleDataDir())
      if (exePath) this.setPaddleSettings({ exePath })
    }
    const ready = !!(exePath && fs.existsSync(exePath))
    const cfg = this._paddlePluginConfig()
    return {
      ready,
      exePath: exePath || '',
      missing: ready ? [] : ['PaddleOCR-json'],
      version: cfg.version || null
    }
  },
  async paddleDownload(onProgress, hostIndex) {
    const cfg = this._paddlePluginConfig()
    if (!cfg.downloadUrl) {
      return { ok: false, error: process.platform === 'darwin' ? '当前仅提供 Windows 版 Paddle OCR 下载' : '未配置 Paddle 下载地址' }
    }
    this._paddleSignal = { aborted: false }
    const signal = this._paddleSignal
    const ext = path.extname(cfg.downloadUrl).toLowerCase() || '.7z'
    const cacheDir = path.join(this._nativeDataRoot(), 'cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    const tmpArc = path.join(cacheDir, 'paddle' + ext)
    const workDir = path.join(os.tmpdir(), `snap-translate-paddle-extract-${Date.now()}`)
    try {
      fs.mkdirSync(workDir, { recursive: true })
      if (onProgress) onProgress({ phase: 'downloading', percent: 0, loaded: 0, total: 0 })
      if (hostIndex != null) {
        const url = await this._applyGhProxy(cfg.downloadUrl, hostIndex, signal)
        await this._downloadFile(url, tmpArc, onProgress, undefined, signal)
      } else {
        await this._downloadWithMirrors(cfg.downloadUrl, tmpArc, onProgress, signal)
      }
      if (onProgress) onProgress({ phase: 'extracting', percent: 0, loaded: 0, total: 0 })
      this._extractArchive(tmpArc, workDir)
      const dest = this._paddleDataDir()
      fs.mkdirSync(this._nativeDataRoot(), { recursive: true })
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
      fs.cpSync(workDir, dest, { recursive: true, force: true })
      const exePath = this._findPaddleExe(dest)
      if (!exePath) return { ok: false, error: '解压完成但未找到 PaddleOCR-json.exe' }
      this.setPaddleSettings({ exePath })
      try { fs.unlinkSync(tmpArc) } catch (_) {}
      return { ok: true }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      if (signal.aborted || msg === '下载已取消') return { ok: false, cancelled: true }
      return { ok: false, error: msg }
    } finally {
      this._paddleSignal = null
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (_) {}
    }
  },
  paddleRemove() {
    const dir = this._paddleDataDir()
    this.setPaddleSettings({ exePath: '' })
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  },
  paddleCancel() {
    if (this._paddleSignal) {
      this._paddleSignal.aborted = true
      if (this._paddleSignal.req) {
        try { this._paddleSignal.req.destroy() } catch (_) {}
      }
    }
  },
  async paddleRecognize(image /*, lang */) {
    const { exePath } = this.paddleStatus()
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error('未安装 Paddle OCR。请将 PaddleOCR-json.exe 放入设置页所示存放目录')
    }
    const tmpFile = await this._ocrMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const { spawnSync } = require('node:child_process')
      const s = paddleSpawnArgs(exePath, tmpFile)
      const r = spawnSync(exePath, s.args, {
        cwd: s.cwd,
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      })
      if (r.error) throw r.error
      const stdout = String(r.stdout || '')
      const stderr = String(r.stderr || '')
      try {
        return parsePaddleOutput(stdout)
      } catch (e1) {
        if (stderr) return parsePaddleOutput(stderr)
        throw e1
      }
    } finally {
      if (isTemp) {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
      }
    }
  }
  }
}

function attachProviders(services) {
  const methods = providerMethods()
  for (const key of Object.keys(methods)) {
    if (typeof services[key] !== 'function') services[key] = methods[key]
  }
  const register =
    (typeof ztools !== 'undefined' && ztools.registerProvider) ||
    (window.ztools && window.ztools.registerProvider)
  if (typeof register !== 'function') return
  // OCR 契约：input { image, lang? } -> { text, blocks?, confidence? }
  register('ocr', async (input) => {
    const { image } = input || {}
    return await window.services.ocrRecognize(image)
  })
  register('paddle', async (input) => {
    const { image } = input || {}
    return await window.services.paddleRecognize(image)
  })
  // 翻译契约：input { text, from?, to? } -> { text, detectedFrom? }
  register('baidu', async (input) => {
    const { text, from, to } = input || {}
    return await window.services.translateBaidu(text, from, to)
  })
  register('google', async (input) => {
    const { text, from, to } = input || {}
    return await window.services.translateGoogle(text, from, to)
  })
  register('youdao', async (input) => {
    const { text, from, to } = input || {}
    return await window.services.translateYoudao(text, from, to)
  })
  register('microsoft', async (input) => {
    const { text, from, to } = input || {}
    return await window.services.translateMicrosoft(text, from, to)
  })
  register('ai-translation', async (input) => {
    const { text, from, to } = input || {}
    return await window.services.translateAi(text, from, to)
  })
  register('ai-ocr', async (input) => {
    const { image, lang } = input || {}
    return await window.services.ocrAi(image, lang)
  })
}

module.exports = { attachProviders }
