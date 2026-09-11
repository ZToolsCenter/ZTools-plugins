import { useCallback } from 'react'
import type { Bookmark } from '@/types/bookmark'
import { getTemplateLabel } from '@/lib/utils'
import { useBookmarkStore } from '@/stores/bookmark'

/**
 * uTools 特性注册 / 进入文本解析 / 窗口控制（React 版）
 * --------------------------------------------------------------------------
 * 旧版 Vue composable 内多为框架无关纯函数（图标转 dataURL、特性签名、串行注册）。
 * React 版保留全部模块级纯函数，仅把对外 API 包成 useCallback 稳定引用。
 * syncFeatures 通过 useBookmarkStore.getState() 读取最新 store（含 isBookmarkInTrash，
 * 业务阶段补齐）。
 */

const FEATURE_PREFIX = 'bm_tpl:'
/** 历史 AI 快捷保存特性码：仅用于同步时清理，不再注册 */
const LEGACY_AI_QUICK_SAVE_FEATURE_CODE = 'ai_quick_save'
const AI_AGGRESSIVE_SAVE_FEATURE_CODE = 'ai_aggressive_save'
const DYNAMIC_ENTRY_CODES = new Set([LEGACY_AI_QUICK_SAVE_FEATURE_CODE, AI_AGGRESSIVE_SAVE_FEATURE_CODE])

type OverCmd = { type: 'over'; label: string; minLength?: number; icon?: string }
type RegexCmd = { type: 'regex'; label: string; match: string; icon?: string }
type FeatureCmd = string | OverCmd | RegexCmd
type UToolsFeature = {
  code: string
  explain: string
  cmds: FeatureCmd[]
  icon?: string
  mainHide?: boolean
}

