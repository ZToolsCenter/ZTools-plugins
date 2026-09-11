// 抓取 Chrome / Edge 书签（解析 User Data/<Profile>/Bookmarks JSON）
// 参考 ZTools 官方 bookmarks 插件实现，增强：多 profile 全扫 + 返回根级结构
const path = require('path')
const fs = require('fs')

const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']

function browserDataDirs() {
  const dirs = []
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || ''
    if (la) {
      dirs.push({ browser: 'chrome', dir: path.join(la, 'Google/Chrome/User Data') })
      dirs.push({ browser: 'edge', dir: path.join(la, 'Microsoft/Edge/User Data') })
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || ''
    if (home) {
      dirs.push({ browser: 'chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') })
      dirs.push({ browser: 'edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') })
    }
  }
  return dirs
}

// 遍历 Bookmarks JSON 的所有 url 节点，带文件夹路径
function walkBookmarks(node, folderPath, out, browser, icon) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'url') {
    const url = node.url || ''
    if (/^https?:/i.test(url) || /^file:/i.test(url)) {
      out.push({
        title: node.name || node.title || url,
        url,
        folder: folderPath || '',
        browser,
        source: 'bookmark',
        addAt: parseInt(node.date_added || '0', 10) || 0
      })
    }
  } else if (node.type === 'folder' || Array.isArray(node.children)) {
    const folder = folderPath ? folderPath + ' / ' + (node.name || '') : (node.name || '')
    ;(node.children || []).forEach(c => walkBookmarks(c, folder, out, browser, icon))
  }
}

// 抓取指定浏览器数据目录的书签
function readBrowserBookmarks(dir, browser) {
  const out = []
  for (const profile of PROFILES) {
    const p = path.join(dir, profile, 'Bookmarks')
    if (!fs.existsSync(p)) continue
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const roots = data && data.roots
      if (!roots) continue
      walkBookmarks(roots.bookmark_bar, '', out, browser, browser)
      walkBookmarks(roots.other, '', out, browser, browser)
      walkBookmarks(roots.synced, '', out, browser, browser)
    } catch (e) {
      // 跳过损坏/占用中的文件
    }
  }
  return out
}

// 全量抓取 Chrome + Edge 书签
function readAllBookmarks() {
  const all = []
  for (const { browser, dir } of browserDataDirs()) {
    if (fs.existsSync(dir)) all.push(...readBrowserBookmarks(dir, browser))
  }
  return all
}

module.exports = { readAllBookmarks, readBrowserBookmarks, walkBookmarks }
