const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

function getHistoryCandidates(platform = process.platform, env = process.env, home = os.homedir()) {
  const candidates = []
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (env.TYPORA_HISTORY_PATH) candidates.push(pathApi.resolve(env.TYPORA_HISTORY_PATH))

  if (platform === 'win32') {
    candidates.push(pathApi.join(env.APPDATA || pathApi.join(home, 'AppData', 'Roaming'), 'Typora', 'history.data'))
  } else if (platform === 'darwin') {
    candidates.push(
      pathApi.join(home, 'Library', 'Application Support', 'abnerworks.Typora', 'history.data'),
      pathApi.join(home, 'Library', 'Application Support', 'Typora', 'history.data')
    )
  } else {
    candidates.push(pathApi.join(env.XDG_CONFIG_HOME || pathApi.join(home, '.config'), 'Typora', 'history.data'))
  }
  return [...new Set(candidates)]
}

function decodeHistory(raw) {
  const source = raw.replace(/^\uFEFF/, '').trim()
  if (!source) throw new Error('history.data 为空')

  if (source.length % 2 === 0 && /^[0-9a-f]+$/i.test(source)) {
    return Buffer.from(source, 'hex').toString('utf8')
  }
  if (/^[a-z0-9+/]+={0,2}$/i.test(source) && source.length % 4 === 0) {
    const decoded = Buffer.from(source, 'base64').toString('utf8')
    if (/^\s*[\[{]/.test(decoded)) return decoded
  }
  return source
}

function normalizeDate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string' || !value.trim()) return 0

  const source = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(source)) return Number(source)
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function parseHistory(raw) {
  const data = JSON.parse(decodeHistory(raw))
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('history.data 解析结果不是有效的 JSON 对象')
  }
  const records = []

  for (const [key, type] of [['recentFolder', 'folder'], ['recentDocument', 'file']]) {
    const items = Array.isArray(data[key]) ? data[key] : []
    for (const item of items) {
      if (!item || typeof item.path !== 'string' || !item.path.trim()) continue
      records.push({
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : (path.win32.basename(item.path) || item.path),
        path: item.path,
        date: normalizeDate(item.date),
        type
      })
    }
  }

  records.sort((a, b) => b.date - a.date)

  const seen = new Set()
  return records.filter((item) => {
    const key = (process.platform === 'win32' || process.platform === 'darwin') ? item.path.toLowerCase() : item.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readRecentItems() {
  const candidates = getHistoryCandidates()
  const historyPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!historyPath) throw new Error(`未找到 Typora 历史文件：${candidates.join('；')}`)
  return parseHistory(fs.readFileSync(historyPath, 'utf8'))
}

function toListResults(items, searchWord = '') {
  const keyword = String(searchWord || '').trim().toLowerCase()
  return items
    .map((item) => ({
      title: item.name,
      description: item.path,
      icon: item.type === 'folder' ? 'folder-icon.png' : 'markdown-icon.png',
      path: item.path,
      itemType: item.type
    }))
    .filter((item) => !keyword || item.title.toLowerCase().includes(keyword) || item.path.toLowerCase().includes(keyword))
}

let cachedItems = null

function loadList(searchWord = '', forceRefresh = false) {
  try {
    if (forceRefresh || !cachedItems) {
      cachedItems = readRecentItems()
    }
    return cachedItems.length
      ? toListResults(cachedItems, searchWord)
      : [{ title: '暂无最近记录', description: 'Typora 的 history.data 中没有文件或文件夹' }]
  } catch (error) {
    console.error('[recent-typora]', error)
    return [{ title: '无法读取 Typora 最近记录', description: error.message }]
  }
}

function getTyporaLaunch(target, platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.TYPORA_EXECUTABLE) return { command: env.TYPORA_EXECUTABLE, args: [target] }

  if (platform === 'darwin') {
    return { command: 'open', args: ['-a', 'Typora', target] }
  }
  if (platform === 'linux') {
    return { command: 'typora', args: [target] }
  }

  const candidates = [
    env.ProgramW6432 && path.win32.join(env.ProgramW6432, 'Typora', 'Typora.exe'),
    env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Typora', 'Typora.exe'),
    env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Typora', 'Typora.exe'),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Typora', 'Typora.exe')
  ].filter(Boolean)
  const executable = candidates.find((candidate) => fs.existsSync(candidate)) || 'Typora.exe'
  return { command: executable, args: [target] }
}

function openInTypora(target, onError = console.error) {
  try {
    const launch = getTyporaLaunch(target)
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', onError)
    child.unref()
  } catch (error) {
    onError(error)
  }
}

function createListFeature(ztools) {
  return {
    mode: 'list',
    args: {
      enter: (action, callbackSetList) => {
        cachedItems = null
        callbackSetList(loadList('', true))
      },
      search: (action, searchWord, callbackSetList) => callbackSetList(loadList(searchWord)),
      select: (action, itemData) => {
        if (!itemData || !itemData.path) return
        if (!fs.existsSync(itemData.path)) {
          ztools.showNotification(`路径已不存在：${itemData.path}`)
          return
        }
        openInTypora(itemData.path, (error) => {
          console.error('[recent-typora] 无法启动 Typora', error)
          ztools.showNotification('无法启动 Typora，请检查安装路径')
        })
        ztools.hideMainWindow()
        ztools.outPlugin()
      },
      placeholder: '搜索最近打开的文件或文件夹'
    }
  }
}

if (typeof window !== 'undefined' && window.ztools) {
  window.exports = {
    'recent-typora': createListFeature(window.ztools)
  }
}

module.exports = {
  createListFeature,
  decodeHistory,
  getHistoryCandidates,
  getTyporaLaunch,
  loadList,
  normalizeDate,
  openInTypora,
  parseHistory,
  readRecentItems,
  toListResults
}
