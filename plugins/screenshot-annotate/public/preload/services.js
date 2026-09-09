// ZTools「截图标注」插件 —— 渲染进程 Node 能力桥
// 运行于 preload 环境：可访问 window.ztools（平铺 API）与 Node fs/path。
// 所有跨进程的磁盘、剪贴板、建窗操作都集中在这里。

const fs = require('node:fs')
const path = require('node:path')
const { ipcRenderer } = require('electron')

/** 确保目录存在 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 把 dataURL 写入文件（按 MIME 判断扩展名由调用方控制，这里按传入数据字节写） */
function dataURLToBuffer(dataURL) {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/.exec(dataURL)
  if (!m) throw new Error('dataURL 格式不合法')
  return { buffer: Buffer.from(m[1], 'base64') }
}

/**
 * 从 PNG buffer 解析像素宽高（IHDR 固定偏移 16/20）。非 PNG 或解析失败返回 null。
 * 用于选区尺寸缺失时让编辑器/钉图窗口贴合图片真实尺寸，避免留白。
 */
function resolvePngSize(buffer) {
  try {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[12] === 0x49
    ) {
      return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) }
    }
  } catch {
    /* ignore */
  }
  return null
}

// ── 跨窗口大图传递（临时文件）──────────────────────────────
// 全屏大图 dataURL 动辄数 MB，塞进 URL query 会超 Chromium 长度限制导致建窗/加载失败。
// 因此 dataURL 写到临时文件，URL 只传短文件路径，子窗口读回 dataURL。
const TEMP_DIR = path.join(window.ztools.getPath('temp'), 'screenshot-annotate')

// 固定默认保存格式（无可视化设置界面，默认 png）
const DEFAULT_FORMAT = 'png'

/** 写 dataURL 到临时文件，返回短文件路径（供 URL query 传递） */
function writeTempImage(dataURL) {
  const { buffer } = dataURLToBuffer(dataURL)
  const stamp = Date.now().toString(36)
  const filePath = path.join(TEMP_DIR, `shot_${stamp}.png`)
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  fs.writeFileSync(filePath, buffer)
  return filePath
}

/** 读临时图片文件 → dataURL；读后删除防堆积 */
function readTempImage(filePath) {
  const buf = fs.readFileSync(filePath)
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* 删除失败不影响使用 */
  }
  return `data:image/png;base64,${buf.toString('base64')}`
}

/** 给 Promise 加超时，超时后 reject，避免永久挂起 */
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/**
 * 抓所有显示器的物理原图 + DIP 边界信息，供渲染层拼虚拟桌面。
 * @returns {Promise<Array<{bounds, scaleFactor, dataURL}>>}
 */
async function captureDisplays() {
  const displays = window.ztools.getAllDisplays()
  const sources = await withTimeout(
    window.ztools.desktopCaptureSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    }),
    8000,
    'desktopCaptureSources 超时：可能缺少屏幕录制权限，请检查 Windows「设置→隐私→屏幕捕获」'
  )

  // sources 顺序与 displays 不一定一一对应，用 display_id 关联；
  // 兜底按 index 对齐（desktopCapturer 通常按屏幕顺序返回）。
  return displays.map((d, idx) => {
    const thumb = (sources.find((s) => s.display_id === d.id) || sources[idx])?.thumbnail
    const dataURL = thumb && !thumb.isEmpty() ? thumb.toDataURL() : null
    return {
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      dataURL
    }
  })
}

/** 打开标注编辑窗口（承载 EditorPanel）。dataURL 经临时文件传给渲染层（query 只放短路径）。
 *  仿 shortcut-capture：transparent 窗口 + backgroundColor 全透明，图片居中展示，
 *  工具条作为独立毛玻璃条悬浮在图片下方透明区，与图片分离（"图片外单独一个窗口"的菜单栏）。 */
