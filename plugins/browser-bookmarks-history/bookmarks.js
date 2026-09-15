const path = require('path')
const fs = require('fs')

const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']

function getBookmarks (dataDir, browser) {
  const bookmarksData = []
  if (!dataDir) return bookmarksData
  try { if (!fs.existsSync(dataDir)) return bookmarksData } catch (e) { return bookmarksData }
  for (const profile of PROFILES) {
    const bookmarkPath = path.join(dataDir, profile, 'Bookmarks')
    try { if (!fs.existsSync(bookmarkPath)) continue } catch (e) { continue }
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
              source: 'bookmark'
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
  }
  return bookmarksData
}

let BOOKMARKS_DATA = []

function readBookmarksData (appData, extraDirs) {
  BOOKMARKS_DATA = []
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
  if (chromeDataDir) BOOKMARKS_DATA.push(...getBookmarks(chromeDataDir, 'chrome'))
  if (edgeDataDir) BOOKMARKS_DATA.push(...getBookmarks(edgeDataDir, 'edge'))
  if (extraDirs) {
    const chromeDirs = Array.isArray(extraDirs.chrome) ? extraDirs.chrome : []
    const edgeDirs = Array.isArray(extraDirs.edge) ? extraDirs.edge : []
    chromeDirs.forEach(d => BOOKMARKS_DATA.push(...getBookmarks(d, 'chrome')))
    edgeDirs.forEach(d => BOOKMARKS_DATA.push(...getBookmarks(d, 'edge')))
  }
  if (BOOKMARKS_DATA.length > 0) {
    BOOKMARKS_DATA = BOOKMARKS_DATA.sort((a, b) => a.addAt - b.addAt)
  }
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

module.exports = { readBookmarksData, searchBookmarks, BOOKMARKS_DATA }
