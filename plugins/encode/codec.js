/* =========================================================================
 * codec.js —— 编码助手纯逻辑(浏览器/Node 双端,无 UI 依赖)
 *   Base64 / URL / Unicode / UUID,每个函数返回 [{ label, value }]
 * ========================================================================= */
(function () {
  'use strict'

  /* ------------------------------ Base64 ------------------------------ */
  /** UTF-8 文本 → Base64 */
  function b64Encode(text) {
    const bytes = new TextEncoder().encode(text)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }

  /** 严格校验并解码 Base64(兼容 URL-safe 与空白),失败返回 null */
  function tryBase64Decode(s) {
    const cleaned = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (!cleaned || cleaned.length % 4 === 1) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null
    try {
      const bin = atob(cleaned)
      // 回编校验,排除噪音输入(如普通英文单词)被静默"解码"
      if (btoa(bin).replace(/=+$/, '') !== cleaned.replace(/=+$/, '')) return null
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      // 必须是合法 UTF-8 文本
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (e) {
      return null
    }
  }

  function base64(text) {
    const out = []
    const decoded = tryBase64Decode(text)
    if (decoded !== null && decoded !== '') out.push({ label: 'Base64 解码', value: decoded })
    out.push({ label: 'Base64 编码', value: b64Encode(text) })
    return out
  }

  /* ------------------------------ URL ------------------------------ */
  function url(text) {
    const out = []
    if (/%[0-9a-fA-F]{2}/.test(text)) {
      try {
        const decoded = decodeURIComponent(text)
        if (decoded !== text) out.push({ label: 'URL 解码', value: decoded })
      } catch (e) {
        /* 非法转义序列,跳过解码 */
      }
    }
    out.push({ label: 'URL 编码(encodeURIComponent)', value: encodeURIComponent(text) })
    out.push({ label: 'URL 编码(encodeURI,保留 :/?&=)', value: encodeURI(text) })
    return out
  }

  /* ------------------------------ Unicode ------------------------------ */
  /** 非 ASCII 字符 → \uXXXX(代理对按两个 \uXXXX 输出) */
  function uniEscape(s) {
    let out = ''
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      out += code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : s[i]
    }
    return out
  }

  function unicode(text) {
    const out = []
    if (/\\u[0-9a-fA-F]{4}/.test(text)) {
      const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      )
      out.push({ label: 'Unicode 解码', value: decoded })
    }
    if (/[^\x00-\x7f]/.test(text)) {
      out.push({ label: 'Unicode 转义(\\uXXXX)', value: uniEscape(text) })
    }
    if (out.length === 0) {
      out.push({ label: 'Unicode 转义(纯 ASCII,无需转义)', value: text })
    }
    return out
  }

  /* ------------------------------ UUID ------------------------------ */
  function randomUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    // 兜底:标准 v4 结构
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }

  /**
   * UUID 生成。
   * @param {string} [input] 输入 2-100 的数字 N → 生成 N 个标准 UUID;否则一个 UUID 的 4 种格式
   */
  function uuid(input) {
    const n = parseInt(String(input || '').trim(), 10)
    if (n >= 2 && n <= 100) {
      return Array.from({ length: n }, (_, i) => ({
        label: 'UUID v4 #' + (i + 1),
        value: randomUUID()
      }))
    }
    const u = randomUUID()
    return [
      { label: 'UUID v4(标准小写)', value: u },
      { label: '无横线', value: u.replace(/-/g, '') },
      { label: '大写', value: u.toUpperCase() },
      { label: '大写无横线', value: u.replace(/-/g, '').toUpperCase() }
    ]
  }

  const api = { base64, url, unicode, uuid, tryBase64Decode, uniEscape, b64Encode }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.Codec = api
})()
