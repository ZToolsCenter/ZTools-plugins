const fs = require('node:fs')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  }
}

/**
 * 窗口间通信桥（window.easynoteBridge）
 *
 * 背景：只有创建窗口的那个窗口持有 WindowInstance 句柄，子窗口操作不了自己。
 * 所以「最小化成边缘标签」这类要改窗口尺寸/显隐的动作，必须由主窗口（管家）代劳。
 *
 * 本 preload 对插件的所有窗口都生效，两个方向共用这一份实现：
 *   主窗口 → 子窗口：sendTo(childWebContentsId, CMD, msg)   —— 主窗口知道子窗口的 id
 *   子窗口 → 主窗口：sendTo(hostId, CMD, msg) / ztools.sendToParent(CMD, msg)
 *
 * 握手：子窗口不知道主窗口的 id，由主窗口先发 { t: 'hello' }，
 * 子窗口从 event.senderId 记下 hostId 并回 ack；握手前发出的指令先入队、收到 hello 后补发。
 *
 * 去重：子窗口 → 主窗口两条路都会发（不知道宿主上哪条真的通），宿主按 envelope.mid 只消费一次。
 */
const CMD_CHANNEL = 'easynote:cmd'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  console.error('[easynote] 无法加载 electron.ipcRenderer，窗口间通信不可用:', e)
}

let hostId = null
let greeted = false
const cmdListeners = []
const pending = []
const seenIds = new Set()

function isMainWindow() {
  try {
    return window.ztools.getWindowType() === 'main'
  } catch {
    return false
  }
}

function flushPending() {
  while (pending.length) {
    const msg = pending.shift()
    try {
      ipcRenderer.sendTo(hostId, CMD_CHANNEL, msg)
    } catch (e) {
      console.error('[easynote] 补发指令失败:', e)
    }
  }
}

if (ipcRenderer) {
  ipcRenderer.on(CMD_CHANNEL, (event, msg) => {
    const senderId = event && event.senderId

    // 主窗口的握手：记下它的 webContents id，回 ack，补发排队指令
    if (msg && msg.t === 'hello') {
      if (senderId) hostId = senderId
      greeted = true
      try {
        ipcRenderer.sendTo(senderId, CMD_CHANNEL, { t: 'hello-ack' })
      } catch (e) {
        /* ignore */
      }
      flushPending()
      return
    }

    // 两路都发时按 mid 去重，只交给上层一次
    if (msg && msg.mid) {
      if (seenIds.has(msg.mid)) return
      seenIds.add(msg.mid)
      if (seenIds.size > 100) seenIds.delete(seenIds.values().next().value)
    }

    cmdListeners.forEach((fn) => {
      try {
        fn(msg, senderId)
      } catch (e) {
        console.error('[easynote] 指令处理失败:', e)
      }
    })
  })
}

window.easynoteBridge = {
  /** 是否主窗口（窗口管家） */
  isHost: isMainWindow,

  /** 子窗口 → 主窗口。两条路都试，谁通用谁；都不通则排队等握手 */
  toHost(msg) {
    if (!ipcRenderer) return
    const envelope = Object.assign({}, msg, {
      mid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    })
    let sent = false

    if (hostId) {
      try {
        ipcRenderer.sendTo(hostId, CMD_CHANNEL, envelope)
        sent = true
      } catch (e) {
        console.error('[easynote] sendTo 失败:', e)
      }
    }

    try {
      if (typeof window.ztools.sendToParent === 'function') {
        window.ztools.sendToParent(CMD_CHANNEL, envelope)
        sent = true
      }
    } catch (e) {
      /* ignore */
    }

    if (!sent && !greeted) pending.push(envelope)
  },

  /** 主窗口 → 指定子窗口（传子窗口的 webContents.id） */
  toWindow(id, msg) {
    if (!ipcRenderer || !id) return
    try {
      ipcRenderer.sendTo(id, CMD_CHANNEL, msg)
    } catch (e) {
      console.error('[easynote] 发送到子窗口失败:', e)
    }
  },

  /** 监听本窗口收到的指令 */
  onCmd(fn) {
    if (typeof fn === 'function') cmdListeners.push(fn)
  }
}
