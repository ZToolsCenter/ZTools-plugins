import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BookSource, SearchSourceEntry } from '../utils/onlineBook'
import { validateBookSource, downloadCoverToDataUrl, sourceKey, sourceDisplayName } from '../utils/onlineBook'
import { domainOfUrl, mergeCookies, setCookiesToString } from '../utils/cookieJar'
import {
  getLegadoBooks,
  saveLegadoProgress,
  type LegadoConfig
} from '../utils/legado'

function storageGet(key: string): string | null {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.getItem) {
      const val = zStorage.getItem(key)
      if (val != null) return typeof val === 'string' ? val : JSON.stringify(val)
    }
  } catch { }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.setItem) {
      zStorage.setItem(key, value)
      return
    }
  } catch { }
  try {
    window.localStorage.setItem(key, value)
  } catch { }
}

const DEFAULT_LEGADO: LegadoConfig = {
  enabled: false,
  type: 1,
  url: '',
  accessToken: ''
}

const DEFAULT_GROUP_NAME = '默认分组'

/** 书源分组：一批书源归到一个分组下，便于批量管理与按组搜索 */
export interface SourceGroup {
  id: string
  name: string
  sources: BookSource[]
}

function newGroupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface LegadoSyncSummary {
  added: number
  updated: number
  removed: number
  total: number
}