function openCaptureWindow({ dataURL, x, y, width, height }) {
  const winId = `edit${++editorSeq}`
  const sz = resolvePngSize(dataURLToBuffer(dataURL).buffer)
  // 图片下方透明留白：容纳独立悬浮工具条的高度（条高 50 + 上下间距 12）
  const TOOLBAR_PAD = 78
  const w = width || sz?.w || 960
  const h = (height || sz?.h || 640) + TOOLBAR_PAD
  const px = x ?? 80
  const py = y ?? 80
  const imgPath = writeTempImage(dataURL)
  const url = `capture.html?img=${encodeURIComponent(imgPath)}&win=${winId}`
  const win = window.ztools.createBrowserWindow(
    url,
    {
      x: px,
      y: py,
      width: w,
      height: h,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      title: '截图标注',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: true,
        webSecurity: false,
        preload: path.join(__dirname, 'services.js')
      }
    },
    () => {}
  )
  // 窗口被关闭时自我清理
  const t = setInterval(() => {
    if (win.isDestroyed && win.isDestroyed()) {
      clearInterval(t)
      editors.delete(winId)
    }
  }, 2000)
  editors.set(winId, win)
  return win
}

/** 虚拟桌面 DIP 包围盒（主视图据此定 capture 窗口尺寸，不抓原图） */
function getVirtualBounds() {
  const displays = window.ztools.getAllDisplays()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 复制 DIP 合成图到系统剪贴板（写 png 位图） */
function copyImageDataURL(dataURL) {
  const { buffer } = dataURLToBuffer(dataURL)
  return window.ztools.copyImage(new Uint8Array(buffer))
}

/**
 * 弹出系统"另存为"对话框保存合成图；取消时返回 { path: null, canceled: true }。
 * @param dataURL 图像 dataURL（png 或 jpeg）
 * @param options { format?: 'png'|'jpg' }——省略时读持久化设置的默认值
 * @returns { path: string|null, canceled: boolean }
 */
function saveImageDataURL(dataURL, options = {}) {
  const { buffer } = dataURLToBuffer(dataURL)
  const format = options.format || DEFAULT_FORMAT
  const ext = format === 'jpg' ? 'jpg' : 'png'
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const baseDir = path.join(window.ztools.getPath('pictures'), 'Screenshots')
  const defaultPath = path.join(baseDir, `Screenshot_${stamp}.${ext}`)
  const chosen = window.ztools.showSaveDialog({
    title: '保存截图',
    defaultPath,
    filters: [{ name: '图片', extensions: [ext] }]
  })
  // undefined 表示用户取消
  if (!chosen) return { path: null, canceled: true }
  ensureDir(path.dirname(chosen))
  fs.writeFileSync(chosen, buffer)
  return { path: chosen, canceled: false }
}

const services = {
  captureDisplays,
  openCaptureWindow,
  getVirtualBounds,
  copyImageDataURL,
  saveImageDataURL,
  writeTempImage,
  readTempImage,
  openPinWindow,
  pinGetBounds,
  pinSetBounds,
  pinMoveBy,
  pinResize,
  pinSetAlwaysOnTop,
  pinClose,
  pathJoin: (...p) => path.join(...p)
}

window.services = services

// ── 钉图窗口管理 ───────────────────────────────────────────
// 每张钉图一个独立置顶窗口；preload 记注册表，关闭即销毁防泄漏。

/** @type {Map<string, any>} winId → WindowInstance */
const pins = new Map()
let pinSeq = 0

/** 编辑器窗口注册表（供 JS 移窗中转） */
const editors = new Map()
let editorSeq = 0

/**
 * 窗口位置缓存（winId → [x, y]，绝对坐标）。
 * 拖动时若每帧 getPosition/getBounds 回读再叠加增量，连续 setPosition 会回读到
 * 合成前的旧值，窗口在邻近位置往返 → 整窗震动。这里首次惰性读一次作基准，
 * 之后纯本地累加 + setPosition 绝对坐标（单调不回读），消除该竞态。
 */
const winPos = new Map()
function posOf(winId, getter) {
  let p = winPos.get(winId)
  if (!p) {
    const b = getter ? getter() : null
    if (!b) return null
    p = [Math.round(b.x === undefined ? b[0] : b.x), Math.round(b.y === undefined ? b[1] : b.y)]
    winPos.set(winId, p)
  }
  return p
}

/**
 * 打开一张钉图窗口。
 * @param {{dataURL:string, x?:number, y?:number, width?:number, height?:number}} opts
 * @returns {{winId:string, x:number, y:number, width:number, height:number}}
 */
function openPinWindow({ dataURL, x, y, width, height }) {
  const winId = `pin${++pinSeq}`
  // 窗口贴合图片真实尺寸（解析 PNG 宽高），四周不再露出深色/黑衬底
  const sz = resolvePngSize(dataURLToBuffer(dataURL).buffer)
  const w = width || sz?.w || 1200
  const h = height || sz?.h || 900
  const px = x ?? 80
  const py = y ?? 80
  const imgPath = writeTempImage(dataURL)
  const q = encodeURIComponent(imgPath)

  const url = `pin.html?win=${winId}&img=${q}`
  const win = window.ztools.createBrowserWindow(
    url,
    {
      x: px,
      y: py,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: true,
        webSecurity: false,
        preload: path.join(__dirname, 'services.js')
      }
    },
    () => {}
  )
  // 窗口被关闭时自我清理
  const t = setInterval(() => {
    if (win.isDestroyed && win.isDestroyed()) {
      clearInterval(t)
      pins.delete(winId)
    }
  }, 2000)
  pins.set(winId, win)
  return { winId, x: px, y: py, width: w, height: h }
}

