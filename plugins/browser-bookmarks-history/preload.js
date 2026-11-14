const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const { readBookmarksData, searchBookmarks, deleteBookmarkEntry, bookmarksChanged, readBookmarkTree, getBookmarksData } = require('./bookmarks')
const { readHistory, deleteHistoryEntry, collectHistoryFiles, filetimeToMs } = require('./history')
const { readFavicons, getFaviconUrl } = require('./favicons')
const { registerTools } = require('./mcp')
registerTools()

function getConfig () {
  const empty = { chromeDirs: [], edgeDirs: [], chromeExe: '', edgeExe: '', autoFilled: {} }
  try {
    const raw = window.ztools.dbStorage.getItem('bookmarks-config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (Array.isArray(cfg.chromeDirs)) empty.chromeDirs = cfg.chromeDirs.filter(x => typeof x === 'string')
      if (Array.isArray(cfg.edgeDirs)) empty.edgeDirs = cfg.edgeDirs.filter(x => typeof x === 'string')
      if (typeof cfg.chromeExe === 'string') empty.chromeExe = cfg.chromeExe
      if (typeof cfg.edgeExe === 'string') empty.edgeExe = cfg.edgeExe
      if (cfg.autoFilled && typeof cfg.autoFilled === 'object') empty.autoFilled = cfg.autoFilled
    }
  } catch (e) {}
  return empty
}
function saveConfig (cfg) {
  try { window.ztools.dbStorage.setItem('bookmarks-config', JSON.stringify(cfg)) } catch (e) {}
}

// 探测系统安装版 Chrome / Edge 的可执行文件与 User Data 目录（存在性校验）
// 仅返回确认为安装版（exe 与 User Data 都存在）的结果；便携版无固定路径，返回 null
function detectInstalledBrowsers () {
  const res = { chrome: null, edge: null }
  const exists = p => { try { return !!p && fs.existsSync(p) } catch (e) { return false } }
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA
    const pf = process.env.PROGRAMFILES
    const pfx = process.env['PROGRAMFILES(X86)']
    const candidates = (browser) => {
      if (browser === 'chrome') {
        const exe = [
          pfx && path.join(pfx, 'Google/Chrome/Application/chrome.exe'),
          pf && path.join(pf, 'Google/Chrome/Application/chrome.exe'),
          la && path.join(la, 'Google/Chrome/Application/chrome.exe')
        ].find(exists)
        const data = la && path.join(la, 'Google/Chrome/User Data')
        return exe && exists(data) ? { exe, dataDir: data } : null
      }
      const exe = [
        pfx && path.join(pfx, 'Microsoft/Edge/Application/msedge.exe'),
        pf && path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
        la && path.join(la, 'Microsoft/Edge/Application/msedge.exe')
      ].find(exists)
      const data = la && path.join(la, 'Microsoft/Edge/User Data')
      return exe && exists(data) ? { exe, dataDir: data } : null
    }
    res.chrome = candidates('chrome')
    res.edge = candidates('edge')
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME
    const chromeExe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    const chromeData = home && path.join(home, 'Library/Application Support/Google/Chrome')
    if (exists(chromeExe) && exists(chromeData)) res.chrome = { exe: chromeExe, dataDir: chromeData }
    const edgeExe = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    const edgeData = home && path.join(home, 'Library/Application Support/Microsoft Edge')
    if (exists(edgeExe) && exists(edgeData)) res.edge = { exe: edgeExe, dataDir: edgeData }
  }
  return res
}

// 安装版浏览器自动填路径：仅当某浏览器完全未配置（无目录且无 exe）且未被手动清空过时，
// 把系统安装版的 User Data 目录与 exe 写入配置（便于设置页展示与打开管理页）。
// 只填路径，不触发重新读取（行为不变）。
function autoFillInstalledPaths () {
  try {
    const cfg = getConfig()
    const auto = (cfg.autoFilled && typeof cfg.autoFilled === 'object') ? cfg.autoFilled : {}
    const chromeEmpty = (!cfg.chromeDirs || cfg.chromeDirs.length === 0) && !cfg.chromeExe
    const edgeEmpty = (!cfg.edgeDirs || cfg.edgeDirs.length === 0) && !cfg.edgeExe
    if (!(chromeEmpty && !auto.chrome) && !(edgeEmpty && !auto.edge)) return
    const inst = detectInstalledBrowsers()
    let changed = false
    if (chromeEmpty && !auto.chrome && inst.chrome) {
      cfg.chromeDirs = [inst.chrome.dataDir]
      cfg.chromeExe = inst.chrome.exe
      auto.chrome = true
      changed = true
    }
    if (edgeEmpty && !auto.edge && inst.edge) {
      cfg.edgeDirs = [inst.edge.dataDir]
      cfg.edgeExe = inst.edge.exe
      auto.edge = true
      changed = true
    }
    if (changed) {
      cfg.autoFilled = auto
      saveConfig(cfg)
    }
  } catch (e) {}
}

function buildDataDirs (cfg) {
  const dirs = []
  const seen = new Set()
  const push = (browser, dir) => {
    if (!dir) return
    let key
    try { key = browser + '::' + path.resolve(dir) } catch (e) { key = browser + '::' + dir }
    if (seen.has(key)) return
    seen.add(key)
    dirs.push({ browser, dir })
  }
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA
    if (la) {
      push('chrome', path.join(la, 'Google/Chrome/User Data'))
      push('edge', path.join(la, 'Microsoft/Edge/User Data'))
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME
    if (home) {
      push('chrome', path.join(home, 'Library/Application Support/Google/Chrome'))
      push('edge', path.join(home, 'Library/Application Support/Microsoft Edge'))
    }
  }
  if (cfg) {
    const cds = Array.isArray(cfg.chromeDirs) ? cfg.chromeDirs : []
    const eds = Array.isArray(cfg.edgeDirs) ? cfg.edgeDirs : []
    cds.forEach(d => push('chrome', d))
    eds.forEach(d => push('edge', d))
  }
  return dirs
}

let bookmarksReady = false
let reloadRequired = true
function ensureBookmarks () {
  // 浏览器侧 Bookmarks 文件变化（新增/修改/删除书签）时自动重读，无需手动刷新
  if (!bookmarksReady || reloadRequired || bookmarksChanged()) {
    const cfg = getConfig()
    readBookmarksData(window.ztools.getPath('appData'), { chrome: cfg.chromeDirs, edge: cfg.edgeDirs })
    bookmarksReady = true
    reloadRequired = false
  }
}

let historyCache = null
let historyTs = 0
let historyLoading = null
let historySig = '' // 历史数据库文件签名（路径+mtime），文件变化时强制重读
const HISTORY_TTL = 60 * 1000

// 计算历史数据库文件签名：任一 History 主库文件新增/修改/删除都会改变签名
// （浏览器产生新历史后主库 mtime 变化，重读即可搜到新记录）
function historyFileSignature () {
  try {
    const cfg = getConfig()
    const files = collectHistoryFiles(buildDataDirs(cfg))
    const parts = []
    for (const f of files) {
      let m = 0
      try { m = fs.statSync(f.file).mtimeMs } catch (e) { m = -1 }
      parts.push(f.file + ':' + m)
    }
    return parts.sort().join('|')
  } catch (e) {
    return ''
  }
}

