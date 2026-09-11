// public/preload/registry.js
// 镜像搜索（多源：Docker Hub 官方 / 轩辕 / 毫秒）+ Docker 加速器解析与 daemon.json 生成
const https = require('node:https')
const http = require('node:http')
const net = require('node:net')
const tls = require('node:tls')
const zlib = require('node:zlib')
const { URL } = require('node:url')

// 浏览器 UA：部分镜像 API（如轩辕）拒绝非浏览器 UA
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// 代理配置（由渲染层 setProxy 注入，存于 dbStorage）
let proxy = ''
let proxyType = ''   // 'http' | 'socks' | ''

function setProxy(value) {
  proxy = String(value || '').trim()
  proxyType = /^socks/i.test(proxy) ? 'socks' : /^https?:\/\//i.test(proxy) ? 'http' : ''
}

function requestJson(urlStr, timeout = 15000, opts = {}) {
  const viaHttp = proxy && proxyType === 'http' && !opts.bypassProxy
  const viaSocks = proxy && proxyType === 'socks' && !opts.bypassProxy
  const t0 = Date.now()
  const p = viaHttp
    ? requestViaProxy(urlStr, proxy, timeout)
    : viaSocks
      ? Promise.resolve({ ok: false, error: '暂不支持 socks 代理，请改用 http:// 代理' })
      : requestDirect(urlStr, timeout)
  return p.then((r) => {
    // 请求日志（开发者工具 Console 可查看，便于排查）
    // eslint-disable-next-line no-console
    console.log(
      '[registry]',
      viaHttp ? '[via-proxy]' : viaSocks ? '[socks]' : '[direct]',
      urlStr.slice(0, 90),
      r.ok ? 'ok' : 'fail: ' + r.error
    )
    return r
  })
}

function requestDirect(urlStr, timeout) {
  return new Promise((resolve) => {
    let u
    try {
      u = new URL(urlStr)
    } catch (e) {
      return resolve({ ok: false, error: '无效的地址' })
    }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(
      urlStr,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        timeout
      },
      (res) => {
        let data = ''
        const limit = () => {
          if (data.length > 3e6) req.destroy()
        }
        const finish = () => resolve({ ok: true, data })
        if ((res.headers['content-encoding'] || '').includes('gzip')) {
          const gz = zlib.createGunzip()
          gz.on('data', (c) => {
            data += c
            limit()
          })
          gz.on('end', finish)
          gz.on('error', () => resolve({ ok: false, error: '解压失败' }))
          res.pipe(gz)
        } else {
          res.on('data', (c) => {
            data += c
            limit()
          })
          res.on('end', finish)
        }
      }
    )
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: '请求超时' })
    })
  })
}

// 解码 HTTP chunked transfer-encoding 的响应体
function decodeChunked(body) {
  let result = Buffer.alloc(0)
  let pos = 0
  while (pos < body.length) {
    const lineEnd = body.indexOf('\r\n', pos)
    if (lineEnd === -1) break
    const size = parseInt(body.slice(pos, lineEnd).toString().trim(), 16)
    if (isNaN(size) || size === 0) break
    const dataStart = lineEnd + 2
    if (dataStart + size > body.length) break
    result = Buffer.concat([result, body.slice(dataStart, dataStart + size)])
    pos = dataStart + size + 2
  }
  return result
}

