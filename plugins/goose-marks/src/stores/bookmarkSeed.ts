import type { Bookmark, Group, IconSource, SubGroup } from '@/types/bookmark'
import { SEED_ICON_BY_KEY } from '@/stores/seedIconData'

export const TRASH_GROUP_ID = 'g-trash'

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const parseUrlParams = (input: string): Record<string, string> => {
  if (!input) return {}
  try {
    const url = new URL(input)
    const params: Record<string, string> = {}
    for (const [key, value] of url.searchParams) {
      params[key] = value
    }
    return params
  } catch {
    return {}
  }
}

export const createSeedGroups = (): Group[] => {
  const now = Date.now()
  return [
    {
      id: 'g-nav',
      name: '常用',
      createdAt: now,
      updatedAt: now,
      children: [{ id: 'sg-nav-common', name: '网站', bookmarkIds: [], createdAt: now, updatedAt: now }]
    },
    {
      id: 'g-ai',
      name: 'AI',
      createdAt: now,
      updatedAt: now,
      children: [{ id: 'sg-ai-chat', name: '对话', bookmarkIds: [], createdAt: now, updatedAt: now }]
    },
    {
      id: TRASH_GROUP_ID,
      name: '回收站',
      createdAt: now,
      updatedAt: now,
      children: [{ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now }]
    }
  ]
}

export interface BookmarkSeed {
  groups: Group[]
  bookmarks: Bookmark[]
}

const seedRemoteIcon = (iconKey: string): IconSource | undefined => {
  const entry = SEED_ICON_BY_KEY[iconKey]
  if (!entry?.cache?.startsWith('data:image/')) return undefined
  return {
    type: 'remote',
    src: entry.src,
    cache: entry.cache,
    fetchedAt: 1
  }
}

type SeedDef = {
  iconKey: string
  title: string
  url: string
  groupId: string
  subGroupId: string
  tags?: string[]
}

const SEED_BOOKMARK_DEFS: SeedDef[] = [
  { iconKey: 'baidu', title: '百度', url: 'https://www.baidu.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'taobao', title: '淘宝', url: 'https://www.taobao.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'jd', title: '京东', url: 'https://www.jd.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'zhihu', title: '知乎', url: 'https://www.zhihu.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'bilibili', title: 'B站', url: 'https://www.bilibili.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'weibo', title: '微博', url: 'https://weibo.com', groupId: 'g-nav', subGroupId: 'sg-nav-common' },
  { iconKey: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] },
  { iconKey: 'kimi', title: 'Kimi', url: 'https://www.kimi.com', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] },
  { iconKey: 'tongyi', title: '通义千问', url: 'https://tongyi.aliyun.com', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] },
  { iconKey: 'yiyan', title: '文心一言', url: 'https://yiyan.baidu.com', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] },
  { iconKey: 'doubao', title: '豆包', url: 'https://www.doubao.com', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] },
  { iconKey: 'chatglm', title: '智谱清言', url: 'https://chatglm.cn', groupId: 'g-ai', subGroupId: 'sg-ai-chat', tags: ['AI'] }
]

/** 老用户书签 URL 变体（http/www/m/旧域名/多入口）→ 同一内置图标 */
export const SEED_URL_ALIASES_BY_ICON_KEY: Record<string, string[]> = {
  baidu: [
    'https://www.baidu.com',
    'http://www.baidu.com',
    'https://baidu.com',
    'http://baidu.com',
    'https://m.baidu.com'
  ],
  taobao: ['https://www.taobao.com', 'http://www.taobao.com', 'https://taobao.com', 'http://taobao.com'],
  jd: ['https://www.jd.com', 'http://www.jd.com', 'https://jd.com', 'http://jd.com'],
  zhihu: ['https://www.zhihu.com', 'http://www.zhihu.com', 'https://zhihu.com', 'http://zhihu.com'],
  bilibili: [
    'https://www.bilibili.com',
    'http://www.bilibili.com',
    'https://bilibili.com',
    'https://m.bilibili.com'
  ],
  weibo: [
    'https://weibo.com',
    'http://weibo.com',
    'https://www.weibo.com',
    'https://m.weibo.cn',
    'http://m.weibo.cn',
    'https://weibo.cn'
  ],
  deepseek: [
    'https://chat.deepseek.com',
    'http://chat.deepseek.com',
    'https://www.deepseek.com',
    'https://deepseek.com',
    'https://platform.deepseek.com'
  ],
  kimi: [
    'https://www.kimi.com',
    'https://kimi.com',
    'http://kimi.com',
    'https://kimi.moonshot.cn',
    'https://www.moonshot.cn',
    'https://moonshot.cn'
  ],
  tongyi: ['https://tongyi.aliyun.com', 'http://tongyi.aliyun.com', 'https://www.tongyi.aliyun.com'],
  yiyan: ['https://yiyan.baidu.com', 'http://yiyan.baidu.com'],
  doubao: ['https://www.doubao.com', 'https://doubao.com', 'https://doubao.com/chat'],
  chatglm: ['https://chatglm.cn', 'https://www.chatglm.cn', 'https://open.bigmodel.cn']
}