function ensureHistory (force) {
  const sig = historyFileSignature()
  const sigChanged = !!sig && sig !== historySig
  if (sigChanged) historySig = sig
  if (!force && !sigChanged && historyCache && Date.now() - historyTs < HISTORY_TTL) return Promise.resolve(historyCache)
  if (!historyLoading) {
    historyLoading = (async () => {
      try {
        const cfg = getConfig()
        historyCache = await readHistory({ chrome: cfg.chromeDirs, edge: cfg.edgeDirs })
        historySig = sig || historySig
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
function invalidateHistory () { historyCache = null; historyLoading = null; historySig = '' }

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
// FILETIME → 友好访问时间（与 Chrome 历史页类似）：
// 今天显示 HH:mm；今年显示 MM-DD HH:mm；更早显示 YYYY-MM-DD；异常时间戳返回空
function formatVisitTime (ft) {
  const ms = filetimeToMs(ft)
  if (ms == null) return ''
  const d = new Date(ms)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const mdd = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hh + ':' + mm
  if (d.getFullYear() === now.getFullYear()) return mdd + ' ' + hh + ':' + mm
  return d.getFullYear() + '-' + mdd
}

function historyToItem (h) {
  const item = { title: h.title || h.url, url: h.url, browser: h.browser, source: 'history', addAt: h.lastVisit || 0, file: h.file }
  item.timeText = formatVisitTime(h.lastVisit)
  return item
}

function fallbackIcon (browser) {
  return browser === 'edge' ? 'icons/edge.svg' : 'icons/chrome.png'
}

// 描述行：初始只渲染 URL（历史记录条目访问时间跟在 URL 后），类型/浏览器图标由 decorateTypeIcons 注入（避免闪现 emoji）
function formatDescription (item) {
  if (item.source === 'history' && item.timeText) return item.url + '  ' + item.timeText
  return item.url
}

function attachFavicon (item, fmap) {
  const favUrl = getFaviconUrl(item.url, fmap)
  item.icon = favUrl || fallbackIcon(item.browser)
  item.description = formatDescription(item)
  return item
}

function openUrlByChrome (url) {
  if (process.platform === 'win32') {
    const cfg = getConfig()
    const portableExe = cfg.chromeExe
    if (portableExe && fs.existsSync(portableExe)) {
      // 与打开内部页一致：带 --user-data-dir（已做目录层级修正），确保用配置的浏览器配置打开网页
      const args = [url]
      const dataRoot = resolveUserDataRoot(cfg.chromeDirs && cfg.chromeDirs[0])
      if (dataRoot) args.unshift('--user-data-dir=' + dataRoot)
      cp.spawn(portableExe, args, { detached: true })
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
    // start 命令首参数为窗口标题（空引号占位）；协议 URL 必须加引号，否则含 & 等字符会被 cmd 截断
    cp.spawn('start', ['""', '"microsoft-edge:' + url + '"'], { shell: 'cmd.exe', detached: true }).once('error', () => {
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

// 解析搜索词尾部的时间过滤指令，返回 { rest, timeFilter }
// 支持：-t（今天 today）、-w（最近 7 天 week）、-d YYYYMMDD[-YYYYMMDD]（date 区间，单日=当天）
// 日期可不写年份：-d 0901 表示今年 9 月 1 日；跨年区间（如 0901-0101）结束日期自动视为下一年
// 例：`xxx -t`、`chrome历史记录 -w`、`xxx -d 20260901-20261001`、`xxx -d 0901`
function parseTimeFilter (word) {
  const src = (word || '').trim()
  let rest = src
  let timeFilter = null
  // 匹配 -t / -w / -d <4位或8位日期[可选区间]；日期段也可 4位(MMDD)+4位(MMDD)
  const m = src.match(/(^|\s)(-t|-w|-d\s+(?:\d{4}(?:-\d{4})?|\d{8}(?:-\d{8})?))(?=\s|$)/i)
  if (m) {
    const raw = m[2]
    const nowY = new Date().getFullYear()
    const fixY = (s) => s.length === 8 ? s : String(nowY) + s // 4 位 MMDD → 补今年年份
    if (/^-t$/i.test(raw)) {
      timeFilter = { raw, type: 'today' }
    } else if (/^-w$/i.test(raw)) {
      timeFilter = { raw, type: 'week' }
    } else {
      const dm = raw.match(/-d\s+(\d{8}|\d{4})(?:-(\d{8}|\d{4}))?/i)
      let from = fixY(dm[1])
      let to = fixY(dm[2] || dm[1])
      // 跨年区间：结束日期 MMDD 小于开始日期时视为下一年（如 0901-0101 → 2026-0901 至 2027-0101）
      if (Number(to) < Number(from)) to = String(Number(from.slice(0, 4)) + 1) + to.slice(4)
      timeFilter = { raw, type: 'date', from, to }
    }
    rest = (src.slice(0, m.index) + ' ' + src.slice(m.index + m[0].length)).trim().replace(/\s+/g, ' ')
  }
  return { rest, timeFilter }
}

// 本地日期 → YYYYMMDD（用于区间比较）
function ymdNum (d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

// 历史记录条目是否命中时间过滤（addAt 为 FILETIME）
function matchTimeFilter (item, timeFilter) {
  if (!timeFilter || !timeFilter.type) return true
  const ms = filetimeToMs(item.addAt)
  if (ms == null) return false
  const d = new Date(ms)
  const ymd = ymdNum(d)
  if (timeFilter.type === 'today') {
    return ymd === ymdNum(new Date())
  }
  if (timeFilter.type === 'week') {
    const now = new Date()
    // 最近 7 天（含今天，向前推 6 天）
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    return ymd >= ymdNum(start) && ymd <= ymdNum(now)
  }
  if (timeFilter.type === 'date') {
    return ymd >= Number(timeFilter.from) && ymd <= Number(timeFilter.to)
  }
  return true
}

// 解析单个指令 token：支持任意顺序组合，如 -ch / -ed-w / -h-ed-w / -ch-t-h / -t-ch / -chb / -w / -t
// 规则：浏览器（ch/ed）、类型（h/b）、时间（t/w）三类各自最多一个，可任意顺序连写；
// chb/edb 为书签浏览模式（独占，不与其它组合）；同类别冲突（如 -t-w、-h-b、-ch-ed）返回 null
// 返回 null（非指令）或 { browser?, source?, browse?, time? }；-d 需日期参数，由 parseTimeFilter 兜底
function parseDirectiveToken (tok) {
  if (!/^-/.test(tok)) return null
  const t = tok.replace(/^-/, '').toLowerCase()
  if (!t) return null
  // 书签浏览模式（独占）
  if (t === 'chb') return { browse: 'chrome' }
  if (t === 'edb') return { browse: 'edge' }
  // 时间片段：t/w 字符不会出现在 ch/ed/h/b 中，可直接提取；同时去掉连写分隔符 -
  const hasT = t.includes('t')
  const hasW = t.includes('w')
  if (hasT && hasW) return null
  const time = hasT ? 'today' : (hasW ? 'week' : null)
  let s = t.replace(/[tw-]/g, '')
  let browser = null
  let source = null
  // 按固定顺序消费片段；同类重复即冲突
  if (s.includes('ed')) {
    if (browser) return null
    browser = 'edge'
    s = s.replace('ed', '')
  }
  if (s.includes('ch')) {
    if (browser) return null
    browser = 'chrome'
    s = s.replace('ch', '')
  }
  if (s.includes('b')) {
    if (source) return null
    source = 'bookmark'
    s = s.replace('b', '')
  }
  if (s.includes('h')) {
    if (source) return null
    source = 'history'
    s = s.replace('h', '')
  }
  if (s) return null
  const d = {}
  if (browser) d.browser = browser
  if (source) d.source = source
  if (time) d.time = time
  return Object.keys(d).length ? d : null
}

// 统一指令解析：token 级剥离来源/浏览/时间指令，可在关键词前或后、可连写；
// -d 日期参数（-d 0901 / -d 20260901-20261001）由 parseTimeFilter 兜底处理
function parseDirectives (word) {
  const src = (word || '').trim()
  let browser = null
  let source = null
  let browse = null
  const timeParts = []
  const keep = []
  for (const tok of src.split(/\s+/)) {
    const d = parseDirectiveToken(tok)
    if (!d) { keep.push(tok); continue }
    if (d.browse) browse = d.browse
    if (d.browser) browser = d.browser
    if (d.source) source = d.source
    if (d.time) timeParts.push(d.time)
  }
  const rest0 = keep.join(' ')
  const parsed = parseTimeFilter(rest0)
  let timeFilter = parsed.timeFilter
  if (!timeFilter && timeParts.length) timeFilter = { raw: timeParts.join('+'), type: timeParts[0] }
  return { rest: parsed.rest, browser, source, browse, timeFilter }
}

async function searchMerged (keyword, filter) {
  filter = filter || {}
  // 统一解析：来源过滤指令（-ch / -ed / -h / -b / 组合，可连写时间）+ 时间过滤指令（-t / -w / -d）
  const dir = parseDirectives(keyword)
  const word = dir.rest
  const browser = filter.browser || dir.browser || null
  const source = filter.source || dir.source || null
  const timeFilter = dir.timeFilter
  // 书签与历史各自独立读取：任一侧出错不连带影响另一侧（避免书签/历史同时搜索不到）
  let books = []
  try {
    ensureBookmarks()
    // 书签类指令且未输入关键词 → 列出全部书签
    if (source === 'bookmark' && !word) books = (getBookmarksData() || []).slice()
    else books = searchBookmarks(word)
  } catch (e) {}
  let history = []
  try { history = await ensureHistory() } catch (e) { history = [] }
  let hist
  if (word) {
    hist = filterHistory(history, word).map(historyToItem)
  } else if (timeFilter) {
    // 有时间过滤指令时使用全量历史（否则只取少量，会导致指定日期/最近记录搜不全）
    hist = history.map(historyToItem)
  } else {
    hist = history.slice(0, 100).map(historyToItem)
  }
  if (timeFilter) hist = hist.filter(h => matchTimeFilter(h, timeFilter))

  if (browser) {
    books = books.filter(b => b.browser === browser)
    hist = hist.filter(h => h.browser === browser)
  }
  let results = []
  if (!source || source === 'bookmark') results = results.concat(books)
  if (!source || source === 'history') results = results.concat(hist)

  const fmap = faviconMap || new Map()
  results = results.map(item => attachFavicon(item, fmap))
  if (!faviconMap) ensureFavicons().catch(() => {})
  return results
}

// 指令联想：仅在输入「-」（未完成输入）时显示全部指令说明。
// 样式：一栏一条指令（上行指令、下行说明，说明前带类型标签）；
// 点击条目直接把对应指令填入输入框；末行为合并说明（note，整体弱化为描述样式）。
function timeFilterHelp (word) {
  const w = (word || '').trim()
  if (w !== '-') return null
  return [
    { text: '-t', title: '「日期指令」今天的历史记录', directive: '-t' },
    { text: '-w', title: '「日期指令」最近 7 天的历史记录', directive: '-w' },
    { text: '-d', title: '「日期指令」指定日期：-d 0901 或 -d 20260901-20261001', directive: '-d ' },
    { text: '-ch', title: '「浏览器指令」Chrome 书签 + 历史记录', directive: '-ch' },
    { text: '-ed', title: '「浏览器指令」Edge 书签 + 历史记录', directive: '-ed' },
    { text: '-b', title: '「类型指令」仅书签', directive: '-b' },
    { text: '-h', title: '「类型指令」仅历史记录', directive: '-h' },
    { text: '-chb', title: '「书签指令」Chrome 书签浏览模式（含文件夹）', directive: '-chb' },
    { text: '-edb', title: '「书签指令」Edge 书签浏览模式（含文件夹）', directive: '-edb' },
    { text: '不同类型指令可组合（除书签指令），书签无日期搜索，关键词与指令用空格隔开', title: '例如：-ch-t 视频（在 Chrome 今日的历史记录中搜索"视频"）；-ch-b-t（搜索 Chrome 的书签，-t 无效，日期只能搜索历史记录）', note: true, highlight: false }
  ]
}

// 书签浏览模式（-chb / -edb）：输入框驱动，-chb[ 路径key] 渲染对应层级
// 路径key：browser::root（根级）或 browser::root::guid::guid...（文件夹），
// 选择文件夹 → setSubInputValue 写入新路径触发重新渲染；返回上级同理
// 浏览路径判断：chrome/书签栏 或 edge/其他书签 形式（区分关键词搜索）
function isBrowsePath (browse, rest) {
  const r = (rest || '').trim()
  if (!r) return false
  return /^chrome\//.test(r) || /^edge\//.test(r)
}

// 浏览模式数据：-chb / -edb 后跟 / 分隔的中文路径（如 chrome/书签栏/视频）
// 文件夹条目带 folder 图标，书签条目带网站图标+网址+书签类型图标
function browseBookmarksData (browse, pathKey) {
  let tree = null
  try { tree = (readBookmarkTree() || []).find(t => t.browser === browse) } catch (e) { tree = null }
  const browseTok = browse === 'chrome' ? '-chb' : '-edb'
  const browserName = browse === 'chrome' ? 'Chrome' : 'Edge'
  if (!tree) {
    return [{ title: '未找到 ' + browserName + ' 书签文件（请检查数据目录配置）', url: '', browser: browse, source: 'bookmark' }]
  }
  const items = []
  const key = (pathKey || '').trim()
  if (key) {
    const upKey = parentOfBrowseKey(key)
    items.push({ title: '返回上级', url: '', browser: browse, source: 'bookmark', upKey: browseTok + (upKey ? ' ' + upKey : ''), isUp: true, icon: svgUri(ICON_BACK.svg) })
  }
  let nodes = null
  if (!key) {
    nodes = tree.roots
  } else {
    const segs = key.split('/').filter(Boolean) // ['chrome','书签栏','视频']
    const rootName = segs[1] || ''
    const root = tree.roots.find(r => r.name === rootName)
    if (root) {
      nodes = root.children
      let cur = root
      for (let i = 2; i < segs.length; i++) {
        const f = (cur.children || []).find(c => (c.name || '') === segs[i] && Array.isArray(c.children))
        if (!f) { nodes = null; break }
        cur = f
        nodes = f.children
      }
    }
  }
  const fmap = faviconMap || new Map()
  for (const c of (nodes || [])) {
    if (Array.isArray(c.children)) {
      const childKey = key ? key + '/' + (c.name || '(未命名文件夹)') : browse + '/' + (c.name || '书签栏')
      items.push({ title: c.name || '(未命名文件夹)', url: '', browser: browse, source: 'bookmark', folderKey: browseTok + ' ' + childKey, file: tree.file, isFolder: true, icon: svgUri(ICON_FOLDER.svg) })
    } else if (c.url) {
      items.push(attachFavicon({ title: c.name || c.url, url: c.url, browser: browse, source: 'bookmark', file: tree.file, guid: c.guid || '' }, fmap))
    }
  }
  if (!nodes) {
    items.push({ title: '未找到该文件夹，请返回上级重试', url: '', browser: browse, source: 'bookmark', highlight: false })
  }
  if (!faviconMap) ensureFavicons().catch(() => {})
  return items
}

// 浏览路径上级：chrome/书签栏/视频 → chrome/书签栏；只剩 chrome/书签栏 → 空（根级）
function parentOfBrowseKey (key) {
  const segs = (key || '').split('/').filter(Boolean)
  if (segs.length <= 2) return ''
  return segs.slice(0, -1).join('/')
}

// 浏览模式下关键词搜索：结果含文件夹（可进入）与书签（带图标/网址/类型图标）
function searchBrowseBooks (browse, word) {
  try { ensureBookmarks() } catch (e) {}
  const w = (word || '').trim().toLowerCase()
  const items = []
  const fmap = faviconMap || new Map()
  const browseTok = browse === 'chrome' ? '-chb' : '-edb'
  // 1) 文件夹匹配（遍历书签树，含深层文件夹）
  try {
    const tree = (readBookmarkTree() || []).find(t => t.browser === browse)
    if (tree) {
      const walk = (nodes, parentKey) => {
        for (const c of (nodes || [])) {
          if (!Array.isArray(c.children)) continue
          const childKey = parentKey ? parentKey + '/' + (c.name || '(未命名文件夹)') : browse + '/' + (c.name || '书签栏')
          if ((c.name || '').toLowerCase().includes(w)) {
            items.push({ title: c.name || '(未命名文件夹)', url: '', browser: browse, source: 'bookmark', folderKey: browseTok + ' ' + childKey, file: tree.file, isFolder: true, icon: svgUri(ICON_FOLDER.svg) })
          }
          walk(c.children, childKey)
        }
      }
      walk(tree.roots, null)
    }
  } catch (e) {}
  // 2) 书签匹配
  try {
    const books = searchBookmarks(word).filter(b => b.browser === browse)
    for (const b of books) items.push(attachFavicon(b, fmap))
  } catch (e) {}
  if (!faviconMap) ensureFavicons().catch(() => {})
  return items
}

window.ztools.onMainPush(async ({ payload }) => {
  closePickModal()
  // 从设置页返回搜索时：移除设置页覆盖层，恢复官方列表渲染
  removeSettingsOverlay()
  const word = (payload || '').trim()
  if (!word) {
    currentListItems = []
    return { type: 'list', data: [] }
  }
  // 输入 - / -t / -w / -d 等前缀时显示指令联想（不参与实际搜索）
  const help = timeFilterHelp(word)
  if (help) {
    currentListItems = []
    // 官方渲染为异步，下一帧弱化末行帮助说明（失败不影响列表）
    setTimeout(() => { try { weakenHelpNote() } catch (e) {} }, 0)
    return { type: 'list', data: help.map(x => {
      const it = { text: x.text, title: x.title, directive: x.directive || '' }
      if (x.highlight === false) it.highlight = false
      return it
    }) }
  }
  // 书签浏览模式：-chb / -edb [路径key 或 关键词]，按文件夹逐层查看 / 搜索书签
  const dir0 = parseDirectives(word)
  if (dir0.browse) {
    const items = buildBrowseData(dir0.browse, dir0.rest)
    currentSearchCtx = { word, filter: currentSearchFilter, setList: null }
    // 浏览模式不截断条目（文件夹层级可能较多），与插件内搜索路径一致
    const data = items.map(x => ({
      text: x.title,
      title: x.description || '',
      icon: x.icon || '',
      browser: x.browser,
      url: x.url || '',
      source: x.source,
      folderKey: x.folderKey || '',
      upKey: x.upKey || '',
      directive: x.directive || ''
    }))
    setTimeout(() => { try { decorateTypeIcons() } catch (e) {} }, 0)
    return { type: 'list', data }
  }
  const all = await searchMerged(word, {})
  // 全局搜索路径也要维护列表状态：右键菜单取当前条目、删除后刷新、混合搜索图标装饰
  // （否则右键会误用上一次指令搜索的旧数据）
  currentListItems = all
  currentSearchFilter = {}
  currentSearchCtx = { word, filter: {}, setList: null }
  const data = all.slice(0, 6).map(x => ({
    text: x.title + ' ' + x.url,
    title: x.description,
    icon: x.icon,
    browser: x.browser,
    url: x.url,
    source: x.source
  }))
  if (all.length > 6) {
    data.pop()
    data.push({ highlight: false, text: '共搜索到 ' + all.length + ' 条（书签+历史），查看更多...' })
  }
  // 官方渲染为异步（onMainPush 返回后渲染），下一帧再装饰图标（失败不影响列表）
  setTimeout(() => { try { decorateTypeIcons() } catch (e) {} }, 0)
  return { type: 'list', data }
}, ({ option }) => {
  closePickModal()
  // 指令联想：点击条目把指令填入输入框
  if (option && option.directive) {
    window.ztools.setSubInputValue(option.directive)
    return
  }
  // 书签浏览模式：选择文件夹/返回上级 → 更新输入框路径触发重新渲染
  if (option && option.folderKey) {
    window.ztools.setSubInputValue(option.folderKey)
    return
  }
  if (option && option.upKey) {
    window.ztools.setSubInputValue(option.upKey)
    return
  }
  if (!option || !option.url) return
  if (option.browser === 'chrome') openUrlByChrome(option.url)
  else openUrlByEdge(option.url)
})

// ==================== 右键操作菜单 ====================
let currentListItems = null // 当前渲染的搜索结果（供右键菜单取数据）
let contextMenuEl = null
let menuAutoCloseTimer = null // 右键菜单无操作自动关闭计时器

// SVG 图标（data URI 内嵌，避免额外文件）
const svgUri = svg => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
const readSvgText = name => fs.readFileSync(path.join(__dirname, 'icons', name), 'utf-8')
// 地址栏内联图标：将固定白色描边替换为 currentColor，跟随链接文字颜色
const inlineSvg = (name, size) => {
  const svg = readSvgText(name)
    .replace(/stroke="#ffffff"/gi, 'stroke="currentColor"')
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"')
  return { svg, size }
}
// 地址栏内联图标：替换为指定颜色（书签黄 / 历史蓝）
const inlineSvgColor = (name, size, color) => {
  const svg = readSvgText(name)
    .replace(/stroke="#ffffff"/gi, 'stroke="' + color + '"')
    .replace(/fill="#ffffff"/gi, 'fill="' + color + '"')
  return { svg, size }
}
const ICON_BOOKMARK_INLINE = inlineSvgColor('bookmark.svg', 14, '#f6a332')
const ICON_CLOCK_INLINE = inlineSvgColor('history.svg', 14, '#77b0ff')
const ICON_CHROME_INLINE = inlineSvg('brand-chrome.svg', 16)
const ICON_EDGE_INLINE = inlineSvg('brand-edge.svg', 16)
// 书签浏览模式图标：文件夹 / 返回上级（返回图标 12px，圆角 8px）
const ICON_FOLDER = inlineSvg('folder.svg', 16)
const ICON_BACK = inlineSvg('back.svg', 12)
// 菜单图标（跟随字体颜色 currentColor，与附件 SVG 一一对应）
const ICON_COMPASS = inlineSvg('compass.svg', 16)
const ICON_HOME = inlineSvg('home.svg', 16)
const ICON_COPY = inlineSvg('copy.svg', 16)
const ICON_BOOKMARK_MENU = inlineSvg('bookmark.svg', 16)
const ICON_HISTORY_MENU = inlineSvg('history.svg', 16)
const ICON_TRASH = inlineSvg('trash.svg', 16)
// 删除确认浮层图标（跟随 currentColor，颜色由调用处控制）
const ICON_CHECK_SQUARE = inlineSvg('check-square.svg', 16)
const ICON_X = inlineSvg('x.svg', 16)
// 设置页 info 悬浮说明图标（白色描边 → currentColor，跟随主题）
const ICON_INFO = inlineSvg('info.svg', 14)
// 设置页「重新读取」图标（白色描边 → currentColor）
const ICON_ROTATE = inlineSvg('rotate-right.svg', 15)
// 设置页行内操作图标（编辑 / 删除）
const ICON_EDIT_SETTINGS = inlineSvg('edit.svg', 15)
const ICON_TRASH_SETTINGS = inlineSvg('trash.svg', 15)
// 删除确认弹窗警示图标
const ICON_ALERT = inlineSvg('alert-triangle.svg', 18)
// 浏览器卡片右上角复制地址图标
const ICON_COPY_ADDR = inlineSvg('cpu.svg', 16)

let currentSearchFilter = null // 当前搜索的 filter（判断是否混合搜索）
let currentSearchCtx = null // { word, filter, setList } 删除后用于刷新列表

// 创建内联 SVG 元素（颜色继承 currentColor）
// 纯字符串 + innerHTML，不依赖 DOMParser（避免真实环境解析失败导致搜索列表装饰抛异常）
function makeInlineSvg (def) {
  const el = document.createElement('span')
  el.style.cssText = 'display:inline-block;width:' + def.size + 'px;height:' + def.size + 'px;vertical-align:-2px;margin-right:5px;flex-shrink:0;line-height:0;'
  el.innerHTML = def.svg.replace(/<svg([^>]*)>/, (m, attrs) => '<svg' + attrs + ' style="width:100%;height:100%;display:block">')
  return el
}

// 搜索结果描述行：类型图标在前 + 浏览器图标在后（混合搜索显示浏览器图标，单独浏览器搜索不显示）；图标颜色跟随链接文字
// 采用 flex 布局：URL 可伸缩截断为省略号，访问时间固定不收缩，保证长网址时时间始终可见
function decorateTypeIcons () {
  if (!currentListItems) return
  const listEl = document.querySelector('.ztools-list')
  if (!listEl) return
  const isMixed = !(currentSearchFilter && currentSearchFilter.browser)
  const rows = listEl.querySelectorAll('.ztools-li')
  for (let i = 0; i < rows.length; i++) {
    const item = currentListItems[i]
    if (!item || !item.url) continue
    const descEl = rows[i].querySelector('.ztools-li-desc')
    if (!descEl) continue
    // 跳过「共搜索到…查看更多」占位行（其描述行为空，装饰会造成错位）
    if (!descEl.textContent || !descEl.textContent.trim()) continue
    descEl.innerHTML = ''
    descEl.style.display = 'flex'
    descEl.style.alignItems = 'center'
    descEl.style.minWidth = '0'
    const typeDef = item.source === 'history' ? ICON_CLOCK_INLINE : ICON_BOOKMARK_INLINE
    descEl.appendChild(makeInlineSvg(typeDef))
    if (isMixed) {
      const bDef = item.browser === 'edge' ? ICON_EDGE_INLINE : ICON_CHROME_INLINE
      descEl.appendChild(makeInlineSvg(bDef))
    }
    // URL 过长时截断为省略号，保证后面访问时间始终可见
    const urlEl = document.createElement('span')
    urlEl.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    urlEl.textContent = item.url
    descEl.appendChild(urlEl)
    // 历史记录条目访问时间跟在 URL 后（今天=时分，今年=月-日 时分，更早=年-月-日），不参与截断
    if (item.source === 'history' && item.timeText) {
      const tEl = document.createElement('span')
      tEl.style.cssText = 'flex-shrink:0;color:inherit;opacity:.85;margin-left:6px;font-variant-numeric:tabular-nums;'
      tEl.textContent = item.timeText
      descEl.appendChild(tEl)
    }
  }
  // 图标空白检测：http(s) 图标因网络或站点删除加载失败时，自动回退为浏览器图标
  fixBlankIcons()
}

// 搜索结果条目图标：加载失败（http(s) 图标无法显示，表现为空白）自动回退为浏览器图标；
// data URI / 本地回退图标必可渲染，不做检测。
function fixBlankIcons () {
  if (!currentListItems || !currentListItems.length) return
  const listEl = document.querySelector('.ztools-list')
  if (!listEl) return
  const rows = listEl.querySelectorAll('.ztools-li')
  for (let i = 0; i < rows.length; i++) {
    const item = currentListItems[i]
    if (!item) continue
    const row = rows[i]
    if (!row) continue
    const fallback = fallbackIcon(item.browser)
    if (!fallback) continue
    // 1) img 元素（ztools 常用 <img> 渲染图标）
    const iconImg = row.querySelector('img')
    if (iconImg) {
      const src = iconImg.currentSrc || iconImg.src || ''
      if (!src || /^data:/i.test(src)) continue
      if (iconImg.complete && iconImg.naturalWidth === 0) {
        iconImg.src = fallback
      } else if (!iconImg.complete) {
        iconImg.onerror = () => { iconImg.src = fallback }
      }
      continue
    }
    // 2) background-image 元素兜底（部分宿主用背景图渲染图标）
    for (const el of row.querySelectorAll('*')) {
      const bg = el.style && el.style.backgroundImage
      if (!bg || !/url\(/.test(bg)) continue
      const m = bg.match(/url\((["']?)([^"')]+)\1\)/)
      const u = m ? m[2] : ''
      if (!u || /^data:/i.test(u)) continue
      const probe = new Image()
      probe.onerror = () => {
        try { el.style.backgroundImage = "url('" + fallback + "')" } catch (e) {}
      }
      probe.src = u
      break
    }
  }
}

// 指令联想提示页：保持 ztools 默认行距与字号，窗口高度按列表内容自动贴合
// （内容多则窗口高、内容少则窗口矮，无滚动条、无底部空白）；
// 末行主行颜色与副行统一（ztools 主行固定主题色，通过 DOM 改色）。
// 防御式实现：找不到元素或结构变化时静默跳过，不影响列表展示。
function weakenHelpNote () {
  if (!document) return
  const listEl = document.querySelector('.ztools-list')
  if (!listEl) return
  const rows = listEl.querySelectorAll('.ztools-li')
  for (const row of rows) {
    const descEl = row.querySelector('.ztools-li-desc')
    if (!descEl || !descEl.textContent) continue
    if (descEl.textContent.includes('例如：-ch-t')) {
      // 末行：主行文字颜色与副行一致
      let descColor = '#888'
      try { descColor = window.getComputedStyle(descEl).color } catch (e) {}
      const leaves = row.querySelectorAll('div,span,p')
      for (const el of leaves) {
        if (el === descEl || descEl.contains(el)) continue
        if (el.children.length === 0 && el.textContent.trim()) {
          el.style.color = descColor
        }
      }
    }
  }
  // 提示页自动高度：迭代测量，只要列表内容溢出（出现滚动条）就继续撑高窗口，
  // 直到内容完全放下（适配 ztools 容器首次渲染的初始状态，最多 6 次）
  let guard = 0
  const step = () => {
    if (guard++ > 6) return
    try {
      const sh = listEl.scrollHeight
      const ch = listEl.clientHeight
      if (sh > ch + 2) {
        // 余量仅 2px：窗口贴合内容底部，不产生明显空白
        const target = Math.ceil(listEl.getBoundingClientRect().height) + (sh - ch) + 2
        if (window.ztools && typeof window.ztools.setExpendHeight === 'function') {
          window.ztools.setExpendHeight(target)
        }
        if (window.ztools && typeof window.ztools.resizeWindow === 'function') {
          window.ztools.resizeWindow(880, target)
        }
        setTimeout(step, 150)
      }
    } catch (e) {}
  }
  step()
}

function closeContextMenu () {
  if (menuAutoCloseTimer) {
    clearTimeout(menuAutoCloseTimer)
    menuAutoCloseTimer = null
  }
  if (contextMenuEl) {
    contextMenuEl.remove()
    contextMenuEl = null
  }
}

// 右键菜单无操作自动关闭：10 秒内没有点击/移动则自动关闭菜单
// （鼠标悬停在菜单上会不断重置计时，只有长时间完全不操作才关闭）
function armMenuAutoClose (menu) {
  const reset = () => {
    if (menuAutoCloseTimer) clearTimeout(menuAutoCloseTimer)
    menuAutoCloseTimer = setTimeout(closeContextMenu, 10000)
  }
  menu.addEventListener('mousemove', reset)
  menu.addEventListener('click', reset)
  reset()
}

function openItem (item) {
  if (item && item.browser === 'chrome') openUrlByChrome(item.url)
  else if (item) openUrlByEdge(item.url)
}

function exitAfterAction () {
  closePickModal()
  window.ztools.hideMainWindow(false)
  window.ztools.outPlugin()
}

// 从 User Data 目录向上倒推便携版浏览器 exe（便携版常见结构：根目录/App/chrome.exe 等）
function findExeNearDataDir (dataDir, exeName) {
  if (!dataDir || typeof dataDir !== 'string') return ''
  const candidates = []
  let base = path.dirname(dataDir)
  for (let depth = 0; depth < 4; depth++) {
    if (!base || base === path.dirname(base)) break
    candidates.push(path.join(base, exeName))
    candidates.push(path.join(base, 'App', exeName))
    candidates.push(path.join(base, 'App', 'Chrome-bin', exeName))
    candidates.push(path.join(base, 'Chrome', 'Application', exeName))
    candidates.push(path.join(base, 'Application', exeName))
    base = path.dirname(base)
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c } catch (e) {}
  }
  return ''
}

// 打开浏览器内部页（书签管理器 / 历史页）
// 内部页（chrome://、edge://）不能用 shellOpenExternal（Electron 不支持该协议），必须直接用浏览器 exe 启动
// 返回 true 表示已找到 exe 并打开；返回 false 表示弹出选择浮层等待用户操作（调用方不应退出插件）
// 打开浏览器内部页（书签管理器 / 历史记录）：
// Chrome/Edge 官方不支持把 chrome://、edge:// 内部 URL 作为命令行参数传递（会被浏览器丢弃并落到 newtab），
// 因此这里改为：启动/聚焦浏览器窗口 → 隐藏 ztools 让出焦点 → 模拟浏览器内置快捷键
//   书签管理器 Ctrl+Shift+O；历史记录 Ctrl+H（不依赖命令行参数，稳定可靠）
// 修正 --user-data-dir 层级：配置的目录可能是个人资料目录（User Data\Default，直接含 Bookmarks/History 文件），
// 但 Chrome/Edge 的 --user-data-dir 必须指向 User Data 根目录，否则浏览器会把它当根目录创建全新空 profile
// （表现为打开的浏览器没有登录用户、书签历史为空）。
// 规则：目录下直接存在 Bookmarks 或 History 文件 → 视为个人资料目录，向上取父目录；否则原样返回。
function resolveUserDataRoot (dir) {
  if (!dir || typeof dir !== 'string') return ''
  try {
    if (fs.existsSync(path.join(dir, 'Bookmarks')) || fs.existsSync(path.join(dir, 'History'))) {
      const parent = path.dirname(dir)
      return parent === dir ? dir : parent
    }
  } catch (e) {}
  return dir
}

function spawnBrowserPage (exe, dataDir, url) {
  const isBookmarks = url.indexOf('bookmarks') >= 0
  // 1) 隐藏 ztools 主窗口并让出焦点（不恢复之前的窗口，避免按键被 ztools 吃掉）
  try { window.ztools.hideMainWindow(false) } catch (e) {}
  // 2) 启动/激活浏览器：只带 --user-data-dir（确保用便携版数据目录），不带 URL——
  //    chrome://、edge:// 不能作为命令行参数传递（会被浏览器丢弃并落到 newtab）。
  //    若浏览器已在运行且数据目录相同，Chrome 会激活已有窗口；否则启动新窗口
  const args = []
  const dataRoot = resolveUserDataRoot(dataDir)
  if (dataRoot) args.push('--user-data-dir=' + dataRoot)
  try { cp.spawn(exe, args, { detached: true }) } catch (e) {}
  // 3) 等待浏览器窗口激活后模拟一次快捷键（只发一次，避免页面打开后重复触发造成跳动）
  setTimeout(() => {
    try {
      if (isBookmarks) window.ztools.simulateKeyboardTap('o', 'control', 'shift')
      else window.ztools.simulateKeyboardTap('h', 'control')
    } catch (e) {}
  }, 1500)
}

function openBrowserPage (browser, page) {
  const url = browser === 'edge' ? 'edge://' + page : 'chrome://' + page
  const cfg = getConfig()
  if (browser === 'chrome') {
    // 1) 已配置 chrome.exe（用户手动选择的便携版 exe）→ 启动/聚焦该浏览器后用内置快捷键打开内部页
    if (cfg.chromeExe && fs.existsSync(cfg.chromeExe)) {
      spawnBrowserPage(cfg.chromeExe, cfg.chromeDirs && cfg.chromeDirs[0], url)
      return true
    }
    // 2) 从 User Data 目录倒推便携版 chrome.exe
    const dataDir = cfg.chromeDirs && cfg.chromeDirs[0]
    const exe = findExeNearDataDir(dataDir, 'chrome.exe')
    if (exe) {
      spawnBrowserPage(exe, dataDir, url)
      return true
    }
    // 3) 找不到 → 弹出解释浮层让用户选择便携版 chrome.exe（保存后立即打开），不再静默失败
    pickAndOpenBrowserExe(url, 'chrome')
    return false
  }
  // Edge：已配置的 edgeExe → 倒推 → 系统安装路径
  let exe = cfg.edgeExe && fs.existsSync(cfg.edgeExe) ? cfg.edgeExe : ''
  if (!exe) exe = findExeNearDataDir(cfg.edgeDirs && cfg.edgeDirs[0], 'msedge.exe')
  if (!exe && process.platform === 'win32') {
    const suffixes = [
      `${path.sep}Microsoft${path.sep}Edge${path.sep}Application${path.sep}msedge.exe`,
      `${path.sep}Program Files (x86)${path.sep}Microsoft${path.sep}Edge${path.sep}Application${path.sep}msedge.exe`,
      `${path.sep}Program Files${path.sep}Microsoft${path.sep}Edge${path.sep}Application${path.sep}msedge.exe`
    ]
    const root = path.parse(process.env.PROGRAMFILES || 'C:\\').root || 'C:\\'
    exe = suffixes.map(s => path.join(root, s)).find(p => fs.existsSync(p)) || ''
  }
  const dir = cfg.edgeDirs && cfg.edgeDirs[0]
  if (exe) {
    spawnBrowserPage(exe, dir, url)
    return true
  }
  // 找不到 → 弹出解释浮层让用户选择便携版 msedge.exe
  pickAndOpenBrowserExe(url, 'edge')
  return false
}

// 兼容各版本 ztools 的 showOpenDialog 返回值：
// 旧版同步 {filePaths:[]}；新版可能返回数组；部分版本包 {data:...}；Electron 风格返回 Promise
async function dialogFilePaths (res) {
  // 数组元素可能是字符串，也可能是 {path}/{filePath}/{name} 形式的对象
  const toPath = (x) => {
    if (x == null) return ''
    if (typeof x === 'string') return x.trim()
    if (typeof x === 'object') return String(x.path || x.filePath || x.file || x.name || '').trim()
    return ''
  }
  try {
    if (!res) return []
    // Promise 形态先解开
    const value = (typeof res.then === 'function') ? await res : res
    if (!value) return []
    if (Array.isArray(value)) return value.map(toPath).filter(Boolean)
    // 个别版本以字符串返回，多条路径用换行/分号分隔
    if (typeof value === 'string') return value.split(/[\r\n;]+/).map(x => x.trim()).filter(Boolean)
    // {data: ...} 解包
    const d = value.data !== undefined ? value.data : value
    if (!d) return []
    if (Array.isArray(d)) return d.map(toPath).filter(Boolean)
    if (typeof d === 'string') return d.split(/[\r\n;]+/).map(x => x.trim()).filter(Boolean)
    // {filePaths:[]} / {paths:[]} / {files:[]}
    const arr = d.filePaths || d.paths || d.files || null
    return Array.isArray(arr) ? arr.map(toPath).filter(Boolean) : []
  } catch (e) { return [] }
}

// 弹窗选择浏览器 exe 并打开内部页（保存到配置，后续直接使用）
// 模态解释浮层：说明原因 → 点击选择 → 显示路径 → 确认/重新选择/取消
let pickModalEl = null
function closePickModal () {
  if (pickModalEl) { pickModalEl.remove(); pickModalEl = null }
}
function pickAndOpenBrowserExe (url, browser) {
  closeContextMenu()
  closePickModal()
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const bg = dark ? '#2b2b2b' : '#ffffff'
  const fg = dark ? '#e5e5e5' : '#1a1a1a'
  const sub = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.62)'
  const hoverBg = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'
  const isEdge = url.startsWith('edge')
  const exeName = isEdge ? 'msedge.exe' : 'chrome.exe'
  const pageName = url.indexOf('bookmarks') >= 0 ? '书签管理器' : '历史页'

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
  const card = document.createElement('div')
  card.style.cssText = 'width:430px;max-width:90vw;background:' + bg + ';border:1px solid ' + border + ';border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:18px 18px 14px;box-sizing:border-box;'
  overlay.appendChild(card)

  const title = document.createElement('div')
  title.style.cssText = 'font-size:14px;font-weight:600;color:' + fg + ';margin-bottom:8px;'
  title.textContent = isEdge ? '未找到 Edge 浏览器程序' : '未找到 Chrome 浏览器程序'
  card.appendChild(title)

  const desc = document.createElement('div')
  desc.style.cssText = 'font-size:12px;color:' + sub + ';line-height:1.65;margin-bottom:14px;word-break:break-all;'
  desc.textContent = (isEdge ? 'Edge' : 'Chrome') + ' 程序未配置，请手动选择' + (isEdge ? 'Edge' : 'Chrome') + ' 的 ' + exeName + '。选择后会记住，下次直接使用。可在设置页面进行修改。'
  card.appendChild(desc)

  const pathBox = document.createElement('div')
  pathBox.style.cssText = 'display:none;font-size:12px;color:' + fg + ';background:' + hoverBg + ';border-radius:6px;padding:8px 10px;margin-bottom:12px;word-break:break-all;'
  card.appendChild(pathBox)

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center;'
  card.appendChild(btnRow)

  const mkBtn = (label, primary, hidden) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'padding:6px 14px;font-size:12px;border-radius:6px;cursor:pointer;border:1px solid ' + (primary ? '#3370ff' : border) + ';background:' + (primary ? '#3370ff' : 'transparent') + ';color:' + (primary ? '#fff' : fg) + ';'
    if (hidden) b.style.display = 'none'
    if (!primary) {
      b.addEventListener('mouseenter', () => { b.style.background = hoverBg })
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent' })
    }
    btnRow.appendChild(b)
    return b
  }

  let chosen = ''
  const pickBtn = mkBtn('选择' + (isEdge ? ' Edge' : ' Chrome') + ' 的 ' + exeName, false, false)
  const reselectBtn = mkBtn('重新选择', false, true)
  const confirmBtn = mkBtn('确认', true, true)
  const cancelBtn = mkBtn('取消', false, false)

  const doPick = async () => {
    const res = window.ztools.showOpenDialog({
      title: '选择' + (isEdge ? ' Edge' : ' Chrome') + ' 的 ' + exeName,
      properties: ['openFile'],
      filters: [{ name: isEdge ? 'Edge' : 'Chrome', extensions: ['exe'] }]
    })
    const paths = await dialogFilePaths(res)
    const fp = paths && paths[0]
    if (!fp) {
      window.ztools.showToast('未获取到选择的文件，请重新选择')
      return
    }
    chosen = fp
    pathBox.textContent = '已选择：' + fp
    pathBox.style.display = 'block'
    pickBtn.style.display = 'none'
    reselectBtn.style.display = ''
    confirmBtn.style.display = ''
  }
  pickBtn.addEventListener('click', doPick)
  reselectBtn.addEventListener('click', doPick)
  confirmBtn.addEventListener('click', () => {
    const cfg = getConfig()
    if (isEdge) cfg.edgeExe = chosen
    else cfg.chromeExe = chosen
    saveConfig(cfg)
    const dataDir = isEdge ? (cfg.edgeDirs && cfg.edgeDirs[0]) : (cfg.chromeDirs && cfg.chromeDirs[0])
    spawnBrowserPage(chosen, dataDir, url)
    closePickModal()
    window.ztools.showToast('已设置' + (isEdge ? ' Edge' : ' Chrome') + '程序，正在打开' + pageName)
  })
  cancelBtn.addEventListener('click', closePickModal)

  document.body.appendChild(overlay)
  pickModalEl = overlay
}

// 删除确认浮层（点击确认后原地显示结果，不再弹 toast）
function confirmDelete (item) {
  closeContextMenu()
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const bg = dark ? '#2b2b2b' : '#ffffff'
  const fg = dark ? '#e5e5e5' : '#1a1a1a'
  const hoverBg = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'
  const menu = document.createElement('div')
  menu.style.cssText = 'position:fixed;z-index:99999;min-width:250px;max-width:380px;background:' + bg + ';border:1px solid ' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)') + ';border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.18);padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
  const hint = document.createElement('div')
  hint.style.cssText = 'display:flex;align-items:center;gap:6px;padding:9px 12px;font-size:12px;color:' + (dark ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)') + ';word-break:break-all;'
  const hintIcon = document.createElement('span')
  hintIcon.style.cssText = 'display:none;width:16px;height:16px;flex-shrink:0;line-height:0;'
  const hintText = document.createElement('span')
  hintText.textContent = '确认删除：' + (item.title || item.url)
  hint.appendChild(hintIcon)
  hint.appendChild(hintText)
  menu.appendChild(hint)
  const mkRow = (label, color, cb, onClose) => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 10px;font-size:13px;color:' + color + ';cursor:pointer;border-radius:6px;'
    const span = document.createElement('span')
    span.textContent = label
    row.appendChild(span)
    row.addEventListener('mouseenter', () => { row.style.background = hoverBg })
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent' })
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      if (onClose) { closeContextMenu(); cb() } else { cb() }
    })
    menu.appendChild(row)
    return row
  }
  const confirmRow = mkRow('✕ 确认删除', '#e74c3c', () => {
    // 原地执行删除，成功后直接改写浮层内容显示结果
    confirmRow.style.pointerEvents = 'none'
    cancelRow.style.pointerEvents = 'none'
    hintText.textContent = '正在删除…'
    hintIcon.style.display = 'inline-flex'
    hintIcon.style.color = fg
    hintIcon.innerHTML = ''
    hintIcon.appendChild(makeInlineSvg(ICON_X).firstChild)
    doDelete(item).then(res => {
      // 删除结果提示（已删除/删除失败）下方不再显示分隔横线，仅保留"确认删除"提示阶段的横线
      hint.style.borderBottom = 'none'
      hint.style.marginBottom = '0'
      if (res && res.ok) {
        hintText.textContent = res.msg || '已删除'
        hintIcon.style.color = '#2ecc71'
        hintIcon.innerHTML = ''
        hintIcon.appendChild(makeInlineSvg(ICON_CHECK_SQUARE).firstChild)
      } else if (res && res.synced) {
        // 账号同步书签：本地删除会被云端恢复，提示去浏览器书签管理器中删除
        hintText.textContent = res.msg || '该用户已开启书签同步，请到浏览器书签管理器中删除'
        hintIcon.style.color = '#e74c3c'
        hintIcon.innerHTML = ''
        hintIcon.appendChild(makeInlineSvg(ICON_X).firstChild)
      } else {
        hintText.textContent = '删除失败：' + ((res && res.msg) || '未知错误')
        hintIcon.style.color = '#e74c3c'
        hintIcon.innerHTML = ''
        hintIcon.appendChild(makeInlineSvg(ICON_X).firstChild)
      }
      confirmRow.style.display = 'none'
      cancelRow.style.display = 'none'
      // 停留片刻后关闭浮层并刷新列表
      setTimeout(() => { closeContextMenu(); refreshCurrentList() }, 2600)
    })
  }, false)
  const cancelRow = mkRow('取消', fg, () => {}, true)
  document.body.appendChild(menu)
  const mw = menu.offsetWidth
  // 高度自适应窗口：按单条行高取整数倍，保证每条完整显示，超出部分滚动
  const firstRow = menu.querySelector(':scope > div')
  const rowH = firstRow ? firstRow.offsetHeight : 33
  const availH = Math.max(rowH, window.innerHeight - 10)
  const maxRows = Math.max(1, Math.floor(availH / rowH))
  // border-box 下 max-height 直接限制浮层总高度，内容区正好 N 条
  menu.style.boxSizing = 'border-box'
  const maxH = maxRows * rowH + 10
  menu.style.maxHeight = maxH + 'px'
  menu.style.overflowY = 'auto'
  const needScroll = menu.scrollHeight > menu.clientHeight
  const mh = menu.offsetHeight
  let left = 0
  let top = 0
  if (typeof item._mx === 'number' && typeof item._my === 'number') {
    left = item._mx; top = item._my
    if (left + mw > window.innerWidth) left = Math.max(0, window.innerWidth - mw - 4)
    // 需要滚动（窗口矮）时垂直居中，保证显示的一条完整居中
    if (needScroll) {
      top = Math.max(0, Math.round((window.innerHeight - mh) / 2))
    } else if (top + mh > window.innerHeight) {
      top = Math.max(0, window.innerHeight - mh - 4)
    }
  }
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  contextMenuEl = menu
  if (needScroll) {
    // 窗口矮需要滚动时：先显示顶部文字条目，停留 1 秒后自动平滑滚动到「确认删除」按钮
    applyRowScroll(menu, rowH)
    menu.scrollTop = 0
    setTimeout(() => {
      if (confirmRow && menu.scrollTo) {
        menu.scrollTo({ top: Math.max(0, confirmRow.offsetTop - 4), behavior: 'smooth' })
      }
    }, 1000)
  } else {
    // 正常情况（窗口够高、不需要滚动）：恢复旧样式——提示文字下方带分隔横线
    hint.style.borderBottom = '1px solid ' + (dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)')
    hint.style.marginBottom = '4px'
  }
}

// 执行删除：书签删 JSON 节点 + 重算 checksum；历史删 SQLite 记录
// 返回结果对象，由删除确认浮层原地显示（不再弹 toast）
async function doDelete (item) {
  let res
  if (item.source === 'bookmark') {
    res = deleteBookmarkEntry(item.file, item.url, item.title)
  } else {
    res = await deleteHistoryEntry(item.file, item.url)
  }
  if (res && res.ok) {
    // 刷新缓存并重读（书签/历史删除不影响 favicon 数据库，保留图标缓存避免回退图标）
    bookmarksReady = false
    reloadRequired = true
    invalidateHistory()
  }
  return res || { ok: false, msg: '删除失败' }
}

// 删除后刷新当前搜索结果列表
function refreshCurrentList () {
  if (!currentSearchCtx || !currentSearchCtx.setList) return
  const { word, filter, setList } = currentSearchCtx
  ensureBookmarks()
  searchMerged(word || '', filter || {}).then(list => {
    currentListItems = list
    setList(list)
    try { decorateTypeIcons() } catch (e) {} // 装饰失败不影响列表展示
  }).catch(() => {
    currentListItems = []
    setList([])
  })
}

function showContextMenu (item, x, y) {
  closeContextMenu()
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const bg = dark ? '#2b2b2b' : '#ffffff'
  const fg = dark ? '#e5e5e5' : '#1a1a1a'
  const hoverBg = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)'
  item._mx = x
  item._my = y
  const actions = []
  // 通用操作（排序：打开网页 → 复制链接 → 默认浏览器打开）
  actions.push({ iconDef: ICON_COMPASS, label: '打开网页', run: () => { openItem(item); exitAfterAction() } })
  actions.push({ iconDef: ICON_COPY, label: '复制链接', feedback: '复制成功', run: () => { window.ztools.copyText(item.url) } })
  actions.push({ iconDef: ICON_HOME, label: '默认浏览器打开', run: () => { window.ztools.shellOpenExternal(item.url); exitAfterAction() } })
  // 类型专属操作（排序：打开对应管理页 → 删除）
  if (item.source === 'bookmark') {
    actions.push({ iconDef: ICON_BOOKMARK_MENU, label: '打开书签管理器', run: () => { if (openBrowserPage(item.browser, 'bookmarks')) exitAfterAction() } })
    actions.push({ iconDef: ICON_TRASH, label: '删除书签', selfClose: true, run: () => confirmDelete(item) })
  } else if (item.source === 'history') {
    actions.push({ iconDef: ICON_HISTORY_MENU, label: '打开历史记录页', run: () => { if (openBrowserPage(item.browser, 'history')) exitAfterAction() } })
    actions.push({ iconDef: ICON_TRASH, label: '删除历史记录', selfClose: true, run: () => confirmDelete(item) })
  }
  const menu = document.createElement('div')
  menu.style.cssText = 'position:fixed;z-index:99999;min-width:210px;background:' + bg + ';border:1px solid ' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)') + ';border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.18);padding:4px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
  actions.forEach(a => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 10px;font-size:13px;color:' + fg + ';cursor:pointer;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    const iconEl = makeInlineSvg(a.iconDef)
    iconEl.style.cssText = 'display:inline-flex;width:16px;height:16px;flex-shrink:0;line-height:0;'
    const span = document.createElement('span')
    span.textContent = a.label
    span.style.cssText = 'display:inline-block;transition:transform .25s ease, opacity .25s ease;'
    row.appendChild(iconEl)
    row.appendChild(span)
    row.addEventListener('mouseenter', () => { row.style.background = hoverBg })
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent' })
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      a.run()
      if (a.feedback) {
        // 文字上滑淡出
        span.style.transform = 'translateY(-100%)'
        span.style.opacity = '0'
        setTimeout(() => {
          // 替换为反馈文字，从下方滑入
          span.textContent = a.feedback
          span.style.color = '#2ecc71'
          span.style.transition = 'none'
          span.style.transform = 'translateY(100%)'
          span.style.opacity = '0'
          requestAnimationFrame(() => {
            span.style.transition = 'transform .25s ease, opacity .25s ease'
            span.style.transform = 'translateY(0)'
            span.style.opacity = '1'
          })
          // 动画完全结束后直接关闭菜单
          setTimeout(closeContextMenu, 280 + 280)
        }, 280)
      } else if (!a.selfClose) {
        closeContextMenu()
      }
    })
    menu.appendChild(row)
  })
  document.body.appendChild(menu)
  const mw = menu.offsetWidth
  // 菜单高度自适应窗口：按单条行高取整数倍，保证每条菜单完整显示，超出部分滚动查看
  const firstRow = menu.querySelector(':scope > div')
  const rowH = firstRow ? firstRow.offsetHeight : 33
  const availH = Math.max(rowH, window.innerHeight - 10) // 底部留 10px 边距
  const maxRows = Math.max(1, Math.floor(availH / rowH))
  // border-box 下 max-height 直接限制菜单框总高度（含 padding/border），内容区正好 N 条
  menu.style.boxSizing = 'border-box'
  const maxH = maxRows * rowH + 10 // padding 4+4 + border 1+1
  menu.style.maxHeight = maxH + 'px'
  menu.style.overflowY = 'auto'
  const needScroll = menu.scrollHeight > menu.clientHeight
  const mh = menu.offsetHeight // 实际总高度（含 padding/border，已被 max-height 限制）
  let left = x
  let top = y
  if (left + mw > window.innerWidth) left = Math.max(0, window.innerWidth - mw - 4)
  // 菜单需要滚动（窗口矮、装不下全部）时：垂直居中于可视区域，保证显示的一条完整居中
  if (needScroll) {
    top = Math.max(0, Math.round((window.innerHeight - mh) / 2))
  } else if (top + mh > window.innerHeight) {
    top = Math.max(0, window.innerHeight - mh - 4)
  }
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  contextMenuEl = menu
  // 滚轮整条控制：每次滚动只翻一条，防止轻轻一滚跳多条
  if (needScroll) applyRowScroll(menu, rowH)
  // 无操作自动关闭：长时间不点击/不移动鼠标则自动收起菜单
  armMenuAutoClose(menu)
}

// 将菜单滚动绑定为整条切换：滚轮每次只前进/后退一条菜单
function applyRowScroll (menu, rowH) {
  menu.addEventListener('wheel', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const maxTop = menu.scrollHeight - menu.clientHeight
    if (maxTop <= 0) return
    const curIdx = Math.round(menu.scrollTop / rowH)
    const dir = e.deltaY > 0 ? 1 : -1
    const maxIdx = Math.round(maxTop / rowH)
    const nextIdx = Math.max(0, Math.min(curIdx + dir, maxIdx))
    menu.scrollTop = nextIdx * rowH
  }, { passive: false })
}

document.addEventListener('contextmenu', (e) => {
  const li = e.target && e.target.closest ? e.target.closest('.ztools-li') : null
  if (!li || !currentListItems) return
  const idx = parseInt(li.getAttribute('data-index'), 10)
  const item = currentListItems[idx]
  if (!item || !item.url) return
  e.preventDefault()
  e.stopPropagation()
  showContextMenu(item, e.clientX, e.clientY)
}, true)

document.addEventListener('click', (e) => {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) closeContextMenu()
}, true)
// 滚动浏览搜索结果列表时自动关闭菜单；菜单内部滚动（逐条切换）不关闭
document.addEventListener('wheel', (e) => {
  if (!contextMenuEl) return
  if (contextMenuEl.contains(e.target)) return
  closeContextMenu()
}, true)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu()
})
window.addEventListener('blur', closeContextMenu)

