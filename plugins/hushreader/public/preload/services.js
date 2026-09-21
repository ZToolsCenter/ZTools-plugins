const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const zlib = require('node:zlib')
const { ipcRenderer } = require('electron')

function httpRequest(method, url, { timeout = 15000, headers = {}, body = null, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch (e) {
      reject(new Error('非法 URL'))
      return
    }
    const lib = parsed.protocol === 'https:' ? https : http
    const reqHeaders = { ...headers }
    if (!reqHeaders['User-Agent'] && !reqHeaders['user-agent']) {
      reqHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
    }
    reqHeaders['Accept'] = reqHeaders['Accept'] || reqHeaders['accept'] || '*/*'
    if (body != null && reqHeaders['Content-Length'] == null && reqHeaders['content-length'] == null) {
      reqHeaders['Content-Length'] = Buffer.byteLength(body)
    }

    const req = lib.request(parsed, { method, headers: reqHeaders }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let buffer = Buffer.concat(chunks)
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        try {
          if (enc === 'gzip') buffer = zlib.gunzipSync(buffer)
          else if (enc === 'deflate') buffer = zlib.inflateSync(buffer)
          else if (enc === 'br') buffer = zlib.brotliDecompressSync(buffer)
        } catch (e) { /* 解码失败则保留原始内容 */ }

        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location && maxRedirects > 0) {
          let next
          try {
            next = new URL(res.headers.location, parsed).href
          } catch (e) {
            reject(new Error('重定向地址非法'))
            return
          }
          httpRequest(method, next, { timeout, headers, body, maxRedirects: maxRedirects - 1 })
            .then(resolve, reject)
          return
        }
        resolve({ status, headers: res.headers, buffer })
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3))
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }

  // 根因修复：严格 UTF-8 校验通过即直接采用（且不含 NUL 字节，排除 UTF-16 文本）。
  // 原因：此前的“编码评分”流程会让 utf-16le/gb18030 把 UTF-8 字节流解码出的乱码
  // （每个字节对都变成汉字，得分极高）盖过正确解码——英文为主的书源 JSON / 接口
  // 响应全部被误判成乱码。其它编码的正文（GBK/Big5/UTF-16）几乎不可能通过严格
  // UTF-8 校验，因此这条规则不会误伤，只会在“确实是 UTF-8”时正确命中。
  try {
    const utf8Strict = decodeWith(buffer, 'utf-8', true)
    if (countMatches(utf8Strict, /\x00/g) === 0) return utf8Strict
  } catch { }

  // 宽松 UTF-8 补救：严格解码因个别损坏/截断字节抛错、但宽松解码几乎无损（0~2 个
  // 替换符）时按 UTF-8 返回。必须在“乱码评分”之前执行，否则 gb18030 的乱码会先胜出。
  const utf8Loose = decodeWith(buffer, 'utf-8', false)
  if (countMatches(utf8Loose, /\uFFFD/g) <= 2) return utf8Loose

  const candidates = uniqueEncodings([guessUtf16(buffer), 'utf-8', 'gb18030', 'gbk', 'gb2312', 'big5', 'utf-16le', 'utf-16be'])
  const strictDecoded = pickBestDecode(buffer, candidates, true)
  if (strictDecoded) return strictDecoded

  return pickBestDecode(buffer, candidates, false) ?? buffer.toString('utf8')
}

function uniqueEncodings(encodings) {
  return [...new Set(encodings.filter(Boolean))]
}

function decodeWith(buffer, encoding, fatal) {
  return new TextDecoder(encoding, { fatal }).decode(buffer)
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text, encoding) {
  const sample = text.slice(0, 10000)
  if (!sample) return 0

  let controlChars = 0
  let nullChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 0) {
      nullChars += 1
    } else if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars += 1
    }
  }

  const replacements = countMatches(sample, /\uFFFD/g)
  const cjkChars = countMatches(sample, /[\u3400-\u9fff\uf900-\ufaff]/g)
  const commonChineseChars = countMatches(sample, /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说面而方后多定行学法所民]/g)
  const chinesePunctuation = countMatches(sample, /[，。！？、；：""''（）《》]/g)
  const mojibakeMarks = countMatches(sample, /锟斤拷|锘|烫烫|屯屯|Ã|Â|�/g)
  const utf8AsGbMojibake = countMatches(sample, /杩欐槸|涓€|娈典|腑鏂|囧皬|璇村|唴瀹|癸紝|涓昏|璧拌|繘鎴|块棿|锛岀|湅瑙|佺獥|澶栫|殑椋|庛|绗浠栫|鐭ラ|亾鑷|繁|鐫|氫箙|彧瑙|夊緱|鍥涘|懆瀹|夐潤|寰/g)
  const privateUseChars = countMatches(sample, /[\ue000-\uf8ff]/g)
  const asciiPrintable = countMatches(sample, /[\x20-\x7e]/g)
  const encodingBias = encoding === 'utf-8' ? 24 : encoding.startsWith('gb') ? 6 : 0

  return (
    encodingBias +
    cjkChars * 1.5 +
    commonChineseChars * 2 +
    chinesePunctuation +
    asciiPrintable * 0.04 -
    replacements * 90 -
    controlChars * 35 -
    nullChars * 110 -
    mojibakeMarks * 40 -
    utf8AsGbMojibake * 85 -
    privateUseChars * 28
  )
}

