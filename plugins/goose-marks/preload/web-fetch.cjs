const dns = require('dns')
const http = require('http')
const https = require('https')
const net = require('net')
const tls = require('tls')
const zlib = require('zlib')
const { execFileSync } = require('child_process')
const { URL } = require('url')

const MAX_REDIRECTS = 4
const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_DECODED_BYTES = 4 * 1024 * 1024
const PROXY_CACHE_MS = 60 * 1000

const WEB_FETCH_ERROR_CODES = Object.freeze({
  RESPONSE_TOO_LARGE: 'WEB_FETCH_RESPONSE_TOO_LARGE',
  DECOMPRESSED_TOO_LARGE: 'WEB_FETCH_DECOMPRESSED_TOO_LARGE'
})

function createWebFetchError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function assertResponseBodySize(receivedBytes, maxBytes) {
  if (receivedBytes > maxBytes) {
    throw createWebFetchError(
      WEB_FETCH_ERROR_CODES.RESPONSE_TOO_LARGE,
      '网页响应体过大，已停止读取'
    )
  }
}

function isPrivateIPv4(address, options = {}) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (!options.allowProxyBenchmarkRange && a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIp(address, options = {}) {
  const normalized = String(address).toLowerCase().split('%')[0]
  const family = net.isIP(normalized)
  if (family === 4) return isPrivateIPv4(normalized, options)
  if (family !== 6) return true
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1], options)
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff')
  )
}

function parsePublicUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(String(rawUrl || '').trim())
  } catch {
    throw new Error('网址格式不正确')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只允许读取 HTTP 或 HTTPS 网页')
  }
  if (parsed.username || parsed.password) throw new Error('网址不能包含账号或密码')

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !hostname.includes('.') ||
    (net.isIP(hostname) && isPrivateIp(hostname))
  ) {
    throw new Error('不能读取本机或内网地址')
  }
  return parsed
}

function resolvePublicAddress(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error || !Array.isArray(addresses) || addresses.length === 0) {
        reject(new Error('无法解析网页地址'))
        return
      }
      // 兼容 Clash 等代理的 198.18/15 fake-ip；用户直接输入该网段仍会被 parsePublicUrl 拒绝。
      const publicAddress = addresses.find(
        (item) => item && !isPrivateIp(item.address, { allowProxyBenchmarkRange: true })
      )
      if (!publicAddress) {
        reject(new Error('不能读取本机或内网地址'))
        return
      }
      resolve(publicAddress)
    })
  })
}

// --- 系统代理检测 ---

/**
 * 解析代理 URL。支持 http/https；socks 可解析但当前不用于转发。
 * @returns {{ protocol: string, host: string, port: number, auth: string|null, href: string, kind: 'http'|'socks' } | null}
 */
function parseProxyUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  let candidate = text
  // 无协议时默认 http
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`
  }
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  const protocol = parsed.protocol.toLowerCase()
  const host = parsed.hostname
  if (!host) return null

  let kind = null
  let defaultPort = 80
  if (protocol === 'http:' || protocol === 'https:') {
    kind = 'http'
    defaultPort = protocol === 'https:' ? 443 : 80
  } else if (protocol === 'socks:' || protocol === 'socks5:' || protocol === 'socks5h:' || protocol === 'socks4:') {
    // SOCKS 可解析，请求路径暂不支持（避免引入依赖）
    kind = 'socks'
    defaultPort = 1080
  } else {
    return null
  }

  const port = parsed.port ? Number(parsed.port) : defaultPort
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null

  const auth =
    parsed.username || parsed.password
      ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
      : null

  const href =
    kind === 'http'
      ? `http://${auth ? `${parsed.username}:${parsed.password}@` : ''}${host}:${port}`
      : `${protocol}//${auth ? `${parsed.username}:${parsed.password}@` : ''}${host}:${port}`

  return { protocol, host, port, auth, href, kind }
}

