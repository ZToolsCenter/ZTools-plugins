const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { clipboard } = require('electron')

const imageMimeTypes = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp'
}

const ocrSpaceLanguages = {
  'chi_sim+eng': 'chs',
  chi_sim: 'chs',
  eng: 'eng'
}

const normalizeOpenAiEndpoint = (endpoint) => {
  const trimmed = String(endpoint || '').trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('未配置 OpenAI-compatible Endpoint')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

const normalizeLocalOcrEndpoint = (endpoint) => {
  const trimmed = String(endpoint || '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'http://127.0.0.1:8765/ocr'
  return trimmed
}

const normalizeTimeoutMs = (timeoutMs) => {
  const value = Number(timeoutMs)
  if (!Number.isFinite(value)) return 30000
  return Math.max(5000, Math.min(180000, value))
}

const requestWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), normalizeTimeoutMs(timeoutMs))
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(normalizeTimeoutMs(timeoutMs) / 1000)} 秒）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const normalizeVisionError = (message) => {
  const text = String(message || '')
  if (text.includes('unknown variant `image_url`') || text.includes('expected `text`')) {
    return '当前接口或模型不支持图片输入（image_url），请换支持视觉的模型'
  }
  return text
}

const stripImageBase64 = (base64Url) => String(base64Url || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')

const sha256 = (content, encoding = 'hex') => crypto.createHash('sha256').update(content).digest(encoding)

const hmac = (key, content, encoding) => crypto.createHmac('sha256', key).update(content).digest(encoding)

const getServerDir = () => path.resolve(__dirname, '..', 'local-ocr-server')

const getPidFile = () => path.join(getServerDir(), '.server.pid')

const getBundledRuntime = () => {
  const executableName = process.platform === 'win32' ? 'rapidocr-server.exe' : 'rapidocr-server'
  const runtimeRoot = path.resolve(__dirname, '..', 'local-ocr-runtime', process.platform)
  const candidates = [
    path.join(runtimeRoot, executableName),
    path.join(runtimeRoot, 'rapidocr-server', executableName)
  ]
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!executablePath) return null
  return {
    executablePath,
    cwd: path.dirname(executablePath)
  }
}

