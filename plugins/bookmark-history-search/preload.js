// ZTools 插件：书签历史搜索（preload）
// - feature "search"：mode list，主窗口搜索框实时搜索 浏览器书签 + 导入书签 + 历史记录
// - feature "import"：headless，导入本地书签文件（Netscape HTML / Chrome JSON）存入插件存储
const path = require('path')
const fs = require('fs')
const { readAllBookmarks } = require('./lib/books')
const { readChromeHistory } = require('./lib/history')
const { readFirefoxBookmarks, readFirefoxHistory } = require('./lib/firefox')
const { parseBookmarkFile } = require('./lib/import')

// ─── 数据缓存 ─────────────────────────────────────────────────────
const CACHE_TTL_BOOKS = 5 * 60 * 1000 // 书签 5 分钟
const CACHE_TTL_HISTORY = 60 * 1000 // 历史 60 秒
let cache = { books: null, booksTs: 0, history: null, historyTs: 0 }

// ─── 数据来源配置（dbStorage 持久化，可在插件设置里切换） ────────
const SOURCE_CFG_KEY = 'source_config'
function getSourceConfig() {
  const def = { chrome: true, edge: true, firefox: true, imported: true }
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.dbStorage) {
      const raw = window.ztools.dbStorage.getItem(SOURCE_CFG_KEY)
      if (raw) return Object.assign(def, JSON.parse(raw))
    }
  } catch (e) {}
  return def
}
function saveSourceConfig(cfg) {
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.dbStorage) {
      window.ztools.dbStorage.setItem(SOURCE_CFG_KEY, JSON.stringify(cfg))
    }
  } catch (e) {}
}

function getImportedBookmarks() {
  if (!getSourceConfig().imported) return []
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.dbStorage) {
      const raw = window.ztools.dbStorage.getItem('imported_bookmarks')
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {}
  return []
}

async function getBooks() {
  if (cache.books && Date.now() - cache.booksTs < CACHE_TTL_BOOKS) return cache.books
  const [chrome, fx] = await Promise.all([Promise.resolve(readAllBookmarks()), readFirefoxBookmarks()])
  const cfg = getSourceConfig()
  cache.books = [...chrome, ...fx].filter(b =>
    (b.browser === 'chrome' && cfg.chrome) ||
    (b.browser === 'edge' && cfg.edge) ||
    (b.browser === 'firefox' && cfg.firefox)
  )
  cache.booksTs = Date.now()
  return cache.books
}

async function getHistory() {
  if (cache.history && Date.now() - cache.historyTs < CACHE_TTL_HISTORY) return cache.history
  try {
    const [ch, fx] = await Promise.all([readChromeHistory(3000), readFirefoxHistory(3000)])
    const cfg = getSourceConfig()
    cache.history = [...ch, ...fx].filter(h =>
      (h.browser === 'chrome' && cfg.chrome) ||
      (h.browser === 'edge' && cfg.edge) ||
      (h.browser === 'firefox' && cfg.firefox)
    )
  } catch (e) {
    cache.history = cache.history || []
  }
  cache.historyTs = Date.now()
  return cache.history
}

// ─── 搜索 ─────────────────────────────────────────────────────────
function matchText(text, terms) {
  if (!text) return false
  return terms.every(t => text.toLowerCase().includes(t))
}

// 合并书签 + 导入书签 + 历史，按关键词过滤
async function searchAll(keyword) {
  const word = (keyword || '').trim().toLowerCase()
  const [books, imported, history] = await Promise.all([getBooks(), Promise.resolve(getImportedBookmarks()), getHistory()])

  if (!word) {
    // 无关键词：返回最近历史 top 10
    return history.slice(0, 10).map(h => ({
      title: h.title || h.url,
      description: h.url,
      url: h.url,
      source: 'history',
      icon: '🕘'
    }))
  }

  const terms = word.split(/\s+/).filter(Boolean)
  const results = []

  // 书签（浏览器）——优先
  for (const b of books) {
    if (matchText(b.title, terms) || matchText(b.url, terms) || matchText(b.folder, terms)) {
      results.push({
        title: b.title,
        description: (b.folder ? '📁' + b.folder + ' · ' : '') + b.url,
        url: b.url,
        source: 'bookmark',
        browser: b.browser,
        icon: b.browser === 'firefox' ? '🦊' : '⭐',
        score: 3 + (matchText(b.title, terms) ? 2 : 0)
      })
    }
  }
  // 导入书签
  for (const b of imported) {
    if (matchText(b.title, terms) || matchText(b.url, terms) || matchText(b.folder, terms)) {
      results.push({
        title: b.title,
        description: (b.folder ? '📂' + b.folder + ' · ' : '📥') + b.url,
        url: b.url,
        source: 'imported',
        icon: '📥',
        score: 2 + (matchText(b.title, terms) ? 2 : 0)
      })
    }
  }
  // 历史
  for (const h of history) {
    if (matchText(h.title, terms) || matchText(h.url, terms)) {
      results.push({
        title: h.title || h.url,
        description: '🕘' + h.url,
        url: h.url,
        source: 'history',
        icon: '🕘',
        score: 1
      })
    }
  }

  // 排序：书签 > 导入 > 历史；同类内 title 匹配优先
  results.sort((a, b) => (b.score || 0) - (a.score || 0))
  // 按 URL 去重（多浏览器同步同一 URL 时只保留优先级最高的一条：书签>导入>历史）
  const dedup = new Map()
  for (const r of results) {
    const key = r.url
    const prev = dedup.get(key)
    if (!prev || (r.score || 0) > (prev.score || 0)) dedup.set(key, r)
  }
  return [...dedup.values()].slice(0, 50)
}