function parseNoProxyList(raw) {
  const text = String(raw || '').trim()
  if (!text || text === '*') return text === '*' ? ['*'] : []
  return text
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 是否应绕过代理。支持 localhost / IP / 后缀域名 / 前导点后缀。
 */
function shouldBypassProxy(hostname, noProxyList) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') {
    return true
  }
  const list = Array.isArray(noProxyList) ? noProxyList : parseNoProxyList(noProxyList)
  if (list.length === 0) return false
  if (list.includes('*')) return true

  for (const entry of list) {
    if (!entry) continue
    // 去掉可能的端口
    const bare = entry.replace(/:\d+$/, '')
    if (bare === host) return true
    if (bare.startsWith('.')) {
      if (host.endsWith(bare) || host === bare.slice(1)) return true
    } else if (bare.startsWith('*')) {
      const suffix = bare.slice(1)
      if (suffix.startsWith('.') && (host.endsWith(suffix) || host === suffix.slice(1))) return true
      if (host.endsWith(suffix.replace(/^\./, '')) || host.endsWith(bare.slice(1))) return true
    } else if (host === bare || host.endsWith(`.${bare}`)) {
      return true
    }
  }
  return false
}

function readEnvProxyCandidate(preferHttps) {
  const keys = preferHttps
    ? ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    : ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
  for (const key of keys) {
    const value = process.env[key]
    if (value && String(value).trim()) return String(value).trim()
  }
  return null
}

function readEnvNoProxy() {
  return process.env.NO_PROXY || process.env.no_proxy || ''
}

function detectMacOSProxy() {
  if (process.platform !== 'darwin') return null
  let output = ''
  try {
    output = execFileSync('scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 64 * 1024
    })
  } catch {
    return null
  }
  const get = (key) => {
    const match = output.match(new RegExp(`${key}\\s*:\\s*(.+)`))
    return match ? match[1].trim() : null
  }
  // 优先 HTTPS，再 HTTP
  if (get('HTTPSEnable') === '1') {
    const host = get('HTTPSProxy')
    const port = get('HTTPSPort')
    if (host && port) return `http://${host}:${port}`
  }
  if (get('HTTPEnable') === '1') {
    const host = get('HTTPProxy')
    const port = get('HTTPPort')
    if (host && port) return `http://${host}:${port}`
  }
  // SOCKS 仅记录，当前不转发
  if (get('SOCKSEnable') === '1') {
    const host = get('SOCKSProxy')
    const port = get('SOCKSPort')
    if (host && port) return `socks5://${host}:${port}`
  }
  return null
}

function detectWindowsProxy() {
  if (process.platform !== 'win32') return null

  // 注册表：ProxyEnable + ProxyServer
  try {
    const output = execFileSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v',
        'ProxyEnable'
      ],
      { encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true }
    )
    const enableMatch = output.match(/ProxyEnable\s+REG_DWORD\s+0x(\d+)/i)
    const enabled = enableMatch ? parseInt(enableMatch[1], 16) === 1 : false
    if (enabled) {
      const serverOut = execFileSync(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
          '/v',
          'ProxyServer'
        ],
        { encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true }
      )
      const serverMatch = serverOut.match(/ProxyServer\s+REG_SZ\s+(.+)/i)
      const server = serverMatch ? serverMatch[1].trim() : ''
      if (server) {
        // 可能是 host:port 或 http=host:port;https=host:port
        if (server.includes('=')) {
          const parts = Object.fromEntries(
            server.split(';').map((item) => {
              const [k, ...rest] = item.split('=')
              return [k.trim().toLowerCase(), rest.join('=').trim()]
            })
          )
          const picked = parts.https || parts.http || Object.values(parts)[0]
          if (picked) return picked.includes('://') ? picked : `http://${picked}`
        }
        return server.includes('://') ? server : `http://${server}`
      }
    }
  } catch {
    // fallthrough
  }

  // netsh 兜底
  try {
    const output = execFileSync('netsh', ['winhttp', 'show', 'proxy'], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 64 * 1024,
      windowsHide: true
    })
    const match =
      output.match(/Proxy Server\(s\)\s*:\s*(.+)/i) ||
      output.match(/代理服务器\s*:\s*(.+)/i)
    if (match) {
      const server = match[1].trim()
      if (server && !/^none$/i.test(server) && server !== '无') {
        if (server.includes('=')) {
          const parts = Object.fromEntries(
            server.split(';').map((item) => {
              const [k, ...rest] = item.split('=')
              return [k.trim().toLowerCase(), rest.join('=').trim()]
            })
          )
          const picked = parts.https || parts.http || Object.values(parts)[0]
          if (picked) return picked.includes('://') ? picked : `http://${picked}`
        }
        return server.includes('://') ? server : `http://${server}`
      }
    }
  } catch {
    // ignore
  }
  return null
}

