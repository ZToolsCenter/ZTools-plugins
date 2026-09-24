// Cookie 工具（纯函数，可独立测试）
// 对标开源阅读（Legado）CookieStore / CookieManager.mergeCookies 的语义：
//   - cookie 字符串 ↔ name=value 映射
//   - 多段 cookie 合并时后者覆盖前者
//   - Set-Cookie 响应头解析为可复用的 cookie 串

/** "a=1; b=2; c=3" → { a:'1', b:'2', c:'3' }（兼容无分号、全角分号） */
export function cookieToMap(cookie: string | undefined | null): Record<string, string> {
  const map: Record<string, string> = {}
  if (!cookie) return map
  for (const part of String(cookie).split(/[;；]/)) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq <= 0) continue
    const key = seg.slice(0, eq).trim()
    if (!key) continue
    map[key] = seg.slice(eq + 1).trim()
  }
  return map
}

/** { a:'1', b:'2' } → "a=1; b=2" */
export function mapToCookie(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** 多段 cookie 合并（按顺序，后者覆盖前者同名项），返回合并后的 cookie 串 */
export function mergeCookies(...cookies: Array<string | undefined | null>): string {
  const map: Record<string, string> = {}
  for (const c of cookies) {
    if (!c) continue
    Object.assign(map, cookieToMap(c))
  }
  return mapToCookie(map)
}

/**
 * 解析 Set-Cookie 响应头（可能多条，Node headers['set-cookie'] 为数组），
 * 返回可直接用于请求的 "name=value; ..." cookie 串。
 * 跳过 HttpOnly/Secure/Path 等属性（仅取 name=value）；跳过删除型 cookie（Max-Age=0）。
 */
export function setCookiesToString(setCookies: Array<string | string[]> | string | undefined): string {
  const map: Record<string, string> = {}
  const lines: string[] = []
  if (Array.isArray(setCookies)) {
    for (const item of setCookies) {
      if (Array.isArray(item)) lines.push(...item)
      else lines.push(item)
    }
  } else if (typeof setCookies === 'string') {
    lines.push(setCookies)
  }
  for (const line of lines) {
    if (!line) continue
    // 删除型 cookie：Max-Age=0 或 Expires 已过期
    if (/\bMax-Age=0\b/i.test(line)) continue
    if (/\bExpires=\s*Thu, 01 Jan 1970/i.test(line)) continue
    const first = line.split(';')[0].trim()
    if (!first) continue
    const eq = first.indexOf('=')
    if (eq <= 0) continue
    const key = first.slice(0, eq).trim()
    if (!key || /^\$/.test(key)) continue
    map[key] = first.slice(eq + 1).trim()
  }
  return mapToCookie(map)
}

/** 从 URL 提取 cookie 归属域名（hostname，不含端口） */
export function domainOfUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    const m = /^(?:https?:\/\/)?([^/:?#]+)/i.exec(url)
    return m ? m[1] : url
  }
}
