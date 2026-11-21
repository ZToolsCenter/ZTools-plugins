/**
 * 宿主 API 封装层。
 *
 * preload（src-ztools/preload/services.js）暴露 window.services：
 *   - loadCreds / saveCreds / clearCreds —— 密钥的加密存取（secretKey 不出 preload）
 *   - translate —— 百度翻译请求（签名与 HTTPS 全在 Node 侧）
 *   - maxQueryBytes / ready
 *
 * 浏览器直接访问 localhost:5173 时没有 preload，自动切换到 mock：
 * 凭证明文存 localStorage（仅开发）、翻译返回假数据，保证 UI 可独立调试。
 *
 * @author yhx
 */

import type { CredsInfo, HistoryItem, SaveResult, TranslateResult } from './types'

interface Services {
  ready(): boolean
  maxQueryBytes(): number
  loadCreds(): CredsInfo | null
  saveCreds(appId: string, secretKey: string): SaveResult
  clearCreds(): SaveResult
  translate(text: string, from: string, to: string): Promise<TranslateResult>
}

const isHost = () =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as { services?: Services }).services !== 'undefined'
export const isDevMock = () => !isHost()

function realServices(): Services {
  return (window as unknown as { services: Services }).services
}

/* ------------------------------------------------------------------ */
/* 通用宿主能力                                                        */
/* ------------------------------------------------------------------ */