function mustPin(winId) {
  const w = pins.get(winId)
  if (!w) throw new Error('钉图窗口不存在')
  return w
}
function pinGetBounds(winId) {
  const w = mustPin(winId)
  return w.getBounds ? w.getBounds() : null
}
function pinSetBounds(winId, b) {
  const w = mustPin(winId)
  if (w.setBounds) {
    w.setBounds(b)
    // 同步位置缓存，避免后续拖动从旧基准累加导致错位
    if (b && b.x !== undefined && b.y !== undefined) winPos.set(winId, [Math.round(b.x), Math.round(b.y)])
  }
}
/** 设置窗口绝对位置（并同步位置缓存，供后续拖动累加） */
function pinSetPosition(winId, x, y) {
  const w = mustPin(winId)
  const nx = Math.round(x)
  const ny = Math.round(y)
  winPos.set(winId, [nx, ny])
  if (w.setPosition) w.setPosition(nx, ny)
}
/** 拖动：按增量移动。主窗口用缓存里的绝对坐标累加（不回读 getBounds，避免整窗震动） */
function pinMoveBy(winId, dx, dy) {
  const w = mustPin(winId)
  const p = posOf(winId, () => w.getBounds())
  if (!p || !w.setPosition) return
  p[0] += dx
  p[1] += dy
  w.setPosition(Math.round(p[0]), Math.round(p[1]))
}
/** 缩放：以窗口左上为锚改变尺寸（phase4 简化：左上锚，滚轮缩放够用） */
function pinResize(winId, dw, dh) {
  const w = mustPin(winId)
  const p = posOf(winId, () => w.getBounds())
  const b = w.getBounds ? w.getBounds() : null
  if (!b || !w.setBounds) return
  const nw = Math.max(80, Math.round(b.width + dw))
  const nh = Math.max(60, Math.round(b.height + dh))
  w.setBounds({ x: p[0], y: p[1], width: nw, height: nh })
}
function pinSetAlwaysOnTop(winId, flag) {
  const w = mustPin(winId)
  if (w.setAlwaysOnTop) w.setAlwaysOnTop(!!flag)
}
function pinClose(winId) {
  const w = pins.get(winId)
  if (!w) return
  if (w.close) w.close()
  pins.delete(winId)
}

// ── 子窗口 → 主窗口钉图中转 ───────────────────────────────
// 只有主插件窗口能 createBrowserWindow（子窗口的 webContents 不被识别为插件 → "plugin not found"）。
// 编辑子窗口用 ztools.sendToParent 把钉图请求送回主窗口；主进程只把 __ipc_sendto_relay__ 发给发送者的
// 父窗口，因此这里的监听只会在主窗口触发一次（子窗口自身不会收到自己的转发），无需按类型过滤。
const PIN_CHANNEL = 'screenshot-annotate:open-pin'

ipcRenderer.on(PIN_CHANNEL, (_event, dataURL) => {
  try {
    openPinWindow({ dataURL })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      window.ztools.showToast?.(`钉图失败: ${msg}`)
    } catch {
      /* 无 toast 通道时忽略 */
    }
  }
})

