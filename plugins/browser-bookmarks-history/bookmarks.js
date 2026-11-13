const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']

// 读取单个书签文件的全量条目（兼容传统 Bookmarks 与新版 AccountBookmarks）
function readBookmarkFile (bookmarkPath, browser) {
  const bookmarksData = []
  if (!bookmarkPath) return bookmarksData
  try { if (!fs.existsSync(bookmarkPath)) return bookmarksData } catch (e) { return bookmarksData }
  try {
    const data = JSON.parse(fs.readFileSync(bookmarkPath, 'utf-8'))
    const getUrlData = (item, folder) => {
      if (!item || !Array.isArray(item.children)) return
      item.children.forEach(c => {
        if (c.type === 'url') {
          bookmarksData.push({
            addAt: parseInt(c.date_added) || 0,
            title: c.name || '',
            description: (folder ? '「' + folder + '」' : '') + c.url,
            url: c.url,
            browser,
            source: 'bookmark',
            file: bookmarkPath,
            guid: c.guid || ''
          })
        } else if (c.type === 'folder') {
          getUrlData(c, folder ? folder + ' - ' + c.name : c.name)
        }
      })
    }
    if (data && data.roots) {
      getUrlData(data.roots.bookmark_bar, '')
      getUrlData(data.roots.other, '')
      getUrlData(data.roots.synced, '')
    }
  } catch (e) {}
  return bookmarksData
}

function getBookmarks (dataDir, browser) {
  const bookmarksData = []
  if (!dataDir) return bookmarksData
  try { if (!fs.existsSync(dataDir)) return bookmarksData } catch (e) { return bookmarksData }
  // 书签文件兼容新旧两种存储：传统「Bookmarks」文件与新版 Chrome 登录账号后的
  // 「AccountBookmarks」文件（格式相同：checksum + roots JSON）。
  // 两者可能并存（Chrome 新版本会在两者中分别保存不同内容）：全部读取，
  // 同一条书签（guid 相同）由 readBookmarksData 的条目级去重合并。
  const tryReadProfile = (profileDir) => {
    for (const fn of ['Bookmarks', 'AccountBookmarks']) {
      const p = path.join(profileDir, fn)
      if (fs.existsSync(p)) {
        bookmarksData.push(...readBookmarkFile(p, browser))
      }
    }
  }
  const directOk = fs.existsSync(path.join(dataDir, 'Bookmarks')) || fs.existsSync(path.join(dataDir, 'AccountBookmarks'))
  if (directOk) {
    tryReadProfile(dataDir)
  } else {
    for (const profile of PROFILES) {
      tryReadProfile(path.join(dataDir, profile))
    }
  }
  return bookmarksData
}

let BOOKMARKS_DATA = []
// 记录读取过的 Bookmarks 文件路径与修改时间，用于检测浏览器侧新增/修改书签
let BOOKMARK_FILES = []

function collectBookmarkFiles (dataDir) {
  const files = []
  if (!dataDir) return files
  try { if (!fs.existsSync(dataDir)) return files } catch (e) { return files }
  // 与 getBookmarks 一致：支持目录直接是 profile（直接含书签文件）或 User Data 根目录；
  // 兼容传统 Bookmarks 与新版 AccountBookmarks 两种文件名
  const tryCollect = (profileDir) => {
    for (const fn of ['Bookmarks', 'AccountBookmarks']) {
      const p = path.join(profileDir, fn)
      try {
        if (fs.existsSync(p)) {
          files.push({ file: p, mtimeMs: fs.statSync(p).mtimeMs })
        }
      } catch (e) {}
    }
  }
  const directOk = fs.existsSync(path.join(dataDir, 'Bookmarks')) || fs.existsSync(path.join(dataDir, 'AccountBookmarks'))
  if (directOk) {
    tryCollect(dataDir)
  } else {
    for (const profile of PROFILES) {
      tryCollect(path.join(dataDir, profile))
    }
  }
  return files
}