/** 标题兜底（老数据 URL 被改/为空时仍能命中内置图标） */
const SEED_TITLE_ALIASES_BY_ICON_KEY: Record<string, string[]> = {
  baidu: ['百度'],
  taobao: ['淘宝'],
  jd: ['京东'],
  zhihu: ['知乎'],
  bilibili: ['b站', 'bilibili', '哔哩哔哩'],
  weibo: ['微博', '新浪微博'],
  deepseek: ['deepseek', '深度求索'],
  kimi: ['kimi', '月之暗面', 'moonshot'],
  tongyi: ['通义千问', '通义', 'qwen'],
  yiyan: ['文心一言', '文心'],
  doubao: ['豆包'],
  chatglm: ['智谱清言', '智谱', 'chatglm', 'glm']
}

export const normalizeSeedHost = (hostname: string): string =>
  hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '')
    .replace(/^mobile\./, '')

/** 规范化主机名 → iconKey（含子域/旧域名；在路径精确匹配失败时优先命中） */
export const BUILTIN_HOST_TO_ICON_KEY: Record<string, string> = {
  'www.baidu.com': 'baidu',
  'www.taobao.com': 'taobao',
  'www.jd.com': 'jd',
  'www.zhihu.com': 'zhihu',
  'www.bilibili.com': 'bilibili',
  'weibo.com': 'weibo',
  'www.weibo.com': 'weibo',
  'm.weibo.cn': 'weibo',
  'weibo.cn': 'weibo',
  'chat.deepseek.com': 'deepseek',
  'www.deepseek.com': 'deepseek',
  'deepseek.com': 'deepseek',
  'platform.deepseek.com': 'deepseek',
  'www.kimi.com': 'kimi',
  'kimi.com': 'kimi',
  'kimi.moonshot.cn': 'kimi',
  'www.moonshot.cn': 'kimi',
  'moonshot.cn': 'kimi',
  'tongyi.aliyun.com': 'tongyi',
  'www.tongyi.aliyun.com': 'tongyi',
  'yiyan.baidu.com': 'yiyan',
  'www.doubao.com': 'doubao',
  'doubao.com': 'doubao',
  'chatglm.cn': 'chatglm',
  'www.chatglm.cn': 'chatglm',
  'open.bigmodel.cn': 'chatglm'
}

const buildSeedTitleToIconKey = (): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const def of SEED_BOOKMARK_DEFS) {
    out[def.title.trim().toLowerCase()] = def.iconKey
    for (const label of SEED_TITLE_ALIASES_BY_ICON_KEY[def.iconKey] ?? []) {
      out[label.trim().toLowerCase()] = def.iconKey
    }
  }
  return out
}

/** 展示标题 / 别名（小写键）→ iconKey，供标题兜底与外部只读引用 */
export const SEED_TITLE_TO_ICON_KEY: Record<string, string> = buildSeedTitleToIconKey()

const normalizeSeedUrl = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    u.protocol = 'https:'
    u.hash = ''
    u.search = ''
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    u.pathname = path || '/'
    const origin = u.origin
    const pathPart = u.pathname === '/' ? '' : u.pathname
    return `${origin}${pathPart}`
  } catch {
    return null
  }
}

const hasBuiltinRemoteCache = (icon?: IconSource) =>
  icon?.type === 'remote' && typeof icon.cache === 'string' && icon.cache.startsWith('data:image/')

const buildBuiltinSeedIconLookup = (): Map<string, IconSource> => {
  const lookup = new Map<string, IconSource>()
  for (const def of SEED_BOOKMARK_DEFS) {
    const icon = seedRemoteIcon(def.iconKey)
    if (!icon) continue
    const aliases = SEED_URL_ALIASES_BY_ICON_KEY[def.iconKey] ?? [def.url]
    for (const alias of aliases) {
      const key = normalizeSeedUrl(alias)
      if (key) lookup.set(key, icon)
    }
  }
  return lookup
}

let builtinSeedIconLookup: Map<string, IconSource> | null = null

const getBuiltinSeedIconLookup = () => {
  if (!builtinSeedIconLookup) builtinSeedIconLookup = buildBuiltinSeedIconLookup()
  return builtinSeedIconLookup
}

