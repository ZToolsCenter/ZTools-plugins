import type { ClipboardRecord, ItemKind } from '../types'
import { codeLangOf, codeLines } from './code'
import { CAT_ICONS } from './icons'

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / 昨天 / MM-DD / YYYY-MM-DD */
export function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  const d = new Date(ts)
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (d.getFullYear() === new Date().getFullYear()) return md
  return `${d.getFullYear()}-${md}`
}

/** 文本预览：压掉多余空白，折叠换行 */
export function previewText(text: string, max = 240): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 路径 → 文件名（兼容 \ 与 / 两种分隔符） */
export function fileName(p: string): string {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return i >= 0 ? s.slice(i + 1) : s
}

/** 路径 → 所在目录（根目录下的文件返回根，如 "E:\" 或 "/"） */
export function fileDir(p: string): string {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  if (i < 0) return ''
  let dir = s.slice(0, i)
  // "E:\a.txt" → 目录是盘符根 "E:\"，不能切成 "E:"
  if (/^[A-Za-z]:$/.test(dir)) dir += '\\'
  else if (dir === '') dir = s[0] === '/' ? '/' : '\\'
  return dir
}

/**
 * 长路径折叠：只保留"盘符 + 省略号 + 末尾几层目录"。
 *
 * 文件名已经在前面单独显示，所以这里真正的信息量在末尾那几层目录；
 * 若保留开头（如 "D:\Users\someone\…"）反而会把最有用的一段挤掉，
 * 而末尾被截断时连 CSS 省略号都救不回来（CSS 只能截尾、不能截头）。
 */
export function shrinkPath(p: string, max = 40): string {
  const s = String(p)
  if (s.length <= max) return s
  const head = /^[A-Za-z]:[\\/]/.test(s) ? s.slice(0, 3) : s.slice(0, 1)
  const tailLen = Math.max(8, max - head.length - 1)
  return head + '…' + s.slice(Math.max(head.length, s.length - tailLen))
}

/** 字节数描述（文件/图片大小如有） */
export function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 类型元信息。
 * `icon` 现在指向 PNG 素材（原来是一段 SVG path）—— 列表项的类型标识与
 * 侧栏分类共用同一套图标，避免同一类型出现两套图形。
 */
export const KIND_META: Record<ItemKind, { label: string; color: string; icon: string }> = {
  text: { label: '文本', color: 'var(--c-text)', icon: CAT_ICONS.text },
  link: { label: '链接', color: 'var(--c-link)', icon: CAT_ICONS.link },
  code: { label: '代码', color: 'var(--c-code)', icon: CAT_ICONS.code },
  color: { label: '颜色', color: 'var(--c-color)', icon: CAT_ICONS.color },
  image: { label: '图片', color: 'var(--c-image)', icon: CAT_ICONS.image },
  file: { label: '文件', color: 'var(--c-file)', icon: CAT_ICONS.file }
}

/** 颜色色板展示（#hex 记录） */
export function isHexColor(t: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t.trim())
}

/**
 * 把一段文本规范成"能交给系统浏览器打开"的网址，不能打开时返回 null。
 *
 * 只放行 http/https（外加裸 `www.` 自动补协议）：
 * `file://`、`data:`、`javascript:` 等协议交给 shell 打开是有风险的，
 * 而且剪贴板内容不可信 —— 宁可不开，也不能把危险协议递出去。
 * 另外要求整串无空白（"整段就是一个网址"才给入口），
 * 避免把一段含 URL 的散文也当成链接。
 */
export function webUrlOf(text: string): string | null {
  const t = String(text ?? '').trim()
  if (!t || /\s/.test(t)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // 至少要有个像样的主机（"https://" 后面什么都没有时 host 为空；
    // 单个单词如 "abc" 不是域名，浏览器只会拿它去搜索，不给入口）
    const host = u.hostname
    const solid = host === 'localhost' || host.includes('.') || host.startsWith('[')
    if (!host || !solid) return null
    return u.href
  } catch {
    return null
  }
}

/** 记录的次级说明文案（空串表示不显示） */
export function recordMeta(r: ClipboardRecord): string {
  if (r.kind === 'image') {
    // 宿主提供分辨率（"W * H"）与来源应用时展示：1920×1080 · 来自 Chrome
    const parts: string[] = []
    const m = r.resolution?.match(/^(\d+)\s*\*\s*(\d+)$/)
    if (m) parts.push(`${m[1]}×${m[2]}`)
    if (r.appName) parts.push(r.appName)
    return parts.join(' · ')
  }
  if (r.kind === 'file' && r.files) return `${r.files.length} 个文件`
  if (r.kind === 'color') return '颜色值'
  if (r.kind === 'link') return hostname(r.content)
  if (r.kind === 'code') {
    // 代码块自身已带语言与行数标签，这里只是给兜底场景（收藏快照等）用的文案
    const lang = codeLangOf(r.content)
    const n = codeLines(r.content).length
    return [lang, n > 1 ? `${n} 行` : '代码片段'].filter(Boolean).join(' · ')
  }
  return `${r.content.length} 字符`
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.split('/')[2] || url
  }
}
