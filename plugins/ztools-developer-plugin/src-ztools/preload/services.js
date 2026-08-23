const fs = require('node:fs')
const path = require('node:path')
const dgram = require('node:dgram')

// 通过 window 对象向渲染进程注入能力
// 悬浮窗引用：主插件窗口持有，便于 focus/复用
let floatWin = null

// 监听悬浮窗关闭通知：悬浮窗关闭时通过 sendToParent 通知主插件彻底退出（杀进程）
// 避免主插件窗口残留导致下次打开 ztools 时仍显示
// 监听悬浮窗大小调节：悬浮窗自身无窗口句柄，由主窗口持有句柄代为 setBounds
try {
  const ipcRenderer = require('electron').ipcRenderer
  if (ipcRenderer) {
    ipcRenderer.on('ztools-float-closed', () => {
      try { window.ztools.outPlugin(true) } catch (_e) {}
    })
    ipcRenderer.on('ztools-float-resize', (_e, size) => {
      try {
        if (
          floatWin && typeof floatWin.setBounds === 'function' &&
          size && Number.isFinite(size.width) && Number.isFinite(size.height) &&
          size.width > 0 && size.height > 0
        ) {
          floatWin.setBounds({ width: Math.round(size.width), height: Math.round(size.height) })
        }
      } catch (_e) {}
    })
  }
} catch (_e) {
  // require electron 失败则忽略
}

// ===== 悬浮窗尺寸偏好 =====
// 透明度/缩放由悬浮窗 UI 写入 dbStorage；主窗口创建悬浮窗时按上次缩放取尺寸
const FLOAT_PREFS_KEY = 'utc-float-prefs'
const FLOAT_BASE_W = 420
const FLOAT_BASE_H = 165

// 读取悬浮窗缩放偏好（脏数据钳制到 0.7–1.6）
function readFloatScale() {
  try {
    const prefs = window.ztools.dbStorage.getItem(FLOAT_PREFS_KEY)
    if (prefs && typeof prefs.scale === 'number' && isFinite(prefs.scale)) {
      return Math.min(1.6, Math.max(0.7, prefs.scale))
    }
  } catch (_e) {
    // ignore
  }
  return 1
}

// ===== NTP 授时 =====
// 依次尝试多个 NTP 服务器，主用国家授时中心 cn.ntp.org.cn
const NTP_SERVERS = ['cn.ntp.org.cn', 'pool.ntp.org', 'time.nist.gov']
const NTP_PORT = 123
// NTP 时间从 1900-01-01 起算，Unix 从 1970-01-01，差 70 年 = 2208988800 秒
const NTP_EPOCH_OFFSET_MS = 2208988800 * 1000

// 发送 NTP 请求并解析响应，返回 { offset, server, rtt }（毫秒）
// offset = 服务器真实时间 - 本地时间，用于修正本地时钟偏差
function queryNtp(server, timeout) {
  timeout = timeout || 3000
  return new Promise((resolve, reject) => {
    let socket
    try {
      socket = dgram.createSocket('udp4')
    } catch (e) {
      reject(e)
      return
    }
    // NTP 包：48 字节，首字节 0x1B = LI(0)+Version(3)+Mode(3 client)，其余补零
    const packet = Buffer.alloc(48)
    packet[0] = 0x1B
    const t0 = Date.now()
    const cleanup = () => { try { socket.close() } catch (_e) {} }
    const timer = setTimeout(() => { cleanup(); reject(new Error('NTP timeout')) }, timeout)
    socket.on('error', (err) => {
      clearTimeout(timer)
      cleanup()
      reject(err)
    })
    socket.on('message', (msg) => {
      clearTimeout(timer)
      const t1 = Date.now()
      // 传输时间戳：byte 40-43 秒, 44-47 小数部分（NTP 1900 起算）
      const seconds = msg.readUInt32BE(40)
      const fraction = msg.readUInt32BE(44)
      if (seconds === 0) {
        cleanup()
        reject(new Error('NTP invalid response'))
        return
      }
      const ntpMs = seconds * 1000 + Math.floor(fraction / 4294967296 * 1000)
      const serverTime = ntpMs - NTP_EPOCH_OFFSET_MS
      const rtt = t1 - t0
      // 估算真实时间 = 服务器发送时间 + 单程延迟（rtt/2）
      const realTime = serverTime + Math.floor(rtt / 2)
      const offset = realTime - t1
      cleanup()
      resolve({ offset: offset, server: server, rtt: rtt })
    })
    socket.send(packet, 0, 48, NTP_PORT, server, (err) => {
      if (err) {
        clearTimeout(timer)
        cleanup()
        reject(err)
      }
    })
  })
}