const BUILTIN_HOSTS_LONGEST_FIRST = Object.keys(BUILTIN_HOST_TO_ICON_KEY).sort(
  (a, b) => b.length - a.length
)

const iconFromHostKeys = (hostname: string): IconSource | undefined => {
  const lower = hostname.trim().toLowerCase()
  for (const host of BUILTIN_HOSTS_LONGEST_FIRST) {
    if (lower === host || lower.endsWith(`.${host}`)) {
      return seedRemoteIcon(BUILTIN_HOST_TO_ICON_KEY[host])
    }
  }
  const norm = normalizeSeedHost(lower)
  for (const host of BUILTIN_HOSTS_LONGEST_FIRST) {
    const nh = normalizeSeedHost(host)
    if (norm === nh || norm.endsWith(`.${nh}`)) {
      return seedRemoteIcon(BUILTIN_HOST_TO_ICON_KEY[host])
    }
  }
  return undefined
}

const resolveBuiltinSeedIconByTitle = (title: string): IconSource | undefined => {
  const t = title.trim().toLowerCase()
  if (!t) return undefined
  const iconKey = SEED_TITLE_TO_ICON_KEY[t]
  if (iconKey) return seedRemoteIcon(iconKey)
  for (const [label, key] of Object.entries(SEED_TITLE_TO_ICON_KEY)) {
    if (label.length >= 2 && t.includes(label)) return seedRemoteIcon(key)
  }
  return undefined
}

/** URL 精确/主机表 + 标题兜底 */
export const resolveBuiltinSeedIcon = (
  rawUrl: string,
  lookup: Map<string, IconSource>,
  title: string
): IconSource | undefined => {
  const key = normalizeSeedUrl(rawUrl)
  if (key) {
    const direct = lookup.get(key)
    if (direct) return direct
    try {
      const u = new URL(key)
      const byHost = iconFromHostKeys(u.hostname)
      if (byHost) return byHost
      const bHost = normalizeSeedHost(u.hostname)
      const bPath = u.pathname && u.pathname !== '/' ? u.pathname : ''
      for (const [k, icon] of lookup) {
        const ku = new URL(k)
        if (normalizeSeedHost(ku.hostname) !== bHost) continue
        const kPath = ku.pathname && ku.pathname !== '/' ? ku.pathname : ''
        if (kPath === bPath || kPath === '' || bPath === '') return icon
      }
    } catch {
      /* ignore */
    }
  }
  return resolveBuiltinSeedIconByTitle(title)
}

/** 按内置示例 URL/标题写死 favicon；已有 remote+data:image cache 的书签不改动 */
export const patchBookmarksWithBuiltinSeedIcons = (
  bookmarks: Bookmark[]
): { bookmarks: Bookmark[]; changed: boolean } => {
  const lookup = getBuiltinSeedIconLookup()
  let changed = false
  const next = bookmarks.map((b) => {
    if (hasBuiltinRemoteCache(b.icon)) return b
    const icon = resolveBuiltinSeedIcon(b.url, lookup, b.title)
    if (!icon) return b
    changed = true
    return {
      ...b,
      icon: { ...icon },
      iconMatchedAt: b.iconMatchedAt ?? Date.now(),
      iconMatchFailedAt: undefined,
      iconMatchFailedReason: undefined
    }
  })
  return { bookmarks: changed ? next : bookmarks, changed }
}

/**
 * 新用户 / 重置书签 共用的默认快照（图标已写入 seedIconData，首屏即显示站点 favicon）。
 */
export const createBookmarkSeed = (): BookmarkSeed => {
  const now = Date.now()
  const groups = createSeedGroups()
  const bookmarks: Bookmark[] = []

  const findSub = (groupId: string, subId: string): SubGroup | undefined => {
    const g = groups.find((gr) => gr.id === groupId)
    return g?.children.find((c) => c.id === subId)
  }

  for (const def of SEED_BOOKMARK_DEFS) {
    const icon = seedRemoteIcon(def.iconKey)
    if (!icon) continue
    const sub = findSub(def.groupId, def.subGroupId)
    if (!sub) continue
    const id = uid()
    bookmarks.push({
      id,
      title: def.title,
      url: def.url,
      desc: '',
      tags: def.tags ?? [],
      icon,
      iconMatchedAt: now,
      locations: [{ groupId: def.groupId, subGroupId: def.subGroupId }],
      createdAt: now,
      updatedAt: now
    })
    sub.bookmarkIds.push(id)
  }

  return { groups, bookmarks }
}

/** 与 createBookmarkSeed 相同；供设置页「重置书签」等显式引用 */
export const createDefaultBookmarkSnapshot = createBookmarkSeed
