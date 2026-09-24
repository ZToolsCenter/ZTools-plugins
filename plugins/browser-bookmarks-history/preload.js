const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const { readBookmarksData, searchBookmarks } = require('./bookmarks')
const { readHistory } = require('./history')
const { readFavicons, getFaviconUrl } = require('./favicons')
const { registerTools } = require('./mcp')
registerTools()

function getConfig () {
  const empty = { chromeDirs: [], edgeDirs: [], chromeExe: '' }
  try {
    const raw = window.ztools.dbStorage.getItem('bookmarks-config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (Array.isArray(cfg.chromeDirs)) empty.chromeDirs = cfg.chromeDirs.filter(x => typeof x === 'string')
      if (Array.isArray(cfg.edgeDirs)) empty.edgeDirs = cfg.edgeDirs.filter(x => typeof x === 'string')
      if (typeof cfg.chromeExe === 'string') empty.chromeExe = cfg.chromeExe
    }
  } catch (e) {}
  return empty
}
function saveConfig (cfg) {
  try { window.ztools.dbStorage.setItem('bookmarks-config', JSON.stringify(cfg)) } catch (e) {}
}

function buildDataDirs (cfg) {
  const dirs = []
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA
    if (la) {
      dirs.push({ browser: 'chrome', dir: path.join(la, 'Google/Chrome/User Data') })
      dirs.push({ browser: 'edge', dir: path.join(la, 'Microsoft/Edge/User Data') })
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME
    if (home) {
      dirs.push({ browser: 'chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') })
      dirs.push({ browser: 'edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') })
    }
  }
  if (cfg) {
    const cds = Array.isArray(cfg.chromeDirs) ? cfg.chromeDirs : []
    const eds = Array.isArray(cfg.edgeDirs) ? cfg.edgeDirs : []
    cds.forEach(d => dirs.push({ browser: 'chrome', dir: d }))
    eds.forEach(d => dirs.push({ browser: 'edge', dir: d }))
  }
  return dirs
}

let bookmarksReady = false
let reloadRequired = true
function ensureBookmarks () {
  if (!bookmarksReady || reloadRequired) {
    const cfg = getConfig()
    readBookmarksData(window.ztools.getPath('appData'), { chrome: cfg.chromeDirs, edge: cfg.edgeDirs })
    bookmarksReady = true
    reloadRequired = false
  }
}

let historyCache = null
let historyTs = 0
let historyLoading = null
const HISTORY_TTL = 60 * 1000
function ensureHistory (force) {
  if (!force && historyCache && Date.now() - historyTs < HISTORY_TTL) return Promise.resolve(historyCache)
  if (!historyLoading) {
    historyLoading = (async () => {
      try {
        const cfg = getConfig()
        historyCache = await readHistory({ chrome: cfg.chromeDirs, edge: cfg.edgeDirs })
      } catch (e) {
        historyCache = historyCache || []
      }
      historyTs = Date.now()
      historyLoading = null
      return historyCache
    })()
  }
  return historyLoading
}
function invalidateHistory () { historyCache = null; historyLoading = null }

let faviconMap = null
let faviconTs = 0
let faviconLoading = null
const FAVICON_TTL = 5 * 60 * 1000
function ensureFavicons (force) {
  if (!force && faviconMap && Date.now() - faviconTs < FAVICON_TTL) return Promise.resolve(faviconMap)
  if (!faviconLoading) {
    faviconLoading = (async () => {
      try {
        const cfg = getConfig()
        faviconMap = await readFavicons(buildDataDirs(cfg))
      } catch (e) {
        faviconMap = faviconMap || new Map()
      }
      faviconTs = Date.now()
      faviconLoading = null
      return faviconMap
    })()
  }
  return faviconLoading
}
function invalidateFavicons () { faviconMap = null; faviconLoading = null }

