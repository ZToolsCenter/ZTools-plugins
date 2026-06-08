const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const zlib = require('node:zlib')
const { clipboard, ipcRenderer, net } = require('electron')

const SOURCE_COOKIE_STORE_KEY = 'deepread.sourceCookies.v1'
const sourceCookieStore = loadSourceCookieStore()

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

  const utf8JsonText = decodeUtf8Json(buffer)
  if (utf8JsonText) return utf8JsonText

  const utf16Guess = guessUtf16(buffer)
  const candidates = uniqueEncodings([utf16Guess, 'utf-8', 'gb18030', 'gbk', 'gb2312', 'big5', 'utf-16le', 'utf-16be'])
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

function decodeUtf8Json(buffer) {
  try {
    const text = decodeWith(buffer, 'utf-8', true)
    const trimmed = text.trim()
    if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) return ''
    JSON.parse(trimmed)
    return text
  } catch (error) {
    return ''
  }
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
  const chinesePunctuation = countMatches(sample, /[，。！？、；：“”‘’（）《》]/g)
  const mojibakeMarks = countMatches(sample, /锟斤拷|锘|烫烫|屯屯|Ã|Â|�/g)
  const utf8AsGbMojibake = countMatches(sample, /杩欐槸|涓€|娈典|腑鏂|囧皬|璇村|唴瀹|癸紝|涓昏|璧拌|繘鎴|块棿|锛岀|湅瑙|佺獥|澶栫|殑椋|庛|绗|浠栦|鐭ラ|亾鑷|繁|鐫|氫箙|彧瑙|夊緱|鍥涘|懆瀹|夐潤|寰/g)
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
      // Try the next likely novel text encoding.
    }
  }

  return best
}

function inflateResponse(buffer, encoding) {
  const normalized = String(encoding || '').toLowerCase()
  if (normalized.includes('br')) return zlib.brotliDecompressSync(buffer)
  if (normalized.includes('gzip')) return zlib.gunzipSync(buffer)
  if (normalized.includes('deflate')) return zlib.inflateSync(buffer)
  return buffer
}

function isGoogleHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '')
  return host === 'google.com' || host.endsWith('.google.com')
}

function isBlockedRedirect(fromUrl, toUrl) {
  try {
    const fromHost = new URL(fromUrl).hostname
    const toHost = new URL(toUrl, fromUrl).hostname
    return fromHost !== toHost && isGoogleHost(toHost)
  } catch (error) {
    return false
  }
}

