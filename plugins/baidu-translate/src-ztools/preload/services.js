/**
 * 百度翻译 preload —— 插件的安全核心。
 *
 * 职责（全部在 Node 侧完成，渲染层拿不到密钥明文）：
 *   1. 密钥的本地加密存储：
 *      - 随机 AES-256-GCM 主密钥，落盘在宿主 userData 目录（baidu-translate.key）；
 *      - appid + secretKey 序列化后用该主密钥加密，密文存宿主 dbStorage；
 *      - 密钥（key 文件）与密文（dbStorage）分离存放，泄露一样不等于全泄露。
 *   2. 百度翻译 API 调用：签名（MD5）、表单编码、HTTPS 请求都在这里做，
 *      渲染层只发 translate(text, from, to)，永远接触不到 secretKey。
 *   3. 读取凭证时只返回 { appId, hasSecret }，secretKey 只进不出。
 *
 * 浏览器开发模式（无 preload）：由渲染层 src/api.ts 提供同接口的 mock。
 *
 * @author yhx
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')

/** dbStorage 里的密文键名（同时是文档 ID） */
const STORE_KEY = 'baidu-translate:creds'
/** 百度通用文本翻译 API（词典资源也只有这个接口返回） */
const ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
/** 免费版单次请求 q 上限 6000 字节（UTF-8），超限返回 58003 */
const MAX_QUERY_BYTES = 6000

/* ------------------------------------------------------------------ */
/* 主密钥管理                                                          */
/* ------------------------------------------------------------------ */

/**
 * 主密钥文件路径。优先放宿主 userData 目录（跟随宿主安装、不在插件目录里，
 * 重装/升级插件不丢）；拿不到就退回用户主目录下的 .ztools-plugins。
 */
function keyFilePath() {
  let dir = ''
  try {
    const zt = window.ztools
    if (zt && typeof zt.getPath === 'function') dir = zt.getPath('userData') || ''
  } catch (e) { /* 老版本宿主没有 getPath：走兜底 */ }
  if (!dir || !fs.existsSync(dir)) dir = path.join(os.homedir(), '.ztools-plugins')
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { /* 建目录失败后面写文件还会再报 */ }
  return path.join(dir, 'baidu-translate.key')
}

/** 读取（或首次生成）32 字节随机主密钥，返回 hex 字符串 */
function loadOrCreateKey() {
  const file = keyFilePath()
  try {
    const hex = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/i.test(hex)) return hex
  } catch (e) { /* 文件不存在：走生成 */ }
  const hex = crypto.randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(file, hex, { encoding: 'utf8', mode: 0o600 })
  } catch (e) { /* 写不了就先返回内存密钥，本次会话内仍可用 */ }
  return hex
}

function aesKey() {
  return Buffer.from(loadOrCreateKey(), 'hex')
}

/* ------------------------------------------------------------------ */
/* AES-256-GCM 加解密                                                  */
/* ------------------------------------------------------------------ */

/**
 * 加密任意 UTF-8 字符串。
 * 输出格式：base64( iv(12B) | authTag(16B) | ciphertext )
 */
function seal(plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, data]).toString('base64')
}

/**
 * 解密 seal() 的输出。主密钥换过 / 密文损坏 / 被篡改都会抛错，由调用方兜底。
 */
function open(sealed) {
  const buf = Buffer.from(String(sealed), 'base64')
  if (buf.length < 12 + 16 + 1) throw new Error('ciphertext too short')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/* ------------------------------------------------------------------ */
/* 凭证存取（密文走宿主 dbStorage，开发兜底走 localStorage）             */
/* ------------------------------------------------------------------ */

function storage() {
  const zt = window.ztools
  if (zt && zt.dbStorage && typeof zt.dbStorage.setItem === 'function') return zt.dbStorage
  return window.localStorage // 调试兜底，正常宿主环境走不到
}

function readCreds() {
  try {
    const sealed = storage().getItem(STORE_KEY)
    if (!sealed) return null
    const json = open(sealed)
    const obj = JSON.parse(json)
    if (obj && typeof obj.appId === 'string' && typeof obj.secretKey === 'string' && obj.appId && obj.secretKey) {
      return { appId: obj.appId, secretKey: obj.secretKey }
    }
  } catch (e) { /* 解密失败（如主密钥文件被删）当作未配置，让用户重新填写 */ }
  return null
}

function writeCreds(appId, secretKey) {
  storage().setItem(STORE_KEY, seal(JSON.stringify({ appId: String(appId), secretKey: String(secretKey) })))
}

function clearCreds() {
  try { storage().removeItem(STORE_KEY) } catch (e) { /* 忽略 */ }
}

/* ------------------------------------------------------------------ */
/* 百度翻译 API                                                        */
/* ------------------------------------------------------------------ */

function utf8Bytes(str) {
  return Buffer.byteLength(String(str), 'utf8')
}

/** 通用 POST：优先 Electron net（走 Chromium 网络栈，自动跟随系统代理），兜底 node https */
function httpsPost(urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    const TIMEOUT = 30000
    const parse = (buf) => {
      try {
        return JSON.parse(buf.toString('utf8'))
      } catch (e) {
        return null
      }
    }

    // ---- 首选：Electron net 模块（Chromium 网络栈，跟随系统代理；代理用户必备）----
    try {
      const electron = require('electron')
      if (electron && electron.net && typeof electron.net.request === 'function') {
        const req = electron.net.request({ method: 'POST', url: urlStr })
        req.setHeader('Content-Type', contentType)
        req.setHeader('User-Agent', 'y-translate/1.1.0')
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          try { req.abort() } catch (e) { /* 已结束 */ }
          reject(new Error('timeout'))
        }, TIMEOUT)
        req.on('response', (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            const data = parse(Buffer.concat(chunks))
            if (data) resolve(data)
            else reject(new Error('HTTP ' + res.statusCode + ' 非 JSON 响应'))
          })
        })
        req.on('error', (e) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(e)
        })
        req.write(body)
        req.end()
        return
      }
    } catch (e) { /* 无 electron（浏览器调试）：走 node https */ }

    // ---- 兜底：node https 直连 ----
    const url = new URL(urlStr)
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        timeout: TIMEOUT,
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'y-translate/1.1.0'
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const data = parse(Buffer.concat(chunks))
          if (data) resolve(data)
          else reject(new Error('HTTP ' + res.statusCode + ' 非 JSON 响应'))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** 签名：MD5(appid + q + salt + 密钥)，32 位小写 */