function filterHistory (history, keyword) {
  const terms = (keyword || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return history.filter(h =>
    terms.every(t => (h.title || '').toLowerCase().includes(t) || h.url.toLowerCase().includes(t))
  )
}
function historyToItem (h) {
  return { title: h.title || h.url, url: h.url, browser: h.browser, source: 'history', addAt: h.lastVisit || 0 }
}

function fallbackIcon (browser) {
  return browser === 'edge' ? 'edge.png' : 'chrome.png'
}

// 描述行：浏览器字母 emoji（🇨 Chrome / 🇪 Edge）+ 类型 emoji + URL
function formatDescription (item) {
  const typeEmoji = item.source === 'history' ? '🕘' : '⭐'
  return typeEmoji + ' · ' + item.url
}

function attachFavicon (item, fmap) {
  const favUrl = getFaviconUrl(item.url, fmap)
  item.icon = favUrl || fallbackIcon(item.browser)
  item.description = formatDescription(item)
  return item
}

function openUrlByChrome (url) {
  if (process.platform === 'win32') {
    const portableExe = getConfig().chromeExe
    if (portableExe && fs.existsSync(portableExe)) {
      cp.spawn(portableExe, [url], { detached: true })
      return
    }
    const suffix = `${path.sep}Google${path.sep}Chrome${path.sep}Application${path.sep}chrome.exe`
    const prefixes = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean)
    const prefix = prefixes.find(p => fs.existsSync(path.join(p, suffix)))
    const chromeApp = prefix ? path.join(prefix, suffix) : ''
    if (chromeApp && fs.existsSync(chromeApp)) {
      cp.spawn(chromeApp, [url], { detached: true })
    } else {
      window.ztools.shellOpenExternal(url)
    }
    return
  }
  if (process.platform === 'darwin') {
    const chromeApp = '/Applications/Google Chrome.app'
    if (fs.existsSync(chromeApp)) cp.spawn('open', ['-a', chromeApp, url], { detached: true })
    else window.ztools.shellOpenExternal(url)
  }
}
function openUrlByEdge (url) {
  if (process.platform === 'win32') {
    cp.spawn('start', ['microsoft-edge:' + url], { shell: 'cmd.exe', detached: true }).once('error', () => {
      window.ztools.shellOpenExternal(url)
    })
    return
  }
  if (process.platform === 'darwin') {
    const edgeApp = '/Applications/Microsoft Edge.app'
    if (fs.existsSync(edgeApp)) cp.spawn('open', ['-a', edgeApp, url], { detached: true })
    else window.ztools.shellOpenExternal(url)
  }
}

async function searchMerged (keyword, filter) {
  filter = filter || {}
  const word = (keyword || '').trim()
  ensureBookmarks()
  let books = searchBookmarks(word)
  const history = await ensureHistory()
  let hist = word ? filterHistory(history, word).map(historyToItem) : history.slice(0, 10).map(historyToItem)

  if (filter.browser) {
    books = books.filter(b => b.browser === filter.browser)
    hist = hist.filter(h => h.browser === filter.browser)
  }
  let results = []
  if (!filter.source || filter.source === 'bookmark') results = results.concat(books)
  if (!filter.source || filter.source === 'history') results = results.concat(hist)

  const fmap = faviconMap || new Map()
  results = results.map(item => attachFavicon(item, fmap))
  if (!faviconMap) ensureFavicons().catch(() => {})
  return results
}

window.ztools.onMainPush(async ({ payload }) => {
  const word = (payload || '').trim()
  if (!word) return { type: 'list', data: [] }
  const all = await searchMerged(word, {})
  const data = all.slice(0, 6).map(x => ({
    text: x.title + ' ' + x.url,
    title: x.description,
    icon: x.icon,
    browser: x.browser,
    url: x.url
  }))
  if (all.length > 6) {
    data.pop()
    data.push({ highlight: false, text: '共搜索到 ' + all.length + ' 条（书签+历史），查看更多...' })
  }
  return { type: 'list', data }
}, ({ option }) => {
  if (option.browser === 'chrome') openUrlByChrome(option.url)
  else openUrlByEdge(option.url)
})

function makeSearchAction (filter, keepInput) {
  return {
    mode: 'list',
    args: {
      enter: (action, callbackSetList) => {
        ensureBookmarks()
        ensureHistory().catch(() => {})
        ensureFavicons().catch(() => {})
        if (keepInput && action.payload && typeof action.payload === 'string') {
          setTimeout(() => { window.ztools.setSubInputValue(action.payload) })
        }
      },
      search: async (action, searchWord, callbackSetList) => {
        try {
          const list = await searchMerged(searchWord, filter)
          callbackSetList(list)
        } catch (e) {
          callbackSetList([])
        }
      },
      select: (action, itemData) => {
        window.ztools.hideMainWindow(false)
        if (itemData.browser === 'chrome') openUrlByChrome(itemData.url)
        else openUrlByEdge(itemData.url)
        window.ztools.outPlugin()
      }
    }
  }
}

