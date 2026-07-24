const path = require('path')
const fs = require('fs')

function getBookmarks (dataDir, browser) {
  const profiles = ['Default', 'Profile 3', 'Profile 2', 'Profile 1']
  const profile = profiles.find(profile => fs.existsSync(path.join(dataDir, profile, 'Bookmarks')))
  if (!profile) return []
  const bookmarkPath = path.join(dataDir, profile, 'Bookmarks')
  const bookmarksData = []
  const icon = browser + '.png'
  try { 
    const data = JSON.parse(fs.readFileSync(bookmarkPath, 'utf-8'))
    const getUrlData = (item, folder) => {
      if (!item || !Array.isArray(item.children)) return
      item.children.forEach(c => {
        if (c.type === 'url') {
          bookmarksData.push({
            addAt: parseInt(c.date_added),
            title: c.name || '',
            description: (folder ? '「' + folder + '」' : '') + c.url,
            url: c.url,
            browser,
            icon
          })
        } else if (c.type === 'folder') {
          getUrlData(c, folder ? folder + ' - ' + c.name : c.name)
        }
      })
    }
    getUrlData(data.roots.bookmark_bar, '')
    getUrlData(data.roots.other, '')
    getUrlData(data.roots.synced, '')
  } catch (e) {}
  return bookmarksData
}

let BOOKMARKS_DATA = null
function readBookmarksData (appData) {
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
  } else { return }
  if (fs.existsSync(chromeDataDir)) {
    BOOKMARKS_DATA.push(...getBookmarks(chromeDataDir, 'chrome'))
  }
  if (fs.existsSync(edgeDataDir)) {
    BOOKMARKS_DATA.push(...getBookmarks(edgeDataDir, 'edge'))
  }
  if (BOOKMARKS_DATA.length > 0) {
    BOOKMARKS_DATA = BOOKMARKS_DATA.sort((a, b) => a.addAt - b.addAt)
  }
}

function searchBookmarks (searchWord) {
  searchWord = searchWord.trim()
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

module.exports = {
  readBookmarksData,
  searchBookmarks,
  BOOKMARKS_DATA
}