let proxyCache = { at: 0, value: null }

/**
 * 解析当前系统/环境代理（缓存约 60s）。
 * 优先级：环境变量 > 系统设置（macOS scutil / Windows 注册表|netsh）
 * @returns {{ proxy: ReturnType<typeof parseProxyUrl> | null, source: string | null, noProxy: string[] }}
 */
function resolveProxySettings(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && proxyCache.value && now - proxyCache.at < PROXY_CACHE_MS) {
    return proxyCache.value
  }

  const noProxy = parseNoProxyList(readEnvNoProxy())
  let raw = null
  let source = null

  const envRaw = readEnvProxyCandidate(true)
  if (envRaw) {
    raw = envRaw
    source = 'env'
  } else if (process.platform === 'darwin') {
    raw = detectMacOSProxy()
    if (raw) source = 'macos-scutil'
  } else if (process.platform === 'win32') {
    raw = detectWindowsProxy()
    if (raw) source = 'windows'
  }

  const parsed = parseProxyUrl(raw)
  // http 代理才用于转发；socks 解析后记 null（避免误用）
  const usable = parsed && parsed.kind === 'http' ? parsed : null
  const value = {
    proxy: usable,
    // 若仅有 socks，source 仍记录便于调试
    source: usable ? source : parsed && parsed.kind === 'socks' ? `${source}:socks-unsupported` : null,
    raw: raw || null,
    noProxy,
    socksOnly: Boolean(parsed && parsed.kind === 'socks' && !usable)
  }
  proxyCache = { at: now, value }
  return value
}

function getResolvedProxy() {
  const settings = resolveProxySettings()
  return settings.proxy ? settings.proxy.href : null
}

function getProxyStatus() {
  const settings = resolveProxySettings()
  return {
    proxy: settings.proxy ? settings.proxy.href : null,
    source: settings.source,
    noProxy: settings.noProxy,
    socksOnly: Boolean(settings.socksOnly),
    raw: settings.raw
  }
}

/** 测试用：清空代理缓存 */
function clearProxyCache() {
  proxyCache = { at: 0, value: null }
}

// --- 请求 ---

function decodeBody(buffer, encoding, maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES) {
  const normalized = String(encoding || '').toLowerCase()
  const decoder = normalized.includes('br')
    ? zlib.createBrotliDecompress()
    : normalized.includes('gzip')
      ? zlib.createGunzip()
      : normalized.includes('deflate')
        ? zlib.createInflate()
        : null

  if (!decoder) {
    if (buffer.length > maxDecodedBytes) {
      return Promise.reject(createWebFetchError(
        WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE,
        '网页解压后内容过大，已停止读取'
      ))
    }
    return Promise.resolve(buffer)
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }

    decoder.on('data', (chunk) => {
      total += chunk.length
      if (total > maxDecodedBytes) {
        decoder.destroy()
        finish(reject, createWebFetchError(
          WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE,
          '网页解压后内容过大，已停止读取'
        ))
        return
      }
      chunks.push(chunk)
    })
    decoder.on('end', () => finish(resolve, Buffer.concat(chunks)))
    decoder.on('error', (error) => finish(reject, error))
    decoder.end(buffer)
  })
}

