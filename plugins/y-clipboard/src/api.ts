import type { ClipboardRecord, FavoriteSnapshot, PageResult } from './types'

/**
 * 宿主 API 封装层。
 *
 * 宿主 getHistory / search 的返回结构文档未给出精确字段，
 * 这里做一层防御性归一化：无论返回 {list} / {rows} / {items} / {data}
 * 还是裸数组，统一收敛成 ClipboardRecord[]。
 *
 * 浏览器直接访问 localhost:5173 时无 window.ztools，
 * 自动切换到 mock 数据，保证 UI 可以独立开发调试。
 */

const isHost = () => typeof window !== 'undefined' && typeof window.ztools !== 'undefined'
export const isDevMock = () => !isHost()

/** 宿主子输入框回调参数 → 文本（兼容 { text } 对象与裸字符串两种实现） */
function extractSubInputText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object') {
    const t = (payload as Record<string, unknown>).text
    if (typeof t === 'string') return t
  }
  return ''
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function djb2(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return 'h' + h.toString(36) + str.length.toString(36)
}

export function contentId(kind: string, content: string): string {
  return djb2(kind + '\u0000' + content)
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
    const d = new Date(v).getTime()
    if (!Number.isNaN(d)) return d
  }
  return 0
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** 图片路径 → 可显示 src（data: 原样；绝对路径转 file://） */
export function toImgSrc(p: string): string {
  if (!p) return ''
  if (/^(data:|https?:|file:)/i.test(p)) return p
  const norm = p.replace(/\\/g, '/')
  return 'file://' + (norm.startsWith('/') ? '' : '/') + encodeURI(norm)
}

/* ------------------------------------------------------------------ */
/* 分类判定                                                            */
/* ------------------------------------------------------------------ */

const CODE_HINTS = [
  'function ', 'const ', 'let ', '=>', 'import ', 'export ', 'class ',
  'return ', 'console.', '<?php', '</', 'SELECT ', 'def ', 'async ',
  '{', '}', '();'
]

/** 常见命令行的首个词 */
const CMD_RE =
  /^\s*(sudo\s+)?(npm|pnpm|yarn|npx|git|docker|docker-compose|cd|ls|dir|mkdir|rm|cp|mv|cat|echo|curl|wget|ssh|scp|chmod|chown|kill|ps|grep|find|tar|zip|unzip|python3?|pip3?|node|java|mvn|gradle|gcc|make|vim|code)\b/

/**
 * 是否是命令行。
 *
 * 判据是"整行以命令开头"，而不是"句子里出现过 npm/git" ——
 * 后者会把"我刚用 npm 装了个包，然后 git 提交"这种散文错判成代码。
 * 另外要求行内带参数或连接符，避免把孤零零一个 "cd" 当成代码。
 */
export function looksLikeShell(text: string): boolean {
  const t = String(text ?? '')
  if (t.trim().length < 8) return false
  return t.split('\n').some((line) => {
    const s = line.trim()
    if (!CMD_RE.test(line)) return false
    return /&&|\|\||\||\s--|\s-\w|\s\S+/.test(s)
  })
}

export function detectKind(text: string): Exclude<ClipboardRecord['kind'], 'image' | 'file'> {
  const t = text.trim()
  if (!t) return 'text'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return 'color'
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return 'link'
  if (t.length >= 24) {
    const hits = CODE_HINTS.reduce((n, h) => (t.includes(h) ? n + 1 : n), 0)
    if (hits >= 2) return 'code'
  }
  if (looksLikeShell(t)) return 'code'
  return 'text'
}

/* ------------------------------------------------------------------ */
/* 归一化                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 图片识别                                                            */
/* ------------------------------------------------------------------ */

/** 常见的图片字段名（不同版本宿主可能用其中任意一个） */
const IMAGE_KEYS = [
  // 官方宿主（clipboardManager）的真实字段：image 保存的本地路径
  'imagePath', 'image_path',
  'thumbnail', 'thumb', 'image', 'img', 'picture', 'imageData', 'imageBase64',
  'dataUrl', 'dataURL', 'dataurl', 'preview', 'cover', 'bitmap', 'bitmapData',
  'source', 'base64',
  // 宿主也可能直接给本地路径
  'path', 'filePath', 'localPath', 'absPath'
]
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|ico|svg|tiff?)$/i
const HTTP_IMAGE = /^https?:\/\/\S*\.(png|jpe?g|gif|webp|bmp|svg)(\?\S*)?$/i
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const BASE64_MAGIC: Array<[string, string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
  ['Qk0', 'image/bmp'],
  ['PHN2Z', 'image/svg+xml']
]

