/**
 * 宿主适配：uTools / ZTools / 浏览器
 *
 * 两个宿主的 API 名字一致，但注入的全局对象不同：
 *   uTools  注入 window.utools
 *   ZTools  注入 window.ztools
 *
 * 两个坑必须一起处理：
 *  1) preload 可能在宿主注入全局对象「之前」执行（uTools 尤其如此），
 *     这时候直接读 window.utools 是 undefined，若把 undefined 当结论，
 *     后面所有 window.ztools.xxx 都会炸，preload 直接中断 —— 表现就是
 *     设置面板、Git 面板全都打不开。
 *  2) 两个宿主的 API 并非完全同集，缺某个方法时不能让调用方 TypeError。
 *
 * 所以这里不写死别名，而是装一个惰性代理：读取时才去 window.utools /
 * window.ztools 找真实对象，找不到就返回 no-op 并记一笔，等宿主注入后
 * 同一个代理立刻恢复正常。
 */

const RAW_U = (typeof window !== 'undefined' && window.utools) || null
const RAW_Z = (typeof window !== 'undefined' && window.ztools) || null
const PROXY_TAG = '__cmark_host_proxy__'

/** 真实的宿主对象（排除我们自己的代理） */
function target() {
  try {
    const u = window.utools
    const z = window.ztools
    if (u && !u[PROXY_TAG]) return u
    if (z && !z[PROXY_TAG]) return z
    return null
  } catch (e) {
    return null
  }
}

function makeProxy() {
  const missing = new Set()
  const p = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === PROXY_TAG) return true
        const t = target() || RAW_U || RAW_Z
        if (!t) {
          // 宿主还没注入：函数类先给 no-op，避免 preload 在早期就崩掉
          return function () { return undefined }
        }
        const v = t[prop]
        if (typeof v === 'function') return v.bind(t)
        if (v === undefined) {
          missing.add(String(prop))
          return function () { return undefined }
        }
        return v
      },
      has(_, prop) {
        const t = target() || RAW_U || RAW_Z
        return !!t && prop in t
      },
    }
  )
  try {
    Object.defineProperty(p, '__missing', { value: missing, enumerable: false })
  } catch (e) {}
  return p
}

let proxy = null

/**
 * 装 shim：缺哪个补哪个（只在缺失时补，不覆盖宿主原对象）。
 * 返回值就是当前识别到的宿主名。
 */
function applyHostShim() {
  try {
    if (typeof window === 'undefined') return 'node'
    if (!window.utools && !window.ztools) {
      proxy = makeProxy()
      window.ztools = proxy
      window.utools = proxy
    } else {
      if (!window.utools) window.utools = window.ztools
      if (!window.ztools) window.ztools = window.utools
    }
    // 每次读取时重新判断，宿主晚注入也能正确反映
    try {
      Object.defineProperty(window, '__CMARK_HOST', {
        configurable: true,
        get() { return detect() },
      })
    } catch (e) {
      window.__CMARK_HOST = detect()
    }
    return detect()
  } catch (e) {
    return 'browser'
  }
}

function detect() {
  // 关键：shim 之后 window.utools 与 window.ztools 是同一个对象，
  // 不能拿「是谁」判断，必须用 shim 之前的快照 RAW_U / RAW_Z。
  if (RAW_U && !RAW_Z) return 'utools'
  if (RAW_Z && !RAW_U) return 'ztools'
  // 宿主晚注入的情形：看实时注入的对象里哪个是真实的（非我们的代理）
  const u = window.utools
  const z = window.ztools
  const realU = u && !u[PROXY_TAG]
  const realZ = z && !z[PROXY_TAG]
  if (realU && !realZ) return 'utools'
  if (realZ && !realU) return 'ztools'
  return 'browser'
}

function hostApi() {
  return target() || RAW_U || RAW_Z || null
}

function isInHost() {
  return !!hostApi()
}

/** 哪些方法宿主没提供过（用于排查，不抛错） */
function missingMethods() {
  if (proxy && proxy.__missing) return Array.from(proxy.__missing)
  return []
}

module.exports = { detect, applyHostShim, hostApi, isInHost, missingMethods, target }