function makeSign(q, salt, creds) {
  return crypto
    .createHash('md5')
    .update(creds.appId + q + salt + creds.secretKey, 'utf8')
    .digest('hex')
}

function makeSalt() {
  return String(Date.now()) + String(Math.floor(Math.random() * 10))
}

/**
 * 通用文本翻译（表单）。词典资源只有这个接口返回。
 */
function commonTranslate(text, from, to, creds) {
  const salt = makeSalt()
  return httpsPost(
    ENDPOINT,
    new URLSearchParams({
      q: text,
      from,
      to,
      appid: creds.appId,
      salt,
      sign: makeSign(text, salt, creds),
      // 词典资源开关：未开通时百度会忽略，开通后单词查询返回 dict 字段
      dict: '1'
    }).toString(),
    'application/x-www-form-urlencoded'
  )
}

/**
 * 大模型文本翻译接口相关代码已移除：插件统一走通用文本翻译 API。
 */

/* ------------------------------------------------------------------ */
/* 对渲染层暴露的 services 接口                                        */
/* ------------------------------------------------------------------ */

window.services = {
  ready() {
    return typeof window.ztools !== 'undefined'
  },

  /** 单次请求字节上限（给渲染层画字数器用） */
  maxQueryBytes() {
    return MAX_QUERY_BYTES
  },

  /**
   * 读取已配置凭证。只回 appId 和"是否已填密钥"，secretKey 不出 preload。
   * 未配置返回 null。
   */
  loadCreds() {
    const creds = readCreds()
    if (!creds) return null
    return { appId: creds.appId, hasSecret: true }
  },

  /** 保存凭证（覆盖式：secretKey 传空串则保留旧密钥，方便只改 appid） */
  saveCreds(appId, secretKey) {
    const id = String(appId || '').trim()
    let secret = String(secretKey || '').trim()
    if (!id) return { ok: false, reason: 'APPID_REQUIRED' }
    if (!secret) {
      const old = readCreds()
      if (!old || old.appId !== id) return { ok: false, reason: 'SECRET_REQUIRED' }
      secret = old.secretKey
    }
    try {
      writeCreds(id, secret)
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: 'ENCRYPT_FAIL' }
    }
  },

  /** 清除已保存的凭证（密文与主密钥文件一并删除） */
  clearCreds() {
    clearCreds()
    try { fs.unlinkSync(keyFilePath()) } catch (e) { /* 文件可能本来就不存在 */ }
    return { ok: true }
  },

  /**
   * 翻译。渲染层只传文本与语言方向，签名与请求全在这里完成。
   *
   * @returns {Promise<{ok:true, from:string, to:string, items:{src?:string,dst:string,dict?:object}[]}
   *                  |{ok:false, code:string, msg?:string}>}
   *          code 见渲染层 src/baidu.ts 的 ERROR_MSG 映射。
   */
  async translate({ text, from, to } = {}) {
    const q = String(text ?? '').trim()
    if (!q) return { ok: false, code: 'EMPTY_INPUT' }

    const creds = readCreds()
    if (!creds) return { ok: false, code: 'NO_CONFIG' }

    if (utf8Bytes(q) > MAX_QUERY_BYTES) return { ok: false, code: 'BAIDU_58003' }

    try {
      const res = await commonTranslate(q, String(from || 'auto'), String(to || 'zh'), creds)
      if (res && res.error_code) {
        return { ok: false, code: 'BAIDU_' + String(res.error_code), msg: res.error_msg || '' }
      }
      const items = (Array.isArray(res.trans_result) ? res.trans_result : [])
        .map((it) => {
          // dict 是 JSON 字符串（音标/词性/释义/词形变化），解析失败不影响译文展示
          let dict
          try {
            if (typeof it.dict === 'string' && it.dict) dict = JSON.parse(it.dict)
          } catch (e) { /* 词典数据损坏就当没有 */ }
          return {
            src: it && typeof it.src === 'string' ? it.src : '',
            dst: it && typeof it.dst === 'string' ? it.dst : '',
            dict
          }
        })
        .filter((it) => it.dst)
      return { ok: true, from: String(res.from || from || ''), to: String(res.to || to || ''), items }
    } catch (e) {
      // 把真实原因（DNS/连接拒绝/证书/HTTP 状态等）带给渲染层，别笼统报"网络失败"
      const detail = String((e && (e.message || e.code)) || e || 'unknown').slice(0, 120)
      const isTimeout = /timeout|ETIMEDOUT/i.test(detail) || (e && e.code === 'ETIMEDOUT')
      return { ok: false, code: isTimeout ? 'TIMEOUT' : 'NETWORK', msg: detail }
    }
  }
}
