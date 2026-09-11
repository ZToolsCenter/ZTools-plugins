/**
 * 主窗口侧：窗口管家。
 *
 * 关键约束：只有创建窗口的那个窗口持有 WindowInstance 句柄，子窗口操作不了自己，
 * 因此便利贴的显隐 / 尺寸 / 位置全部由这里（主窗口）代劳。
 *
 * 窗口构成：主窗口（本进程，创建便利贴后被 hide）+ 便利贴窗口 + 可选边缘标签窗口。
 *
 * 关键约束二：ztools.createBrowserWindow 只接受 file:// 本地地址。
 * - 生产模式：location.href 为 file://，可创建独立窗口，并通过 ?note=xxx 传递要打开的便签 id。
 * - dev 模式：主窗口跑在 http://localhost:5173，createBrowserWindow 拒绝 http url，
 *   由 App.vue 回退为「主窗口内嵌编辑视图」。
 */

import { getBridge } from './bridge'

let stickyWin: BrowserWindow.WindowInstance | null = null
let stickyWatcher: ReturnType<typeof setInterval> | null = null
/** 最小化后的边缘标签窗口 */
let tabWin: BrowserWindow.WindowInstance | null = null
/** 折叠前的便利贴窗口 bounds；非空表示当前处于「已折叠」状态 */
let stickyPrev: BrowserWindow.Rectangle | null = null
/** 折叠发生的时刻，用于给「标签窗口意外消失」的兜底判断留宽限期 */
let collapsedAt: number | null = null
/** 标签窗口拖动中的状态：光标起点 + 窗口起点 */
let tabDrag: { cursorX: number; cursorY: number; winX: number; winY: number } | null = null
/** 标签是否被拖动过：决定还原便利贴时是回到原位还是跟着标签走 */
let tabDragged = false
/** 与标签窗口握手用的重复问候定时器 */
let greetTimer: ReturnType<typeof setInterval> | null = null
let hostBridgeInited = false

/** 标签窗口创建后的宽限期，这段时间内不做「标签消失就还原」的判断 */
const TAB_SETTLE_MS = 1500
/** 标签吸附到边缘时与屏幕上下边留的间距 */
const TAB_EDGE_GAP = 8
/** 便利贴贴边摆放时与屏幕边缘的间距（首次打开与跟着标签还原都用它，保持一致） */
const STICKY_EDGE_GAP = 24

const STICKY_W = 360
const STICKY_H = 480

/** 边缘标签宽度 */
const TAB_W = 32
/** 标签高度 = 基础高度 + 标题字数 × 每字高度，再夹在这个区间内（基础高度里含关闭按钮与拖动把手的固定开销） */
const TAB_BASE_H = 64
const TAB_CHAR_H = 16
const TAB_H_MIN = 88
const TAB_H_MAX = 250
/** 标签竖排标题最多显示几个字 */
const TAB_TITLE_MAX = 10

interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

function getWorkArea(): WorkArea {
  try {
    const display = window.ztools.getPrimaryDisplay() as any
    const wa = display?.workArea || display?.bounds
    if (wa && wa.width && wa.height) return wa
  } catch {
    /* ignore */
  }
  return { x: 0, y: 0, width: 1280, height: 720 }
}

