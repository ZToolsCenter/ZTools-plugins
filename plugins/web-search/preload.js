// 网页搜索插件 preload
const { ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')

// 参考 bad-bear：preload 加载时直接设置高度为 1px
try {
  if (window.ztools && typeof window.ztools.setExpendHeight === 'function') {
    window.ztools.setExpendHeight(1)
  }
} catch (e) {}

// 获取插件目录路径
function getPluginDir() {
  try {
    return __dirname || ''
  } catch (e) {
    return ''
  }
}

window.webSearch = {
  openExternal(url) {
    return ipcRenderer.invoke('open-external', url)
  },
  outPlugin() {
    return ipcRenderer.invoke('out-plugin', false)
  },
  onPluginEnter(callback) {
    ipcRenderer.on('on-plugin-enter', (_event, payload) => {
      callback(payload || {})
    })
  },
  onPluginDetach(callback) {
    ipcRenderer.on('plugin-detach', () => {
      callback()
    })
  },
  getLaunchParam() {
    return new Promise((resolve) => {
      let done = false
      ipcRenderer.on('on-plugin-enter', (_e, p) => {
        if (!done) { done = true; resolve(p || {}) }
      })
      setTimeout(() => { if (!done) { done = true; resolve({}) } }, 1500)
    })
  },
  setExpendHeight(height) {
    try {
      if (window.ztools && typeof window.ztools.setExpendHeight === 'function') {
        return window.ztools.setExpendHeight(height)
      }
      return ipcRenderer.invoke('set-expend-height', height)
    } catch (e) {}
  },
  // 动态 feature API
  setFeature(feature) {
    return ipcRenderer.sendSync('set-feature', feature)
  },
  getFeatures(codes) {
    return ipcRenderer.sendSync('get-features', codes)
  },
  removeFeature(code) {
    return ipcRenderer.sendSync('remove-feature', code)
  },
  // 从最近使用/历史记录中删除
  // 不传 name 参数，只靠 path + featureCode 匹配，避免 pluginName 不匹配导致删除失败
  removeFromHistory(featureCode) {
    try {
      const appPath = getPluginDir()
      return ipcRenderer.invoke('remove-from-history', appPath, featureCode)
    } catch (e) {
      return Promise.resolve()
    }
  },
  // 主题相关
  onThemeChange(callback) {
    ipcRenderer.on('update-theme-info', (_event, themeInfo) => {
      callback(themeInfo || {})
    })
  },
  getIsDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch (e) {
      return false
    }
  },
  // 保存文件（用于保存下载的图标）
  saveFile(filename, dataUrl) {
    try {
      const dir = getPluginDir()
      const filePath = path.join(dir, filename)
      const matches = dataUrl.match(/^data:(.+);base64,(.+)$/)
      if (matches) {
        const buffer = Buffer.from(matches[2], 'base64')
        fs.writeFileSync(filePath, buffer)
        return { success: true, path: filePath }
      }
      fs.writeFileSync(filePath, dataUrl)
      return { success: true, path: filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
  readFile(filename) {
    try {
      const dir = getPluginDir()
      const filePath = path.join(dir, filename)
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8')
      }
      return null
    } catch (e) {
      return null
    }
  },
  fileExists(filename) {
    try {
      const dir = getPluginDir()
      const filePath = path.join(dir, filename)
      return fs.existsSync(filePath)
    } catch (e) {
      return false
    }
  },
  getPluginDir() {
    return getPluginDir()
  }
}