// ─── 打开 URL ─────────────────────────────────────────────────────
function openUrl(url) {
  try {
    if (typeof window !== 'undefined' && window.ztools && window.ztools.shellOpenExternal) {
      window.ztools.shellOpenExternal(url)
    }
  } catch (e) {}
}

// ─── payload 兼容提取 ─────────────────────────────────────────────
function collectPaths(action) {
  let payload = action
  if (action && typeof action === 'object') {
    if ('payload' in action) payload = action.payload
    else if ('files' in action) payload = action.files
  }
  const list = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const item of list) {
    if (item == null) continue
    if (typeof item === 'string') { out.push(item); continue }
    if (typeof item === 'object') {
      const p = item.path || item.filePath || item.realPath ||
        (item.data && (item.data.path || item.data.filePath)) || item.name
      if (typeof p === 'string') out.push(p)
    }
  }
  return out
}

// ─── feature: search（mode list） ─────────────────────────────────
const searchFeature = {
  mode: 'list',
  args: {
    enter: (action) => {
      // 从「选中文字」或搜索命令进入：把 payload 填入搜索框
      if (action && action.payload && typeof action.payload === 'string' && window.ztools.setSubInputValue) {
        window.ztools.setSubInputValue(action.payload)
      }
    },
    search: (action, searchWord, callbackSetList) => {
      searchAll(searchWord).then(list => {
        callbackSetList(list.map(x => ({
          title: x.title,
          description: x.description,
          url: x.url,
          source: x.source,
          icon: x.icon
        })))
      }).catch(() => callbackSetList([]))
    },
    select: (action, itemData) => {
      if (window.ztools.hideMainWindow) window.ztools.hideMainWindow(false)
      openUrl(itemData.url)
      if (window.ztools.outPlugin) window.ztools.outPlugin()
    }
  }
}

// 主窗口搜索框联想（mainPush）
// 修复：preload 加载即预热数据（否则主窗口直接输入时 cache 为空 → 搜不出）
if (typeof window !== 'undefined' && window.ztools && window.ztools.onMainPush) {
  getBooks().catch(() => {})
  getHistory().catch(() => {})

  window.ztools.onMainPush(async ({ payload }) => {
    try {
      const word = (payload || '').trim()
      if (!word) return { type: 'list', data: [] }
      // 异步加载（确保数据就绪），缓存命中时秒回
      const [books, history] = await Promise.all([getBooks(), getHistory()])
      const imported = getImportedBookmarks()
      const terms = word.toLowerCase().split(/\s+/).filter(Boolean)
      const data = []
      const push = (title, description, url) => {
        data.push({ text: title + ' ' + description, title: description, url })
      }
      for (const b of books) {
        if (terms.every(t => (b.title || '').toLowerCase().includes(t) || b.url.toLowerCase().includes(t))) {
          push(b.title, (b.browser === 'firefox' ? '🦊' : '⭐') + b.url, b.url)
        }
      }
      for (const b of imported) {
        if (terms.every(t => (b.title || '').toLowerCase().includes(t) || b.url.toLowerCase().includes(t))) {
          push(b.title, '📥' + b.url, b.url)
        }
      }
      for (const h of history) {
        if (terms.every(t => (h.title || '').toLowerCase().includes(t) || h.url.toLowerCase().includes(t))) {
          push(h.title || h.url, '🕘' + h.url, h.url)
        }
      }
      return { type: 'list', data: data.slice(0, 6) }
    } catch (e) {
      return { type: 'list', data: [] }
    }
  }, ({ option }) => {
    if (option && option.url) openUrl(option.url)
  })
}