const toSvgDataUrlFromText = (text: string): string => {
  const display = text.trim() ? text.trim().slice(0, 2).toUpperCase() : '•'
  const palette = ['#0f172a', '#1f2937', '#111827', '#0b3d2e', '#3b2f2f']
  const colorIndex = Math.abs([...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % palette.length
  const bg = palette[colorIndex]
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="24" fill="${bg}"/>
      <text x="64" y="68" text-anchor="middle" font-size="56" font-weight="700" fill="#fff" font-family="system-ui, -apple-system, sans-serif">${display}</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const toDataUrlFromText = (text: string): string | null => {
  try {
    const canvas = document.createElement('canvas')
    const size = 128
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return toSvgDataUrlFromText(text)

    const palette = ['#0f172a', '#1f2937', '#111827', '#0b3d2e', '#3b2f2f']
    const colorIndex = Math.abs([...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % palette.length
    ctx.fillStyle = palette[colorIndex]
    ctx.fillRect(0, 0, size, size)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 56px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const display = text.trim() ? text.trim().slice(0, 2).toUpperCase() : '•'
    ctx.fillText(display, size / 2, size / 2)

    return canvas.toDataURL('image/png')
  } catch {
    return toSvgDataUrlFromText(text)
  }
}

// 全局缓存已处理的书签签名，避免重复处理
const processedBookmarks = new Map<string, string>()

const getIconSignature = (bookmark: Bookmark) => {
  const icon = bookmark.icon
  if (!icon) return ''
  if (icon.type === 'file') return `file:${icon.path || ''}`
  if (icon.type === 'remote') return `remote:${icon.cache || icon.src || ''}`
  if (icon.type === 'custom') return `custom:${icon.data || ''}`
  if (icon.type === 'text') return `text:${icon.value || ''}`
  return ''
}

const fetchIconAsDataUrl = async (url: string): Promise<string | null> => {
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const ensurePngBase64 = async (dataUrl: string): Promise<string> => {
  if (!dataUrl || dataUrl.startsWith('data:image/png') || dataUrl.startsWith('data:image/jpeg')) {
    return dataUrl
  }
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || 32
      canvas.height = img.naturalHeight || 32
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } else {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

const getFeatureIcon = async (bookmark: Bookmark): Promise<string | null> => {
  const icon = bookmark.icon
  if (icon) {
    if (icon.type === 'custom' && icon.data) return await ensurePngBase64(icon.data)
    if (icon.type === 'file' && icon.path) return `file://${icon.path}`
    if (icon.type === 'remote') {
      if (icon.cache) {
        if (!icon.cache.startsWith('data:image/png') && !icon.cache.startsWith('data:image/jpeg')) {
          icon.cache = await ensurePngBase64(icon.cache)
        }
        return icon.cache
      }
      if (icon.src) {
        const dataUrl = await fetchIconAsDataUrl(icon.src)
        if (dataUrl) {
          icon.cache = await ensurePngBase64(dataUrl)
          bookmark.iconMatchedAt = Date.now()
          return icon.cache
        }
      }
    }
    if (icon.type === 'text' && icon.value) {
      const textUrl = toDataUrlFromText(icon.value)
      return textUrl ? await ensurePngBase64(textUrl) : null
    }
  }
  const fallbackUrl = toDataUrlFromText(bookmark.title || bookmark.url)
  return fallbackUrl ? await ensurePngBase64(fallbackUrl) : null
}

const getBookmarkSignature = (bookmark: Bookmark) => {
  const allow = bookmark.allowUniversal ? '1' : '0'
  const title = bookmark.title || ''
  const url = bookmark.url || ''
  const iconSig = getIconSignature(bookmark)
  const iconStatus = `${bookmark.iconMatchedAt || 0}|${bookmark.iconMatchFailedAt || 0}`
  return `${allow}|${title}|${url}|${iconSig}|${iconStatus}`
}

type SyncFeatureOptions = {
  force?: boolean
  aiAggressiveSaveEnabled?: boolean
}

const getAiSaveFeature = (): UToolsFeature => ({
  code: AI_AGGRESSIVE_SAVE_FEATURE_CODE,
  explain: 'AI 快速保存：粘贴网址，自动归类入库',
  cmds: [
    'AI 快速保存',
    'AI 保存',
    'ai save',
    // 与 quick_save 的「保存到书签」并列：主搜索框粘贴 http(s) 网址时可选 AI 快速保存
    {
      type: 'regex',
      label: 'AI 快速保存',
      match: '/^https?:\\/\\/.*$/i'
    },
    // 无协议域名 / 任意粘贴文本（如 example.com）仍可走 AI 快速保存
    { type: 'over', label: 'AI 快速保存', minLength: 4 }
  ],
  mainHide: false
})

const isTemplateBookmark = (b: Bookmark) =>
  typeof b.title === 'string' && !!b.title.trim() && typeof b.url === 'string' && /{[^}]+}/.test(b.url)

const isUniversalBookmark = (b: Bookmark) => !!b.allowUniversal

const buildFeatureSetSignature = (
  bookmarks: Bookmark[],
  aiAggressiveSaveEnabled: boolean
) =>
  `${aiAggressiveSaveEnabled ? '1' : '0'}::${bookmarks
    .map((bookmark) => `${bookmark.id}:${getBookmarkSignature(bookmark)}`)
    .sort()
    .join('||')}`

let lastAppliedFeatureSetSignature = ''

const syncFeaturesOnce = async (bookmarks: Bookmark[], options: SyncFeatureOptions = {}) => {
  const ut = window.utools
  if (!ut?.setFeature || !ut?.getFeatures || !ut?.removeFeature) return

  const store = useBookmarkStore.getState()

  // 1. 筛选并去重当前需要的书签
  const desired = bookmarks.filter(
    (b) => (isTemplateBookmark(b) || isUniversalBookmark(b)) && !store.isBookmarkInTrash(b)
  )
  const seenCmd = new Set<string>()
  const unique = desired.filter((b) => {
    const cmd = b.title.trim()
    if (!cmd || seenCmd.has(cmd)) return false
    seenCmd.add(cmd)
    return true
  })
  const featureSetSignature = buildFeatureSetSignature(
    unique,
    options.aiAggressiveSaveEnabled === true
  )
  if (!options.force && featureSetSignature === lastAppliedFeatureSetSignature) return

  // 2. 获取现有特性
  const existingFeatures = ut.getFeatures().filter((f) => {
    if (typeof f.code !== 'string') return false
    return f.code.startsWith(FEATURE_PREFIX) || DYNAMIC_ENTRY_CODES.has(f.code)
  })

  if (options.force) {
    existingFeatures.forEach((f) => ut.removeFeature!(f.code))
    processedBookmarks.clear()
  }

  // 3. 计算需要删除的特性（存在但不再需要的；含历史 ai_quick_save）
  const currentCodes = new Set(unique.map((b) => `${FEATURE_PREFIX}${b.id}`))
  if (options.aiAggressiveSaveEnabled) {
    currentCodes.add(AI_AGGRESSIVE_SAVE_FEATURE_CODE)
  }
  const toRemove = existingFeatures.filter((f) => !currentCodes.has(f.code))

  // 4. 删除不再需要的特性，并清理对应缓存
  toRemove.forEach((f) => {
    ut.removeFeature!(f.code)
    const bookmarkId = f.code.slice(FEATURE_PREFIX.length)
    processedBookmarks.delete(bookmarkId)
  })

  // 5. 只处理新增的书签，避免重复处理
  const toProcess = options.force
    ? unique
    : unique.filter((b) => processedBookmarks.get(b.id) !== getBookmarkSignature(b))

  // 6. 串行注册新增的特性
  for (const b of toProcess) {
    const cmd = b.title.trim()
    const code = `${FEATURE_PREFIX}${b.id}`
    const label = getTemplateLabel(b.url)
    const explain = `搜索：${b.title}${label ? `（${label}）` : ''}`

    const cmds: FeatureCmd[] = []
    let overCmd: OverCmd | null = null

    if (b.allowUniversal === true) {
      overCmd = { type: 'over', label: cmd, minLength: 1 }
      cmds.push(overCmd)
    } else {
      cmds.push(cmd)
    }

    const feature: UToolsFeature = { code, explain, cmds, mainHide: false }

    const iconDataUrl = await getFeatureIcon(b)
    if (iconDataUrl) {
      feature.icon = iconDataUrl
      if (overCmd) overCmd.icon = iconDataUrl
    }

    ut.setFeature(feature)
    processedBookmarks.set(b.id, getBookmarkSignature(b))
  }

  // AI 保存特性每次同步都 setFeature：既补注册，也刷新 cmds（如 URL regex）
  if (options.aiAggressiveSaveEnabled) {
    ut.setFeature(getAiSaveFeature())
  }
  lastAppliedFeatureSetSignature = featureSetSignature
}

interface FeatureSyncJob {
  bookmarks: Bookmark[]
  options: SyncFeatureOptions
}

let pendingFeatureSyncJob: FeatureSyncJob | null = null
let featureSyncPromise: Promise<void> | null = null

/** 合并批量图标/导入期间的重入调用，只串行执行当前任务与最新任务。 */
const syncFeaturesImpl = (bookmarks: Bookmark[], options: SyncFeatureOptions = {}): Promise<void> => {
  pendingFeatureSyncJob = { bookmarks: [...bookmarks], options: { ...options } }
  if (featureSyncPromise) return featureSyncPromise

  featureSyncPromise = (async () => {
    while (pendingFeatureSyncJob) {
      const job = pendingFeatureSyncJob
      pendingFeatureSyncJob = null
      try {
        await syncFeaturesOnce(job.bookmarks, job.options)
      } catch (error) {
        console.warn('[uTools] 动态特性同步失败:', error)
      }
    }
  })().finally(() => {
    featureSyncPromise = null
    if (pendingFeatureSyncJob) void syncFeaturesImpl(pendingFeatureSyncJob.bookmarks, pendingFeatureSyncJob.options)
  })

  return featureSyncPromise
}

const getEnterTextImpl = (payload: unknown): string => {
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    const first = payload[0] as unknown
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      const value =
        (first as { text?: unknown; value?: unknown; title?: unknown }).text ??
        (first as { text?: unknown; value?: unknown; title?: unknown }).value ??
        (first as { text?: unknown; value?: unknown; title?: unknown }).title
      return typeof value === 'string' ? value : ''
    }
    return ''
  }
  if (!payload || typeof payload !== 'object') return ''
  const candidate = payload as { text?: unknown; value?: unknown; title?: unknown }
  const text = candidate.text ?? candidate.value ?? candidate.title
  if (typeof text === 'string') return text
  if ('text' in payload) {
    return typeof candidate.text === 'string' ? candidate.text : ''
  }
  return ''
}

const getWindowType = () => {
  try {
    return window.utools?.getWindowType?.()
  } catch {
    return undefined
  }
}

const isDetachedWindowNowImpl = () => {
  const type = getWindowType()
  return type === 'detach' || type === 'browser'
}

const setExpendHeightImpl = (height: number) => {
  if (typeof window.utools?.setExpendHeight === 'function') {
    window.utools.setExpendHeight(height)
  }
}

export function useUTools() {
  const syncFeatures = useCallback(
    (bookmarks: Bookmark[], options: SyncFeatureOptions = {}) => syncFeaturesImpl(bookmarks, options),
    []
  )
  const getEnterText = useCallback((payload: unknown) => getEnterTextImpl(payload), [])
  const isDetachedWindowNow = useCallback(() => isDetachedWindowNowImpl(), [])
  const setExpendHeight = useCallback((height: number) => setExpendHeightImpl(height), [])

  return {
    AI_AGGRESSIVE_SAVE_FEATURE_CODE,
    FEATURE_PREFIX,
    syncFeatures,
    getEnterText,
    isDetachedWindowNow,
    setExpendHeight
  }
}
