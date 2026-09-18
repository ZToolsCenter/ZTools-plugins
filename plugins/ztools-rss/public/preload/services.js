const https = require('node:https')
const http = require('node:http')
const { URL } = require('node:url')

/**
 * 在 Node.js 侧发起 HTTP(S) 请求，规避渲染进程的 CORS 限制。
 * @param {string} urlStr 完整 URL
 * @param {object} [opts]
 * @param {string} [opts.method] HTTP 方法
 * @param {object} [opts.headers] 请求头
 * @param {string|null} [opts.body] 请求体（字符串）
 * @param {number} [opts.timeout] 超时毫秒，默认 30000
 * @returns {Promise<{ status: number, headers: object, text: string }>}
 */
function httpRequest(urlStr, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 30000 } = opts
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(urlStr)
    } catch (e) {
      reject(new Error('无效的 URL：' + urlStr))
      return
    }
    const lib = u.protocol === 'https:' ? https : http
    const reqOpts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { ...headers }
    }

    const req = lib.request(reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location
        if (loc.startsWith('/')) loc = u.protocol + '//' + u.host + loc
        res.resume()
        httpRequest(loc, { method, headers, body, timeout }).then(resolve, reject)
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf-8')
        })
      })
      res.on('error', reject)
    })

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('请求超时'))
    })
    if (body != null) req.write(body)
    req.end()
  })
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * 通过 Node 下载图片（可带 Referer 绕过防盗链），返回 data URL。
 * 独立实现以正确处理二进制数据。
 * @param {string} urlStr 图片地址
 * @param {string} [referer] Referer 提示，用于防盗链
 * @returns {Promise<string>} data:image/...;base64,xxxx
 */
function fetchImageAsDataUrl(urlStr, referer) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(urlStr)
    } catch (e) {
      reject(new Error('无效的图片 URL'))
      return
    }
    const lib = u.protocol === 'https:' ? https : http
    const headers = { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' }
    if (referer) {
      headers['Referer'] = referer
      try {
        headers['Origin'] = new URL(referer).origin
      } catch (_) {
        /* ignore */
      }
    }
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location
          if (loc.startsWith('/')) loc = u.protocol + '//' + u.host + loc
          res.resume()
          fetchImageAsDataUrl(loc, referer).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('图片下载失败：HTTP ' + res.statusCode))
          return
        }
        const ct = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const b64 = Buffer.concat(chunks).toString('base64')
          resolve('data:' + ct + ';base64,' + b64)
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('图片下载超时')))
    req.end()
  })
}

// 通过 window 对象向渲染进程注入能力
window.services = {
  /**
   * RSS HTTP 请求
   * @param {string} url
   * @param {{ method?: string, headers?: object, body?: string|null, timeout?: number }} [opts]
   */
  async rssFetch(url, opts) {
    const res = await httpRequest(url, opts)
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: res.headers,
      text: res.text
    }
  },
  /** 下载图片为 data URL（绕过防盗链） */
  fetchImageAsDataUrl
}