export const host = {
  ready(): boolean {
    try {
      return realServices().ready()
    } catch {
      return false
    }
  },

  maxQueryBytes(): number {
    try {
      return realServices().maxQueryBytes() || 6000
    } catch {
      return 6000
    }
  },

  loadCreds(): CredsInfo | null {
    try {
      return realServices().loadCreds()
    } catch {
      return null
    }
  },

  saveCreds(appId: string, secretKey: string): SaveResult {
    try {
      return realServices().saveCreds(appId, secretKey)
    } catch {
      return { ok: false, reason: 'ENCRYPT_FAIL' }
    }
  },

  clearCreds(): SaveResult {
    try {
      return realServices().clearCreds()
    } catch {
      return { ok: false }
    }
  },

  async translate(text: string, from: string, to: string): Promise<TranslateResult> {
    // preload 端 window.services.translate 的实参是对象形态，这里做一次适配
    const raw = realServices() as unknown as {
      translate(a: { text: string; from: string; to: string }): Promise<TranslateResult>
    }
    return raw.translate({ text, from, to })
  },
  /** 翻译结果写回系统剪贴板（优先宿主，浏览器开发环境用 navigator.clipboard 兜底） */
  async copy(text: string): Promise<boolean> {
    try {
      const zt = (window as unknown as Record<string, any>).ztools
      if (zt?.clipboard?.writeContent) {
        const res = await zt.clipboard.writeContent({ type: 'text', content: text })
        return (res as { success?: boolean } | null)?.success !== false
      }
    } catch { /* 走浏览器兜底 */ }
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },

  /** 用系统浏览器打开百度翻译开放平台（申请密钥用） */
  openConsole(): void {
    const url = 'https://fanyi-api.baidu.com/'
    try {
      const zt = (window as unknown as Record<string, any>).ztools
      if (typeof zt?.shellOpenExternal === 'function') {
        zt.shellOpenExternal(url)
        return
      }
    } catch { /* 走兜底 */ }
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  toast(message: string): void {
    try {
      void (window as unknown as Record<string, any>).ztools?.showToast?.(message)
    } catch {
      console.info('[toast]', message)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 浏览器开发 mock                                                     */
/* ------------------------------------------------------------------ */

const MOCK_CREDS_KEY = 'y-translate:dev-creds'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 假词典：覆盖 mock 调试时常见输入，其他输入返回"伪翻译" */
const MOCK_DICT: Record<string, string> = {
  'hello': '你好',
  'hello world': '你好，世界',
  'thank you': '谢谢',
  'good morning': '早上好'
}

/** 单词查询的 mock 词典数据（模拟百度 dict 字段结构，供浏览器预览词典卡片） */
function mockDict(word: string): unknown {
  const w = word.toLowerCase()
  return {
    word_result: {
      simple_means: {
        word_name: w,
        word_means: [`${w}：用于问候的感叹词`, '（开发模式示例数据）'],
        tags: { core: ['高考', 'CET4', '考研'], other: [''] },
        exchange: {
          word_pl: [w + 's'],
          word_third: [w + 's'],
          word_past: [w + 'ed'],
          word_done: [w + 'ed'],
          word_ing: [w + 'ing']
        },
        symbols: [
          {
            ph_en: 'həˈləʊ',
            ph_am: 'həˈloʊ',
            ph_other: '',
            parts: [
              { part: 'int.', means: ['喂；哈罗（用于问候、接电话或引起注意）'] },
              { part: 'n.', means: ['问候，招呼'] },
              { part: 'vi.', means: ['喊"喂"'] }
            ]
          }
        ]
      },
      edict: {
        item: [
          {
            pos: 'noun',
            tr_group: [
              {
                tr: ['an expression of greeting'],
                example: ['every morning they exchanged polite hellos'],
                similar_word: ['hullo', 'hi', 'howdy']
              }
            ]
          }
        ]
      }
    }
  }
}

const mock: Services = {
  ready() {
    return false
  },
  maxQueryBytes() {
    return 6000
  },
  loadCreds() {
    try {
      const raw = localStorage.getItem(MOCK_CREDS_KEY)
      const obj = raw ? JSON.parse(raw) : null
      return obj ? { appId: String(obj.appId), hasSecret: true } : null
    } catch {
      return null
    }
  },
  saveCreds(appId, secretKey) {
    if (!String(appId).trim()) return { ok: false, reason: 'APPID_REQUIRED' }
    if (!String(secretKey).trim() && !this.loadCreds()) return { ok: false, reason: 'SECRET_REQUIRED' }
    localStorage.setItem(MOCK_CREDS_KEY, JSON.stringify({ appId: String(appId).trim(), hasSecret: true }))
    return { ok: true }
  },
  clearCreds() {
    localStorage.removeItem(MOCK_CREDS_KEY)
    return { ok: true }
  },
  /** mock 单一假数据源，词典卡片也能在浏览器里演示 */
  async translate(text: string, from: string, to: string): Promise<TranslateResult> {
    await sleep(400)
    const q = String(text ?? '').trim()
    if (!q) return { ok: false, code: 'EMPTY_INPUT' }
    if (!this.loadCreds()) return { ok: false, code: 'NO_CONFIG' }
    // 多条（按换行切）时逐条给结果，模拟百度 trans_result 数组形态
    const lines = q.split('\n').filter(Boolean)
    return {
      ok: true,
      from: from === 'auto' ? (/[一-龥]/.test(q) ? 'zh' : 'en') : from,
      to,
      items: lines.map((line) => {
        const w = line.toLowerCase()
        const base = { src: line, dst: MOCK_DICT[w] ?? `〔开发模式〕${line}` }
        // 单个英文单词时附带词典数据，让词典卡片在浏览器里也能演示
        if (/^[a-z]+$/.test(w)) {
          return { ...base, dict: mockDict(w) }
        }
        return base
      })
    }
  }
}

/** 统一出口：宿主走 host 适配层（负责把三参数调用转成 preload 的对象实参），
 * 浏览器开发走 mock。**不能直接暴露 realServices()**——它的 translate
 * 收对象参数，渲染层按三参数调用会全部解构出 undefined（表现为永远
 * 提示"请输入要翻译的内容"）。
 */
export const api: Services & {
  copy(t: string): Promise<boolean>
  openConsole(): void
  toast(m: string): void
} = isHost() ? (host as never) : (mock as never)

/* ------------------------------------------------------------------ */
/* 历史记录持久化（宿主 dbStorage / 浏览器 localStorage）                */
/* ------------------------------------------------------------------ */

const HIST_KEY = 'baidu-translate:history'
const HIST_LIMIT = 50

function rawStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (isHost()) return (window as unknown as Record<string, any>).ztools.dbStorage
  return localStorage
}

export const historyStore = {
  load(): HistoryItem[] {
    try {
      const raw = rawStorage().getItem(HIST_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  },

  save(list: HistoryItem[]): void {
    try {
      rawStorage().setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_LIMIT)))
    } catch { /* 存储失败静默 */ }
  },

  clear(): void {
    try {
      rawStorage().removeItem(HIST_KEY)
    } catch { /* 忽略 */ }
  }
}

// mock 下把宿主能力也补成开发形态，UI 无需分叉
if (isDevMock()) {
  ;(api as unknown as Record<string, unknown>).copy = async (t: string) => {
    await navigator.clipboard.writeText(t).catch(() => {})
    console.info('[toast] 已复制（开发模式）:', t)
    return true
  }
  ;(api as unknown as Record<string, unknown>).openConsole = () => {
    console.info('[toast] 开发模式：此处会打开 https://fanyi-api.baidu.com/')
  }
  ;(api as unknown as Record<string, unknown>).toast = (m: string) => console.info('[toast]', m)
}
