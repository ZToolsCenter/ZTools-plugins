export interface ProbeResult {
  url: string
  ok: boolean
  status?: number
  method?: 'HEAD' | 'GET'
  reason?: 'invalid_url' | 'unsupported_protocol' | 'template' | 'timeout' | 'error'
  elapsed: number
}


// Use lazy checks for node modules
const getNodeModule = (name: string) => {
  if (typeof window !== 'undefined' && window.require) {
    try {
      return window.require(name)
    } catch {
      return null
    }
  }
  return null
}

const normalizeHttpUrl = (raw: string): { url: string; reason?: ProbeResult['reason'] } => {
  const input = raw.trim()
  if (!input) return { url: raw, reason: 'invalid_url' }
  if (/{[^}]+}/.test(input)) return { url: raw, reason: 'template' }
  if (/^javascript:/i.test(input) || /^file:/i.test(input)) return { url: raw, reason: 'unsupported_protocol' }
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url: raw, reason: 'unsupported_protocol' }
    return { url: u.toString() }
  } catch {
    return { url: raw, reason: 'invalid_url' }
  }
}

/** 从 gooseWeb 抛错信息里尽量取出 HTTP 状态码（非 2xx 会 reject）。 */
const statusFromGooseWebError = (error: unknown): number | null => {
  const message = error instanceof Error ? error.message : String(error || '')
  const match = /HTTP\s+(\d{3})/i.exec(message)
  if (!match) return null
  const status = Number(match[1])
  return Number.isFinite(status) ? status : null
}

/** 优先 gooseWeb GET（代理感知，无 HEAD）；失败再 require/fetch。 */
const probeViaGooseWeb = async (
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; status?: number } | null> => {
  if (typeof window === 'undefined' || !window.gooseWeb?.fetchText) return null
  try {
    const result = await window.gooseWeb.fetchText(url, {
      timeoutMs,
      maxBytes: 64 * 1024
    })
    const status = result.status
    return { ok: result.ok && status >= 200 && status < 400, status }
  } catch (error) {
    const status = statusFromGooseWebError(error)
    if (status != null) {
      return { ok: status >= 200 && status < 400, status }
    }
    return null
  }
}

const nodeRequest = (url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<any> => {
  return new Promise((resolve) => {
     const https = getNodeModule('https')
     const http = getNodeModule('http')
     if (!https || !http) {
       // Browser fallback
       const controller = new AbortController()
       const timer = setTimeout(() => controller.abort(), timeoutMs)
       fetch(url, { method, signal: controller.signal })
         .then(res => {
            clearTimeout(timer)
            resolve(res)
         })
         .catch(() => {
            clearTimeout(timer)
            resolve(null)
         })
       return
     }

     try {
       const u = new URL(url)
       const requestModule = u.protocol === 'http:' ? http : https
       const opts = {
         method,
         headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
         },
         timeout: timeoutMs
       }
       const req = requestModule.request(url, opts, (res: any) => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode })
          req.destroy()
       })
       req.on('error', () => resolve(null))
       req.on('timeout', () => {
         req.destroy()
         resolve(null)
       })
       req.end()
     } catch {
       resolve(null)
     }
  })
}

export const probeUrl = async (url: string, timeoutMs = 3000): Promise<ProbeResult> => {
  const normalized = normalizeHttpUrl(url)
  if (normalized.reason) {
    return { url, ok: false, elapsed: 0, reason: normalized.reason }
  }
  const target = normalized.url

  const started = performance.now()

  // gooseWeb 仅 GET：一次探测即可，不必再 HEAD
  const viaGoose = await probeViaGooseWeb(target, timeoutMs)
  if (viaGoose) {
    return {
      url,
      ok: viaGoose.ok,
      status: viaGoose.status,
      method: 'GET',
      elapsed: performance.now() - started
    }
  }

  const head = await nodeRequest(target, 'HEAD', timeoutMs)
  if (head?.ok) {
    return { url, ok: true, status: head.status, method: 'HEAD', elapsed: performance.now() - started }
  }
  const shouldTryGet = !head || head.status === 405
  if (!shouldTryGet) {
    return {
      url,
      ok: false,
      status: head?.status,
      method: 'HEAD',
      elapsed: performance.now() - started
    }
  }

  // 总预算制：GET 的超时 = 剩余预算，不足 300ms 则直接返回超时，避免最坏 2× timeout
  const remaining = timeoutMs - (performance.now() - started)
  if (remaining < 300) {
    return { url, ok: false, elapsed: performance.now() - started, method: 'GET', reason: 'timeout' }
  }
  const get = await nodeRequest(target, 'GET', remaining)
  const elapsed = performance.now() - started
  if (!get) return { url, ok: false, elapsed, method: 'GET', reason: 'timeout' }
  return { url, ok: get.ok, status: get.status, elapsed, method: 'GET' }
}