// 书签浏览模式数据构建（onMainPush 与 makeSearchAction.search 共用）
// rest 为浏览路径（chrome/书签栏）→ 文件夹导航；为关键词 → 搜索该浏览器书签（含文件夹）；空 → 根级
function buildBrowseData (browse, rest) {
  // 确保书签文件已加载（首次使用浏览模式时 BOOKMARK_FILES 可能为空）
  try { ensureBookmarks() } catch (e) {}
  const r = (rest || '').trim()
  let items
  if (r && isBrowsePath(browse, r)) items = browseBookmarksData(browse, r)
  else if (r) items = searchBrowseBooks(browse, r)
  else items = browseBookmarksData(browse, '')
  currentListItems = items
  currentSearchFilter = { source: 'bookmark', browser: browse }
  return items
}

// 判断输入是否为「指令触发词」：选中插件后输入框应清空（如 书签 / shuqian / 历史记录 / chrome书签 等），
// 其他输入（如 icon / 视频）作为搜索词保留在输入框
const CMD_TRIGGERS = ['书签', 'shuqian', 'sq', '历史记录', '历史', 'lishijilu', '设置', 'shezhi', '浏览', 'liulan', '书签浏览', '书签与历史记录搜索', '书签与历史记录设置', 'chrome书签', 'edge书签', 'chrome历史记录', 'edge历史记录']
function isCmdTrigger (word) {
  const w = (word || '').trim().toLowerCase().replace(/\s+/g, '')
  return CMD_TRIGGERS.some(t => w === t.toLowerCase().replace(/\s+/g, ''))
}