// ─── feature: import（mode none，导入书签） ───────────────────────
const importFeature = {
  mode: 'none',
  args: {
    enter: (action) => {
      // 注意：不能先 outPlugin（会销毁视图导致后续解析/存储中断 = 闪退），
      // 必须先把导入做完，finally 里再藏主窗口 + 退出。
      try {
        const files = collectPaths(action)
        // 搜索框命令触发（无文件 payload）：弹文件选择器选书签文件
        if (!files.length) {
          try {
            if (window.ztools && window.ztools.showOpenDialog) {
              const picked = window.ztools.showOpenDialog({
                title: '选择要导入的书签文件',
                properties: ['openFile', 'multiSelections'],
                filters: [{
                  name: 'Bookmarks',
                  extensions: ['html', 'htm', 'json']
                }]
              })
              if (picked && Array.isArray(picked)) files.push(...picked)
              else if (picked && Array.isArray(picked.filePaths)) files.push(...picked.filePaths)
            }
          } catch (e) {}
        }
        if (!files.length) {
          notify('未获取到书签文件')
          return
        }
      let total = 0
      const merged = []
      for (const f of files) {
        try {
          const list = parseBookmarkFile(f)
          merged.push(...list.map(x => Object.assign({}, x, { importedFrom: path.basename(f) })))
          total += list.length
        } catch (e) {
          notify('解析失败: ' + path.basename(f) + ': ' + e.message)
        }
      }
      if (!merged.length) {
        notify('没有从文件中解析到书签')
        return
      }
      // 合并已有导入书签（按 url 去重）
      const existing = getImportedBookmarks()
      const seen = new Set(existing.map(x => x.url))
      for (const x of merged) {
        if (!seen.has(x.url)) { existing.push(x); seen.add(x.url) }
      }
      try {
        window.ztools.dbStorage.setItem('imported_bookmarks', JSON.stringify(existing))
      } catch (e) {
        notify('保存导入书签失败: ' + e.message)
        return
      }
      notify(`已导入 ${total} 条书签（共 ${existing.length} 条）`)
      } catch (e) {
        notify('导入失败: ' + (e && e.message ? e.message : e))
      } finally {
        // 导入全部完成后再退出（避免视图销毁导致导入中断 = 闪退）
        try { if (window.ztools && window.ztools.hideMainWindow) window.ztools.hideMainWindow(true) } catch (e) {}
        try { if (window.ztools && window.ztools.outPlugin) window.ztools.outPlugin() } catch (e) {}
      }
    }
  }
}

function notify(text) {
  if (typeof window !== 'undefined' && window.ztools && window.ztools.showNotification) {
    try { window.ztools.showNotification(text) } catch (e) {}
  }
}

// ─── feature: settings（选择抓取哪些浏览器的数据） ────────────────
const SOURCE_NAMES = { chrome: 'Chrome 书签/历史', edge: 'Edge 书签/历史', firefox: 'Firefox 书签/历史', imported: '导入的书签' }
function buildSettingsList() {
  const cfg = getSourceConfig()
  return Object.keys(SOURCE_NAMES).map(k => ({
    title: SOURCE_NAMES[k] + (cfg[k] ? '  ✅' : '  ⭕'),
    description: cfg[k] ? '已开启 · 点选关闭' : '已关闭 · 点选开启',
    key: k
  }))
}

let _settingsSetList = null // 保存 callbackSetList 以便 select 后刷新列表（支持连续切换）

const settingsFeature = {
  mode: 'list',
  args: {
    enter: (action, callbackSetList) => {
      _settingsSetList = callbackSetList
      callbackSetList(buildSettingsList())
    },
    search: (action, searchWord, callbackSetList) => {
      _settingsSetList = callbackSetList
      callbackSetList(buildSettingsList())
    },
    select: (action, itemData) => {
      if (itemData && itemData.key) {
        const cfg = getSourceConfig()
        cfg[itemData.key] = !cfg[itemData.key]
        saveSourceConfig(cfg)
        // 关键：配置变了必须清缓存，否则 getBooks/getHistory 还按旧配置返回旧数据
        cache.books = null
        cache.history = null
        notify(SOURCE_NAMES[itemData.key] + ' 已' + (cfg[itemData.key] ? '开启' : '关闭'))
      }
      // 不退出：刷新列表支持连续多选，切完按 ESC 返回
      if (_settingsSetList) _settingsSetList(buildSettingsList())
    }
  }
}

if (typeof window !== 'undefined') {
  window.exports = {
    search: searchFeature,
    import: importFeature,
    settings: settingsFeature
  }
}

// 本地测试导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searchAll, collectPaths, getImportedBookmarks, searchFeature, importFeature, settingsFeature, getSourceConfig, saveSourceConfig }
}