export const useOnlineStore = defineStore('online', () => {
  const groups = ref<SourceGroup[]>([])
  const legado = ref<LegadoConfig>({ ...DEFAULT_LEGADO })
  const lastSyncAt = ref<number | null>(null)
  const syncing = ref(false)
  /** Cookie Jar：域名 → cookie 串（对标 Legado CookieStore 的域名维度持久化） */
  const cookieJar = ref<Record<string, string>>({})

  // legado 进度回写节流（同一本书 1 秒内只写一次）
  const progressPushMap = new Map<string, number>()

  function load() {
    const raw = storageGet('hushreader_online')
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (Array.isArray(data.groups)) {
          groups.value = data.groups
            .filter((g: any) => g && typeof g === 'object')
            .map((g: any) => ({
              id: String(g.id || newGroupId()),
              name: String(g.name || DEFAULT_GROUP_NAME),
              sources: Array.isArray(g.sources) ? g.sources : []
            }))
        } else if (Array.isArray(data.sources)) {
          // 旧版本平铺书源，迁移到默认分组
          groups.value = [{ id: newGroupId(), name: DEFAULT_GROUP_NAME, sources: data.sources }]
        }
        if (data.legado) legado.value = { ...DEFAULT_LEGADO, ...data.legado }
        if (data.lastSyncAt) lastSyncAt.value = data.lastSyncAt
        if (data.cookieJar && typeof data.cookieJar === 'object') {
          cookieJar.value = data.cookieJar
        }
      } catch { }
    }
  }

  function save() {
    storageSet('hushreader_online', JSON.stringify({
      groups: groups.value,
      legado: legado.value,
      lastSyncAt: lastSyncAt.value,
      cookieJar: cookieJar.value
    }))
  }

  // ---------- 书源分组管理 ----------

  function findGroup(groupId: string): SourceGroup | undefined {
    return groups.value.find(g => g.id === groupId) || groups.value[0]
  }

  /** 无任何分组时兜底创建默认分组 */
  function ensureGroup(): SourceGroup {
    if (groups.value.length === 0) {
      const g: SourceGroup = { id: newGroupId(), name: DEFAULT_GROUP_NAME, sources: [] }
      groups.value.push(g)
      save()
      return g
    }
    return groups.value[0]
  }

  /** 新建分组并返回分组 id */
  function createGroup(name?: string): string {
    const g: SourceGroup = {
      id: newGroupId(),
      name: (name || '').trim() || DEFAULT_GROUP_NAME,
      sources: []
    }
    groups.value.push(g)
    save()
    return g.id
  }

  /** 删除分组会连同其下全部书源一起删除 */
  function removeGroup(groupId: string) {
    const idx = groups.value.findIndex(g => g.id === groupId)
    if (idx < 0) return
    groups.value.splice(idx, 1)
    save()
  }

  function addSource(groupId: string, source: BookSource): string | null {
    const error = validateBookSource(source)
    if (error) return error
    const group = findGroup(groupId)
    if (!group) return '目标分组不存在'
    if (group.sources.some(s => sourceKey(s) === sourceKey(source))) return '该分组已存在相同书源'
    group.sources.push(source)
    save()
    return null
  }

  function removeSource(groupId: string, index: number) {
    const group = findGroup(groupId)
    if (!group) return
    group.sources.splice(index, 1)
    save()
  }

  /** 切换书源启用/禁用状态（禁用的书源不参与搜索） */
  function toggleSource(groupId: string, index: number) {
    const group = findGroup(groupId)
    if (!group) return
    const source = group.sources[index]
    if (!source) return
    source.enabled = source.enabled === false
    save()
  }

  /** 重命名分组 */
  function renameGroup(groupId: string, name: string) {
    const group = findGroup(groupId)
    if (!group) return
    group.name = (name || '').trim() || group.name
    save()
  }

  /** 更新书源（浅合并；enabled/分组名等字段变更后保存） */
  function updateSource(groupId: string, index: number, patch: Partial<BookSource>) {
    const group = findGroup(groupId)
    if (!group) return
    const source = group.sources[index]
    if (!source) return
    Object.assign(source, patch)
    save()
  }

  /** 把书源移动到另一个分组（不存在目标分组时忽略） */
  function moveSource(groupId: string, index: number, toGroupId: string): boolean {
    const from = findGroup(groupId)
    if (!from) return false
    const target = groups.value.find(g => g.id === toGroupId)
    if (!target) return false
    const [source] = from.sources.splice(index, 1)
    if (!source) return false
    if (target.sources.some(s => sourceKey(s) === sourceKey(source))) {
      // 目标分组已存在同源书源，回滚
      from.sources.splice(index, 0, source)
      return false
    }
    target.sources.push(source)
    save()
    return true
  }

  /** 批量启用/停用分组内全部书源 */
  function setGroupEnabled(groupId: string, enabled: boolean) {
    const group = findGroup(groupId)
    if (!group) return
    for (const s of group.sources) s.enabled = enabled
    save()
  }

  // ---------- Cookie Jar ----------

  /** 获取指定 URL 对应域名的 jar cookie */
  function jarCookie(url: string): string {
    const domain = domainOfUrl(url)
    return cookieJar.value[domain] || ''
  }

  /** 把响应 Set-Cookie 合并保存到对应域名（jar 覆盖同名项） */
  function saveJarCookies(url: string, setCookies: string[]) {
    const domain = domainOfUrl(url)
    const merged = setCookiesToString(setCookies)
    if (!merged) return
    cookieJar.value[domain] = mergeCookies(cookieJar.value[domain], merged)
    save()
  }

  /** 直接把完整 cookie 串合并保存到对应域名（手动粘贴 Cookie 用） */
  function saveJarCookieString(url: string, cookieStr: string) {
    const domain = domainOfUrl(url)
    if (!cookieStr.trim()) return
    cookieJar.value[domain] = mergeCookies(cookieJar.value[domain], cookieStr)
    save()
  }

  /** 清除书源登录状态：删除该域名 jar cookie（书源 cookie 字段由调用方通过 updateSource 清空） */
  function clearSourceLogin(source: BookSource) {
    const domain = domainOfUrl(sourceKey(source) || source?.bookSourceUrl || '')
    if (domain && cookieJar.value[domain]) {
      delete cookieJar.value[domain]
    }
    save()
  }

  /**
   * 从文本解析书源 JSON 并导入到指定分组，返回错误信息（成功返回 null）。
   * groupId 缺省时落到默认分组（第一个分组）。
   */
  function importSourcesText(text: string, groupId?: string): string | null {
    let list: any[]
    try {
      const data = JSON.parse(text)
      list = Array.isArray(data) ? data : [data]
    } catch {
      return '书源文件不是合法的 JSON'
    }
    if (!list.length) return '未解析到任何书源'
    const target = groupId ? groups.value.find(g => g.id === groupId) : undefined
    if (groupId && !target) return '目标分组不存在'
    const group = target || ensureGroup()
    let added = 0
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const error = validateBookSource(item)
      if (error) continue
      if (group.sources.some(s => sourceKey(s) === sourceKey(item))) continue
      group.sources.push(item)
      added++
    }
    if (added) save()
    return added ? null : '没有可导入的书源（可能已存在或规则不完整）'
  }

  function exportSourcesText(): string {
    return JSON.stringify(groups.value.flatMap(g => g.sources), null, 2)
  }

  /** 汇总所有分组的启用书源（用于搜索等场景） */
  function flattenSources(): SearchSourceEntry[] {
    const entries: SearchSourceEntry[] = []
    for (const g of groups.value) {
      for (const source of g.sources) {
        if (source.enabled === false) continue
        entries.push({ source, groupName: g.name })
      }
    }
    return entries
  }

  // ---------- 开源阅读（Legado）同步 ----------

  async function syncLegado(bookStore: any): Promise<LegadoSyncSummary | null> {
    if (!legado.value.enabled) return null
    if (!legado.value.url.trim()) throw new Error('请先填写开源阅读服务地址')
    syncing.value = true
    try {
      const remote = await getLegadoBooks(legado.value)
      const remoteByUrl = new Map<string, any>()
      remote.forEach(b => remoteByUrl.set(b.url, b))

      const localLegado = bookStore.books.filter((b: any) => b.format === 'online' && b.onlineKind === 'legado')
      const remoteUrls = new Set(remote.map(b => b.url))
      let added = 0
      let updated = 0

      for (const r of remote) {
        const local = localLegado.find((b: any) => b.bookUrl === r.url)
        if (!local) {
          let cover: string | undefined
          if (r.cover) cover = (await downloadCoverToDataUrl(r.cover)) || undefined
          const book = bookStore.addOnlineBook({
            title: r.name || '未命名',
            author: r.author || '',
            description: r.intro || undefined,
            onlineKind: 'legado',
            bookUrl: r.url,
            bookId: r.url,
            source: undefined,
            cover,
            // Legado 分组 → 书架分类（分类为派生数据，写入后自动出现在分类筛选栏）
            categories: r.group ? [r.group] : undefined,
            progress: r.progress,
            chapterProgress: r.chapterProgress,
            chapterCount: r.chapterCount,
            updateTime: r.updateTime,
            latestChapterTitle: r.latestChapterTitle || undefined,
            wordCount: r.wordCount || undefined,
            kind: r.kind || undefined
          })
          if (book) added++
        } else {
          const updates: any = {}
          // 分组：远端有分组则合并进去（不覆盖本地已有分类）
          if (r.group && !(local.categories || []).includes(r.group)) {
            updates.categories = [...(local.categories || []), r.group]
          }
          // 元数据：本地缺失时补全
          if (r.cover && !local.coverImage) {
            const cover = (await downloadCoverToDataUrl(r.cover)) || undefined
            if (cover) updates.coverImage = cover
          }
          if (r.intro && !local.description) updates.description = r.intro
          if (r.latestChapterTitle && !local.latestChapterTitle) updates.latestChapterTitle = r.latestChapterTitle
          if (r.wordCount && !local.wordCount) updates.wordCount = r.wordCount
          if (r.kind && !local.kind) updates.kind = r.kind
          // 仅当远端进度更新时才覆盖本地进度
          const remoteMs = r.updateTime || local.updatedAt || 0
          const localMacChange = (local.lastReadAt || 0)
          if (r.progress != null && (localMacChange === 0 || remoteMs > localMacChange)) {
            updates.lastChapter = r.progress
            updates.progressIndex = r.chapterProgress || 0
            updates.totalChapters = r.chapterCount || local.totalChapters
          } else if (r.chapterCount && r.chapterCount !== local.totalChapters) {
            updates.totalChapters = r.chapterCount
          }
          if (Object.keys(updates).length) {
            bookStore.updateBook(local.id, updates)
            updated++
          }
        }
      }

      // 移除远端已消失的同步书
      let removed = 0
      for (const local of localLegado) {
        if (!remoteUrls.has(local.bookUrl)) {
          bookStore.removeBook(local.id)
          removed++
        }
      }

      lastSyncAt.value = Date.now()
      save()
      return { added, updated, removed, total: remote.length }
    } finally {
      syncing.value = false
    }
  }

  /** 回写阅读进度到开源阅读（带节流） */
  async function pushProgress(book: any) {
    const cfg = legado.value
    if (!cfg.enabled || !cfg.url.trim()) return
    if (!book || book.format !== 'online' || book.onlineKind !== 'legado' || !book.bookUrl) return
    const now = Date.now()
    const last = progressPushMap.get(book.bookUrl) || 0
    if (now - last < 1000) return
    progressPushMap.set(book.bookUrl, now)
    try {
      await saveLegadoProgress(
        cfg,
        book.bookUrl,
        book.title,
        book.author || '',
        book.lastChapter ?? 0,
        book.progressIndex ?? 0
      )
    } catch {
      // 回写失败静默处理，不打断阅读
    }
  }

  function reset() {
    groups.value = []
    legado.value = { ...DEFAULT_LEGADO }
    lastSyncAt.value = null
    save()
  }

  return {
    groups, legado, lastSyncAt, syncing, cookieJar,
    load, save,
    createGroup, removeGroup, addSource, removeSource, toggleSource,
    renameGroup, updateSource, moveSource, setGroupEnabled,
    importSourcesText, exportSourcesText, flattenSources,
    jarCookie, saveJarCookies, saveJarCookieString, clearSourceLogin,
    syncLegado, pushProgress, reset
  }
})