const startDetached = (command, args, cwd) => {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  return child.pid
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 图片读取为 Data URL，供 OCR 渲染进程使用
  readImageAsDataUrl(file) {
    const ext = path.extname(file).slice(1).toLowerCase()
    const mimeType = imageMimeTypes[ext] || 'application/octet-stream'
    const base64 = fs.readFileSync(file).toString('base64')
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      name: path.basename(file),
      path: file
    }
  },
  // 读取系统剪贴板中的图片
  getCopyedImage() {
    const image = clipboard.readImage()
    return !image || image.isEmpty() ? null : image.toDataURL()
  },
  async ocrSpaceRecognize(options) {
    const body = new URLSearchParams()
    body.set('base64Image', options.base64Url)
    body.set('language', ocrSpaceLanguages[options.language] || 'chs')
    body.set('isOverlayRequired', 'false')
    body.set('scale', 'true')
    body.set('OCREngine', '2')

    const response = await requestWithTimeout('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        apikey: options.apiKey || 'helloworld',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }, options.timeoutMs)
    if (!response.ok) {
      throw new Error(`OCR.Space 请求失败：${response.status}`)
    }

    const result = await response.json()
    if (result.IsErroredOnProcessing) {
      const message = Array.isArray(result.ErrorMessage) ? result.ErrorMessage.join('\n') : result.ErrorMessage
      throw new Error(message || 'OCR.Space 识别失败')
    }

    return (result.ParsedResults || [])
      .map((item) => item.ParsedText || '')
      .filter(Boolean)
      .join('\n')
  },
  async openAiVisionRecognize(options) {
    const endpoint = normalizeOpenAiEndpoint(options.endpoint)
    const headers = {
      'Content-Type': 'application/json'
    }
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`
    }

    const response = await requestWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: options.prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: options.base64Url,
                  detail: 'high'
                }
              }
            ]
          }
        ]
      })
    }, options.timeoutMs)

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = result?.error?.message || result?.message || `OpenAI-compatible 请求失败：${response.status}`
      throw new Error(normalizeVisionError(message))
    }

    return result?.choices?.[0]?.message?.content || result?.output_text || ''
  },
  async baiduOcrRecognize(options) {
    if (!options.apiKey || !options.secretKey) throw new Error('未配置百度 OCR API Key / Secret Key')
    const tokenResponse = await requestWithTimeout(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(options.apiKey)}&client_secret=${encodeURIComponent(options.secretKey)}`,
      { method: 'POST' },
      options.timeoutMs
    )
    const tokenResult = await tokenResponse.json().catch(() => ({}))
    if (!tokenResponse.ok || !tokenResult.access_token) {
      throw new Error(tokenResult.error_description || tokenResult.error || '百度 OCR access_token 获取失败')
    }

    const body = new URLSearchParams()
    body.set('image', stripImageBase64(options.base64Url))
    body.set('language_type', options.language === 'eng' ? 'ENG' : 'CHN_ENG')
    body.set('detect_direction', 'true')
    body.set('paragraph', 'true')

    const response = await requestWithTimeout(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${encodeURIComponent(tokenResult.access_token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      },
      options.timeoutMs
    )
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.error_code) {
      throw new Error(result.error_msg || `百度 OCR 请求失败：${response.status}`)
    }
    return (result.words_result || []).map((item) => item.words || '').filter(Boolean).join('\n')
  },
  async tencentOcrRecognize(options) {
    if (!options.secretId || !options.secretKey) throw new Error('未配置腾讯云 SecretId / SecretKey')
    const host = 'ocr.tencentcloudapi.com'
    const service = 'ocr'
    const action = 'GeneralBasicOCR'
    const version = '2018-11-19'
    const region = options.region || 'ap-guangzhou'
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const payload = JSON.stringify({ ImageBase64: stripImageBase64(options.base64Url) })
    const hashedPayload = sha256(payload)
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
    const signedHeaders = 'content-type;host;x-tc-action'
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`
    const credentialScope = `${date}/${service}/tc3_request`
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`
    const secretDate = hmac(`TC3${options.secretKey}`, date)
    const secretService = hmac(secretDate, service)
    const secretSigning = hmac(secretService, 'tc3_request')
    const signature = hmac(secretSigning, stringToSign, 'hex')
    const authorization = `TC3-HMAC-SHA256 Credential=${options.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const response = await requestWithTimeout(`https://${host}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': version,
        'X-TC-Region': region
      },
      body: payload
    }, options.timeoutMs)

    const result = await response.json().catch(() => ({}))
    const payloadResult = result.Response || {}
    if (!response.ok || payloadResult.Error) {
      throw new Error(payloadResult.Error?.Message || `腾讯云 OCR 请求失败：${response.status}`)
    }
    return (payloadResult.TextDetections || []).map((item) => item.DetectedText || '').filter(Boolean).join('\n')
  },
  async localHttpRecognize(options) {
    const response = await requestWithTimeout(normalizeLocalOcrEndpoint(options.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: options.base64Url,
        language: options.language
      })
    }, options.timeoutMs)

    const result = await response.json().catch(() => ({}))
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || `本地 OCR 服务请求失败：${response.status}`)
    }

    return result?.text || ''
  },
  async getLocalOcrStatus(options = {}) {
    const bundledRuntime = getBundledRuntime()
    const runtimeBundled = !!bundledRuntime
    try {
      const endpoint = normalizeLocalOcrEndpoint(options.endpoint)
      const healthUrl = endpoint.endsWith('/ocr') ? endpoint.slice(0, -4) + '/health' : endpoint.replace(/\/+$/, '') + '/health'
      const response = await requestWithTimeout(healthUrl, { method: 'GET' }, 2000)
      const result = await response.json().catch(() => ({}))
      return { running: !!result.ok, runtimeBundled }
    } catch (_error) {
      return { running: false, runtimeBundled }
    }
  },
  async startLocalOcr() {
    const bundledRuntime = getBundledRuntime()
    if (!bundledRuntime) throw new Error(`当前平台 (${process.platform}) 未集成 RapidOCR 运行时`)
    const pid = startDetached(bundledRuntime.executablePath, [], bundledRuntime.cwd)
    if (pid) fs.writeFileSync(getPidFile(), String(pid), { encoding: 'utf-8' })
    return { ok: true }
  },
  async stopLocalOcr() {
    const pidFile = getPidFile()
    if (!fs.existsSync(pidFile)) return { ok: true, stopped: false }
    const pid = Number(fs.readFileSync(pidFile, { encoding: 'utf-8' }))
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid)
      } catch (_error) {
        // 进程可能已经退出，只清理 pid 文件
      }
    }
    fs.rmSync(pidFile, { force: true })
    return { ok: true, stopped: true }
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
  }
}