function makeSearchAction (filter, keepInput) {
  return {
    mode: 'list',
    args: {
      enter: (action, callbackSetList) => {
        closePickModal()
        // 从设置页切回搜索模式：移除设置页覆盖层，恢复官方列表渲染
        removeSettingsOverlay()
        try { ensureBookmarks() } catch (e) {}
        ensureHistory().catch(() => {})
        ensureFavicons().catch(() => {})
        currentSearchFilter = filter || {}
        currentSearchCtx = { word: '', filter: filter || {}, setList: callbackSetList }
        // 指令触发词（书签/shuqian 等）→ 清空输入框，等待用户输入搜索内容；普通搜索词保留
        if (keepInput && action.payload && typeof action.payload === 'string' && !isCmdTrigger(action.payload)) {
          setTimeout(() => { window.ztools.setSubInputValue(action.payload) })
        }
      },
      search: async (action, searchWord, callbackSetList) => {
        closePickModal()
        // 书签浏览模式：-chb / -edb [路径key]
        const dir = parseDirectives(searchWord)
        if (dir.browse) {
          const items = buildBrowseData(dir.browse, dir.rest)
          currentSearchCtx = { word: searchWord || '', filter: currentSearchFilter, setList: callbackSetList }
          callbackSetList(items)
          try { decorateTypeIcons() } catch (e) {}
          return
        }
        // 输入「-」显示全部指令说明
        const help = timeFilterHelp(searchWord)
        if (help) {
          currentListItems = []
          currentSearchCtx = { word: searchWord || '', filter: filter || {}, setList: callbackSetList }
          callbackSetList(help.map(x => {
            const it = { title: x.text, description: x.title, url: '', browser: '', source: '', directive: x.directive || '' }
            if (x.highlight === false) it.highlight = false
            return it
          }))
          // 弱化末行帮助说明（官方渲染后执行，失败不影响列表）
          setTimeout(() => { try { weakenHelpNote() } catch (e) {} }, 0)
          return
        }
        currentSearchFilter = filter || {}
        currentSearchCtx = { word: searchWord || '', filter: filter || {}, setList: callbackSetList }
        try {
          const list = await searchMerged(searchWord, filter)
          currentListItems = list
          callbackSetList(list)
          // 官方渲染为同步，紧跟装饰可同帧显示图标（避免图标晚一步出现）
          // 装饰失败不影响列表展示，单独捕获
          try { decorateTypeIcons() } catch (e) {}
        } catch (e) {
          currentListItems = []
          callbackSetList([])
        }
      },
      select: (action, itemData) => {
        closePickModal()
        // 指令联想：点击条目把指令填入输入框
        if (itemData && itemData.directive) {
          window.ztools.setSubInputValue(itemData.directive)
          return
        }
        // 书签浏览模式：选择文件夹/返回上级 → 更新输入框路径触发重新渲染
        if (itemData && itemData.folderKey) {
          window.ztools.setSubInputValue(itemData.folderKey)
          return
        }
        if (itemData && itemData.upKey) {
          window.ztools.setSubInputValue(itemData.upKey)
          return
        }
        if (!itemData || !itemData.url) return
        window.ztools.hideMainWindow(false)
        if (itemData.browser === 'chrome') openUrlByChrome(itemData.url)
        else openUrlByEdge(itemData.url)
        window.ztools.outPlugin()
      }
    }
  }
}