function buildSettingsList () {
  const cfg = getConfig()
  const list = []
  list.push({ title: '为便携版 chrome / Edge 配置Data目录，请选择下面选项', description: '', action: 'none' })
  cfg.chromeDirs.forEach(d => {
    list.push({ title: '🗑 删除已配置 Chrome 目录：' + d, description: '点击即删除', action: 'removeChrome', dir: d })
  })
  cfg.edgeDirs.forEach(d => {
    list.push({ title: '🗑 删除已配置 Edge 目录：' + d, description: '点击即删除', action: 'removeEdge', dir: d })
  })
  if (cfg.chromeExe) {
    list.push({ title: '🗑 删除已配置 Chrome 程序：' + cfg.chromeExe, description: '点击即删除', action: 'clearExe' })
  }
  list.push({ title: '1. 选择 Chrome 的 User Data 文件夹', description: '便携版 Chrome 数据目录（含 Default\\Bookmarks、History 和 Favicons）', action: 'addChrome' })
  list.push({ title: '2. 选择 Edge 的 User Data 文件夹', description: '便携版 Edge 数据目录', action: 'addEdge' })
  list.push({
    title: '3. 选择便携版 Chrome 的 chrome.exe（搜索到书签后用它打开网页）',
    description: cfg.chromeExe ? '当前：' + cfg.chromeExe : '可选；不设置则用系统默认浏览器打开',
    action: 'setExe'
  })
  list.push({ title: '4. 立即重新读取全部书签目录', description: '修改目录后点此刷新书签、历史和图标', action: 'reload' })
  return list
}
function handleSettingsSelect (item) {
  if (!item || !item.action || item.action === 'none') return
  const cfg = getConfig()
  if (item.action === 'addChrome' || item.action === 'addEdge') {
    const isChrome = item.action === 'addChrome'
    const res = window.ztools.showOpenDialog({
      title: isChrome ? '选择便携版 Chrome 的 User Data 文件夹' : '选择便携版 Edge 的 User Data 文件夹',
      properties: ['openDirectory']
    })
    const data = res && res.data ? res.data : res
    const fp = data && data.filePaths && data.filePaths[0]
    if (fp) {
      const key = isChrome ? 'chromeDirs' : 'edgeDirs'
      if (!cfg[key].includes(fp)) cfg[key].push(fp)
      saveConfig(cfg)
      reloadRequired = true
      invalidateHistory()
      invalidateFavicons()
      window.ztools.showToast('已添加' + (isChrome ? ' Chrome' : ' Edge') + ' 目录：' + fp)
    }
    return
  }
  if (item.action === 'removeChrome' || item.action === 'removeEdge') {
    const key = item.action === 'removeChrome' ? 'chromeDirs' : 'edgeDirs'
    cfg[key] = cfg[key].filter(x => x !== item.dir)
    saveConfig(cfg)
    reloadRequired = true
    invalidateHistory()
    invalidateFavicons()
    window.ztools.showToast('已移除目录')
    return
  }
  if (item.action === 'setExe') {
    const res = window.ztools.showOpenDialog({
      title: '选择便携版 Chrome 的 chrome.exe',
      properties: ['openFile'],
      filters: [{ name: 'Chrome', extensions: ['exe'] }]
    })
    const data = res && res.data ? res.data : res
    const fp = data && data.filePaths && data.filePaths[0]
    if (fp) {
      cfg.chromeExe = fp
      saveConfig(cfg)
      window.ztools.showToast('已设置 Chrome 程序路径')
    }
    return
  }
  if (item.action === 'clearExe') {
    cfg.chromeExe = ''
    saveConfig(cfg)
    window.ztools.showToast('已清除程序路径')
    return
  }
  if (item.action === 'reload') {
    reloadRequired = true
    invalidateHistory()
    invalidateFavicons()
    ensureBookmarks()
    ensureHistory(true).catch(() => {})
    ensureFavicons(true).catch(() => {})
    window.ztools.showToast('书签、历史与图标已重新加载')
  }
}
const settingsAction = {
  mode: 'list',
  args: {
    enter: (action, callbackSetList) => { callbackSetList(buildSettingsList()) },
    search: (action, searchWord, callbackSetList) => {
      const kw = (searchWord || '').trim().toLowerCase()
      const list = buildSettingsList().filter(x =>
        !kw || (x.title || '').toLowerCase().includes(kw) || (x.description || '').toLowerCase().includes(kw)
      )
      callbackSetList(list)
    },
    select: (action, itemData) => {
      handleSettingsSelect(itemData)
      window.ztools.setSubInputValue('')
    }
  }
}

window.exports = {
  all: makeSearchAction({}),
  history: makeSearchAction({ source: 'history' }),
  chrome_bookmarks: makeSearchAction({ browser: 'chrome', source: 'bookmark' }),
  chrome_history: makeSearchAction({ browser: 'chrome', source: 'history' }),
  edge_bookmarks: makeSearchAction({ browser: 'edge', source: 'bookmark' }),
  edge_history: makeSearchAction({ browser: 'edge', source: 'history' }),
  search: makeSearchAction({}, true),
  settings: settingsAction
}

try { ensureBookmarks() } catch (e) {}
ensureHistory().catch(() => {})
ensureFavicons().catch(() => {})