function guessUtf16(buffer) {
  const sampleLength = Math.min(buffer.length, 4096)
  if (sampleLength < 8) return ''

  let evenNulls = 0
  let oddNulls = 0

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }

  const pairs = sampleLength / 2
  if (oddNulls / pairs > 0.28 && evenNulls / pairs < 0.08) return 'utf-16le'
  if (evenNulls / pairs > 0.28 && oddNulls / pairs < 0.08) return 'utf-16be'
  return ''
}

function pickBestDecode(buffer, encodings, fatal) {
  let best = ''
  let bestScore = Number.NEGATIVE_INFINITY

  for (const encoding of encodings) {
    try {
      const text = decodeWith(buffer, encoding, fatal)
      const score = scoreDecodedText(text, encoding)
      if (score > bestScore) {
        best = text
        bestScore = score
      }
    } catch (error) {
      // try next
    }
  }

  return best
}

window.services = {
  onHushreaderCommand(handler) {
    const listener = (_event, command) => handler(command)
    ipcRenderer.on('hushreader-command', listener)
    return () => ipcRenderer.off('hushreader-command', listener)
  },

  readFile(filePath) {
    return window.services.readTextFile(filePath).content
  },

  readTextFile(filePath) {
    const fullPath = path.resolve(filePath)
    const buffer = fs.readFileSync(fullPath)
    const stat = fs.statSync(fullPath)

    return {
      name: path.basename(fullPath),
      path: fullPath,
      content: decodeText(buffer),
      size: stat.size,
      mtime: stat.mtimeMs
    }
  },

  readFileBinary(filePath) {
    return fs.readFileSync(filePath)
  },

  getFileInfo(filePath) {
    const fullPath = path.resolve(filePath)
    const stat = fs.statSync(fullPath)

    return {
      name: path.basename(fullPath),
      path: fullPath,
      size: stat.size,
      mtime: stat.mtimeMs
    }
  },

  getFileModifiedTime(filePath) {
    try {
      const fullPath = path.resolve(filePath)
      const stat = fs.statSync(fullPath)
      return stat.mtimeMs
    } catch {
      return null
    }
  },

  writeTextFile(text) {
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.txt'
    )
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  writeFileToPath(filePath, content, encoding) {
    const fullPath = path.resolve(filePath)
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fullPath, content, { encoding: encoding || 'utf-8' })
    return fullPath
  },

  readFileFromPath(filePath) {
    const fullPath = path.resolve(filePath)
    return fs.readFileSync(fullPath, 'utf-8')
  },

  /***  HTTP GET，返回原始二进制 Buffer  ***/
  httpGetBuffer(url, options = {}) {
    return httpRequest('GET', url, options).then(res => {
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return res.buffer
    })
  },

  /***  HTTP GET，按检测到的编码解码为文本  ***/
  httpGetText(url, options = {}) {
    return httpRequest('GET', url, options).then(res => {
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return decodeText(res.buffer)
    })
  },

  /***  HTTP GET，解析 JSON  ***/
  httpGetJson(url, options = {}) {
    return httpRequest('GET', url, options).then(res => {
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return JSON.parse(decodeText(res.buffer))
    })
  },

  /***  HTTP POST，JSON 请求体，返回解析后的 JSON  ***/
  httpPostJson(url, data, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
    return httpRequest('POST', url, { ...options, headers, body: JSON.stringify(data) }).then(res => {
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      const text = decodeText(res.buffer)
      return text ? JSON.parse(text) : null
    })
  },

  /***  HTTP POST，任意请求体，返回解码后的文本  ***/
  httpPostText(url, body = '', options = {}) {
    const headers = { ...(options.headers || {}) }
    if (body && headers['Content-Type'] == null && headers['content-type'] == null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return httpRequest('POST', url, { ...options, headers, body }).then(res => {
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return decodeText(res.buffer)
    })
  },

  /***  HTTP GET，返回 { status, text, headers }（不因 4xx 抛错；headers 含 set-cookie）  ***/
  httpGetResponse(url, options = {}) {
    return httpRequest('GET', url, options).then(res => ({
      status: res.status,
      text: decodeText(res.buffer),
      headers: res.headers
    }))
  },

  /***  HTTP POST，返回 { status, text, headers }（不因 4xx 抛错；headers 含 set-cookie）  ***/
  httpPostResponse(url, body = '', options = {}) {
    const headers = { ...(options.headers || {}) }
    if (body && headers['Content-Type'] == null && headers['content-type'] == null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return httpRequest('POST', url, { ...options, headers, body }).then(res => ({
      status: res.status,
      text: decodeText(res.buffer),
      headers: res.headers
    }))
  }
}