function readBookmarksData (appData, extraDirs) {
  BOOKMARKS_DATA = []
  BOOKMARK_FILES = []
  // 收集所有待读目录（同一目录只读一次）
  const dirs = []
  const seenDirs = new Set()
  const pushDir = (browser, dir) => {
    if (!dir) return
    let key
    try { key = browser + '::' + path.resolve(dir) } catch (e) { key = browser + '::' + dir }
    if (seenDirs.has(key)) return
    seenDirs.add(key)
    dirs.push({ browser, dir })
  }
  let chromeDataDir
  let edgeDataDir
  if (process.platform === 'win32') {
    chromeDataDir = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data')
    edgeDataDir = path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/User Data')
  } else if (process.platform === 'darwin') {
    const appDataPath = appData || path.join(process.env.HOME, 'Library/Application Support')
    chromeDataDir = path.join(appDataPath, 'Google/Chrome')
    edgeDataDir = path.join(appDataPath, 'Microsoft Edge')
  }
  if (chromeDataDir) pushDir('chrome', chromeDataDir)
  if (edgeDataDir) pushDir('edge', edgeDataDir)
  if (extraDirs) {
    const chromeDirs = Array.isArray(extraDirs.chrome) ? extraDirs.chrome : []
    const edgeDirs = Array.isArray(extraDirs.edge) ? extraDirs.edge : []
    chromeDirs.forEach(d => pushDir('chrome', d))
    edgeDirs.forEach(d => pushDir('edge', d))
  }
  // 按「浏览器+文件路径」去重文件：同一文件只完整读取一次（配置里根目录与 Default 目录并存、
  // 或配置路径与默认路径指向同一文件时，避免同一文件被读两次导致每条重复）
  const seenFiles = new Set()
  const fileList = []
  for (const { browser, dir } of dirs) {
    for (const f of collectBookmarkFiles(dir)) {
      let k
      try { k = browser + '::' + path.resolve(f.file) } catch (e) { k = browser + '::' + f.file }
      if (seenFiles.has(k)) continue
      seenFiles.add(k)
      fileList.push({ browser, file: f.file, mtimeMs: f.mtimeMs })
    }
  }
  // 每个文件读取全量条目（文件夹内书签不会被误删）
  for (const { browser, file, mtimeMs } of fileList) {
    BOOKMARKS_DATA.push(...readBookmarkFile(file, browser))
    BOOKMARK_FILES.push({ file, mtimeMs, browser })
  }
  // 条目级去重：同一浏览器同一书签（guid 相同）只保留一条。
  // 用于「配置路径」与「默认路径（LOCALAPPDATA 等）」指向同一份数据、但路径不同导致
  // 文件级去重无法命中时的重复（内容完全相同）。不同 profile 的同名书签 guid 不同，不会被误删。
  const seenEntries = new Set()
  BOOKMARKS_DATA = BOOKMARKS_DATA.filter(x => {
    let k
    if (x.guid) k = x.browser + '::' + x.guid
    else k = x.browser + '::' + (x.url || '') + '::' + (x.title || '')
    if (seenEntries.has(k)) return false
    seenEntries.add(k)
    return true
  })
  if (BOOKMARKS_DATA.length > 0) {
    BOOKMARKS_DATA = BOOKMARKS_DATA.sort((a, b) => a.addAt - b.addAt)
  }
}

// 检测 Bookmarks 文件是否在浏览器侧发生变化（新增/修改/删除书签）
function bookmarksChanged () {
  if (!BOOKMARK_FILES.length) return false
  for (const f of BOOKMARK_FILES) {
    try {
      if (!fs.existsSync(f.file) || fs.statSync(f.file).mtimeMs !== f.mtimeMs) return true
    } catch (e) {
      return true
    }
  }
  return false
}

// ============ 书签文件夹树（浏览模式 -chbk / -edbk） ============
// 基于已收集的 BOOKMARK_FILES 现读树结构，返回 [{ browser, file, roots: [{key,name,children}] }]
// 与 Chrome 书签管理器一致：书签栏 / 其他书签 / 移动书签 三个根；节点保留原生结构，
// folderKey 用 浏览器+根+guid链 稳定标识，供逐层进入与输入框路径编码
function readBookmarkTree () {
  const trees = []
  const rootDefs = [['bookmark_bar', '书签栏'], ['other', '其他书签'], ['synced', '移动书签'], ['mobile', '移动书签']]
  for (const { file, browser } of BOOKMARK_FILES) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const roots = []
      for (const [rk, rn] of rootDefs) {
        const r = data.roots && data.roots[rk]
        if (r && Array.isArray(r.children)) {
          roots.push({ key: browser + '::' + rk, name: rn, children: r.children })
        }
      }
      trees.push({ browser, file, roots })
    } catch (e) {}
  }
  return trees
}

function searchBookmarks (searchWord) {
  searchWord = (searchWord || '').trim()
  if (!searchWord) return []
  if (/\S\s+\S/.test(searchWord)) {
    const regexTexts = searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/)
    const searchRegexs = regexTexts.map(rt => new RegExp(rt, 'i'))
    return BOOKMARKS_DATA.filter(x => (
      !searchRegexs.find(r => x.title.search(r) === -1) || !searchRegexs.find(r => x.description.search(r) === -1)
    ))
  }
  const regexText = searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const searchRegex = new RegExp(regexText, 'i')
  return BOOKMARKS_DATA.filter(x => (
    x.title.search(searchRegex) !== -1 || x.description.search(searchRegex) !== -1
  ))
}