// 取路径最后一段做短标题（悬停可看完整路径）
function shortName (p) {
  try {
    const base = path.basename(String(p).replace(/[\\/]+$/, ''))
    return base || p
  } catch (e) {
    return p
  }
}

// ==================== 指令说明 ====================
// 指令体系已改为全局搜索框输入后缀指令（见 timeFilterHelp / parseDirectives）：
// -ch / -ed / -h / -b / -chb / -edb / 时间指令 -t / -w / -d
// 以及时间指令 -t / -w / -d。独立的中文指令（书签 / chrome书签 等）已移除。

window.exports = {
  search: makeSearchAction({}, true)
  // 注意：settings 不放入 window.exports。
  // 主进程 getPluginMode 读到 undefined → 走「有界面插件」分支 → 派发 PluginEnter
  // → 由下方 renderSettingsPage() 动态注入完整设置页 UI（卡片+按钮+弹窗）
}

try { ensureBookmarks() } catch (e) {}
ensureHistory().catch(() => {})
ensureFavicons().catch(() => {})

// ─────────────────────────────────────────────
// 设置页：自定义 HTML 渲染（卡片 + 按钮 + 弹窗 + toast）
// 参照 web-search 插件的实现：plugin.json 声明 main: index.html，
// settings 不注册为 list 模式，主进程派发 PluginEnter 事件，这里动态注入 UI。
// ─────────────────────────────────────────────