/** HTTP CONNECT 隧道（裸 socket，兼容 Bun/Node，不依赖 http.request 的 CONNECT） */
function connectViaHttpProxy(proxy, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }

    const socket = net.connect({ host: proxy.host, port: proxy.port })
    let head = ''

    const onData = (chunk) => {
      head += chunk.toString('latin1')
      const sep = head.indexOf('\r\n\r\n')
      if (sep < 0) {
        if (head.length > 8192) {
          socket.destroy()
          finish(reject, new Error('代理 CONNECT 响应异常'))
        }
        return
      }
      socket.removeListener('data', onData)
      const statusLine = head.slice(0, head.indexOf('\r\n'))
      const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/i)
      const code = match ? Number(match[1]) : 0
      if (code !== 200) {
        socket.destroy()
        finish(reject, new Error(`代理 CONNECT 失败（HTTP ${code || '未知'}）`))
        return
      }
      const leftover = head.slice(sep + 4)
      if (leftover) {
        socket.unshift(Buffer.from(leftover, 'latin1'))
      }
      finish(resolve, socket)
    }

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => {
      socket.destroy()
      finish(reject, new Error('网页读取超时'))
    })
    socket.on('error', (error) => finish(reject, error))
    socket.on('connect', () => {
      let payload =
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        'Proxy-Connection: keep-alive\r\n' +
        'Connection: keep-alive\r\n'
      if (proxy.auth) {
        payload += `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n`
      }
      payload += '\r\n'
      socket.write(payload)
    })
    socket.on('data', onData)
  })
}