/** 取指定矩形所在显示器的可用区域（多屏时不能用主屏的算） */
function workAreaOf(rect?: BrowserWindow.Rectangle): WorkArea {
  if (rect) {
    try {
      const display = (window.ztools as any).getDisplayMatching?.(rect) as any
      const wa = display?.workArea || display?.bounds
      if (wa && wa.width && wa.height) return wa
    } catch {
      /* ignore */
    }
  }
  return getWorkArea()
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

function isWindowsPlatform(): boolean {
  try {
    return window.ztools.isWindows() === true
  } catch {
    return false
  }
}

function stopGreet() {
  if (greetTimer) {
    clearInterval(greetTimer)
    greetTimer = null
  }
}

function stopStickyWatcher() {
  if (stickyWatcher) {
    clearInterval(stickyWatcher)
    stickyWatcher = null
  }
}

/** 是否支持创建独立便利贴窗口（仅生产 file:// 模式可用） */
export function isStandaloneSupported(): boolean {
  return /^file:/i.test(location.href) && typeof window.ztools?.createBrowserWindow === 'function'
}

/**
 * 插件 preload 的相对路径（与 plugin.json 的 preload 字段保持一致，改一处要一起改）。
 *
 * 必须显式传给 createBrowserWindow：plugin.json 里的 preload 只保证注入插件主窗口，
 * 新建的窗口要自己带上，否则子窗口里没有 window.easynoteBridge，窗口间通信全断。
 */
const PLUGIN_PRELOAD = 'preload/services.js'

/**
 * 创建子窗口的统一入口：显式带上 preload。
 * 万一某些环境不认这个相对路径而直接抛错，退回不带 preload 的旧行为，别把窗口创建整个搞挂。
 */
function createChildWindow(
  url: string,
  options: Record<string, unknown>,
  onLoaded?: () => void
): BrowserWindow.WindowInstance {
  const ztools = window.ztools as unknown as {
    createBrowserWindow: (
      u: string,
      o: BrowserWindow.InitOptions,
      cb?: () => void
    ) => BrowserWindow.WindowInstance
  }
  const base = { ...options }
  try {
    return ztools.createBrowserWindow(
      url,
      {
        ...base,
        webPreferences: { preload: PLUGIN_PRELOAD, zoomFactor: 1 }
      } as unknown as BrowserWindow.InitOptions,
      onLoaded
    )
  } catch (e) {
    console.warn('[easynote] 带 preload 创建窗口失败，退回不带 preload 的方式：', e)
    return ztools.createBrowserWindow(
      url,
      { ...base, webPreferences: { zoomFactor: 1 } } as unknown as BrowserWindow.InitOptions,
      onLoaded
    )
  }
}

/** 便利贴窗口是否正在打开（未被销毁） */
export function isStickyNoteOpen(): boolean {
  return stickyWin !== null && !stickyWin.isDestroyed()
}

/**
 * 监听便利贴窗口关闭：一旦销毁即结束整个插件进程（主窗口已被隐藏，无其他用途）。
 * 顺带兜个底：折叠状态下标签窗口要是自己没了（意外销毁），把便利贴还原回来，别让便签走失。
 */
function watchStickyClose() {
  stopStickyWatcher()
  stickyWatcher = setInterval(() => {
    if (!stickyWin || stickyWin.isDestroyed()) {
      stopStickyWatcher()
      stickyWin = null
      stickyPrev = null
      collapsedAt = null
      destroyTabWindow()
      try {
        window.ztools.outPlugin(true)
      } catch {
        /* ignore */
      }
      return
    }
    // 折叠后先宽限一会儿，躲开标签窗口刚创建、状态还没稳定下来的那几十毫秒
    const settled = collapsedAt !== null && Date.now() - collapsedAt > TAB_SETTLE_MS
    if (stickyPrev && settled && (!tabWin || tabWin.isDestroyed())) {
      restoreStickyNote()
    }
  }, 300)
}

/** 创建/聚焦便利贴窗口。noteId 为空=新建草稿；非空=打开已保存便签 */
export function openStickyWindow(noteId?: string | null): boolean {
  if (!isStandaloneSupported()) return false

  // 如果已有打开的窗口，先关闭它（单例模式，但允许多次打开不同内容）
  closeStickyWindow()

  const wa = getWorkArea()
  const x = Math.round(wa.x + wa.width - STICKY_W - STICKY_EDGE_GAP)
  const y = Math.round(wa.y + STICKY_EDGE_GAP)

  // 生产模式：基础 url（去掉可能存在的 query）+ ?note=xxx
  const base = location.href.split('?')[0]
  const url = noteId ? `${base}?note=${encodeURIComponent(noteId)}` : base

  try {
    stickyWin = createChildWindow(
      url,
      {
        width: STICKY_W,
        height: STICKY_H,
        minWidth: 260,
        minHeight: 240,
        x,
        y,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        hasShadow: true,
        skipTaskbar: false,
        // parent: null 让窗口独立于主窗口，关闭主窗口时不连带关闭
        parent: null
      },
      () => {
        try {
          window.ztools.hideMainWindow()
        } catch {
          /* ignore */
        }
      }
    )
    // 主窗口已被隐藏，便利贴关闭后插件应随之结束
    watchStickyClose()
    return true
  } catch (e) {
    console.error('创建便利贴窗口失败:', e)
    stopStickyWatcher()
    stickyWin = null
    return false
  }
}

/** 关闭当前便利贴窗口（如果存在），同时清掉标签窗口与折叠状态 */
export function closeStickyWindow(): void {
  stopStickyWatcher()
  stickyPrev = null
  collapsedAt = null
  destroyTabWindow()
  if (stickyWin && !stickyWin.isDestroyed()) {
    try {
      stickyWin.close()
    } catch {
      /* ignore */
    }
  }
  stickyWin = null
}

/** 销毁标签窗口 */
function destroyTabWindow(): void {
  stopGreet()
  tabDrag = null
  if (tabWin && !tabWin.isDestroyed()) {
    try {
      tabWin.close()
    } catch {
      /* ignore */
    }
  }
  tabWin = null
}

/**
 * 把标签窗口吸附到所在屏幕的左 / 右边缘。
 * 顺带把「贴哪一边」告诉标签窗口自己 —— 贴边那一侧不画边框，换边后要跟着变。
 */
function dockTabWindow(): void {
  if (!tabWin || tabWin.isDestroyed()) return
  const [width, height] = tabWin.getSize()
  const [x, y] = tabWin.getPosition()
  const wa = workAreaOf({ x, y, width, height })

  const onRight = x + width / 2 > wa.x + wa.width / 2
  const nx = Math.round(onRight ? wa.x + wa.width - width : wa.x)
  const ny = Math.round(clamp(y, wa.y + TAB_EDGE_GAP, wa.y + wa.height - height - TAB_EDGE_GAP))

  if (nx !== x || ny !== y) tabWin.setPosition(nx, ny)

  const id = tabWin.webContents?.id
  if (id) getBridge()?.toWindow(id, { type: 'side', side: onRight ? 'right' : 'left' })
}

/**
 * 标签窗口拖动：子窗口改不了自己的位置，只能把光标的屏幕坐标报过来，由管家 setPosition。
 * 拖动中自由移动（可以换边、换屏），松手后吸附到最近的边缘。
 */
function dragTabWindow(msg: { phase?: string; x?: number; y?: number }): void {
  if (!tabWin || tabWin.isDestroyed()) return

  if (msg.phase === 'start') {
    const [winX, winY] = tabWin.getPosition()
    tabDrag = { cursorX: msg.x ?? 0, cursorY: msg.y ?? 0, winX, winY }
    return
  }
  if (!tabDrag) return

  if (msg.phase === 'move') {
    const x = Math.round(tabDrag.winX + ((msg.x ?? 0) - tabDrag.cursorX))
    const y = Math.round(tabDrag.winY + ((msg.y ?? 0) - tabDrag.cursorY))
    tabWin.setPosition(x, y)
    return
  }

  // end：松手就吸附，保证它始终是"贴在边缘的一条"
  tabDrag = null
  tabDragged = true
  dockTabWindow()
}

/** 标签窗口高度：标题越长标签越高（竖排），夹在 [TAB_H_MIN, TAB_H_MAX] */
function tabHeight(title: string): number {
  const len = Math.min([...title].length, TAB_TITLE_MAX)
  return Math.round(clamp(TAB_BASE_H + len * TAB_CHAR_H, TAB_H_MIN, TAB_H_MAX))
}

/**
 * 标签被拖动过之后，便利贴该从哪儿出来：
 * 跟标签同一侧边缘（间距与首次打开时一致），纵向中心对齐标签中心，尺寸沿用折叠前的大小。
 */
function boundsNearTab(
  prev: BrowserWindow.Rectangle,
  tab: BrowserWindow.Rectangle
): BrowserWindow.Rectangle {
  const wa = workAreaOf(tab)
  const { width, height } = prev
  const onRight = tab.x + tab.width / 2 > wa.x + wa.width / 2
  const x = Math.round(
    onRight ? wa.x + wa.width - width - STICKY_EDGE_GAP : wa.x + STICKY_EDGE_GAP
  )
  const y = Math.round(
    clamp(
      tab.y + tab.height / 2 - height / 2,
      wa.y + STICKY_EDGE_GAP,
      wa.y + wa.height - height - STICKY_EDGE_GAP
    )
  )
  return { x, y, width, height }
}

/**
 * 与标签窗口握手：子窗口不知道主窗口的 webContents id，由主窗口先发 hello。
 * 重复发几次直到收到 ack，避免子窗口 preload 尚未就绪导致消息丢失。
 */
function greetTabWindow() {
  stopGreet()
  const bridge = getBridge()
  if (!bridge) return

  let times = 0
  const greet = () => {
    const id = tabWin?.webContents?.id
    if (!id || !tabWin || tabWin.isDestroyed() || times >= 10) {
      stopGreet()
      return
    }
    times++
    bridge.toWindow(id, { type: 'hello' })
  }
  greet()
  greetTimer = setInterval(greet, 200)
}

/**
 * 最小化便利贴：把便利贴藏起来，在它靠近的那一侧屏幕边缘放一个竖排标签。
 * 便利贴只是 hide、不销毁 —— 未保存的草稿、光标、滚动位置都原样留着。
 */
export function collapseStickyNote(title: string, noteType: 'note' | 'todo'): void {
  if (!isStandaloneSupported()) return
  if (!stickyWin || stickyWin.isDestroyed()) return
  if (stickyPrev) return // 已经折叠过了

  const prev = stickyWin.getBounds()
  const wa = workAreaOf(prev)
  const height = tabHeight(title)

  // 吸附边：按窗口中心落在屏幕哪一半自动决定左右
  const onRight = prev.x + prev.width / 2 > wa.x + wa.width / 2
  const x = Math.round(onRight ? wa.x + wa.width - TAB_W : wa.x)
  const y = Math.round(
    clamp(
      prev.y + prev.height / 2 - height / 2,
      wa.y + TAB_EDGE_GAP,
      wa.y + wa.height - height - TAB_EDGE_GAP
    )
  )

  try {
    stickyWin.hide()
  } catch (e) {
    console.error('隐藏便利贴窗口失败:', e)
    return
  }
  stickyPrev = prev
  collapsedAt = Date.now()
  tabDragged = false

  const base = location.href.split('?')[0]
  const label = [...title].slice(0, TAB_TITLE_MAX).join('')
  const url =
    `${base}?view=tab&side=${onRight ? 'right' : 'left'}` +
    `&type=${noteType === 'todo' ? 'todo' : 'note'}&title=${encodeURIComponent(label)}`

  try {
    tabWin = createChildWindow(
      url,
      {
        width: TAB_W,
        height,
        x,
        y,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        parent: null,
        // Windows 下 'toolbar' 会带上 WS_EX_TOOLWINDOW，顺带把标签从 Alt+Tab 里摘掉；
        // 其它平台不支持这个 type（macOS 会直接报错），所以只在 Windows 上加
        ...(isWindowsPlatform() ? { type: 'toolbar' } : {})
      },
      () => greetTabWindow()
    )
    // 不指望那个回调一定来（页面加载异常时不会触发），这里就先开始问候，
    // 回调到了再重启一轮，两边都不耽误
    if (tabWin) greetTabWindow()
  } catch (e) {
    console.error('创建边缘标签窗口失败:', e)
    tabWin = null
    stickyPrev = null
    collapsedAt = null
    try {
      stickyWin.show()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 还原便利贴：销毁标签，便利贴回到折叠前的位置与尺寸。
 * 标签被拖动过的话，位置改成「跟着标签走」—— 点开就在标签所在的那一侧、纵向对齐标签中心，
 * 毕竟标签就是这张便签的停车位。
 */
export function restoreStickyNote(): void {
  const prev = stickyPrev
  const tabRect =
    tabDragged && tabWin && !tabWin.isDestroyed() ? tabWin.getBounds() : null
  stickyPrev = null
  collapsedAt = null
  tabDragged = false
  destroyTabWindow()

  if (!stickyWin || stickyWin.isDestroyed()) return
  const target = prev && tabRect ? boundsNearTab(prev, tabRect) : prev
  try {
    if (target) {
      stickyWin.setSize(target.width, target.height)
      stickyWin.setPosition(target.x, target.y)
    }
    stickyWin.show()
    stickyWin.focus()
  } catch (e) {
    console.error('还原便利贴窗口失败:', e)
  }
}

/**
 * 标签上的关闭：先把便利贴还原出来，再让它走自己那套关闭流程
 * （含未保存修改的确认弹窗）—— 关不关、要不要二次确认，判断逻辑只在 StickyNote 里有一份。
 */
function closeStickyFromTab(): void {
  const target = stickyWin
  const wasCollapsed = stickyPrev !== null
  restoreStickyNote()
  if (!wasCollapsed || !target || target.isDestroyed()) return

  const id = target.webContents?.id
  if (!id) return
  // 等窗口显示出来再发，免得确认弹窗挂在还没画出来的窗口上
  setTimeout(() => {
    const bridge = getBridge()
    if (!bridge || !target || target.isDestroyed()) return
    bridge.toWindow(id, { type: 'close-request' })
  }, 60)
}

/**
 * 主窗口启动时调用一次：接便利贴 / 标签窗口发来的指令。
 * 只有主窗口需要注册（子窗口用 getBridge().toHost 往外发）。
 */
export function initHostBridge(): void {
  const bridge = getBridge()
  if (!bridge || hostBridgeInited) return
  hostBridgeInited = true

  bridge.onCmd((msg) => {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'collapse':
        collapseStickyNote(msg.title || '便签', msg.noteType === 'todo' ? 'todo' : 'note')
        break
      case 'restore':
        restoreStickyNote()
        break
      case 'request-close':
        closeStickyFromTab()
        break
      case 'tab-drag':
        dragTabWindow(msg)
        break
      case 'hello-ack':
        stopGreet()
        break
      default:
        break
    }
  })
}