// 通过 HTTP 代理请求（HTTPS 目标用 CONNECT 隧道，标准 http.request CONNECT 实现）
function requestViaProxy(urlStr, proxyUrl, timeout) {
  return new Promise((resolve) => {
    let u, p
    try {
      u = new URL(urlStr)
      p = new URL(proxyUrl)
    } catch (e) {
      return resolve({ ok: false, error: '无效的地址' })
    }
    if (!p.port) {
      return resolve({ ok: false, error: '代理地址需包含端口，如 http://127.0.0.1:7890' })
    }
    let settled = false
    const fail = (msg) => {
      if (settled) return
      settled = true
      resolve({ ok: false, error: msg })
    }
    // CONNECT 目标必须带端口（host:443），否则部分代理默认连 80 → TLS 打到 http 服务
    const targetPort = u.port || (u.protocol === 'https:' ? 443 : 80)
    const connectTarget = u.hostname + ':' + targetPort
    const req = http.request({
      host: p.hostname,
      port: p.port,
      method: 'CONNECT',
      path: connectTarget,
      headers: { Host: connectTarget, 'Proxy-Connection': 'Keep-Alive' },
      timeout
    })
    req.on('error', (e) => fail('代理错误：' + e.message))
    req.on('timeout', () => {
      req.destroy()
      fail('代理连接超时')
    })

    const readHttp = (stream) => {
      const path = u.pathname + u.search
      stream.write(
        `GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nUser-Agent: ${BROWSER_UA}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`
      )
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => {
        const resp = Buffer.concat(chunks)
        const i = resp.indexOf('\r\n\r\n')
        if (i < 0) return fail('代理响应无效')
        const head = resp.slice(0, i).toString()
        let body = resp.slice(i + 4)
        // 先解 chunked，再解 gzip
        if (/transfer-encoding:\s*chunked/i.test(head)) {
          body = decodeChunked(body)
        }
        if (/content-encoding:\s*gzip/i.test(head)) {
          try {
            body = zlib.gunzipSync(body)
          } catch (e) {
            return fail('代理响应解压失败')
          }
        }
        settled = true
        stream.destroy()
        resolve({ ok: true, data: body.toString() })
      })
    }

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        return fail('代理 CONNECT 失败：' + res.statusCode)
      }
      socket.setTimeout(timeout)
      socket.on('error', (e) => fail('代理错误：' + e.message))
      if (u.protocol === 'https:') {
        // CONNECT 隧道已建立，基于原始 socket 做 TLS
        const tlsSock = tls.connect({ socket, servername: u.hostname }, () => readHttp(tlsSock))
        tlsSock.on('error', (e) => fail('TLS 错误：' + e.message))
      } else {
        readHttp(socket)
      }
    })
    req.end()
  })
}

// 统一的搜索结果
function normalize(item, source) {
  // 各源字段不同：毫秒用 repository_name；Docker Hub 官方用 repo_name；轩辕用 id
  // 注意毫秒/轩辕的 id 是数字或仓库路径，需按源区分
  let rawName = ''
  if (source === '1ms') rawName = item.repository_name || item.name || ''
  else if (source === 'dockerhub') rawName = item.repo_name || item.name || ''
  else rawName = item.id || item.name || ''
  // Docker Hub 官方镜像（is_official 且无命名空间）实际命名空间为 library
  let name = rawName
  if (source === 'dockerhub' && item.is_official && !rawName.includes('/')) {
    name = 'library/' + rawName
  }
  const logo =
    source === 'xuanyuan'
      ? item.logo_url && (item.logo_url.small || item.logo_url.large)
      : source === '1ms'
        ? item.logo_url
        : item.logo_url && item.logo_url.small
  return {
    source,
    name,
    description: item.short_description || item.description || '',
    stars: Number(item.star_count || 0),
    pulls: source === '1ms' ? String(item.pull_count || 0) : String(item.pull_count || ''),
    official: source === '1ms' ? !!item.is_official : (item.namespace || '') === 'library' || !!item.is_official,
    logo: logo || ''
  }
}

// 按源搜索镜像
async function searchImages(query, source) {
  const q = encodeURIComponent(String(query || '').trim())
  if (!q) return { ok: true, results: [] }

  if (source === 'dockerhub') {
    const r = await requestJson(`https://hub.docker.com/v2/search/repositories/?query=${q}&page_size=25`)
    if (!r.ok) {
      const msg = r.error
      // TLS/连接错误/超时 = 大概率国内直连被墙
      const blocked = /TLS|SSL|WRONG_VERSION|ECONNRESET|timeout|ETIMEDOUT|ENOTFOUND|EPROTO/i.test(msg)
      return {
        ok: false,
        error:
          'Docker Hub 官方搜索失败：' +
          msg +
          (blocked ? '（直连可能被墙，请在「设置」配置 http 代理后重试；或改用轩辕/毫秒源）' : '')
      }
    }
    try {
      const data = JSON.parse(r.data)
      const list = (data.results || []).map((item) => normalize(item, 'dockerhub'))
      return { ok: true, results: list }
    } catch (e) {
      return { ok: false, error: 'Docker Hub 响应解析失败' }
    }
  }

  if (source === 'xuanyuan') {
    const r = await requestJson(
      `https://xuanyuan.cloud/api/docker/searchv4?q=${q}&source=docker.io&page=1&limit=25`,
      15000,
      { bypassProxy: true }
    )
    if (!r.ok) return { ok: false, error: '轩辕搜索失败：' + r.error }
    try {
      const data = JSON.parse(r.data)
      return { ok: true, results: (data.results || []).map((item) => normalize(item, 'xuanyuan')) }
    } catch (e) {
      return { ok: false, error: '轩辕响应解析失败' }
    }
  }

  if (source === '1ms') {
    const r = await requestJson(`https://1ms.run/api/v1/registry/search?query=${q}&page=1&page_size=25`, 15000, {
      bypassProxy: true
    })
    if (!r.ok) return { ok: false, error: '毫秒搜索失败：' + r.error }
    try {
      const data = JSON.parse(r.data)
      return { ok: true, results: ((data.data && data.data.list) || []).map((item) => normalize(item, '1ms')) }
    } catch (e) {
      return { ok: false, error: '毫秒响应解析失败' }
    }
  }

  return { ok: true, results: [] }
}