// ============ 删除书签 ============
// Chromium BookmarkCodec checksum：MD5 流式拼接 id -> title(utf16le) -> type -> url，
// 深度优先遍历 bookmark_bar -> other -> synced 三个根目录。
function computeChecksum (data) {
  const md5 = crypto.createHash('md5')
  const updStr = s => md5.update(s, 'utf8')
  const updU16 = s => md5.update(Buffer.from(s, 'utf16le'))
  const visit = node => {
    if (!node || typeof node !== 'object') return
    const id = String(node.id == null ? '' : node.id)
    const title = node.name || ''
    if (node.type === 'url') {
      updStr(id)
      updU16(title)
      updStr('url')
      updStr(node.url || '')
    } else {
      // folder
      updStr(id)
      updU16(title)
      updStr('folder')
      if (Array.isArray(node.children)) node.children.forEach(visit)
    }
  }
  if (data && data.roots) {
    visit(data.roots.bookmark_bar)
    visit(data.roots.other)
    visit(data.roots.synced)
  }
  return md5.digest('hex')
}

// 删除指定文件中的一个书签（url+title 精确匹配优先，url 兜底）。
// 新版 Chrome 可能同时存在 Bookmarks 与 AccountBookmarks 两个书签文件（内容不同），
// 删除时需要从同一个人资料目录下的所有书签文件中删除，否则另一个文件仍保留该书签。
function deleteBookmarkEntry (file, url, title) {
  if (!file || !fs.existsSync(file)) return { ok: false, msg: '书签文件不存在：' + file }
  // 账号同步书签检测：登录浏览器账号（Google / Microsoft）后，账号书签存储在
  // AccountBookmarks 文件中（顶层含 sync_metadata 同步元数据），由云端同步管理——
  // 本地删除会被云端恢复，删除必须在浏览器书签管理器中执行（浏览器内删除会同步到云端）。
  // 仅存在于 Bookmarks 文件（无同步元数据）的为纯本地书签，可正常本地删除。
  const base = path.basename(file)
  let synced = false
  if (base === 'AccountBookmarks') {
    synced = true
  } else {
    try {
      const head = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (head && head.sync_metadata !== undefined) synced = true
    } catch (e) {}
  }
  if (synced) {
    return { ok: false, synced: true, msg: '该用户已开启书签同步，请到浏览器书签管理器中删除' }
  }
  // 同目录下所有书签文件（Bookmarks / AccountBookmarks 中实际存在的）
  const profileDir = path.dirname(file)
  const targets = ['Bookmarks', 'AccountBookmarks']
    .map(fn => path.join(profileDir, fn))
    .filter(p => fs.existsSync(p))
  if (!targets.length) targets.push(file)
  let anyRemoved = false
  let lastMsg = ''
  for (const tf of targets) {
    let raw
    try {
      raw = fs.readFileSync(tf, 'utf-8')
    } catch (e) {
      lastMsg = '无法读取书签文件：' + (e.message || e)
      continue
    }
    let data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      lastMsg = '书签文件解析失败：' + (e.message || e)
      continue
    }
    let removed = false
    const walk = node => {
      if (!node || !Array.isArray(node.children)) return
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i]
        if (c.type === 'url' && c.url === url) {
          if (title && c.name !== title) continue
          node.children.splice(i, 1)
          removed = true
        } else if (c.type === 'folder') {
          walk(c)
        }
      }
    }
    if (data.roots) {
      walk(data.roots.bookmark_bar)
      walk(data.roots.other)
      walk(data.roots.synced)
    }
    if (!removed) continue
    // 备份 + 重算 checksum + 写回
    try {
      fs.copyFileSync(tf, tf + '.bak-' + Date.now())
    } catch (e) {}
    data.checksum = computeChecksum(data)
    // 兼容新版：若原文件存在 checksum_sha256 字段，一并更新（Chromium 用 SHA256 特性时校验）
    if (data.checksum_sha256) {
      data.checksum_sha256 = computeChecksumSha256(data)
    }
    try {
      fs.writeFileSync(tf, JSON.stringify(data, null, 2), 'utf-8')
      anyRemoved = true
    } catch (e) {
      lastMsg = '写入书签文件失败（请先关闭浏览器）：' + (e.message || e)
    }
  }
  if (anyRemoved) {
    return { ok: true, msg: '书签已删除' }
  }
  if (lastMsg) return { ok: false, msg: lastMsg }
  return { ok: false, msg: '未找到匹配的书签（可能已被删除）' }
}

function computeChecksumSha256 (data) {
  const sha = crypto.createHash('sha256')
  const updStr = s => sha.update(s, 'utf8')
  const updU16 = s => sha.update(Buffer.from(s, 'utf16le'))
  const visit = node => {
    if (!node || typeof node !== 'object') return
    const id = String(node.id == null ? '' : node.id)
    const title = node.name || ''
    if (node.type === 'url') {
      updStr(id)
      updU16(title)
      updStr('url')
      updStr(node.url || '')
    } else {
      updStr(id)
      updU16(title)
      updStr('folder')
      if (Array.isArray(node.children)) node.children.forEach(visit)
    }
  }
  if (data && data.roots) {
    visit(data.roots.bookmark_bar)
    visit(data.roots.other)
    visit(data.roots.synced)
  }
  return sha.digest('hex')
}

module.exports = { readBookmarksData, searchBookmarks, deleteBookmarkEntry, bookmarksChanged, readBookmarkTree, getBookmarksData: () => BOOKMARKS_DATA }