/** 裸 base64（无 data: 前缀）→ data URL；不是图片数据返回 null */
export function base64ToDataUrl(v: string): string | null {
  const t = v.replace(/\s/g, '')
  if (t.length < 128 || !BASE64_RE.test(t)) return null
  const mime = BASE64_MAGIC.find(([sig]) => t.startsWith(sig))?.[1]
  return mime ? `data:${mime};base64,${t}` : null
}

function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v
  if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return new Uint8Array(v)
  return null
}

const MAGIC_BYTES: Array<[number[], string]> = [
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46], 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
  [[0x42, 0x4d], 'image/bmp']
]

/** 二进制字节 → data URL（按魔数判图片类型） */
export function bytesToDataUrl(u8: Uint8Array): string {
  const mime = MAGIC_BYTES.find(([sig]) => sig.every((b, i) => u8[i] === b))?.[1] ?? 'image/png'
  let s = ''
  const step = 0x8000
  for (let i = 0; i < u8.length; i += step) {
    s += String.fromCharCode(...Array.from(u8.subarray(i, i + step)))
  }
  // 渲染进程里一定有 btoa，不需要 Buffer 兜底
  return `data:${mime};base64,${btoa(s)}`
}

interface ImageHit {
  src: string
  /** strong = 值本身就是图片数据（data URL / base64 / 二进制 / 网络图片） */
  strong: boolean
}

/** 单个值能否作为图片来源 */
function imageFromValue(v: unknown): ImageHit | null {
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    if (/^data:image/i.test(t)) return { src: t, strong: true }
    const fromB64 = base64ToDataUrl(t)
    if (fromB64) return { src: fromB64, strong: true }
    if (HTTP_IMAGE.test(t)) return { src: t, strong: true }
    if (IMAGE_EXT.test(t)) return { src: t, strong: false } // 本地图片路径
    return null
  }
  const u8 = asBytes(v)
  if (u8 && u8.length > 16) return { src: bytesToDataUrl(u8), strong: true }
  return null
}

/** 逐层找图片：先按字段名，再退化为扫描所有字段的值 */
function detectImage(o: Record<string, unknown>, rawType: string): ImageHit | null {
  // type 明确是文件：交给文件分支处理，避免单张图片文件被抢进图片分类
  if (/\b(files?)\b/i.test(rawType)) return null

  const typeSaysImage = /\b(image|img|picture|bitmap)/i.test(rawType)

  for (const k of IMAGE_KEYS) {
    if (!(k in o)) continue
    const hit = imageFromValue(o[k])
    if (hit) return hit
  }

  for (const k of Object.keys(o)) {
    const hit = imageFromValue(o[k])
    if (hit && hit.strong) return hit
  }

  // type 明确是图片但取不到内容 → 仍判定为图片（占位显示，便于排查）
  if (typeSaysImage) return { src: '', strong: true }
  return null
}

let warnedOnce = false

function warnUnrecognized(raw: unknown, why: string): void {
  if (warnedOnce) return
  warnedOnce = true
  try {
    console.warn(
      '[y-clipboard] 有记录未能识别（' + why + '），原始结构如下，便于对齐字段：',
      JSON.parse(JSON.stringify(raw ?? null))
    )
  } catch {
    /* 忽略序列化失败 */
  }
}

