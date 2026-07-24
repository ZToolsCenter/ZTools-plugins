const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const { readBookmarksData, searchBookmarks, BOOKMARKS_DATA } = require('./bookmarks')
const { registerTools } = require('./mcp')

registerTools()

function openUrlByChrome(url) {
  if (process.platform === 'win32') {
    const suffix = `${path.sep}Google${path.sep}Chrome${path.sep}Application${path.sep}chrome.exe`
    const prefixes = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean)
    const prefix = prefixes.find(prefix => fs.existsSync(path.join(prefix, suffix)))
    const chromeApp = path.join(prefix, suffix)
    if (chromeApp) {
      cp.spawn(chromeApp, [url], { detached: true })
    } else {
      window.ztools.shellOpenExternal(url)
    }
    return
  }
  if (process.platform === 'darwin') {
    const chromeApp = '/Applications/Google Chrome.app'
    if (fs.existsSync(chromeApp)) {
      cp.spawn('open', ['-a', chromeApp, url], { detached: true })
    } else {
      window.ztools.shellOpenExternal(url)
    }
  }
}

function openUrlByEdge(url) {
  if (process.platform === 'win32') {
    // const args = ['shell:AppsFolder\\Microsoft.MicrosoftEdge_8wekyb3d8bbwe!MicrosoftEdge']
    cp.spawn('start', ['microsoft-edge:' + url], { shell: 'cmd.exe', detached: true }).once('error', () => {
      window.ztools.shellOpenExternal(url)
    })
    return
  }
  if (process.platform === 'darwin') {
    const edgeApp = '/Applications/Microsoft Edge.app'
    if (fs.existsSync(edgeApp)) {
      cp.spawn('open', ['-a', edgeApp, url], { detached: true })
    } else {
      window.ztools.shellOpenExternal(url)
    }
  }
}


window.ztools.onMainPush(({ payload }) => {
  if (!BOOKMARKS_DATA) readBookmarksData(window.ztools.getPath('appData'))
  const bookmarks = searchBookmarks(payload)
  const data = bookmarks.slice(0, 6).map(x => ({ text: x.title + ' ' + x.url, title: x.description, icon: x.icon, browser: x.browser, url: x.url }))
  if (bookmarks.length > 6) {
    data.pop()
    data.push({ highlight: false, text: '共搜索到 ' + bookmarks.length + ' 条书签，查看更多...' })
  }
  return { type: 'list', data }
}, ({ option }) => {
  if (option.browser === 'chrome') {
    openUrlByChrome(option.url)
  } else {
    openUrlByEdge(option.url)
  }
})

const featureAction = {
  mode: 'list',
  args: {
    enter: (action, callbackSetList) => {
      if (!BOOKMARKS_DATA) readBookmarksData(window.ztools.getPath('appData'))
      if (action.code === 'search') setTimeout(() => { window.ztools.setSubInputValue(action.payload) })
    },
    search: (action, searchWord, callbackSetList) => {
      callbackSetList(searchBookmarks(searchWord))
    },
    select: (action, itemData) => {
      window.ztools.hideMainWindow(false)
      if (itemData.browser === 'chrome') {
        openUrlByChrome(itemData.url)
      } else {
        openUrlByEdge(itemData.url)
      }
      window.ztools.outPlugin()
    }
  }
}

window.exports = {
  bookmarks: featureAction,
  search: featureAction
}

