const { provider } = require('./provider')

const active = new Map()
async function call(operation, value) {
  active.get(operation)?.abort()
  const controller = new AbortController()
  active.set(operation, controller)
  try {
    return await provider[operation](value, controller.signal)
  } finally {
    if (active.get(operation) === controller) active.delete(operation)
  }
}

window.videoService = Object.freeze({
  channel: (key) => call('channel', key),
  search: (query) => call('search', query),
  catalog: (v) => call('catalog', v),
  resolve: (v) => call('resolve', v),
  cancel() {
    for (const controller of active.values()) controller.abort()
    active.clear()
  },
})

// 播放窗口写入记录后通过宿主的 sendToParent 中继通知这里。
const historyChangedListeners = new Set()
require('electron').ipcRenderer.on('ztools-video:history-changed', () => {
  for (const listener of historyChangedListeners) listener()
})
window.videoHistory = Object.freeze({
  onChange(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a history listener')
    historyChangedListeners.add(callback)
    return () => historyChangedListeners.delete(callback)
  },
})