export function normalizeRecord(raw: unknown): ClipboardRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const rawType = String(pick(o, ['type', 'kind', 'contentType']) ?? '').toLowerCase()

  const filesRaw = pick(o, ['files', 'paths', 'fileList', 'file'])
  let files: string[] | undefined
  if (Array.isArray(filesRaw)) {
    // 宿主官方结构：files 是对象数组 [{path, name, isDirectory, exists}]；
    // 兼容旧形态/其他宿主的字符串数组
    files = filesRaw
      .map((f) =>
        typeof f === 'string' ? f
        : f && typeof f === 'object' ? String((f as Record<string, unknown>).path ?? '') : ''
      )
      .filter(Boolean)
  } else if (typeof filesRaw === 'string' && filesRaw) {
    files = [filesRaw]
  }

  let content = ''
  let kind: ClipboardRecord['kind']

  const image = detectImage(o, rawType)

  if (image && (image.strong || !rawType.startsWith('text'))) {
    kind = 'image'
    content = image.src
    if (!content) {
      // 取不到图片数据（如宿主对超大图片只存 preview 不存 imagePath）：
      // 用预览文案兜底，行内至少能显示"[图片] 过大未保存"而不是空白
      const fallback = String(pick(o, ['preview', 'note', 'description']) ?? '')
      if (fallback) {
        content = fallback
        warnUnrecognized(raw, '图片记录无图片数据（可能过大未保存），已用预览文案兜底')
      } else {
        warnUnrecognized(raw, '判定为图片但取不到图片内容')
      }
    }
  } else if (rawType.includes('file') || (files && files.length > 0)) {
    kind = 'file'
    if (!files || files.length === 0) {
      warnUnrecognized(raw, '文件记录缺少路径')
      return null
    }
    content = files[0]
  } else {
    content = String(pick(o, ['content', 'text', 'value', 'data']) ?? '')
    if (!content) {
      // 没有任何可显示内容：保留占位而不是静默消失
      if (image) {
        kind = 'image'
        content = image.src
      } else {
        warnUnrecognized(raw, '文本记录无内容')
        return null
      }
    } else {
      kind = detectKind(content)
    }
  }

  const id = String(pick(o, ['id', '_id', 'recordId']) ?? djb2(kind + '\u0000' + content))
  const resolution = String(pick(o, ['resolution', 'imageSize', 'size']) ?? '')

  return {
    id,
    kind,
    rawType: rawType || 'unknown',
    content,
    files,
    resolution: kind === 'image' && /^\d+\s*\*\s*\d+$/.test(resolution) ? resolution : undefined,
    appName: typeof o.appName === 'string' && o.appName ? o.appName : undefined,
    preview: typeof o.preview === 'string' && o.preview ? o.preview : undefined,
    createdAt: toNum(pick(o, ['createdAt', 'createAt', 'time', 'timestamp', 'date', 'updated_at'])),
    raw
  }
}

function extractList(res: unknown): unknown[] {
  if (Array.isArray(res)) return res
  if (res && typeof res === 'object') {
    const o = res as Record<string, unknown>
    for (const k of ['list', 'rows', 'items', 'data', 'records', 'result']) {
      if (Array.isArray(o[k])) return o[k]
    }
    // { success, data: { list } } 双层结构
    if (o.data && typeof o.data === 'object') return extractList(o.data)
  }
  return []
}

function toRecords(res: unknown): ClipboardRecord[] {
  return extractList(res)
    .map(normalizeRecord)
    .filter((r): r is ClipboardRecord => r !== null)
}

/**
 * 官方 getHistory 返回 {items, total, page, pageSize}；
 * host 与 mock 共用这一条归一化路径，保证开发模式验证的就是生产行为。
 */
function normalizeHistory(res: unknown, page: number, pageSize: number): PageResult {
  const items = toRecords(res)
  const total = Number((res as Record<string, unknown> | null)?.total ?? 0)
  const hasMore = total > 0 ? page * pageSize < total : items.length >= pageSize
  return { items, hasMore, total }
}

/* ------------------------------------------------------------------ */
/* 宿主 API                                                            */
/* ------------------------------------------------------------------ */