// 钉图窗口操作中转：钉图窗口是子窗口，其 preload 里 pins map 为空，无法直接操作
// 主窗口创建的窗口实例（move/scale/top/bounds 全失效）。因此钉图窗口把这些操作
// 经 sendToParent 送回主窗口执行（与钉图创建同一条已验证可靠的中转链路）。
const PIN_CMD_CHANNEL = 'screenshot-annotate:pin-cmd'

ipcRenderer.on(PIN_CMD_CHANNEL, (_event, payload) => {
  const { winId, action } = payload || {}
  if (!winId) return
  try {
    switch (action) {
      case 'move':
        // 绝对屏幕坐标（渲染层已算好窗口左上角 = screenX - clientX），直接落位并同步缓存
        pinSetPosition(winId, payload.x || 0, payload.y || 0)
        break
      case 'resize':
        pinResize(winId, payload.dw || 0, payload.dh || 0)
        break
      case 'setTop':
        pinSetAlwaysOnTop(winId, !!payload.flag)
        break
      case 'setBounds':
        pinSetBounds(winId, payload.bounds)
        break
      default:
        break
    }
  } catch {
    /* 窗口可能已关闭，忽略 */
  }
})

// 编辑器窗口移动：编辑器子窗口经 sendToParent 请求主窗口移动自己窗口
// （子窗口 preload 无法操作主窗口创建的窗口 instance）。
// 采用**绝对屏幕坐标**（渲染层已算好窗口左上角目标 = screenX - clientX），
// setPosition 直接落位并同步 winPos 缓存，不再做增量回读，彻底避免整窗震动。
function editorMoveTo(winId, x, y) {
  const w = editors.get(winId)
  if (!w || !w.setPosition) return
  const nx = Math.round(x)
  const ny = Math.round(y)
  winPos.set(winId, [nx, ny])
  w.setPosition(nx, ny)
}

const EDITOR_MOVE_CHANNEL = 'screenshot-annotate:editor-move'

ipcRenderer.on(EDITOR_MOVE_CHANNEL, (_event, payload) => {
  const { winId, x, y } = payload || {}
  if (!winId) return
  try {
    editorMoveTo(winId, x || 0, y || 0)
  } catch {
    /* 忽略 */
  }
})

// ── 无页面命令协议（window.exports + mode:none）───────────
// 触发任一 feature 时 ZTools 不渲染 main 页面，直接进入这里截图。
// 参考市场插件 shortcut-capture 的同款协议。
// 结束本次运行：打开子窗口/取消后调用 outPlugin()（不杀进程）把插件收回后台，
// 否则插件保持"前台隐藏运行"态，第二次快捷键无法重新触发（截图/钉图"只能用一次"的根因）。
// 已创建的编辑器/钉图子窗口与 preload 的 IPC 中转（sendToParent 通道）不随 outPlugin() 销毁，
// 子窗口可继续交互并随时中转钉图/移窗 —— 参照 clipboard-image-paintbrush 的 outPlugin() 用法。
function endRun() {
  setTimeout(() => {
    try {
      window.ztools.outPlugin()
    } catch {
      /* 退出失败不影响子窗口 */
    }
  }, 50)
}

function startCapture(mode) {
  const anyZtools = window.ztools
  // 框选前先隐藏搜索主窗口：否则主窗口停留在屏幕上，被拍进截图画面里
  anyZtools.hideMainWindow(true)
  anyZtools.screenCapture((image) => {
    if (!image) {
      // 用户取消了框选，恢复主窗口让交互不中断
      anyZtools.showMainWindow()
      endRun()
      return
    }
    const b = { x: 80, y: 80, width: 0, height: 0 }
    if (mode === 'pin') {
      openPinWindow({
        dataURL: image,
        x: b.x,
        y: b.y,
        width: b.width || undefined,
        height: b.height || undefined
      })
    } else {
      openCaptureWindow({
        dataURL: image,
        x: b.x,
        y: b.y,
        width: b.width || undefined,
        height: b.height || undefined
      })
    }
    endRun()
  })
}

window.exports = {
  'ui.capture': {
    mode: 'none',
    args: {
      enter: () => startCapture('edit')
    }
  },
  'function.capture-copy': {
    mode: 'none',
    args: {
      enter: () => startCapture('edit')
    }
  },
  'function.capture-pin': {
    mode: 'none',
    args: {
      enter: () => startCapture('pin')
    }
  }
}