function isHttpUrl(target) {
  try {
    const protocol = new URL(target).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch (error) {
    return false
  }
}

function getRequestMethod(request) {
  const body = typeof request?.body === 'string' ? request.body : undefined
  return String(request?.method || (body ? 'POST' : 'GET')).toUpperCase()
}

function createRedirectRequest(request, nextUrl, statusCode) {
  const source = request && typeof request === 'object' ? request : { url: nextUrl }
  const originalMethod = getRequestMethod(source)
  const shouldSwitchToGet = statusCode === 303 || ((statusCode === 301 || statusCode === 302) && originalMethod === 'POST')
  const redirectRequest = {
    ...source,
    url: nextUrl
  }

  if (shouldSwitchToGet) {
    redirectRequest.method = 'GET'
    delete redirectRequest.body
    if (redirectRequest.headers) {
      redirectRequest.headers = { ...redirectRequest.headers }
      for (const key of Object.keys(redirectRequest.headers)) {
        if (/^(content-type|content-length)$/i.test(key)) delete redirectRequest.headers[key]
      }
    }
  }

  return redirectRequest
}

function loadSourceCookieStore() {
  try {
    const text = window.localStorage?.getItem(SOURCE_COOKIE_STORE_KEY)
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    return {}
  }
}

function saveSourceCookieStore() {
  try {
    window.localStorage?.setItem(SOURCE_COOKIE_STORE_KEY, JSON.stringify(sourceCookieStore))
  } catch (error) {
    // Cookie persistence is best-effort; the in-memory jar still works.
  }
}

function getCookieKey(request, target) {
  if (request?.sourceId) return `source:${request.sourceId}`
  try {
    return `host:${new URL(request?.sourceUrl || target).hostname}`
  } catch (error) {
    return `url:${target}`
  }
}

function parseCookiePairs(cookie) {
  const pairs = {}
  if (!cookie) return pairs

  String(cookie)
    .split(';')
    .forEach((part) => {
      const index = part.indexOf('=')
      if (index <= 0) return
      const key = part.slice(0, index).trim()
      if (!key) return
      pairs[key] = part.slice(index + 1).trim()
    })

  return pairs
}

function mapToCookie(map) {
  return Object.entries(map)
    .filter(([key]) => key)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

function mergeCookieStrings(...cookies) {
  const merged = {}
  cookies.forEach((cookie) => Object.assign(merged, parseCookiePairs(cookie)))
  return mapToCookie(merged)
}

function splitSetCookieHeader(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(splitSetCookieHeader)
  return String(value)
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((cookie) => cookie.trim())
    .filter(Boolean)
}

function mergeSetCookies(cookie, setCookies) {
  const merged = parseCookiePairs(cookie)

  splitSetCookieHeader(setCookies).forEach((setCookie) => {
    const pair = setCookie.split(';')[0]
    const index = pair.indexOf('=')
    if (index <= 0) return

    const key = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    const expires = /expires\s*=\s*([^;]+)/i.exec(setCookie)?.[1] || ''
    const maxAge = /max-age\s*=\s*(-?\d+)/i.exec(setCookie)?.[1]
    const expiredByMaxAge = maxAge !== undefined && Number(maxAge) <= 0
    if (!value || expiredByMaxAge || /^(thu,\s*)?01 jan 1970/i.test(expires)) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  })

  return mapToCookie(merged)
}

function applyCookieJar(request, target, headers) {
  if (request?.enabledCookieJar === false) return headers

  const nextHeaders = { ...headers }
  const explicitCookie = nextHeaders.Cookie || nextHeaders.cookie
  delete nextHeaders.cookie

  const storedCookie = sourceCookieStore[getCookieKey(request, target)]
  const mergedCookie = mergeCookieStrings(storedCookie, explicitCookie)
  if (mergedCookie) nextHeaders.Cookie = mergedCookie

  return nextHeaders
}

function rememberResponseCookies(request, target, setCookies) {
  if (request?.enabledCookieJar === false) return
  const normalized = splitSetCookieHeader(setCookies)
  if (!normalized.length) return

  const key = getCookieKey(request, target)
  const nextCookie = mergeSetCookies(sourceCookieStore[key], normalized)
  if (nextCookie) sourceCookieStore[key] = nextCookie
  else delete sourceCookieStore[key]
  saveSourceCookieStore()
}

function getResponseSetCookies(response) {
  if (typeof response.headers?.getSetCookie === 'function') return response.headers.getSetCookie()
  return splitSetCookieHeader(response.headers?.get?.('set-cookie'))
}

async function fetchText(request, redirectCount = 0) {
  const target = typeof request === 'string' ? request : request?.url
  if (!target) throw new Error('请求地址为空')
  if (net?.fetch && !isHttpUrl(target)) return fetchTextWithElectronNet(request)

  const url = new URL(target)
  const transport = url.protocol === 'https:' ? https : http
  const body = typeof request?.body === 'string' ? request.body : undefined
  const method = getRequestMethod(request)
  const headers = applyCookieJar(request, target, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) DeepRead/1.0',
    Accept: 'text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.6',
    'Accept-Encoding': 'gzip, deflate, br',
    ...(request?.headers || {})
  })

  return new Promise((resolve, reject) => {
    const clientRequest = transport.request(
      url,
      {
        method,
        headers
      },
      (response) => {
        const statusCode = response.statusCode || 0
        const location = response.headers.location
        rememberResponseCookies(request, target, response.headers['set-cookie'])

        if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 5) {
          response.resume()
          const nextUrl = new URL(location, url).toString()
          if (isBlockedRedirect(target, nextUrl)) {
            reject(new Error('请求被站点跳转到 Google，可能被反爬拦截'))
            return
          }
          const redirectRequest = createRedirectRequest(request, nextUrl, statusCode)
          fetchText(redirectRequest, redirectCount + 1).then(
            (text) => {
              if (request && typeof request === 'object') request.responseUrl = redirectRequest.responseUrl || nextUrl
              resolve(text)
            },
            reject
          )
          return
        }

        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.once('error', reject)
        response.once('aborted', () => reject(new Error('连接被中止')))
        response.on('end', () => {
          if (statusCode >= 400) {
            reject(new Error(`请求失败：HTTP ${statusCode}`))
            return
          }

          try {
            const buffer = inflateResponse(Buffer.concat(chunks), response.headers['content-encoding'])
            if (request && typeof request === 'object') request.responseUrl = target
            resolve(decodeText(buffer))
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    clientRequest.setTimeout(20000, () => {
      clientRequest.destroy(new Error('请求超时'))
    })
    clientRequest.on('error', reject)
    if (body) clientRequest.write(body)
    clientRequest.end()
  })
}

async function fetchTextWithElectronNet(request, redirectCount = 0) {
  const target = typeof request === 'string' ? request : request?.url
  if (!target) throw new Error('请求地址为空')

  const body = typeof request?.body === 'string' ? request.body : undefined
  const method = getRequestMethod(request)
  const headers = applyCookieJar(request, target, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    Accept: 'text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.6',
    ...(request?.headers || {})
  })
  const response = await net.fetch(target, {
    method,
    headers,
    body,
    redirect: 'manual'
  })

  rememberResponseCookies(request, target, getResponseSetCookies(response))
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location && redirectCount < 5) {
    const nextUrl = new URL(location, target).toString()
    if (isBlockedRedirect(target, nextUrl)) {
      throw new Error('请求被站点跳转到 Google，可能被反爬拦截')
    }
    const redirectRequest = createRedirectRequest(request, nextUrl, response.status)
    const text = await fetchTextWithElectronNet(redirectRequest, redirectCount + 1)
    if (request && typeof request === 'object') request.responseUrl = redirectRequest.responseUrl || nextUrl
    return text
  }

  if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`)

  const finalUrl = response.url || target
  if (request && typeof request === 'object') request.responseUrl = finalUrl
  try {
    const finalHost = new URL(finalUrl).hostname
    const targetHost = new URL(target).hostname
    if (targetHost !== finalHost && isGoogleHost(finalHost)) {
      throw new Error('请求被站点跳转到 Google，可能被反爬拦截')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Google')) throw error
  }

  return decodeText(Buffer.from(await response.arrayBuffer()))
}

function toDataUrl(buffer, contentType) {
  const mime = String(contentType || '').split(';')[0].trim() || 'application/octet-stream'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

async function fetchDataUrl(request, redirectCount = 0) {
  const target = typeof request === 'string' ? request : request?.url
  if (!target) throw new Error('请求地址为空')
  if (net?.fetch && !isHttpUrl(target)) return fetchDataUrlWithElectronNet(request)

  const url = new URL(target)
  const transport = url.protocol === 'https:' ? https : http
  const body = typeof request?.body === 'string' ? request.body : undefined
  const method = getRequestMethod(request)
  const headers = applyCookieJar(request, target, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) DeepRead/1.0',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    ...(request?.headers || {})
  })

  return new Promise((resolve, reject) => {
    const clientRequest = transport.request(
      url,
      {
        method,
        headers
      },
      (response) => {
        const statusCode = response.statusCode || 0
        const location = response.headers.location
        rememberResponseCookies(request, target, response.headers['set-cookie'])

        if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 5) {
          response.resume()
          const nextUrl = new URL(location, url).toString()
          if (isBlockedRedirect(target, nextUrl)) {
            reject(new Error('请求被站点跳转到 Google，可能被反爬拦截'))
            return
          }
          const redirectRequest = createRedirectRequest(request, nextUrl, statusCode)
          fetchDataUrl(redirectRequest, redirectCount + 1).then(
            (dataUrl) => {
              if (request && typeof request === 'object') request.responseUrl = redirectRequest.responseUrl || nextUrl
              resolve(dataUrl)
            },
            reject
          )
          return
        }

        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.once('error', reject)
        response.once('aborted', () => reject(new Error('连接被中止')))
        response.on('end', () => {
          if (statusCode >= 400) {
            reject(new Error(`请求失败：HTTP ${statusCode}`))
            return
          }

          try {
            const buffer = inflateResponse(Buffer.concat(chunks), response.headers['content-encoding'])
            if (request && typeof request === 'object') request.responseUrl = target
            resolve(toDataUrl(buffer, response.headers['content-type']))
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    clientRequest.setTimeout(20000, () => {
      clientRequest.destroy(new Error('请求超时'))
    })
    clientRequest.on('error', reject)
    if (body) clientRequest.write(body)
    clientRequest.end()
  })
}

async function fetchDataUrlWithElectronNet(request, redirectCount = 0) {
  const target = typeof request === 'string' ? request : request?.url
  if (!target) throw new Error('请求地址为空')

  const body = typeof request?.body === 'string' ? request.body : undefined
  const method = getRequestMethod(request)
  const headers = applyCookieJar(request, target, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    ...(request?.headers || {})
  })
  const response = await net.fetch(target, {
    method,
    headers,
    body,
    redirect: 'manual'
  })

  rememberResponseCookies(request, target, getResponseSetCookies(response))
  const location = response.headers.get('location')
  if (response.status >= 300 && response.status < 400 && location && redirectCount < 5) {
    const nextUrl = new URL(location, target).toString()
    if (isBlockedRedirect(target, nextUrl)) {
      throw new Error('请求被站点跳转到 Google，可能被反爬拦截')
    }
    const redirectRequest = createRedirectRequest(request, nextUrl, response.status)
    const dataUrl = await fetchDataUrlWithElectronNet(redirectRequest, redirectCount + 1)
    if (request && typeof request === 'object') request.responseUrl = redirectRequest.responseUrl || nextUrl
    return dataUrl
  }

  if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`)

  const finalUrl = response.url || target
  if (request && typeof request === 'object') request.responseUrl = finalUrl
  try {
    const finalHost = new URL(finalUrl).hostname
    const targetHost = new URL(target).hostname
    if (targetHost !== finalHost && isGoogleHost(finalHost)) {
      throw new Error('请求被站点跳转到 Google，可能被反爬拦截')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Google')) throw error
  }

  return toDataUrl(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'))
}

window.services = {
  onFishCommand(handler) {
    const listener = (_event, command) => handler(command)
    ipcRenderer.on('deepread-fish-command', listener)
    return () => ipcRenderer.off('deepread-fish-command', listener)
  },

  readFile(filePath) {
    return window.services.readTextFile(filePath).content
  },

  readClipboardText() {
    return clipboard.readText()
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

  fetchText(request) {
    return fetchText(request)
  },

  fetchDataUrl(request) {
    return fetchDataUrl(request)
  },

  rememberSourceCookie(request, cookie) {
    if (!cookie) return
    const target = request?.url || request?.sourceUrl || ''
    const key = getCookieKey(request, target)
    const nextCookie = mergeCookieStrings(sourceCookieStore[key], cookie)
    if (nextCookie) sourceCookieStore[key] = nextCookie
    else delete sourceCookieStore[key]
    saveSourceCookieStore()
  },

  clearSourceCookie(request) {
    const target = request?.url || request?.sourceUrl || ''
    delete sourceCookieStore[getCookieKey(request, target)]
    saveSourceCookieStore()
  }
}