export const host = {
  async getHistory(page: number, pageSize: number): Promise<PageResult> {
    const res = await (window.ztools as any).clipboard.getHistory(page, pageSize)
    return normalizeHistory(res, page, pageSize)
  },

  async search(keyword: string): Promise<ClipboardRecord[]> {
    const res = await (window.ztools as any).clipboard.search(keyword)
    return toRecords(res)
  },

  async remove(id: string): Promise<boolean> {
    const res = await (window.ztools as any).clipboard.delete(id)
    return !res || (res as any).success !== false
  },

  /** 写回剪贴板（默认同时模拟粘贴到之前焦点窗口） */
  async write(id: string, paste = true): Promise<void> {
    await (window.ztools as any).clipboard.write(id, paste)
  },

  /** 按内容写剪贴板（收藏快照等无宿主 id 的场景） */
  async writeContent(
    type: 'text' | 'image' | 'file',
    content: string | string[],
    paste = true
  ): Promise<void> {
    await (window.ztools as any).clipboard.writeContent({ type, content }, paste)
  },

  async clear(): Promise<number> {
    const res = await (window.ztools as any).clipboard.clear()
    return Number((res as any)?.count ?? 0)
  },

  onChange(cb: () => void): void {
    ;(window.ztools as any).clipboard.onChange(cb)
  },

  outPlugin(): void {
    void (window.ztools as any).outPlugin?.()
  },

  /**
   * 插件进入事件。**每次**打开插件都会触发（插件页面可能被缓存复用，mount 只跑一次），
   * 且宿主带"粘性"：晚注册也能补收到最近一次 enter（见宿主 preload 的 pendingEnterPayload）。
   */
  onPluginEnter(cb: (payload: unknown) => void): boolean {
    const zt = window.ztools as any
    if (typeof zt?.onPluginEnter !== 'function') return false
    try {
      zt.onPluginEnter(cb)
      return true
    } catch {
      return false
    }
  },

  onPluginOut(cb: (processExit: boolean) => void): void {
    const zt = window.ztools as any
    try {
      if (typeof zt?.onPluginOut === 'function') zt.onPluginOut(cb)
    } catch {
      /* 生命周期回调缺失不影响主流程 */
    }
  },

  /** 聚焦宿主子输入框（主进程实现：窗口取焦 + 通知渲染层 focus-sub-input） */
  focusSubInput(): boolean {
    const zt = window.ztools as any
    if (typeof zt?.subInputFocus !== 'function') return false
    try {
      return zt.subInputFocus() === true
    } catch {
      return false
    }
  },

  /** 聚焦子输入框并全选内容（已有关键词时用这个，避免新输入被拼到旧词后面） */
  selectSubInput(): boolean {
    const zt = window.ztools as any
    if (typeof zt?.subInputSelect !== 'function') return false
    try {
      return zt.subInputSelect() === true
    } catch {
      return false
    }
  },

  /**
   * 在文件管理器中定位文件。
   *
   * 优先走宿主官方 API shellShowItemInFolder（它能真正选中文件）；
   * 老版本宿主没有该 API 时，退回 preload 的 spawn 兜底实现。
   * 两条路都失败返回 false，由调用方提示用户。
   */
  async reveal(filePath: string): Promise<boolean> {
    const zt = window.ztools as any
    try {
      if (typeof zt?.shellShowItemInFolder === 'function') {
        zt.shellShowItemInFolder(filePath)
        return true
      }
    } catch {
      /* 宿主 API 抛错：继续走 preload */
    }
    try {
      const svc = (window as unknown as { services?: { revealInFolder?: (p: string) => boolean } }).services
      if (svc?.revealInFolder) return svc.revealInFolder(filePath) === true
    } catch {
      /* preload 缺失（浏览器开发模式） */
    }
    return false
  },

  /**
   * 用系统默认浏览器打开网址。
   *
   * 优先走宿主官方 API `shellOpenExternal`（Electron 的 shell.openExternal）；
   * 老宿主没有该 API 时退回 `window.open`（浏览器开发模式就是这条路）。
   * 只接受 http/https —— 协议过滤在调用方（utils/format 的 webUrlOf）做，
   * 这里不再重复判断，免得两处规则不一致。
   */
  openExternal(url: string): boolean {
    const zt = window.ztools as any
    try {
      if (typeof zt?.shellOpenExternal === 'function') {
        zt.shellOpenExternal(url)
        return true
      }
    } catch {
      /* 宿主 API 抛错：继续走兜底 */
    }
    try {
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      if (w) {
        w.opener = null
        return true
      }
    } catch {
      /* 被浏览器拦截（非用户手势触发时常见） */
    }
    return false
  },

  /**
   * 设置宿主子输入框（插件模式下的搜索框）。
   *
   * 签名必须是 setSubInput(onChange, placeholder, isFocus) —— 第一个参数
   * **是函数本身**，宿主内部判断 `typeof onChange === 'function'` 才会注册回调。
   * 传 { text: fn } 之类的对象会被静默忽略，表现为"打字毫无反应"。
   *
   * 回调参数是 details 对象，文本在 details.text（兼容直接传字符串的实现）。
   * @returns 是否成功注册（失败时调用方应退回页面内搜索框）
   */
  setSubInput(onChange: (text: string) => void, placeholder: string): boolean {
    const zt = window.ztools as any
    if (typeof zt.setSubInput !== 'function') return false
    zt.setSubInput((details: unknown) => onChange(extractSubInputText(details)), placeholder, true)
    return true
  },

  toast(message: string): void {
    void (window.ztools as any).showToast?.(message)
  },

  theme(): { dark: boolean; accent: string } {
    try {
      const info = (window.ztools as any).getThemeInfo?.() ?? {}
      return {
        dark: window.ztools.isDarkColors?.() ?? false,
        accent: String(info.primaryColor || '')
      }
    } catch {
      return { dark: false, accent: '' }
    }
  },

  onThemeChange(cb: () => void): void {
    ;(window.ztools as any).onThemeChange?.(cb)
  }
}