function escHtml (s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showSettingsToast (msg) {
  const root = document.getElementById('bh-settings-root')
  if (!root) return
  let t = document.getElementById('bh-settings-toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'bh-settings-toast'
    root.appendChild(t)
  }
  const dark = !!(document.documentElement.classList && document.documentElement.classList.contains('dark'))
  t.textContent = msg
  t.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
    'background:' + (dark ? 'rgba(15,23,41,.94)' : 'rgba(255,255,255,.96)') + ';' +
    'color:' + (dark ? '#fff' : '#111') + ';' +
    'border:1px solid ' + (dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.1)') + ';' +
    'padding:8px 18px;border-radius:16px;' +
    'font-size:13px;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,.25);transition:opacity .25s;' +
    'white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;'
  t.style.opacity = '1'
  clearTimeout(t._tm)
  t._tm = setTimeout(() => { t.style.opacity = '0' }, 1800)
}

function openSettingsModal (title, message, confirmLabel) {
  return new Promise((resolvePromise) => {
    const root = document.getElementById('bh-settings-root')
    if (!root) { resolvePromise(false); return }
    let overlay = document.getElementById('bh-settings-modal')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'bh-settings-modal'
      root.appendChild(overlay)
    }
    overlay.innerHTML =
      '<div class="bh-modal-mask"></div>' +
      '<div class="bh-modal-box">' +
      '<div class="bh-modal-title"><span class="bh-modal-alert">' + makeInlineSvgHtml(ICON_ALERT) + '</span>' + escHtml(title) + '</div>' +
      '<div class="bh-modal-msg">' + escHtml(message) + '</div>' +
      '<div class="bh-modal-actions">' +
      '<button class="bh-btn bh-btn-plain" data-bh="cancel">取消</button>' +
      '<button class="bh-btn bh-btn-confirm" data-bh="confirm">' + escHtml(confirmLabel || '确定') + '</button>' +
      '</div></div>'
    overlay.style.display = 'flex'
    // 同时保存 Promise resolve 与 done（done 内部调用 Promise resolve，避免递归）
    const done = (val) => {
      overlay.style.display = 'none'
      overlay.innerHTML = ''
      resolvePromise(val)
    }
    overlay.querySelector('[data-bh="cancel"]').onclick = () => done(false)
    overlay.querySelector('[data-bh="confirm"]').onclick = () => done(true)
    overlay.querySelector('.bh-modal-mask').onclick = () => done(false)
  })
}

