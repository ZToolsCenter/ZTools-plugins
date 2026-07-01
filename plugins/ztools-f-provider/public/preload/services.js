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

  // ─── 微信 OCR（基于 wechat_ocr.node 原生模块）─────────────────────────
  // 原生模块懒加载：首次调用时才 require + init，避免插件加载即拉起
  // WeChatOCR.exe 子进程。
  _ocrAddon: null,
  _ocrDataDir() {
    // preload 文件位于 <pluginRoot>/preload/services.js
    // wco_data 位于 <pluginRoot>/native/wco_data
    return path.join(__dirname, '..', 'native', 'wco_data')
  },
  _ocrEnsure() {
    if (this._ocrAddon) return this._ocrAddon
    const nativeEntry = path.join(__dirname, '..', 'native', 'index.js')
    this._ocrAddon = require(nativeEntry)
    this._ocrAddon.init(this._ocrDataDir())
    return this._ocrAddon
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
    const addon = this._ocrEnsure()
    const tmpFile = await this._ocrMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const result = await addon.ocr(tmpFile)
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
    const addon = this._ocrEnsure()
    const tmpFile = await this._ocrMaterialize(image)
    const isTemp = tmpFile !== image
    try {
      const result = await addon.ocr(tmpFile)
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

  // 释放 OCR 引擎（停止 WeChatOCR.exe 子进程）
  ocrDispose() {
    if (this._ocrAddon) {
      try { this._ocrAddon.dispose() } catch (_) {}
      this._ocrAddon = null
    }
  },

  // ─── native 引擎下载/状态管理 ─────────────────────────────────────────
  // 插件初始不带 native；前端展示下载状态，用户点击下载后下载 native.zip
  // 并解压到插件根目录（zip 顶层为 native/，解压后落到 <pluginRoot>/native/）。
  _pluginRoot() {
    // preload 文件位于 <pluginRoot>/preload/services.js
    return path.join(__dirname, '..')
  },
  _nativeDir() {
    return path.join(this._pluginRoot(), 'native')
  },
  // 读 plugin.json 的 native 配置块（缓存）
  _nativeConfig() {
    if (this._nativeConfigCache) return this._nativeConfigCache
    try {
      const raw = fs.readFileSync(path.join(this._pluginRoot(), 'plugin.json'), 'utf8')
      const cfg = JSON.parse(raw)
      this._nativeConfigCache = (cfg && cfg.native) || {}
    } catch (_) {
      this._nativeConfigCache = {}
    }
    return this._nativeConfigCache
  },
  _nativeConfigCache: null,

  // 检查 native 引擎是否就绪。真值来源 = 关键文件存在与否（不靠 dbStorage 记忆，避免漂移）。
  nativeStatus() {
    const dir = this._nativeDir()
    const nodeFile = path.join(dir, 'build', 'Release', 'wechat_ocr.node')
    const exe = path.join(dir, 'wco_data', 'WeChatOCR.exe')
    const missing = []
    if (!fs.existsSync(nodeFile)) missing.push('build/Release/wechat_ocr.node')
    if (!fs.existsSync(exe)) missing.push('wco_data/WeChatOCR.exe')
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
  _pickFastestMirror(rawUrl) {
    // 非 github.com URL（或非法 URL）跳过代理。
    try {
      const u = new URL(rawUrl)
      if (!/github\.com$/i.test(u.hostname) && u.hostname !== 'github.com') {
        return Promise.resolve(rawUrl)
      }
    } catch (_) {
      return Promise.resolve(rawUrl)
    }

    const TIMEOUT_MS = 8000
    const candidates = GH_PROXY_HOSTS.map((prefix) => prefix + rawUrl)

    return new Promise((resolve) => {
      let settled = false          // 是否已选出胜者
      const reqs = []
      const timers = []

      const finish = (url) => {
        if (settled) return
        settled = true
        // 立即 abort 其余在途请求，清理定时器。
        timers.forEach((t) => clearTimeout(t))
        reqs.forEach((r) => { try { r.destroy() } catch (_) {} })
        resolve(url)
      }

      candidates.forEach((url) => {
        let parsed
        try { parsed = new URL(url) } catch (_) { return }
        const req = https.get(parsed, () => {
          // 收到响应头即定胜负（不论状态码，能握手就算可达）。
          finish(url)
        })
        reqs.push(req)
        req.on('error', () => {})  // 单个失败不影响其余；最终兜底处理
        // 超时：到点仍未握手，单独 destroy，等其余或兜底。
        const timer = setTimeout(() => { try { req.destroy() } catch (_) {} }, TIMEOUT_MS)
        timers.push(timer)
      })

      // 所有候选都失败/超时 → 回退原始 URL 直连。
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

  // 下载 native.zip 到临时目录，支持 3xx 重定向跟随（兼容 GitHub release 跳 CDN）。
  // onProgress({ phase, percent, loaded, total }) 用于上报进度。
  _downloadFile(url, dest, onProgress, maxRedirects) {
    maxRedirects = maxRedirects == null ? 5 : maxRedirects
    return new Promise((resolve, reject) => {
      let parsed
      try { parsed = new URL(url) } catch (e) { reject(e); return }
      const client = parsed.protocol === 'https:' ? https : http
      const req = client.get(parsed, (res) => {
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
          this._downloadFile(next, dest, onProgress, maxRedirects - 1)
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

  // 用 PowerShell Expand-Archive 解压 zip 到插件根目录（-Force 幂等覆盖）。
  _extractZip(zipPath, destDir) {
    const { spawnSync } = require('node:child_process')
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

  // 主流程：下载 + 校验 + 解压 + 复检。
  // onProgress({ phase, percent, loaded, total }) -> Promise<{ ok, error? }>
  async nativeDownload(onProgress) {
    const cfg = this._nativeConfig()
    if (!cfg.downloadUrl) {
      return { ok: false, error: '未配置 native 下载地址，请在 plugin.json 中设置 native.downloadUrl' }
    }
    // 释放可能已加载的旧引擎，避免解压覆盖 .node 后引用悬空。
    if (this._ocrAddon) {
      try { this._ocrAddon.dispose() } catch (_) {}
      this._ocrAddon = null
    }
    const tmpZip = path.join(os.tmpdir(), `wechat-ocr-native-${Date.now()}.zip`)
    try {
      // 下载阶段：先并发竞速选最快的 gh-proxy 镜像（透明，不报进度）。
      if (onProgress) onProgress({ phase: 'downloading', percent: 0, loaded: 0, total: 0 })
      const downloadUrl = await this._pickFastestMirror(cfg.downloadUrl)
      await this._downloadFile(downloadUrl, tmpZip, onProgress)

      // 可选 sha256 校验
      if (cfg.sha256) {
        const sum = await this._sha256File(tmpZip)
        if (sum.toLowerCase() !== String(cfg.sha256).toLowerCase()) {
          return { ok: false, error: '校验和不匹配，文件可能已损坏' }
        }
      }

      // 解压阶段（zip 顶层为 native/，解压到插件根目录即还原）
      if (onProgress) onProgress({ phase: 'extracting', percent: 0, loaded: 0, total: 0 })
      this._extractZip(tmpZip, this._pluginRoot())

      // 复检关键文件
      const status = this.nativeStatus()
      if (!status.ready) {
        return {
          ok: false,
          error: '解压完成但缺少关键文件: ' + status.missing.join(', ')
        }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    } finally {
      try { fs.unlinkSync(tmpZip) } catch (_) {}
    }
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

// 读某 provider 的设置（合并默认值）。全部走 ztools.dbStorage（按插件命名空间隔离）。
// 微软：默认 signature。edge 端点会按 Chrome UA 版本号风控（旧版本号被拒 400
// Client Browser Version not supported），signature 走 HMACSHA256 不依赖 UA，更稳。
// 曾保存过 requestMode='edge' 的老用户在这里一次性迁移到 signature。
getTranslateSettings(provider) {
  const defaults = {
    baidu: { appID: '', appKey: '' },
    google: {},
    youdao: { appKey: '', appSecret: '' },
    microsoft: { requestMode: 'signature' } // 'signature' | 'edge'
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

// 谷歌翻译：POST googlet.deno.dev/translate，JSON，无凭据
async translateGoogle(text, from, to) {
  if (!to) to = this._resolveDefaultTargetLang(text) // 未指定目标语言时按内容推断（中→英，其余→中）
  const sf = this._mapLang('google', from)
  const st = this._mapLang('google', to)
  if (sf === null) throw new Error('谷歌翻译不支持源语言: ' + from)
  if (st === null) throw new Error('谷歌翻译不支持目标语言: ' + to)
  const resp = await this._httpRequest('POST', 'https://googlet.deno.dev/translate', {
    json: { text, source_lang: sf, target_lang: st }
  })
  const data = JSON.parse(resp.body)
  if (typeof data.data !== 'string') throw new Error('谷歌翻译返回异常: ' + resp.body.slice(0, 200))
  return { text: data.data, detectedFrom: from }
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