/* ------------------------------------------------------------------ */
/* 浏览器开发 mock                                                     */
/* ------------------------------------------------------------------ */

const MOCK_TEXTS: Array<[string, string]> = [
  ['text', '会议纪要：周三评审剪贴板插件交互稿，重点看键盘流是否顺'],
  ['text', '发票抬头：北京某某科技有限公司 税号 91110108MA01XXXXXX'],
  ['text', '地铁 10 号线换乘 6 号线，C 口出直走 200 米'],
  ['link', 'https://vuejs.org/guide/introduction.html'],
  ['link', 'https://github.com/vuejs/core/releases'],
  ['link', 'https://ztoolscenter.github.io/ZTools-doc/first-plugin.html'],
  ['code', 'const debounce = (fn, ms) => {\n  let t\n  return (...a) => {\n    clearTimeout(t)\n    t = setTimeout(() => fn(...a), ms)\n  }\n}'],
  ['code', 'import { createApp } from \'vue\'\nimport App from \'./App.vue\'\ncreateApp(App).mount(\'#app\')'],
  ['code', 'SELECT id, content, created_at\nFROM clipboard\nWHERE kind = \'code\'\nORDER BY created_at DESC\nLIMIT 50;'],
  ['code', 'interface Props {\n  id: number\n  name: string\n}\n\nexport function Card(props: Props) {\n  return <div className="card">{props.name}</div>\n}'],
  ['code', 'def load(path: str) -> dict:\n    with open(path, encoding="utf-8") as f:\n        return json.load(f)'],
  ['code', '{\n  "name": "y-clipboard",\n  "version": "1.0.0",\n  "main": "index.html"\n}'],
  ['code', 'npm run build && git add -A && git commit -m "feat: 代码块展示"'],
  // 超长单行：用来验证代码块横向滚动 + 全屏查看（卡片里必然放不下）
  ['code', 'const columns = [{ key: "id", title: "编号", width: 80, fixed: "left" }, { key: "content", title: "内容", width: 320, ellipsis: true }, { key: "kind", title: "类型", width: 90 }, { key: "createdAt", title: "复制时间", width: 160, sorter: true }, { key: "appName", title: "来源应用", width: 140 }];'],
  // 超过单行字符上限（会真的被截断）：用来验证"超长行已截断 · 展开看全部"提示
  ['code', '{"name":"y-clipboard","version":"1.0.0","description":"分类清晰、响应飞快的剪贴板管理插件：文本 / 链接 / 代码 / 颜色 / 图片 / 文件自动归类，支持收藏、搜索与全键盘操作，动态行高虚拟滚动，千条记录依然流畅","keywords":["ztools","clipboard","vue3","vite","typescript","虚拟滚动","语法着色","剪贴板管理"],"scripts":{"dev":"vite","build":"vue-tsc && vite build"},"dependencies":{"vue":"^3.5.13"},"devDependencies":{"vite":"^6.4.3","vue-tsc":"^2.2.0"},"repository":{"type":"git","url":"git+https://github.com/example/y-clipboard.git"},"homepage":"https://github.com/example/y-clipboard","bugs":{"url":"https://github.com/example/y-clipboard/issues"},"engines":{"node":">=20"}}'],
  ['code', '.card {\n  padding: 12px 16px;\n  border-radius: 8px;\n  background: var(--panel);\n}'],
  ['code', '/* 多行块注释\n   跨行也要保持注释色 */\nconst KEY = "value" // 行注释'],
  ['color', '#5B8DEF'],
  ['color', '#0F6E56'],
  ['text', 'ssh -p 2222 dev@10.0.0.12'],
  ['text', '取件码 8-2-3069，丰巢快递柜'],
]