function buildSettingsHtml () {
  const cfg = getConfig()
  const chromeDirs = cfg.chromeDirs || []
  const edgeDirs = cfg.edgeDirs || []

  // info 悬浮说明（长解释放入 tooltip，不占版面）
  const info = (text) =>
    '<span class="bh-info-wrap">' +
    '<span class="bh-info">' + makeInlineSvgHtml(ICON_INFO) + '</span>' +
    '<span class="bh-tip">' + escHtml(text) + '</span>' +
    '</span>'

  // 数据目录行
  const dirRows = (dirs, kind) => dirs.map((d, i) =>
    '<div class="bh-card">' +
    '<div class="bh-card-body">' +
    '<div class="bh-dir-info">' +
    '<div class="bh-dir-name">' + escHtml(shortName(d)) + '</div>' +
    '<div class="bh-dir-path" title="' + escHtml(d) + '">' + escHtml(d) + '</div>' +
    '</div>' +
    '<div class="bh-card-actions">' +
    '<button class="bh-btn bh-icon-btn bh-icon-edit" title="编辑" data-bh="pickDir" data-kind="' + kind + '" data-idx="' + i + '">' + makeInlineSvgHtml(ICON_EDIT_SETTINGS) + '</button>' +
    '<button class="bh-btn bh-icon-btn bh-icon-del" title="删除" data-bh="delDir" data-kind="' + kind + '" data-idx="' + i + '">' + makeInlineSvgHtml(ICON_TRASH_SETTINGS) + '</button>' +
    '</div></div></div>'
  ).join('')

  // 程序行：已配置时显示路径卡片；未配置时不显示卡片（显示 + 选择按钮）
  const exeRow = (kind, exe, exeName) => exe
    ? '<div class="bh-card">' +
      '<div class="bh-card-body">' +
      '<div class="bh-dir-info">' +
      '<div class="bh-dir-name">' + exeName + '</div>' +
      '<div class="bh-dir-path" title="' + escHtml(exe) + '">' + escHtml(exe) + '</div>' +
      '</div>' +
      '<div class="bh-card-actions">' +
      '<button class="bh-btn bh-icon-btn bh-icon-edit" title="编辑" data-bh="pickExe" data-kind="' + kind + '">' + makeInlineSvgHtml(ICON_EDIT_SETTINGS) + '</button>' +
      '<button class="bh-btn bh-icon-btn bh-icon-del" title="删除" data-bh="clearExe" data-kind="' + kind + '">' + makeInlineSvgHtml(ICON_TRASH_SETTINGS) + '</button>' +
      '</div></div></div>'
    : ''

  // 浏览器配置大卡片：头部 logo + 名称（无 info）；data / exe 小节带 info
  const browserCard = (kind, label, dirs, exe, exeName, dirTip, exeTip) =>
    '<div class="bh-bcard">' +
    '<div class="bh-bcard-head">' +
    '<img class="bh-logo" src="icons/' + kind + '.svg" alt="" />' +
    '<span class="bh-bcard-title">' + label + '</span>' +
    '<button class="bh-btn bh-copy-addr" title="复制浏览器命令到相应浏览器地址栏粘贴，可查看具体文件路径" data-bh="copyVer" data-kind="' + kind + '">' + makeInlineSvgHtml(ICON_COPY_ADDR) + '</button>' +
    '</div>' +
    '<div class="bh-sec-title">数据目录' + info(dirTip) + '</div>' +
    '<div class="bh-list">' + dirRows(dirs, kind) + '</div>' +
    (dirs.length === 0 ? '<button class="bh-btn bh-add bh-dashed" data-bh="addDir" data-kind="' + kind + '">+ 选择 ' + label + ' 数据目录</button>' : '') +
    '<div class="bh-sec-title">程序（' + exeName + '）' + info(exeTip) + '</div>' +
    (exe ? exeRow(kind, exe, exeName) : '<button class="bh-btn bh-add bh-dashed" data-bh="pickExe" data-kind="' + kind + '">+ 选择 ' + exeName + ' 程序</button>') +
    '</div>'

  return '' +
    '<div class="bh-settings">' +
    '<div class="bh-header-row">' +
    '<div class="bh-header-col">' +
    '<div class="bh-header">书签与历史记录设置</div>' +
    '<div class="bh-sub">为 Chrome / Edge 配置数据目录与程序路径，默认自动填入浏览器相关路径，若无可自行配置。</div>' +
    '</div>' +
    '<button class="bh-btn bh-reload" title="重新读取书签及历史记录" data-bh="reload">' + makeInlineSvgHtml(ICON_ROTATE) + '<span class="bh-reload-text">重新读取</span></button>' +
    '</div>' +

    browserCard('chrome', 'Chrome', chromeDirs, cfg.chromeExe, 'chrome.exe',
      '选择 Chrome 的数据目录，一般是 User Data\\Default 目录，目录下有 Bookmarks、History 文件。未配置时，可打开浏览器输入"chrome://version/"查看个人资料路径，手动配置。',
      '选择 chrome.exe 后，可用该程序打开 Chrome 的书签及历史记录。不配置则使用默认浏览器打开网页，且无法打开 Chrome 书签及历史记录的管理页。') +
    browserCard('edge', 'Edge', edgeDirs, cfg.edgeExe, 'msedge.exe',
      '选择 Edge 的数据目录，一般是 User Data\\Default 目录，目录下有 Bookmarks、History 文件。未配置时，可打开浏览器输入"edge://version/"查看用户配置路径，手动配置。',
      '选择 msedge.exe 后，可用该程序打开 Edge 的书签及历史记录。不配置则使用默认浏览器打开网页，且无法打开 Edge 书签及历史记录的管理页。') +

    '</div>'
}

// 内联 SVG 的 HTML 字符串（用于设置页 info 图标，颜色跟随 currentColor）
// 纯字符串处理，不依赖 DOMParser / outerHTML（避免环境差异导致图标渲染失败）
function makeInlineSvgHtml (def) {
  const svg = def.svg.replace(/<svg([^>]*)>/, (m, attrs) => {
    const clean = attrs.replace(/\s(width|height)="[^"]*"/g, '')
    return '<svg' + clean + ' width="' + def.size + '" height="' + def.size + '">'
  })
  return '<span class="bh-info-ic">' + svg + '</span>'
}

function injectSettingsStyle () {
  if (document.getElementById('bh-settings-css')) return
  const style = document.createElement('style')
  style.id = 'bh-settings-css'
  style.textContent = `
    .bh-settings { padding: 14px 16px 12px; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; user-select: none; }

    /* ── 页头行：标题+说明 与 重新读取按钮（右上角平行，底部对齐） ── */
    .bh-header-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .bh-header-col { flex: 1; min-width: 0; }
    .bh-header { font-size: 15px; font-weight: 700; color: var(--bh-title, #222); }
    .bh-sub { font-size: 11px; color: var(--bh-muted, #888); margin-top: 3px; line-height: 1.5; }
    .bh-btn.bh-reload { flex-shrink: 0; position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; line-height: 1; color: #999999; background: transparent; border-radius: 14px; transition: color .15s, background-color .15s; }
    .bh-btn.bh-reload .bh-info-ic { width: 15px; height: 15px; }
    .bh-btn.bh-reload .bh-reload-text { font-size: 12px; color: #999999; transition: color .15s; }
    .bh-btn.bh-reload:hover { color: #ffffff; background: #3a4253; }
    .bh-btn.bh-reload:hover .bh-reload-text { color: #ffffff; }
    :root.dark .bh-btn.bh-reload { color: #999999; background: transparent; }
    :root.dark .bh-btn.bh-reload .bh-reload-text { color: #999999; }
    :root.dark .bh-btn.bh-reload:hover { color: #ffffff; background: #2d3443; }
    :root.dark .bh-btn.bh-reload:hover .bh-reload-text { color: #ffffff; }

    /* ── 浏览器配置大卡片 ── */
    .bh-bcard { border: 1px solid var(--bh-border, rgba(0,0,0,.1)); border-radius: 12px; background: var(--bh-card, #fff); padding: 10px 12px 12px; margin-bottom: 12px; }
    .bh-bcard-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .bh-logo { width: 20px; height: 20px; flex-shrink: 0; }
    .bh-bcard-title { font-size: 14px; font-weight: 700; color: var(--bh-title, #222); }
    /* 卡片头右上角复制地址按钮（与删除按钮同色 #999999，深浅模式适配） */
    .bh-btn.bh-copy-addr { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border-radius: 50%; color: #999999; position: relative; background: transparent; }
    .bh-btn.bh-copy-addr .bh-info-ic { width: 15px; height: 15px; }
    .bh-btn.bh-copy-addr:hover { color: var(--bh-title, #222); background: transparent; }
    :root.dark .bh-btn.bh-copy-addr { color: #999999; }
    :root.dark .bh-btn.bh-copy-addr:hover { color: #fff; background: transparent; }

    /* ── 分组小节标题（数据目录 / 程序） ── */
    .bh-sec-title { font-size: 12px; font-weight: 600; color: var(--bh-muted, #888); margin: 8px 0 6px; display: flex; align-items: center; gap: 5px; }

    /* ── info 悬浮说明 ── */
    .bh-info-wrap { position: relative; display: inline-flex; align-items: center; cursor: help; }
    .bh-info { display: inline-flex; align-items: center; color: var(--bh-muted, #999); }
    .bh-info-ic { display: inline-flex; width: 14px; height: 14px; }
    .bh-info-ic svg { width: 100%; height: 100%; display: block; }
    .bh-info-wrap .bh-tip {
      visibility: hidden; opacity: 0; position: absolute; left: 0; top: calc(100% + 8px); z-index: 100;
      background: var(--bh-tip-bg, #fff); color: var(--bh-tip-fg, #111); border: 1px solid var(--bh-tip-border, rgba(0,0,0,.14));
      border-radius: 8px; padding: 8px 10px;
      font-size: 11px; line-height: 1.55; font-weight: 400; width: 250px; white-space: normal; text-align: left;
      box-shadow: 0 4px 16px rgba(0,0,0,.25); transition: opacity .15s, visibility .15s; pointer-events: none;
    }
    .bh-info-wrap:hover .bh-tip { visibility: visible; opacity: 1; }
    :root.dark .bh-info-wrap .bh-tip { background: #0f1729; color: #fff; border-color: rgba(255,255,255,.18); }

    /* ── 列表卡片行 ── */
    .bh-list { display: flex; flex-direction: column; gap: 6px; }
    .bh-card { border: 1px solid var(--bh-border, rgba(0,0,0,.1)); border-radius: 10px; background: var(--bh-card2, #fafafa); }
    :root.dark .bh-card { background: rgba(40,40,45,.6); }
    .bh-card-body { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
    .bh-dir-info { flex: 1; min-width: 0; }
    .bh-dir-name { font-size: 13px; font-weight: 600; color: var(--bh-title, #222); }
    .bh-dir-path { font-size: 11px; color: var(--bh-muted, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .bh-muted { color: var(--bh-muted, #999); }
    .bh-card-actions { display: flex; gap: 6px; flex-shrink: 0; }

    /* ── 按钮（无描边、圆角圆润；删除同色不标红） ── */
    .bh-btn { border: none; background: transparent; color: var(--bh-title, #222); border-radius: 10px; padding: 5px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; transition: background-color .15s; }
    .bh-btn:hover { background: rgba(128,128,128,.14); }
    /* 图标按钮（修改 / 删除）：与 web-search 一致，默认 #999999，悬停变图标颜色，无背景变色 */
    .bh-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; color: #999999; position: relative; background: transparent; transition: color .15s; }
    .bh-icon-btn:hover { background: transparent; }
    .bh-icon-btn .bh-info-ic { width: 15px; height: 15px; }
    .bh-icon-edit:hover { color: #007aff; }
    .bh-icon-del:hover { color: #ff3b30; }
    /* + 选择按钮：虚框，hover 虚框消失 + 背景变色 */
    .bh-add { width: 100%; margin-top: 6px; }
    .bh-dashed { border: 1px dashed var(--bh-border, rgba(128,128,128,.5)); border-radius: 10px; padding: 7px 12px; color: var(--bh-muted, #666); }
    .bh-dashed:hover { border-color: transparent; background: rgba(128,128,128,.12); color: var(--bh-title, #222); }

    #bh-settings-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 9998; }
    .bh-modal-mask { position: absolute; inset: 0; background: rgba(0,0,0,.4); }
    .bh-modal-box { position: relative; background: var(--bh-card, #fff); border-radius: 12px; padding: 16px 18px; width: 320px; max-width: 88vw; box-sizing: border-box; box-shadow: 0 4px 20px rgba(0,0,0,.3); }
    .bh-modal-title { font-size: 14px; font-weight: 700; color: var(--bh-title, #222); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; line-height: 1; }
    .bh-modal-alert { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; color: #e5a13b; flex-shrink: 0; }
    .bh-modal-alert svg { width: 100%; height: 100%; display: block; }
    .bh-modal-msg { font-size: 13px; color: var(--bh-muted, #666); line-height: 1.5; margin-bottom: 14px; overflow-wrap: break-word; word-break: break-all; }
    .bh-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .bh-btn-plain { color: var(--bh-title, #222); border-radius: 14px; }
    .bh-btn-confirm { background: var(--bh-primary, #3a4253); color: #fff; padding: 5px 16px; border-radius: 14px; }
    .bh-btn-confirm:hover { background: var(--bh-primary-h, #2d3443); }
    :root.dark { --bh-title: #f0f0f0; --bh-muted: #999; --bh-border: rgba(255,255,255,.12); --bh-card: rgba(45,45,45,.95); --bh-card2: rgba(40,40,45,.6); --bh-tip-bg: #0f1729; --bh-tip-fg: #fff; }
    :root.dark .bh-settings { color-scheme: dark; }
  `
  document.head.appendChild(style)
}