function makeRequestOptions(parsed, proxy, resolved) {
  const isHttps = parsed.protocol === 'https:'
  const path = `${parsed.pathname}${parsed.search}`
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain,application/json;q=0.9,*/*;q=0.2',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Host: parsed.host
  }

  // 经 HTTP 代理访问明文 HTTP：绝对 URL
  if (proxy && !isHttps) {
    if (proxy.auth) {
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(proxy.auth).toString('base64')}`
    }
    return {
      library: http,
      options: {
        protocol: 'http:',
        hostname: proxy.host,
        port: proxy.port,
        path: parsed.toString(),
        method: 'GET',
        headers
      }
    }
  }

  // 直连（含将由 createConnection 注入的 HTTPS 隧道）
  const library = isHttps ? https : http
  const options = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path,
    method: 'GET',
    headers: {
      Accept: headers.Accept,
      'Accept-Encoding': headers['Accept-Encoding'],
      'User-Agent': headers['User-Agent']
    }
  }
  if (resolved) {
    options.lookup = (_hostname, lookupOptions, callback) => {
      const cb = typeof lookupOptions === 'function' ? lookupOptions : callback
      if (typeof lookupOptions === 'object' && lookupOptions?.all) {
        cb(null, [resolved])
        return
      }
      cb(null, resolved.address, resolved.family)
    }
  }
  return { library, options }
}

/**
 * @param {'text'|'binary'} mode
 */
async function fetchPublic(rawUrl, options = {}, mode = 'text') {
  const timeoutMs = Math.min(30000, Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS))
  const maxBytes = Math.min(4 * 1024 * 1024, Math.max(64 * 1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES))
  const maxDecodedBytes = Math.min(
    8 * 1024 * 1024,
    Math.max(64 * 1024, Number(options.maxDecodedBytes) || Math.max(DEFAULT_MAX_DECODED_BYTES, maxBytes))
  )

  const proxySettings = resolveProxySettings()

  async function visit(currentUrl, redirectsLeft) {
    const parsed = parsePublicUrl(currentUrl)
    const useProxy =
      proxySettings.proxy &&
      !shouldBypassProxy(parsed.hostname, proxySettings.noProxy)
        ? proxySettings.proxy
        : null

    // 走代理时由代理侧解析 DNS（兼容系统代理 + fake-ip 场景）；直连仍本地校验。
    let resolved = null
    if (!useProxy) {
      resolved = await resolvePublicAddress(parsed.hostname)
    }

    const isHttps = parsed.protocol === 'https:'
    const targetPort = Number(parsed.port) || (isHttps ? 443 : 80)

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        callback(value)
      }

      const startRequest = (createConnection) => {
        const { library, options: reqOptions } = makeRequestOptions(parsed, useProxy, resolved)
        if (createConnection) {
          reqOptions.createConnection = createConnection
          // 隧道已建立，agent 默认 keepAlive 可能干扰
          reqOptions.agent = false
        }

        const request = library.request(reqOptions, (response) => {
          const status = response.statusCode || 0
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume()
            if (redirectsLeft <= 0) {
              finish(reject, new Error('网页重定向次数过多'))
              return
            }
            let nextUrl
            try {
              nextUrl = new URL(response.headers.location, parsed).toString()
            } catch {
              finish(reject, new Error('网页返回了无效的重定向地址'))
              return
            }
            visit(nextUrl, redirectsLeft - 1).then(
              (value) => finish(resolve, value),
              (error) => finish(reject, error)
            )
            return
          }
          if (status < 200 || status >= 300) {
            response.resume()
            finish(reject, new Error(`网页请求失败（HTTP ${status || '未知'}）`))
            return
          }
          const contentType = String(response.headers['content-type'] || '')
          if (mode === 'text' && contentType && !/(?:text\/|html|xml|json|rss|atom)/i.test(contentType)) {
            response.resume()
            finish(reject, new Error('该地址不是可读取的文本网页'))
            return
          }
          const chunks = []
          let total = 0
          response.on('data', (chunk) => {
            total += chunk.length
            try {
              assertResponseBodySize(total, maxBytes)
            } catch (error) {
              response.destroy()
              request.destroy()
              finish(reject, error)
              return
            }
            chunks.push(chunk)
          })
          response.on('end', async () => {
            try {
              const decoded = await decodeBody(
                Buffer.concat(chunks),
                response.headers['content-encoding'],
                maxDecodedBytes
              )
              if (mode === 'binary') {
                finish(resolve, {
                  ok: true,
                  url: parsed.toString(),
                  status,
                  contentType,
                  buffer: decoded
                })
              } else {
                finish(resolve, {
                  ok: true,
                  url: parsed.toString(),
                  status,
                  contentType,
                  text: decoded.toString('utf8')
                })
              }
            } catch (error) {
              if (error?.code === WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE) {
                finish(reject, error)
                return
              }
              finish(reject, new Error(mode === 'binary' ? '内容解码失败' : '网页内容解码失败'))
            }
          })
          response.on('error', (error) => finish(reject, error))
        })
        request.setTimeout(timeoutMs, () => {
          request.destroy()
          finish(reject, new Error('网页读取超时'))
        })
        request.on('error', (error) => finish(reject, error))
        request.end()
      }

      if (useProxy && isHttps) {
        connectViaHttpProxy(useProxy, parsed.hostname, targetPort, timeoutMs)
          .then((socket) => {
            const tlsSocket = tls.connect({
              socket,
              servername: parsed.hostname,
              rejectUnauthorized: true
            })
            tlsSocket.setTimeout(timeoutMs)
            const onTimeout = () => {
              tlsSocket.destroy()
              finish(reject, new Error('网页读取超时'))
            }
            const onError = (error) => finish(reject, error)
            tlsSocket.once('timeout', onTimeout)
            tlsSocket.once('error', onError)
            tlsSocket.once('secureConnect', () => {
              tlsSocket.removeListener('timeout', onTimeout)
              tlsSocket.removeListener('error', onError)
              // 隧道 TLS 已就绪，createConnection 直接复用
              startRequest(() => tlsSocket)
            })
          })
          .catch((error) => finish(reject, error))
        return
      }

      startRequest(null)
    })
  }

  return visit(rawUrl, MAX_REDIRECTS)
}

async function fetchPublicText(rawUrl, options = {}) {
  return fetchPublic(rawUrl, options, 'text')
}

async function fetchPublicBinary(rawUrl, options = {}) {
  return fetchPublic(rawUrl, options, 'binary')
}

module.exports = {
  WEB_FETCH_ERROR_CODES,
  assertResponseBodySize,
  clearProxyCache,
  decodeBody,
  fetchPublicBinary,
  fetchPublicText,
  getProxyStatus,
  getResolvedProxy,
  isPrivateIp,
  parseNoProxyList,
  parseProxyUrl,
  parsePublicUrl,
  resolveProxySettings,
  shouldBypassProxy
}