/**
 * 开发用文件记录。刻意覆盖几种形态：
 *   单文件 / 多文件 / 深长路径（验证折叠）/ 已删除的文件（验证"已不存在"提示）
 */
const MOCK_FILES = [
  ['E:\\A_YSYSYSS_workspace\\y-clipboard\\src-ztools\\plugin.json'],
  ['D:\\Downloads\\设计稿-首页-v3.fig', 'D:\\Downloads\\设计稿-详情-v3.fig'],
  ['C:\\Users\\someone\\Documents\\2026 年度预算\\Q3 合并报表-final-v7.xlsx', 'C:\\Users\\someone\\Documents\\2026 年度预算\\口径说明.txt'],
  ['E:\\A_YSYSYSS_workspace\\y-clipboard\\已删除的旧归档.zip']
]

function mockSvgText(i: number, w = 480, h = 280): string {
  const hue = (i * 47) % 360
  const cx = Math.round(w * (0.2 + (i % 5) * 0.15))
  const r = Math.round(Math.min(w, h) * 0.22)
  const barW = Math.round(w * 0.84)
  const barH = Math.max(10, Math.round(h * 0.07))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="hsl(${hue},62%,72%)"/>` +
    `<circle cx="${cx}" cy="${Math.round(h / 2)}" r="${r}" fill="hsl(${(hue + 40) % 360},70%,88%)"/>` +
    `<rect x="${Math.round((w - barW) / 2)}" y="${Math.round(h * 0.78)}" width="${barW}" height="${barH}" rx="${Math.round(barH / 2)}" fill="hsl(${hue},45%,90%)"/>` +
    `</svg>`
}

/** 形态一：data URL */
function mockImage(i: number, w?: number, h?: number): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(mockSvgText(i, w, h))
}

/**
 * 用 canvas 现生成一张真实 PNG（data URL）。
 * 之前这里是 btoa(一段 SVG 文本)，看着像 base64 其实解不出图，
 * 导致开发环境永远走不到"图片正常显示"这条路径。
 */
function mockCanvasPng(i: number, w = 480, h = 280): string {
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return ''
    const hue = (i * 47) % 360
    ctx.fillStyle = `hsl(${hue},62%,72%)`
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = `hsl(${(hue + 40) % 360},70%,88%)`
    ctx.beginPath()
    ctx.arc(w * (0.2 + (i % 5) * 0.15), h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = `hsl(${hue},45%,90%)`
    const barH = Math.max(10, h * 0.07)
    ctx.fillRect(w * 0.08, h * 0.78, w * 0.84, barH)
    return c.toDataURL('image/png')
  } catch {
    return ''
  }
}

/** 形态二：裸 base64（无 data: 前缀，模拟宿主直接把图片数据扔在字段里） */
function mockBase64Image(i: number): string {
  return mockCanvasPng(i).split(',')[1] || ''
}

/** 形态三：二进制字节（模拟宿主返回 Buffer / Uint8Array） */
function pngBytes(i: number): Uint8Array {
  const b64 = mockCanvasPng(i).split(',')[1] || ''
  if (!b64) return new Uint8Array(0)
  try {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k)
    return u8
  } catch {
    return new Uint8Array(0)
  }
}

function buildMockData(): any[] {
  const out: any[] = []
  const now = Date.now()
  let fileIdx = 0

  for (let i = 0; i < 72; i++) {
    const age = (i * 23 + (i % 7) * 41) * 60 * 1000 // 分布在过去约 48h
    const ts = now - age

    // 图片：按官方 clipboardManager 的真实结构仿真，轮换覆盖各种形态
    if (i % 9 === 4) {
      const v = i % 7
      if (v === 0) {
        // 官方主形态：imagePath 本地路径 + resolution + preview + appName
        out.push({
          id: 'mock-img-path-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          appName: i % 2 ? 'Chrome' : 'Snipaste',
          imagePath: 'E:\\A_YSYSYSS_workspace\\y-clipboard\\design\\logo-a.png',
          resolution: '512 * 512', preview: '[图片] 14KB'
        })
      } else if (v === 1) {
        // 官方超大图片形态：不存 imagePath，只有 preview
        out.push({
          id: 'mock-img-big-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          appName: 'Chrome', preview: '[图片] 过大未保存 (25.30MB)'
        })
      } else if (v === 2) {
        // 竖图（手机截图）：用于验证高度限幅不被撑爆
        out.push({
          id: 'mock-img-tall-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          appName: '微信', resolution: '1080 * 1920', preview: '[图片] 186KB',
          content: mockImage(i, 1080, 1920)
        })
      } else if (v === 3) {
        // 超宽图（带鱼屏截图）：用于验证不被压成细线
        out.push({
          id: 'mock-img-wide-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          appName: 'Snipaste', resolution: '2560 * 720', preview: '[图片] 92KB',
          content: mockImage(i, 2560, 720)
        })
      } else if (v === 4) {
        // data URL 形态（浏览器直连开发时可见缩略图）
        out.push({
          id: 'mock-img-data-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          resolution: '480 * 280', preview: '[图片] 3KB', content: mockImage(i, 480, 280)
        })
      } else if (v === 5) {
        // 裸 base64 形态
        out.push({
          id: 'mock-img-b64-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          resolution: '480 * 280', content: mockBase64Image(i)
        })
      } else {
        // 二进制字节形态
        out.push({
          id: 'mock-img-bytes-' + i, type: 'image', timestamp: ts, hash: 'hi' + i,
          image: pngBytes(i)
        })
      }
      continue
    }

    if (i % 13 === 7) {
      // 官方文件形态：files 为对象数组 [{path, name, isDirectory, exists}]
      // 依次轮换 MOCK_FILES，保证各种形态（单/多/长路径/已删除）都能看到
      const group = MOCK_FILES[fileIdx++ % MOCK_FILES.length]
      const fs = group.map((p) => ({
        path: p, name: p.split('\\').pop() || p, isDirectory: false, exists: true
      }))
      out.push({
        id: 'mock-file-' + i, type: 'file', timestamp: ts, hash: 'fi' + i,
        files: fs, preview: `[文件] ${fs[0].name}`
      })
      continue
    }

    const entry = MOCK_TEXTS[i % MOCK_TEXTS.length]
    out.push({ id: 'mock-' + i, type: 'text', timestamp: ts, hash: 'ti' + i, content: entry[1] })
  }

  return out
}

let mockDb = buildMockData()

/** 开发模式下最后一次"要交给浏览器打开"的网址（见 mock.openExternal） */
let lastExternalUrl = ''
export const devLastExternalUrl = (): string => lastExternalUrl

const mock = {
  async getHistory(page: number, pageSize: number): Promise<PageResult> {
    await sleep(60)
    // 与官方 clipboardManager 相同的返回结构
    const start = (page - 1) * pageSize
    const raw = {
      items: mockDb.slice(start, start + pageSize),
      total: mockDb.length,
      page,
      pageSize
    }
    return normalizeHistory(raw, page, pageSize)
  },

  async search(keyword: string): Promise<ClipboardRecord[]> {
    await sleep(80)
    const kw = keyword.toLowerCase()
    return toRecords(
      mockDb.filter((r: any) => String(r.content ?? '').toLowerCase().includes(kw))
    )
  },

  async remove(id: string): Promise<boolean> {
    mockDb = mockDb.filter((r: any) => r.id !== id)
    return true
  },

  async write(_id: string): Promise<void> {
    mock.toast('已复制（开发模式不执行真实粘贴）')
  },

  async writeContent(): Promise<void> {
    mock.toast('已复制（开发模式不执行真实粘贴）')
  },

  async clear(): Promise<number> {
    const n = mockDb.length
    mockDb = []
    return n
  },

  onChange(_cb: () => void): void {
    /* 开发模式不监听 */
  },

  outPlugin(): void {
    mock.toast('开发模式：此处会退出插件')
  },

  /** 开发模式没有宿主可调用：如实告知动作内容，并按成功处理以走通界面流程 */
  async reveal(filePath: string): Promise<boolean> {
    mock.toast('开发模式：此处会打开资源管理器并选中 ' + filePath)
    return true
  },

  /**
   * 开发模式没有宿主 shell：不真的弹浏览器（会打断调试），改成
   * 记下最后一次要打开的网址 + toast 提示。记下来的值同时给探针/测试用
   * —— 界面上"点了没反应"和"根本没调用"是两种完全不同的 bug。
   */
  openExternal(url: string): boolean {
    lastExternalUrl = url
    // 也挂到 window 上：开发模式下没有宿主可查，界面上"点了没反应"和
    // "压根没调用"是两种 bug，探针读这个值就能区分。
    ;(window as unknown as Record<string, unknown>).__lastExternalUrl = url
    mock.toast('开发模式：此处会用浏览器打开 ' + url)
    return true
  },

  /** 开发模式没有"打开插件"这回事，立即触发一次，让聚焦逻辑也能被验证 */
  onPluginEnter(cb: (payload: unknown) => void): boolean {
    cb({ code: 'clipboard', type: 'text', payload: '', from: 'main' })
    return true
  },

  onPluginOut(_cb: (processExit: boolean) => void): void {
    /* 开发模式不监听 */
  },

  /** 开发模式没有宿主子输入框：如实返回失败，调用方退回页面内搜索框 */
  focusSubInput(): boolean {
    return false
  },

  selectSubInput(): boolean {
    return false
  },

  /** 开发模式没有宿主子输入框，返回 false 让页面显示自己的搜索框 */
  setSubInput(_onChange: (t: string) => void, _ph: string): boolean {
    return false
  },

  toast(message: string): void {
    console.info('[toast]', message)
  },

  theme(): { dark: boolean; accent: string } {
    return { dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false, accent: '#5B8DEF' }
  },

  onThemeChange(_cb: () => void): void {
    /* noop */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 统一出口：真实宿主或 mock */
export const api = isHost() ? host : mock

/* ------------------------------------------------------------------ */
/* 收藏持久化（宿主 dbStorage / mock localStorage）                     */
/* ------------------------------------------------------------------ */

const FAV_KEY = 'y-clipboard:favorites'
const FAV_LIMIT = 200

function rawStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (isHost()) return window.ztools.dbStorage as any
  return localStorage
}

export const favoritesStore = {
  load(): FavoriteSnapshot[] {
    try {
      const raw = rawStorage().getItem(FAV_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  },

  save(list: FavoriteSnapshot[]): void {
    try {
      rawStorage().setItem(FAV_KEY, JSON.stringify(list.slice(0, FAV_LIMIT)))
    } catch { /* 存储失败静默 */ }
  }
}

/* ------------------------------------------------------------------ */
/* 偏好设置持久化（图片密度等 UI 偏好）                                 */
/* ------------------------------------------------------------------ */

const PREFS_KEY = 'y-clipboard:prefs'

export const prefsStore = {
  get(key: string, fallback: string): string {
    try {
      const raw = rawStorage().getItem(PREFS_KEY)
      if (!raw) return fallback
      const v = (JSON.parse(raw) as Record<string, unknown>)[key]
      return typeof v === 'string' ? v : fallback
    } catch {
      return fallback
    }
  },

  set(key: string, value: string): void {
    try {
      const raw = rawStorage().getItem(PREFS_KEY)
      const obj: Record<string, string> = raw ? JSON.parse(raw) : {}
      obj[key] = value
      rawStorage().setItem(PREFS_KEY, JSON.stringify(obj))
    } catch { /* 存储失败静默 */ }
  }
}