async function handleSettingsAction (btn) {
  const act = btn.dataset.bh
  const kind = btn.dataset.kind
  const cfg = getConfig()
  if (act === 'copyVer') {
    const cmd = kind === 'chrome' ? 'chrome://version/' : 'edge://version/'
    window.ztools.copyText(cmd)
    showSettingsToast(kind === 'chrome' ? '已复制 chrome://version/，粘贴到 Chrome 地址栏即可查看路径' : '已复制 edge://version/，粘贴到 Edge 地址栏即可查看路径')
    return
  }
  if (act === 'addDir' || act === 'pickDir') {
    const isChrome = kind === 'chrome'
    const res = window.ztools.showOpenDialog({
      title: isChrome ? '选择便携版 Chrome 的 User Data 文件夹' : '选择便携版 Edge 的 User Data 文件夹',
      properties: ['openDirectory']
    })
    const paths = await dialogFilePaths(res)
    const fp = paths && paths[0]
    if (fp) {
      const key = isChrome ? 'chromeDirs' : 'edgeDirs'
      // 路径比较归一化：忽略大小写与结尾斜杠，避免同一目录重复添加
      const normPath = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
      if (act === 'pickDir') {
        const idx = parseInt(btn.dataset.idx || '0', 10)
        cfg[key][idx] = fp
      } else if (!cfg[key].some(x => normPath(x) === normPath(fp))) {
        cfg[key].push(fp)
      }
      saveConfig(cfg)
      reloadRequired = true
      invalidateHistory()
      invalidateFavicons()
      renderSettingsPage()
      showSettingsToast((act === 'pickDir' ? '已修改 ' : '已添加 ') + (isChrome ? 'Chrome' : 'Edge') + ' 数据目录')
    }
    return
  }
  if (act === 'delDir') {
    const isChrome = kind === 'chrome'
    const key = isChrome ? 'chromeDirs' : 'edgeDirs'
    const dir = cfg[key][parseInt(btn.dataset.idx || '0', 10)]
    const ok = await openSettingsModal('删除目录', '确定删除此目录吗？\n' + dir, '删除')
    if (!ok) return
    cfg[key] = cfg[key].filter(x => x !== dir)
    // 手动删除后标记该浏览器不再自动填充（避免安装版探测又把路径填回来）
    const auto = (cfg.autoFilled && typeof cfg.autoFilled === 'object') ? cfg.autoFilled : {}
    auto[isChrome ? 'chrome' : 'edge'] = true
    cfg.autoFilled = auto
    saveConfig(cfg)
    reloadRequired = true
    invalidateHistory()
    invalidateFavicons()
    renderSettingsPage()
    showSettingsToast('已删除数据目录')
    return
  }
  if (act === 'pickExe') {
    const isEdge = kind === 'edge'
    const res = window.ztools.showOpenDialog({
      title: isEdge ? '选择便携版 Edge 的 msedge.exe' : '选择便携版 Chrome 的 chrome.exe',
      properties: ['openFile'],
      filters: [{ name: isEdge ? 'Edge' : 'Chrome', extensions: ['exe'] }]
    })
    const paths = await dialogFilePaths(res)
    const fp = paths && paths[0]
    if (fp) {
      if (isEdge) cfg.edgeExe = fp
      else cfg.chromeExe = fp
      saveConfig(cfg)
      renderSettingsPage()
      showSettingsToast('已设置程序路径')
    }
    return
  }
  if (act === 'clearExe') {
    const isEdge = kind === 'edge'
    const ok = await openSettingsModal('删除程序', '确定删除已配置的程序路径吗？', '删除')
    if (!ok) return
    if (isEdge) cfg.edgeExe = ''
    else cfg.chromeExe = ''
    // 手动清除后标记该浏览器不再自动填充
    const auto = (cfg.autoFilled && typeof cfg.autoFilled === 'object') ? cfg.autoFilled : {}
    auto[isEdge ? 'edge' : 'chrome'] = true
    cfg.autoFilled = auto
    saveConfig(cfg)
    renderSettingsPage()
    showSettingsToast('已删除程序路径')
    return
  }
  if (act === 'reload') {
    reloadRequired = true
    invalidateHistory()
    invalidateFavicons()
    ensureBookmarks()
    ensureHistory(true).catch(() => {})
    ensureFavicons(true).catch(() => {})
    showSettingsToast('书签、历史记录已重新读取')
    return
  }
}

// 移除设置页覆盖层（保留 ztools 官方列表 DOM，避免退出设置页后搜索列表无法渲染）
function removeSettingsOverlay () {
  const root = document.getElementById('bh-settings-root')
  if (root) root.remove()
  // 恢复 ztools 官方列表容器显示（页面模式：进入设置页时隐藏，退出后恢复，保证搜索列表可用）
  try {
    const l = document.querySelector('.ztools-list')
    if (l && l.style.display === 'none') l.style.display = ''
  } catch (e) {}
}

function renderSettingsPage () {
  try { window.ztools.removeSubInput() } catch (e) {}
  closePickModal()
  currentListItems = null
  // 进入设置页时：安装版浏览器若完全未配置则自动填入路径（仅展示，不触发读取）
  autoFillInstalledPaths()
  injectSettingsStyle()
  // 主题适配：跟随 ztools 深浅色模式
  try {
    let isDark = false
    if (window.ztools.isDarkColors && typeof window.ztools.isDarkColors === 'function') {
      isDark = !!window.ztools.isDarkColors()
    } else {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    document.documentElement.classList.toggle('dark', isDark)
  } catch (e) {}
  // 页面模式设置页：模仿 web-search —— 不能清空 document.body（ztools 官方列表容器 .ztools-list
  // 由宿主创建并复用，清空 body 会导致退出设置页后搜索结果有数据但列表不显示，回车仍能打开第一条）。
  // 因此：进入设置页时仅隐藏 .ztools-list 容器，把设置页渲染为页面本身（正常文档流、背景透明，
  // 不使用全屏覆盖层）；退出时移除设置页并恢复列表容器显示。
  try {
    const l = document.querySelector('.ztools-list')
    if (l) l.style.display = 'none'
  } catch (e) {}
  let root = document.getElementById('bh-settings-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'bh-settings-root'
    document.body.appendChild(root)
  }
  // 正常文档流（非 fixed 覆盖层），背景透明露出 ztools 窗口底色（与 web-search 页面一致）
  root.style.cssText = 'width:100%;box-sizing:border-box;background:transparent;'
  root.innerHTML = buildSettingsHtml()
  root.querySelectorAll('[data-bh]').forEach(btn => {
    btn.onclick = () => { handleSettingsAction(btn) }
  })
  // 进入设置页后调整高度：按内容自适应，避免底部大片空白
  try {
    window.ztools.setExpendHeight(1)
    setTimeout(() => {
      try {
        const content = root.querySelector('.bh-settings')
        const h = Math.min(Math.max((content ? content.scrollHeight : 0) || 0, 300), 700)
        window.ztools.setExpendHeight(h)
      } catch (e) {}
    }, 60)
  } catch (e) {}
  // 多次重试移除子输入框，确保设置页无搜索框
  setTimeout(() => { try { window.ztools.removeSubInput() } catch (e) {} }, 100)
  setTimeout(() => { try { window.ztools.removeSubInput() } catch (e) {} }, 300)
}

// 主题变化监听（设置页为自定义 HTML，需自己跟随主题）
let themeBound = false
function bindThemeListener () {
  if (themeBound) return
  themeBound = true
  try {
    window.ztools.onThemeChange((themeInfo) => {
      document.documentElement.classList.toggle('dark', !!(themeInfo && themeInfo.isDark))
    })
  } catch (e) {}
}
bindThemeListener()

// 注册 PluginEnter：仅 settings feature 走有界面分支，搜索 feature 仍走官方 list 模式
try {
  window.ztools.onPluginEnter((payload) => {
    if (payload && payload.code === 'settings') {
      renderSettingsPage()
    } else {
      // 从设置页退出（进入其他模式/空界面）：移除设置页覆盖层，避免残留遮挡列表
      removeSettingsOverlay()
    }
  })
} catch (e) {
  console.error('register settings enter failed:', e)
}