window.services = {
  // 开启置顶悬浮窗（独立 Electron 窗口）
  // 返回 winId；失败返回 null（具体原因已通过 notification 提示）
  openFloatWindow() {
    const ztools = window.ztools

    // 已存在则聚焦复用
    if (floatWin) {
      try {
        if (typeof floatWin.focus === 'function') floatWin.focus()
        else if (typeof floatWin.show === 'function') floatWin.show()
        const id = floatWin.id
        return typeof id === 'number' ? id : null
      } catch (_e) {
        floatWin = null
      }
    }
    // createBrowserWindow 要求 url 必须是 file:// 本地地址（不接受 http://）
    // 因此 dev 与生产模式都指向 dist 构建产物
    const htmlPath = path.join(__dirname, '..', 'dist', 'index.html')
    if (!fs.existsSync(htmlPath)) {
      try { ztools.showNotification && ztools.showNotification('悬浮窗需要构建产物，请先运行 npm run build') } catch (_e) {}
      return null
    }
    const url = 'file://' + htmlPath + '#float'
    // 最小 options，不传 webPreferences（main 模式下指定 preload 可能被安全策略拒绝）
    // 悬浮窗依赖全局 window.ztools（由客户端注入）+ window.close() 关闭，不依赖 services
    // 透明窗口：配合卡片背景 alpha 实现透明度调节；尺寸按上次缩放偏好创建
    const scale = readFloatScale()
    const options = {
      width: Math.round(FLOAT_BASE_W * scale),
      height: Math.round(FLOAT_BASE_H * scale),
      frame: false,
      resizable: false,
      skipTaskbar: true,
      transparent: true
    }
    try {
      floatWin = ztools.createBrowserWindow(url, options, function () {
        floatWin = null
      })
    } catch (e) {
      floatWin = null
      const msg = e && e.message ? e.message : String(e)
      try { ztools.showNotification && ztools.showNotification('悬浮窗创建失败: ' + msg) } catch (_e2) {}
      return null
    }
    if (!floatWin) {
      try { ztools.showNotification && ztools.showNotification('悬浮窗创建失败: createBrowserWindow 返回空') } catch (_e2) {}
      return null
    }
    // 创建成功后再设置置顶
    try {
      if (typeof floatWin.setAlwaysOnTop === 'function') floatWin.setAlwaysOnTop(true)
    } catch (_e) {
      // 置顶失败不阻塞
    }
    const id = floatWin.id
    return typeof id === 'number' ? id : null
  },

  // 关闭主插件持有的悬浮窗
  closeFloatWindow() {
    if (!floatWin) return
    try {
      if (typeof floatWin.close === 'function') floatWin.close()
    } catch (_e) {
      // 忽略
    }
    floatWin = null
  },

  // 悬浮窗自身关闭（在悬浮窗 renderer 进程中调用）
  closeSelf() {
    try { window.close() } catch (_e) {
      try { window.ztools && window.ztools.outPlugin && window.ztools.outPlugin(true) } catch (_e2) {}
    }
  },

  // NTP 校时：依次尝试多个服务器，返回 { offset, server, rtt } 或 null
  // offset = 服务器真实时间 - 本地时间（毫秒），renderer 用 Date.now()+offset 显示真实时间
  async syncNtpTime() {
    for (const server of NTP_SERVERS) {
      try {
        const result = await queryNtp(server)
        return result
      } catch (_e) {
        // 试下一个服务器
      }
    }
    return null
  }
}
