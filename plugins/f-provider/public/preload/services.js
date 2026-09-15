const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')
const crypto = require('node:crypto')
const { URL } = require('node:url')

// ─── multipart/form-data body 构造（图床文件上传用）──────────────────────────
// 手搓 boundary 拼装，避免引入第三方 form-data 包。
//   fields：字符串键值对（如 { storage_destination: 'r2' }）
//   files ：{ key: { filename, contentType, data: Buffer } }
// 返回可直接作为 HTTP body 写出的完整 Buffer。
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
// 每个图床一个对象：{ name, description, upload(buf, ext, mime) -> { url } }。
// upload 内 this 绑定为 services，可复用 this._httpRequest（代理/重定向/超时统一）。
// 后续新增图床只需在此表加一项 + ImageHostType 联合类型扩一项即可。
const IMAGE_HOST_ADAPTORS = {
  'img-scdn': {
    name: 'img.scdn.io',
    description: '免鉴权图床，支持 Cloudflare R2 存储（storage_destination=r2）',
    // buf: 图片二进制 Buffer；ext/mime 用于 multipart 文件头。返回 { url }。
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

// GitHub Release 下载加速镜像列表（竞速选最快）。
// 对 github.com 域名的下载 URL，并发请求各镜像，谁先返回响应头即胜出，
// 全部失败/超时则回退原始 URL 直连，保证不卡死。
// 格式为「前缀 + 完整原始 URL」，如：
//   https://v6.gh-proxy.org/https://github.com/kaineooo/f-provider/releases/download/v1.0.4/latex-models.zip
// 暴露给前端用于「选择加速 host 重试」UI。
const GH_PROXY_HOSTS = [
  'https://gh-proxy.org/',
  'https://v4.gh-proxy.org/',
  'https://v6.gh-proxy.org/',
  'https://cdn.gh-proxy.org/'
]


// ──────────────────────────────────────────────────────────────────────────
// f-provider: 微信 OCR Provider
//
// 通过原生模块 wechat_ocr.node 调用本机微信内置 OCR 引擎
// （mmmojo.dll + WeChatOCR.exe）实现离线图片文字识别。
//
// 既作为 Provider（在 plugin.json 的 providers.ocr 声明）供主程序聚合调用，
// 也提供一个交互式 feature（拖入图片 → 识别 → 展示）作为可视化入口。
// ──────────────────────────────────────────────────────────────────────────

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
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

  // ─── LaTeX 公式 OCR（基于 onnxruntime-node + pix2tex ONNX 导出模型）──
  // 与微信 OCR 引擎完全独立：独立的配置块（plugin.json nativeLatex）、
  // 独立的落地目录（<userData>/f-provider/latex/）、独立的状态/下载/释放。
  //
  // 引擎产物结构：
  //   latex/
  //     onnxruntime-node/   （来自 GitHub Release 的 latex-ort-{win,mac}.zip，含平台原生二进制）
  //     models/{encoder,decoder,image_resizer}.onnx + tokenizer.json
  //
  // 推理在 preload（Node 侧）完成：lazy require latexOcr.js，
  // 其内部用 require(path.join(latexDir,'onnxruntime-node')) 加载 ORT。
  _latexEngine: null, // createLatexOcr 返回的推理器实例
  _latexDataRoot() {
    // 与微信 OCR 共用 <userData>/f-provider 数据根，latex 子目录独立
    return path.join(window.ztools.getPath('userData'), 'f-provider')
  },
  _latexDir() {
    return path.join(this._latexDataRoot(), 'latex')
  },
  // 读 plugin.json 的 nativeLatex 配置块（结构与 native 块一致）。
  _latexConfig() {
    if (this._latexConfigCache) return this._latexConfigCache
    try {
      const raw = fs.readFileSync(path.join(this._pluginRoot(), 'plugin.json'), 'utf8')
      const cfg = JSON.parse(raw)
      const native = (cfg && cfg.nativeLatex) || {}
      const key = process.platform === 'darwin' ? 'mac' : 'win'
      this._latexConfigCache = native[key] || (native.mac || native.win ? {} : native)
    } catch (_) {
      this._latexConfigCache = {}
    }
    return this._latexConfigCache
  },
  _latexConfigCache: null,

  // 检查 LaTeX 引擎是否就绪。真值来源 = 关键文件存在与否（与 nativeStatus 对齐）。
  latexStatus() {
    const dir = this._latexDir()
    const missing = []
    // onnxruntime-node：要求能 require（main 入口存在）；平台二进制由其内部解析
    const ortEntry = path.join(dir, 'onnxruntime-node', 'package.json')
    if (!fs.existsSync(ortEntry)) missing.push('onnxruntime-node/')
    // 三个 ONNX 模型 + tokenizer
    const models = path.join(dir, 'models')
    const need = ['encoder.onnx', 'decoder.onnx', 'image_resizer.onnx', 'tokenizer.json']
    for (const f of need) {
      if (!fs.existsSync(path.join(models, f))) missing.push('models/' + f)
    }
    return {
      ready: missing.length === 0,
      missing,
      version: this._latexConfig().version || null
    }
  },

  // 释放 LaTeX 引擎（关闭 ONNX Session，释放模型内存）。
  latexDispose() {
    if (this._latexEngine) {
      try { this._latexEngine.dispose() } catch (_) {}
      this._latexEngine = null
    }
  },

  // 懒加载推理器：首次调用才 require latexOcr.js 并 createLatexOcr。
  _latexEnsure() {
    if (this._latexEngine) return this._latexEngine
    const { createLatexOcr } = require(path.join(__dirname, 'latexOcr.js'))
    this._latexEngine = createLatexOcr(this._latexDir())
    return this._latexEngine
  },

  // 把任意 image 输入归一化为本地临时文件路径（复用与 _ocrMaterialize 相同逻辑）。
  async _latexMaterialize(image) {
    return this._ocrMaterialize(image)
  },

  // LaTeX Provider 契约：返回 { text, blocks, confidence }；失败抛错。
  async latexRecognize(image) {
    const tmpFile = await this._latexMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const engine = this._latexEnsure()
      const { latex } = await engine.recognize(tmpFile)
      return {
        text: latex || '',
        blocks: [latex || ''],
        confidence: 1
      }
    } finally {
      if (isTemp) {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
      }
    }
  },

  // 交互式 feature 用：返回 { ok, latex, error? }（不抛错）。
  async latexRecognizeDetail(image) {
    const tmpFile = await this._latexMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const engine = this._latexEnsure()
      const { latex } = await engine.recognize(tmpFile)
      return { ok: true, latex: latex || '' }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    } finally {
      if (isTemp) {
        try { fs.unlinkSync(tmpFile) } catch (_) {}
      }
    }
  },

  // 下载 LaTeX 引擎并解压到 latex 数据目录（去重布局）。
  // 直接下载 GitHub Release 上的两个 zip（github 域名经 _applyGhProxy 固定走
  // v6.gh-proxy.org 加速）：
  //   - latex-ort-{win,mac}.zip  顶层 onnxruntime-node/（当前平台 ORT，小）
  //   - latex-models.zip         顶层 models/（共享 ONNX 模型 + tokenizer，~179MB）
  // 解压后按当前平台选取 onnxruntime-node 目录，与 models 组装成 latex/ 再拷贝到数据目录。
  // 进度合并：ORT 映射到 0–50%，models 映射到 50–100%，避免第二个文件从 0 跳回。
  async latexDownload(onProgress, hostIndex) {
    const cfg = this._latexConfig()
    if (!cfg.ortUrl || !cfg.modelsUrl) {
      return { ok: false, error: '未配置 nativeLatex 下载地址，请在 plugin.json 中设置 nativeLatex.{win,mac}.{ortUrl,modelsUrl}' }
    }
    // 取消信号（latexCancel 置 aborted=true 中断下载）
    this._latexSignal = { aborted: false }
    const signal = this._latexSignal
    // 释放可能已加载的旧引擎，避免覆盖文件后引用悬空
    this.latexDispose()
    const ortZip = path.join(os.tmpdir(), `f-provider-latex-ort-${Date.now()}.zip`)
    const modelsZip = path.join(os.tmpdir(), `f-provider-latex-models-${Date.now()}.zip`)
    // 解压目录（产出顶层 onnxruntime-node/ 与 models/）
    const extractDir = path.join(os.tmpdir(), `f-provider-latex-extract-${Date.now()}`)
    // 装配目录：组装出 latex/{onnxruntime-node, models} 供整体拷贝
    const stageDir = path.join(os.tmpdir(), `f-provider-latex-stage-${Date.now()}`)
    try {
      fs.mkdirSync(extractDir, { recursive: true })
      fs.mkdirSync(stageDir, { recursive: true })
      // 1) 下载 ORT zip（小，占整体 0–50%）。
      if (onProgress) onProgress({ phase: 'downloading', percent: 0, loaded: 0, total: 0 })
      const ortUrl = await this._applyGhProxy(cfg.ortUrl, hostIndex, signal)
      await this._downloadFile(ortUrl, ortZip, (p) => {
        if (onProgress && p.phase === 'downloading') {
          onProgress({
            phase: 'downloading',
            loaded: p.loaded,
            total: p.total,
            percent: p.total > 0 ? Math.min(50, Math.round((p.loaded / p.total) * 50)) : 0
          })
        }
      }, undefined, signal)
      // 可选 sha256 校验（ORT）
      if (cfg.ortSha256) {
        const sum = await this._sha256File(ortZip)
        if (sum.toLowerCase() !== String(cfg.ortSha256).toLowerCase()) {
          return { ok: false, error: 'ORT 校验和不匹配，文件可能已损坏' }
        }
      }
      // 2) 下载 models zip（大，~179MB，占整体 50–100%）。
      const modelsUrl = await this._applyGhProxy(cfg.modelsUrl, hostIndex, signal)
      await this._downloadFile(modelsUrl, modelsZip, (p) => {
        if (onProgress && p.phase === 'downloading') {
          onProgress({
            phase: 'downloading',
            loaded: p.loaded,
            total: p.total,
            percent: 50 + (p.total > 0 ? Math.min(50, Math.round((p.loaded / p.total) * 50)) : 0)
          })
        }
      }, undefined, signal)
      // 可选 sha256 校验（models）
      if (cfg.modelsSha256) {
        const sum = await this._sha256File(modelsZip)
        if (sum.toLowerCase() !== String(cfg.modelsSha256).toLowerCase()) {
          return { ok: false, error: 'models 校验和不匹配，文件可能已损坏' }
        }
      }
      // 3) 解压 ORT zip → onnxruntime-node/
      if (onProgress) onProgress({ phase: 'extracting', percent: 0, loaded: 0, total: 0 })
      this._extractZip(ortZip, extractDir)
      // 4) 解压 models zip → models/
      this._extractZip(modelsZip, extractDir)
      // 5) 装配 latex/{onnxruntime-node, models}（去重布局：models 共享一份）
      const ortSrc = path.join(extractDir, 'onnxruntime-node')
      const modelsSrc = path.join(extractDir, 'models')
      if (!fs.existsSync(ortSrc)) {
        return { ok: false, error: '压缩包内未找到 onnxruntime-node/（ORT zip 顶层结构异常）' }
      }
      if (!fs.existsSync(modelsSrc)) {
        return { ok: false, error: '压缩包内未找到 models/（models zip 顶层结构异常）' }
      }
      const staged = path.join(stageDir, 'latex')
      fs.mkdirSync(staged, { recursive: true })
      fs.cpSync(ortSrc, path.join(staged, 'onnxruntime-node'), { recursive: true, force: true })
      fs.cpSync(modelsSrc, path.join(staged, 'models'), { recursive: true, force: true })
      this._installLatex(staged)
      // 6) 复检关键文件
      const status = this.latexStatus()
      if (!status.ready) {
        return { ok: false, error: '解压完成但缺少关键文件: ' + status.missing.join(', ') }
      }
      return { ok: true }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      if (signal.aborted || msg === '下载已取消') {
        return { ok: false, cancelled: true }
      }
      return { ok: false, error: msg }
    } finally {
      this._latexSignal = null
      try { fs.unlinkSync(ortZip) } catch (_) {}
      try { fs.unlinkSync(modelsZip) } catch (_) {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch (_) {}
      try { fs.rmSync(stageDir, { recursive: true, force: true }) } catch (_) {}
    }
  },

  // 取消进行中的 LaTeX 下载（用户点「取消」时调用）。
  latexCancel() {
    if (this._latexSignal) {
      this._latexSignal.aborted = true
      // 销毁竞速阶段的镜像探测请求，使 _pickFastestMirror 立即回退 → _downloadFile 入口 reject
      if (Array.isArray(this._latexSignal.raceReqs)) {
        for (const r of this._latexSignal.raceReqs) {
          try { r.destroy() } catch (_) {}
        }
      }
      // 带 error 参数 destroy，确保触发 req.on('error', reject)，避免 Promise 悬挂
      if (this._latexSignal.req) {
        try { this._latexSignal.req.destroy(new Error('下载已取消')) } catch (_) {}
      }
    }
  },

  // 把临时目录里解压好的 latex/ 整体拷贝到数据目录（覆盖安装）。
  _installLatex(stagedLatex) {
    const dest = this._latexDir()
    fs.mkdirSync(this._latexDataRoot(), { recursive: true })
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
    fs.cpSync(stagedLatex, dest, { recursive: true, force: true })
  },

  // 删除已下载的 LaTeX 引擎目录（便于重新下载/释放空间）。
  latexRemove() {
    const dir = this._latexDir()
    this.latexDispose()
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  },

  // ─── native 引擎下载/状态管理 ─────────────────────────────────────────
  // 插件初始不带 native；前端展示下载状态，用户点击下载后从 GitHub Release 拉取
  // 当前平台的 native-{win,mac}.zip（github 域名经 _applyGhProxy 走 v6.gh-proxy.org
  // 加速），解压得到顶层 native/，再拷贝到用户数据目录。插件被打包成 asar 后插件
  // 目录只读，故 native 落盘于 userData 而非插件目录。
  _pluginRoot() {
    // preload 文件位于 <pluginRoot>/preload/services.js（asar 内，仅用于读 plugin.json）
    return path.join(__dirname, '..')
  },
  // native 产物所在的数据根目录（可写；独立于只读的 asar 插件目录）。
  _nativeDataRoot() {
    return path.join(window.ztools.getPath('userData'), 'f-provider')
  },
  _nativeDir() {
    return path.join(this._nativeDataRoot(), 'native')
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

  // 并发竞速选最快的加速镜像（仅对 github.com 域名启用）。
  // 谁先返回响应头谁胜出，立即销毁其余请求；全部失败/超时回退原始 URL 直连。
  // 单请求超时 8s。
  _pickFastestMirror(rawUrl, signal) {
    // 已取消则直接回退原始 URL（让 _downloadFile 在入口处 reject）
    if (signal && signal.aborted) return Promise.resolve(rawUrl)
    try {
      const u = new URL(rawUrl)
      if (u.hostname !== 'github.com') return Promise.resolve(rawUrl)
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
      // 注册竞速请求到 signal：取消时可统一 destroy，使 Promise.all 立即 resolve
      // → finish 回退原始 URL → _downloadFile 在入口检测 aborted 后 reject
      if (signal) {
        signal.raceReqs = reqs
        if (signal.aborted) { finish(rawUrl); return }
      }
      Promise.all(
        reqs.map((r) =>
          new Promise((res) => {
            if (r.destroyed) return res()
            r.on('close', () => res())
            r.on('error', () => res())
          })
        )
      ).then(() => { if (!settled) finish(rawUrl) })
    })
  },

  // 对 github.com 域名的下载 URL 套上加速镜像前缀；其余域名原样返回。
  //   hostIndex:
  //     - undefined: 并发竞速，选最快的镜像（默认）。
  //     - -1:        直连原始 URL（不走加速）。
  //     - 0..N-1:    指定使用 GH_PROXY_HOSTS[hostIndex]。
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

  // 暴露加速 host 列表给前端（用于「选择 host 重试」UI）。
  ghProxyHosts() {
    return GH_PROXY_HOSTS.slice()
  },

  // 下载 native.zip 到临时目录，支持 3xx 重定向跟随（兼容 GitHub release 跳 CDN）。
  // onProgress({ phase, percent, loaded, total }) 用于上报进度。
  // signal: 可选的取消信号对象 { aborted, req }，aborted=true 时立即销毁请求中断下载。
  _downloadFile(url, dest, onProgress, maxRedirects, signal) {
    maxRedirects = maxRedirects == null ? 5 : maxRedirects
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new Error('下载已取消'))
        return
      }
      let parsed
      try { parsed = new URL(url) } catch (e) { reject(e); return }
      const client = parsed.protocol === 'https:' ? https : http
      const req = client.get(parsed, (res) => {
        // 注册到 signal：取消时可直接 destroy 当前请求
        if (signal) {
          signal.req = req
          if (signal.aborted) {
            try { req.destroy() } catch (_) {}
            reject(new Error('下载已取消'))
            return
          }
        }
        // 取消检查：响应头到达后也检查一次
        if (signal && signal.aborted) {
          try { req.destroy() } catch (_) {}
          try { fs.unlinkSync(dest) } catch (_) {}
          reject(new Error('下载已取消'))
          return
        }
        // 重定向
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
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('下载失败: HTTP ' + res.statusCode))
          return
        }
        const total = Number(res.headers['content-length']) || 0
        let loaded = 0
        const file = fs.createWriteStream(dest)
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
        // 响应流异常（含取消 destroy 触发的 socket 中断）时 reject，避免 Promise 悬挂
        res.on('error', (err) => {
          try { file.destroy() } catch (_) {}
          reject(err)
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', (err) => {
          try { fs.unlinkSync(dest) } catch (_) {}
          reject(err)
        })
      })
      req.on('error', reject)
    })
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

  // 解压 zip 到目标目录（幂等覆盖）。
  //  - Windows: PowerShell Expand-Archive -Force。
  //  - macOS:   系统 unzip -o（覆盖），并对整个解压目录递归去 quarantine，
  //             避免 Gatekeeper 拦截 dlopen（native 的 dylib、latex onnxruntime-node 的 .node 均需此处理）。
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
      // 解压出的二进制带下载来源的 quarantine 属性时，dlopen 会被 Gatekeeper 拦截。
      // 对整个 destDir 递归去除，兼容 native/、onnxruntime-node/、models/ 等任意顶层目录。
      spawnSync('xattr', ['-dr', 'com.apple.quarantine', destDir], {
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

  // 主流程：下载平台 native zip + 校验 + 解压（临时目录）+ 拷贝到数据目录 + 复检。
  // 直接下载 GitHub Release 上的 native-{win,mac}.zip（github 域名经 _applyGhProxy
  // 固定走 v6.gh-proxy.org 加速），zip 顶层含 native/ 目录，解压即还原结构。
  // onProgress({ phase, percent, loaded, total }) -> Promise<{ ok, error? }>
  async nativeDownload(onProgress, hostIndex) {
    const cfg = this._nativeConfig()
    if (!cfg.downloadUrl) {
      return { ok: false, error: '未配置 native 下载地址，请在 plugin.json 中设置 native.{win,mac}.downloadUrl' }
    }
    // 取消信号（nativeCancel 置 aborted=true 中断下载）
    this._nativeSignal = { aborted: false }
    const signal = this._nativeSignal
    // 释放可能已加载的旧引擎，避免覆盖 .node 后引用悬空。
    if (this._ocrAddon) {
      try { this._ocrAddon.dispose() } catch (_) {}
      this._ocrAddon = null
    }
    const zipName = process.platform === 'darwin' ? 'native-mac.zip' : 'native-win.zip'
    const tmpZip = path.join(os.tmpdir(), `f-provider-${zipName}-${Date.now()}.zip`)
    const workDir = path.join(os.tmpdir(), `f-provider-extract-${Date.now()}`)
    try {
      fs.mkdirSync(workDir, { recursive: true })

      // 1) 下载阶段：github.com URL 经 gh-proxy 加速，其余域名直连。
      if (onProgress) onProgress({ phase: 'downloading', percent: 0, loaded: 0, total: 0 })
      const downloadUrl = await this._applyGhProxy(cfg.downloadUrl, hostIndex, signal)
      await this._downloadFile(downloadUrl, tmpZip, onProgress, undefined, signal)

      // 2) 可选 sha256 校验
      if (cfg.sha256) {
        const sum = await this._sha256File(tmpZip)
        if (sum.toLowerCase() !== String(cfg.sha256).toLowerCase()) {
          return { ok: false, error: '校验和不匹配，文件可能已损坏' }
        }
      }

      // 3) 解压 zip 到临时目录 → 顶层 native/
      if (onProgress) onProgress({ phase: 'extracting', percent: 0, loaded: 0, total: 0 })
      this._extractZip(tmpZip, workDir)

      // 4) 拷贝 native/ 到数据目录（先清旧目录，避免残留过期文件）
      const staged = path.join(workDir, 'native')
      if (!fs.existsSync(staged)) {
        return { ok: false, error: '解压完成但未找到 native 目录' }
      }
      this._installNative(staged)

      // 5) 复检关键文件
      const status = this.nativeStatus()
      if (!status.ready) {
        return {
          ok: false,
          error: '解压完成但缺少关键文件: ' + status.missing.join(', ')
        }
      }
      return { ok: true }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      if (signal.aborted || msg === '下载已取消') {
        return { ok: false, cancelled: true }
      }
      return { ok: false, error: msg }
    } finally {
      this._nativeSignal = null
      try { fs.unlinkSync(tmpZip) } catch (_) {}
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (_) {}
    }
  },

  // 取消进行中的 native 下载（用户点「取消」时调用）。
  nativeCancel() {
    if (this._nativeSignal) {
      this._nativeSignal.aborted = true
      // 销毁竞速阶段的镜像探测请求，使 _pickFastestMirror 立即回退 → _downloadFile 入口 reject
      if (Array.isArray(this._nativeSignal.raceReqs)) {
        for (const r of this._nativeSignal.raceReqs) {
          try { r.destroy() } catch (_) {}
        }
      }
      // 带 error 参数 destroy，确保触发 req.on('error', reject)，避免 Promise 悬挂
      if (this._nativeSignal.req) {
        try { this._nativeSignal.req.destroy(new Error('下载已取消')) } catch (_) {}
      }
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
// 解析系统/环境代理，返回 {host, port} 或 null。结果按协议做缓存（进程级）。
// 优先级：环境变量 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY > Windows 注册表 ProxyServer。
// 只在 win32 读注册表；其他平台仅认环境变量。
_proxyCache: {},
_resolveHttpProxy(targetProtocol) {
  if (this._proxyCache[targetProtocol] !== undefined) return this._proxyCache[targetProtocol]
  const pick = (s) => {
    if (!s) return null
    try {
      const u = new URL(s.includes('://') ? s : 'http://' + s)
      if (!u.hostname || !u.port) return null
      return { host: u.hostname, port: parseInt(u.port, 10) }
    } catch (e) { return null }
  }
  let p = null
  if (targetProtocol === 'https:') {
    p = pick(process.env.HTTPS_PROXY || process.env.https_proxy)
    if (!p) p = pick(process.env.ALL_PROXY || process.env.all_proxy)
  } else {
    p = pick(process.env.HTTP_PROXY || process.env.http_proxy)
    if (!p) p = pick(process.env.ALL_PROXY || process.env.all_proxy)
  }
  // win32：读注册表 Internet Settings 的 ProxyServer（如 Clash 写入 127.0.0.1:7897）。
  // 用 spawnSync + 参数数组（shell:false），避免 execSync 经 shell 执行时反斜杠被转义吞掉。
  if (!p && process.platform === 'win32') {
    try {
      const { spawnSync } = require('node:child_process')
      const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
      const r = spawnSync('reg', ['query', regKey], {
        encoding: 'utf8', timeout: 3000, windowsHide: true
      })
      const out = r.stdout || ''
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)
      const m = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(out)
      if (enabled && m) {
        // ProxyServer 可能是 "host:port" 或 "http=host:port;https=host:port" 形式
        const raw = m[1].trim()
        const entries = raw.split(';').map(x => x.trim()).filter(Boolean)
        let chosen = null
        for (const e of entries) {
          const eq = e.indexOf('=')
          if (eq > 0) {
            const k = e.slice(0, eq).toLowerCase()
            if (k === 'https' && targetProtocol === 'https:') { chosen = e.slice(eq + 1); break }
            if (k === 'http' && targetProtocol !== 'https:') { chosen = e.slice(eq + 1); break }
          } else {
            chosen = e // 单一 host:port 形式，http/https 共用
          }
        }
        if (chosen) p = pick(chosen)
      }
    } catch (e) { /* 读注册表失败则视为无系统代理 */ }
  }
  this._proxyCache[targetProtocol] = p
  return p
},

// 通过 HTTP CONNECT 建立到 targetHost:targetPort 的 TLS 隧道，返回底层 socket。
// 用于让 https.request 走系统代理（Node 的 https 默认不走系统代理，需手动 CONNECT）。
_tunnelConnect(proxyHost, proxyPort, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const tunnel = http.request({
      method: 'CONNECT',
      host: proxyHost,
      port: proxyPort,
      path: targetHost + ':' + targetPort,
      headers: { Host: targetHost + ':' + targetPort }
    })
    tunnel.setTimeout(timeoutMs, () => tunnel.destroy(new Error('代理隧道超时')))
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error('代理拒绝 CONNECT: ' + res.statusCode))
        return
      }
      resolve(socket)
    })
    tunnel.on('error', reject)
    tunnel.end()
  })
},

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

  const doOnce = async (targetUrl) => {
    let parsed
    try { parsed = new URL(targetUrl) } catch (e) { throw e }
    const isHttps = parsed.protocol === 'https:'
    const client = isHttps ? https : http
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
      // multipart/form-data 文件上传（图床用）：手搓 boundary，
      // 由 _buildMultipartBody 拼装 fields + 文件 Buffer 为完整 body。
      const boundary = '----ztools' + crypto.randomBytes(8).toString('hex')
      bodyBuf = _buildMultipartBody(boundary, opts.multipart)
      headers['Content-Type'] = headers['Content-Type'] || ('multipart/form-data; boundary=' + boundary)
      headers['Content-Length'] = bodyBuf.length
    } else if (opts.body !== undefined) {
      bodyBuf = Buffer.from(String(opts.body), 'utf8')
      headers['Content-Length'] = bodyBuf.length
    }

    const reqPath = parsed.pathname + (parsed.search || buildQS(opts.query))
    const targetPort = parseInt(parsed.port, 10) || (isHttps ? 443 : 80)
    const proxy = this._resolveHttpProxy(parsed.protocol)

    // HTTPS + 代理：先 CONNECT 建隧道，再把 socket 交给 https.request 做 TLS。
    // 这是让 Node https 走系统代理（如 Clash 127.0.0.1:7897）的标准方式，
    // 否则 Node 会直连目标 IP，在国内访问 google/microsoft 等境外端点会超时。
    let tunneledSocket = null
    if (isHttps && proxy) {
      try {
        tunneledSocket = await this._tunnelConnect(proxy.host, proxy.port, parsed.hostname, targetPort, timeoutMs)
      } catch (e) {
        // 隧道失败则回退直连（保留原行为，便于代理临时不可用时仍可访问境内端点）
        tunneledSocket = null
      }
    }

    const reqOpts = {
      method,
      hostname: parsed.hostname,
      port: targetPort,
      path: reqPath,
      headers
    }
    // HTTP + 代理：走绝对 URI 转发（HTTP 代理标准用法）。
    if (!isHttps && proxy) {
      reqOpts.hostname = proxy.host
      reqOpts.port = proxy.port
      reqOpts.path = parsed.toString() // 绝对 URI
    }
    // HTTPS + 代理：在隧道 socket 上发请求；servername 用于 SNI。
    // 注意：复用 socket 时 Node 不会自动补 Host 头，必须显式设置，
    // 否则部分代理（如 Clash）会因无法识别目标主机而返回伪造的 404。
    if (isHttps && tunneledSocket) {
      reqOpts.socket = tunneledSocket
      reqOpts.servername = parsed.hostname
      headers['Host'] = parsed.hostname + (parsed.port ? ':' + parsed.port : '')
      reqOpts.headers = headers
      delete reqOpts.hostname
      delete reqOpts.port
      delete reqOpts.createConnection
    }

    return new Promise((resolve, reject) => {
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
  }

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

// 读某 provider 的设置（合并默认值）。全部走 ztools.dbStorage（按插件命名空间隔离）。
// 微软：默认 signature。edge 端点会按 Chrome UA 版本号风控（旧版本号被拒 400
// Client Browser Version not supported），signature 走 HMACSHA256 不依赖 UA，更稳。
// 曾保存过 requestMode='edge' 的老用户在这里一次性迁移到 signature。
getTranslateSettings(provider) {
  const defaults = {
    baidu: { appID: '', appKey: '' },
    google: {},
    youdao: { appKey: '', appSecret: '' },
    microsoft: { requestMode: 'signature' }, // 'signature' | 'edge'
    // AI 翻译：复用宿主已配置的 AI 模型（走 ztools.ai），此处只存模型选择与 prompt 模板，不存密钥。
    'ai-translation': {
      model: '',
      systemPrompt: '你是一个专业翻译。将用户输入翻译成 {to}，只输出译文，不要解释或附加说明。'
    }
  }
  const base = defaults[provider] || {}
  const stored = window.ztools.dbStorage.getItem('translate.' + provider) || {}
  const merged = Object.assign({}, base, stored)
  if (provider === 'microsoft' && merged.requestMode === 'edge') {
    merged.requestMode = 'signature'
  }
  return merged
},

// 写某 provider 的设置到 ztools.dbStorage。
setTranslateSettings(provider, data) {
  data = data || {}
  window.ztools.dbStorage.setItem('translate.' + provider, data)
},

// 读某 OCR provider 的设置（合并默认值）。现有 ocr 无配置，
// ai-ocr 与 ai-latex-ocr 复用宿主 AI 视觉模型，需模型选择与 prompt 模板（不存密钥）。
getOcrSettings(provider) {
  const defaults = {
    'ai-ocr': {
      model: '',
      systemPrompt: '识别图片中的所有文字，按原文逐行输出，只输出识别到的文字，不要解释或附加说明。'
    },
    'ai-latex-ocr': {
      model: '',
      systemPrompt: '识别图片中的数学公式并输出对应的 LaTeX 源码。只输出 LaTeX 代码，不要用 $ 或 $$ 包裹，不要解释或附加说明。'
    }
  }
  const base = defaults[provider] || {}
  const stored = window.ztools.dbStorage.getItem('ocr.' + provider) || {}
  return Object.assign({}, base, stored)
},

// 写某 OCR provider 的设置到 ztools.dbStorage。
setOcrSettings(provider, data) {
  data = data || {}
  window.ztools.dbStorage.setItem('ocr.' + provider, data)
},

// ─── 图床（AI 识图/公式识别的图片上传通道，可扩展）─────────────────────────
// 配置存 dbStorage key 'ocr.image-host'，ai-ocr 与 ai-latex-ocr 共用。
// 默认 enabled=true：升级即生效；关闭或上传失败由 ocrAi/latexAi 回退 base64 直传。
getImageHostSettings() {
  const defaults = { enabled: true, type: 'img-scdn' }
  const stored = window.ztools.dbStorage.getItem('ocr.image-host') || {}
  return Object.assign({}, defaults, stored)
},

setImageHostSettings(data) {
  data = data || {}
  window.ztools.dbStorage.setItem('ocr.image-host', data)
},

// 把图片上传到已启用图床，返回可访问 URL；关闭/未知类型/上传失败返回 null。
// image 可为 本地路径 / data URI / http(s) URL；已是 URL 直接原样返回不二次转存。
async uploadImage(image) {
  if (!image) return null
  const cfg = this.getImageHostSettings()
  if (!cfg || !cfg.enabled) { console.debug('[image-host] disabled, skip'); return null }
  const adapter = IMAGE_HOST_ADAPTORS[cfg.type]
  if (!adapter) { console.debug('[image-host] unknown type, skip:', cfg.type); return null }
  // 已是 http(s) URL（如已有图床链接或网络图片），图床无需二次转存，直接返回。
  if (/^https?:\/\//i.test(image)) { console.debug('[image-host] http(s) url passthrough'); return image }
  // 归一化为 { buf, ext, mime }
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
    // 本地路径：读取二进制，按扩展名推断 mime。
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

// 谷歌翻译：免费接口 translate.googleapis.com/translate_a/single（client=gtx，无需凭据）。
// 必须用 GET：该端点对 POST 请求会返回 404（仅接受 query 传参的 GET）。
// 该域名为 Google 官方地址，国内无法直连；_httpRequest 已支持自动走系统代理（CONNECT 隧道）。
// 返回体为嵌套数组：data[0] 是句段列表，每段 [译文, 原文, ...]；data[2] 为检测到的源语言。
async translateGoogle(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const sf = this._mapLang('google', from)
  const st = this._mapLang('google', to)
  if (sf === null) throw new Error('谷歌翻译不支持源语言: ' + from)
  if (st === null) throw new Error('谷歌翻译不支持目标语言: ' + to)
  const resp = await this._httpRequest('GET', 'https://translate.googleapis.com/translate_a/single', {
    query: { client: 'gtx', sl: sf, tl: st, dt: 't', q: text }
  })
  let data
  try {
    data = JSON.parse(resp.body)
  } catch (e) {
    throw new Error('谷歌翻译返回异常: ' + resp.body.slice(0, 200))
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('谷歌翻译返回异常: ' + resp.body.slice(0, 200))
  }
  const out = data[0].map((seg) => (seg && seg[0]) ? seg[0] : '').join('')
  return { text: out, detectedFrom: from }
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

// ─── AI 翻译 / AI OCR（走宿主 ztools.ai）─────────────────────────────────
// 复用宿主已配置的 AI 模型，本插件不存 apiKey/baseUrl，仅存模型选择与 prompt 模板。
// ztools.ai 非流式返回 { content, reasoning_content? }；system 提示须放进 messages[0]。
// 注意：handler 内 this 不是 services，故这两个方法经 window.services.xxx 调用时，
// 内部若要读配置须用 this.getTranslateSettings / this.getOcrSettings（与其它翻译方法一致）。

// AI 翻译：input { text, from?, to? } -> { text, detectedFrom? }
// model 留空则 ztools.ai 自动按宿主已启用供应商顺序选首个模型；prompt 模板支持 {from}/{to} 占位。
async translateAi(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
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

// AI OCR：input { image, lang? } -> { text, blocks?, confidence? }
// image 可为 本地路径 / data URI / http(s) URL：本地路径经 readFileAsDataURL 转 data URI 后传入。
// 必须选择支持视觉的模型，宿主不识别「视觉模型」概念，纯文本模型会由远端报错透传。
async ocrAi(image, lang) {
  const { model, systemPrompt } = this.getOcrSettings('ai-ocr')
  if (!model) throw new Error('AI 识图未选择模型，请在「翻译/OCR 提供商」设置页选择支持视觉的模型')
  if (!image) throw new Error('AI 识图未提供图片')
  console.debug('[ai-ocr] start', { model, lang: lang || null, src: image.slice(0, 24) + (image.length > 24 ? '…(' + image.length + ')' : '') })
  // 先走图床（开启时）拿可访问 URL，省 token 且防大图 base64 截断；
  // 关闭 / 未知类型 / 上传失败时 uploadImage 返回 null，回退本地路径转 data URI。
  let imageUrl = await this.uploadImage(image)
  if (!imageUrl) {
    if (!/^https?:\/\//i.test(image) && !/^data:/i.test(image)) {
      imageUrl = this.readFileAsDataURL(image)
      console.debug('[ai-ocr] image-host miss → local-path data URI', { dataUriLen: imageUrl.length })
    } else {
      imageUrl = image
      console.debug('[ai-ocr] image-host miss → input passthrough', { kind: /^data:/i.test(image) ? 'data-uri' : 'http' })
    }
  } else {
    console.debug('[ai-ocr] image-host hit', { urlLen: imageUrl.length })
  }
  const t0 = Date.now()
  const res = await window.ztools.ai({
    model,
    messages: [
      { role: 'system', content: systemPrompt || '识别图片中的所有文字，只输出识别到的文字。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: lang ? `请识别这张图片中的文字（语言：${lang}）。` : '请识别这张图片中的所有文字。' },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }
    ]
  })
  const out = (res && res.content ? String(res.content) : '').trim()
  console.debug('[ai-ocr] ai done', { ms: Date.now() - t0, contentLen: out.length })
  if (!out) throw new Error('AI 识图返回为空，请确认所选模型支持视觉输入')
  return { text: out }
},

// AI 公式识别：input { image } -> { latex }
// 复用宿主 AI 视觉模型（与 ocrAi 同机制），但走独立的 ai-latex-ocr 配置块
// （独立 model + systemPrompt，prompt 要求输出 LaTeX 源码）。
// image 可为 本地路径 / data URI / http(s) URL：本地路径经 readFileAsDataURL 转 data URI 后传入。
// 防御性剔除 AI 可能误加的 markdown 代码块围栏与 $/$$ 包裹，保证 KaTeX 可直接渲染。
async latexAi(image) {
  const { model, systemPrompt } = this.getOcrSettings('ai-latex-ocr')
  if (!model) throw new Error('AI 公式识别未选择模型，请在「翻译/OCR 提供商」设置页选择支持视觉的模型')
  if (!image) throw new Error('AI 公式识别未提供图片')
  console.debug('[ai-latex] start', { model, src: image.slice(0, 24) + (image.length > 24 ? '…(' + image.length + ')' : '') })
  // 先走图床（开启时）拿可访问 URL；关闭/失败回退本地路径转 data URI（与 ocrAi 一致）。
  let imageUrl = await this.uploadImage(image)
  if (!imageUrl) {
    if (!/^https?:\/\//i.test(image) && !/^data:/i.test(image)) {
      imageUrl = this.readFileAsDataURL(image)
      console.debug('[ai-latex] image-host miss → local-path data URI', { dataUriLen: imageUrl.length })
    } else {
      imageUrl = image
      console.debug('[ai-latex] image-host miss → input passthrough', { kind: /^data:/i.test(image) ? 'data-uri' : 'http' })
    }
  } else {
    console.debug('[ai-latex] image-host hit', { urlLen: imageUrl.length })
  }
  const t0 = Date.now()
  const res = await window.ztools.ai({
    model,
    messages: [
      { role: 'system', content: systemPrompt || '识别图片中的数学公式并输出对应的 LaTeX 源码。只输出 LaTeX 代码，不要用 $ 或 $$ 包裹，不要解释或附加说明。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图片中的数学公式并输出 LaTeX 源码。' },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }
    ]
  })
  let out = (res && res.content ? String(res.content) : '').trim()
  console.debug('[ai-latex] ai done', { ms: Date.now() - t0, contentLen: out.length })
  if (!out) throw new Error('AI 公式识别返回为空，请确认所选模型支持视觉输入')
  const before = out.length
  out = this._stripLatexFencing(out)
  console.debug('[ai-latex] stripped fencing', { before, after: out.length })
  return { latex: out }
},

// 剔除 AI 输出常见的 markdown 代码块围栏与 $/$$ 包裹，得到纯净 LaTeX 源码。
// 处理：```latex\n...\n``` / ```\n...\n``` 围栏；首尾的 $$...$$ / $...$ 包裹。
_stripLatexFencing(s) {
  let t = String(s || '').trim()
  // ```lang\n...\n``` 或 ```\n...\n```
  const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/)
  if (fence) t = fence[1].trim()
  // 首尾 $$...$$
  if (t.startsWith('$$') && t.endsWith('$$')) t = t.slice(2, -2).trim()
  // 首尾 $...$（避免误伤 $ 内部含 $ 的情形：仅当首尾各恰好一个 $ 时剥离）
  else if (t.startsWith('$') && t.endsWith('$') && t.length >= 2) t = t.slice(1, -1).trim()
  return t
}
}

// ─── 注册 Providers ──────────────────────────────────────────────────────
// OCR 契约：input { image, lang? } -> { text, blocks?, confidence? }
// image 可为 本地路径 / data URI / http(s) URL。
ztools.registerProvider('ocr', async (input) => {
  const { image } = input || {}
  return await window.services.ocrRecognize(image)
})

// 翻译契约（对齐宿主 TranslationInput/Output）：
// input { text, from?, to? } -> { text, detectedFrom? }
// 注意：handler 内不能用 this（this 在 registerProvider 回调里不是 services），
// 必须显式经 window.services.xxx 调用，才能正确解析方法内的 this。
ztools.registerProvider('baidu', async (input) => {
  const { text, from, to } = input || {}
  return await window.services.translateBaidu(text, from, to)
})
ztools.registerProvider('google', async (input) => {
  const { text, from, to } = input || {}
  return await window.services.translateGoogle(text, from, to)
})
ztools.registerProvider('youdao', async (input) => {
  const { text, from, to } = input || {}
  return await window.services.translateYoudao(text, from, to)
})
ztools.registerProvider('microsoft', async (input) => {
  const { text, from, to } = input || {}
  return await window.services.translateMicrosoft(text, from, to)
})

// AI 翻译（走宿主 ztools.ai）：input { text, from?, to? } -> { text, detectedFrom? }
ztools.registerProvider('ai-translation', async (input) => {
  const { text, from, to } = input || {}
  return await window.services.translateAi(text, from, to)
})

// AI 识图（走宿主 ztools.ai，需视觉模型）：input { image, lang? } -> { text }
ztools.registerProvider('ai-ocr', async (input) => {
  const { image, lang } = input || {}
  return await window.services.ocrAi(image, lang)
})