// 内置常用加速器（在线列表获取失败时回退）
const FALLBACK_MIRRORS = [
  'https://docker.m.daocloud.io',
  'https://docker.1ms.run',
  'https://hub.rat.dev',
  'https://docker.1panel.live',
  'https://docker.kejilion.pro',
  'https://docker.xuanyuan.me',
  'https://docker.melikeme.cn'
]

// 获取镜像可用版本列表（Docker Hub tags API，一级搜索结果后二级查询）
async function fetchImageTags(source, imageName) {
  const repoPath = String(imageName || '').split(':')[0].replace(/^\/+/, '')
  if (!repoPath) return { ok: false, error: '镜像名无效' }
  const r = await requestJson(`https://hub.docker.com/v2/repositories/${repoPath}/tags/?page_size=50`)
  if (!r.ok) return { ok: false, error: '版本列表获取失败：' + r.error }
  try {
    const data = JSON.parse(r.data)
    const tags = (data.results || []).map((t) => t.name).filter(Boolean)
    // eslint-disable-next-line no-console
    console.log('[registry] tags', repoPath, tags.length, '个')
    return tags.length ? { ok: true, tags } : { ok: false, error: '无可用版本' }
  } catch (e) {
    return { ok: false, error: '版本响应解析失败' }
  }
}

// 从 Docker 加速器监控页解析可用加速器地址（tools.opsnote.top/registry-mirrors/）
// 解析失败时回退内置列表，offline=true 供 UI 提示
async function fetchMirrors() {
  const r = await requestJson('https://tools.opsnote.top/registry-mirrors/', 20000, { bypassProxy: true })
  if (r.ok) {
    const html = r.data
    const mirrors = []
    const re = /<h2>\s*(https?:\/\/[^<\s]+)\s*<\/h2>/g
    let m
    while ((m = re.exec(html)) !== null) {
      const url = m[1].replace(/\/+$/, '')
      if (!mirrors.includes(url)) mirrors.push(url)
    }
    if (mirrors.length) return { ok: true, mirrors, offline: false }
  }
  return { ok: true, mirrors: [...FALLBACK_MIRRORS], offline: true }
}

// 生成不同平台的 daemon.json 内容
function generateDaemonJson(mirrors) {
  const body = JSON.stringify({ 'registry-mirrors': mirrors }, null, 2)
  return body
}

// 各平台 daemon.json 配置路径与说明
function daemonConfigPath() {
  if (process.platform === 'darwin') {
    return {
      path: '~/.docker/daemon.json',
      note: 'macOS：Docker Desktop → Settings → Docker Engine，或将下方内容写入 ~/.docker/daemon.json 后重启 Docker Desktop'
    }
  }
  if (process.platform === 'win32') {
    return {
      path: '%USERPROFILE%\\.docker\\daemon.json',
      note: 'Windows：Docker Desktop → Settings → Docker Engine，或将下方内容写入 %USERPROFILE%\\.docker\\daemon.json 后重启'
    }
  }
  return {
    path: '/etc/docker/daemon.json',
    note: 'Linux：将下方内容写入 /etc/docker/daemon.json，执行 sudo systemctl restart docker 生效'
  }
}

module.exports = {
  searchImages,
  fetchImageTags,
  fetchMirrors,
  generateDaemonJson,
  daemonConfigPath,
  setProxy,
  requestViaProxy,
  decodeChunked,
  normalize
}
