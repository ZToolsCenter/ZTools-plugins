/**
 * 主窗口侧：窗口管家。
 *
 * 关键约束：只有创建窗口的那个窗口持有 WindowInstance 句柄，子窗口操作不了自己，
 * 因此便利贴的显隐 / 尺寸 / 位置全部由这里（主窗口）代劳。
 *
 * 窗口构成：主窗口（本进程，创建便利贴后被 hide）+ N 张便利贴窗口 + 各自可选的边缘标签窗口。
 * 多便利贴：每张便签一个独立窗口，注册表（stickies）按窗口句柄记一份折叠状态；
 * 子窗口 → 管家的指令靠消息的 senderId（即发送方 webContents.id）反查是哪一张，
 * 管家 → 子窗口用 toWindow(webContents.id)，协议里不需要额外带身份字段。
 *
 * 关键约束二：ztools.createBrowserWindow 只接受 file:// 本地地址。
 * - 生产模式：location.href 为 file://，可创建独立窗口，并通过 ?note=xxx 传递要打开的便签 id。
 * - dev 模式：主窗口跑在 http://localhost:5173，createBrowserWindow 拒绝 http url，
 *   由 App.vue 回退为「主窗口内嵌编辑视图」。
 */

import { getBridge } from './bridge'

/** 标签拖动过程中的临时状态：光标起点 + 窗口起点 */
interface TabDragState {
  cursorX: number
  cursorY: number
  winX: number
  winY: number
}

/** 单张便利贴的注册表条目：窗口句柄 + 折叠状态 */
interface StickyEntry {
  win: BrowserWindow.WindowInstance
  /** 打开的便签 id；null = 新建草稿 */
  noteId: string | null
  /** 折叠前的 bounds；非空表示当前处于「已折叠」状态 */
  prev: BrowserWindow.Rectangle | null
  /** 折叠后的边缘标签窗口 */
  tabWin: BrowserWindow.WindowInstance | null
  /** 折叠发生的时刻，用于给「标签窗口意外消失」的兜底判断留宽限期 */
  collapsedAt: number | null
  /** 标签是否被拖动过：决定还原便利贴时是回到原位还是跟着标签走 */
  tabDragged: boolean
  /** 标签拖动中的临时状态 */
  drag: TabDragState | null
  /** 与标签窗口握手用的重复问候定时器 */
  greetTimer: ReturnType<typeof setInterval> | null
}

/** 便利贴注册表：key 用 WindowInstance 对象本身（身份反查走 webContents.id 比较） */
const stickies = new Map<BrowserWindow.WindowInstance, StickyEntry>()

let stickyWatcher: ReturnType<typeof setInterval> | null = null
let hostBridgeInited = false

/** 同时最多打开的便利贴数量（每张窗口一个渲染进程，防资源失控） */
export const MAX_STICKIES = 8
/** 级联摆放：每张新窗口相对右上角基准点错开的步长与最大档数 */
const CASCADE_STEP = 28
const CASCADE_MAX_STEPS = 8

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

function stopGreet(entry: StickyEntry) {
  if (entry.greetTimer) {
    clearInterval(entry.greetTimer)
    entry.greetTimer = null
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

/** 是否还有存活的便利贴窗口 */
export function isStickyNoteOpen(): boolean {
  for (const entry of stickies.values()) {
    if (!entry.win.isDestroyed()) return true
  }
  return false
}

function aliveEntries(): StickyEntry[] {
  return [...stickies.values()].filter((e) => !e.win.isDestroyed())
}

/** 主页展示用：当前打开的便利贴数量（total 含最小化成标签的） */
export function getStickyStats(): { total: number; collapsed: number } {
  let total = 0
  let collapsed = 0
  for (const entry of stickies.values()) {
    if (entry.win.isDestroyed()) continue
    total++
    if (entry.prev) collapsed++
  }
  return { total, collapsed }
}

/**
 * 关闭全部便利贴（含最小化成标签的）。不逐窗做未保存确认，由调用方（主页）先做整体确认。
 * 退出收尾沿用可靠路径：先关其余窗口，留最后一张执行 outPlugin(true) 结束整个插件。
 */
export function closeAllStickies(): void {
  const alive = aliveEntries()
  if (!alive.length) return
  const survivor = alive[alive.length - 1]

  for (const entry of alive) {
    if (entry === survivor) continue
    destroyTab(entry)
    if (!entry.win.isDestroyed()) {
      try {
        entry.win.close()
      } catch {
        /* ignore */
      }
    }
    stickies.delete(entry.win)
  }

  const id = survivor.win.webContents?.id
  if (id) {
    // 由存活的便利贴窗口自己 outPlugin —— 主窗口侧调用结束不掉插件进程
    getBridge()?.toWindow(id, { type: 'exit' })
    stickies.delete(survivor.win)
  } else {
    // 极端情况拿不到 webContents id：全部直接关，收尾交给看门狗
    destroyTab(survivor)
    try {
      survivor.win.close()
    } catch {
      /* ignore */
    }
    stickies.delete(survivor.win)
  }
}

/** 按便利贴窗口的 webContents.id 反查条目（子窗口 toHost 消息的 senderId 就是它） */
function entryByStickyId(senderId?: number): StickyEntry | null {
  if (!senderId) return null
  for (const entry of stickies.values()) {
    if (entry.win.webContents?.id === senderId) return entry
  }
  return null
}

/** 按边缘标签窗口的 webContents.id 反查条目 */
function entryByTabId(senderId?: number): StickyEntry | null {
  if (!senderId) return null
  for (const entry of stickies.values()) {
    if (entry.tabWin?.webContents?.id === senderId) return entry
  }
  return null
}

/** 销毁一张便利贴的边缘标签窗口 */
function destroyTab(entry: StickyEntry): void {
  stopGreet(entry)
  if (entry.tabWin && !entry.tabWin.isDestroyed()) {
    try {
      entry.tabWin.close()
    } catch {
      /* ignore */
    }
  }
  entry.tabWin = null
}

/**
 * 全量看门狗：清理已销毁的便利贴、兜底还原「标签意外消失」的折叠便签、
 * 在最后一张便利贴关闭且主窗口不可见时结束插件进程。
 * 只要有存活便利贴就保持运行（openStickyWindow 时启动，注册表清空后自停）。
 */
function startStickyWatcher() {
  if (stickyWatcher) return
  stickyWatcher = setInterval(() => {
    // 1. 清理已销毁的便利贴（顺带收掉它的标签）
    for (const [win, entry] of stickies) {
      if (entry.win.isDestroyed()) {
        destroyTab(entry)
        stickies.delete(win)
      }
    }

    // 2. 折叠状态下标签窗口要是自己没了（意外销毁），把便利贴还原回来，别让便签走失
    for (const entry of stickies.values()) {
      const settled =
        entry.prev !== null &&
        entry.collapsedAt !== null &&
        Date.now() - entry.collapsedAt > TAB_SETTLE_MS
      if (settled && (!entry.tabWin || entry.tabWin.isDestroyed())) {
        restoreSticky(entry)
      }
    }

    // 3. 全部关闭 → 结束插件进程（语义与单窗口时代一致：便利贴全关 = 插件退出）
    if (stickies.size === 0) {
      stopStickyWatcher()
      try {
        window.ztools.outPlugin(true)
      } catch {
        /* ignore */
      }
    }
  }, 300)
}

/** 聚焦已打开的便利贴：折叠中则先还原，否则前置+聚焦 */
function focusSticky(entry: StickyEntry): void {
  if (entry.win.isDestroyed()) return
  if (entry.prev) {
    restoreSticky(entry)
    return
  }
  try {
    entry.win.show()
    entry.win.focus()
  } catch {
    /* ignore */
  }
}

/** 打开结果：created=新开窗口，focused=聚焦已有窗口，limit=超出上限，unsupported/failed=需要回退内嵌编辑 */
export type OpenStickyResult = 'created' | 'focused' | 'limit' | 'unsupported' | 'failed'

/**
 * 打开便利贴窗口（支持多开）：同一张便签已开着就聚焦已有窗口，避免双开编辑冲突；
 * 新窗口位置按级联错开摆放，不记录历史位置。noteId 为空=新建草稿；非空=打开已保存便签。
 */
export function openStickyWindow(noteId?: string | null): OpenStickyResult {
  if (!isStandaloneSupported()) return 'unsupported'

  // 同一张便签已在桌面上 → 聚焦即可
  if (noteId) {
    const existed = aliveEntries().find((e) => e.noteId === noteId)
    if (existed) {
      focusSticky(existed)
      return 'focused'
    }
  }

  const alive = aliveEntries()
  if (alive.length >= MAX_STICKIES) return 'limit'

  // 级联偏移：每张往左下错开一点，避免完全叠在一起
  const off = (alive.length % CASCADE_MAX_STEPS) * CASCADE_STEP
  const wa = getWorkArea()
  const x = Math.round(wa.x + wa.width - STICKY_W - STICKY_EDGE_GAP - off)
  const y = Math.round(wa.y + STICKY_EDGE_GAP + off)

  // 生产模式：基础 url（去掉可能存在的 query）+ ?note=xxx
  const base = location.href.split('?')[0]
  const url = noteId ? `${base}?note=${encodeURIComponent(noteId)}` : base

  try {
    const win = createChildWindow(
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
    stickies.set(win, {
      win,
      noteId: noteId ?? null,
      prev: null,
      tabWin: null,
      collapsedAt: null,
      tabDragged: false,
      drag: null,
      greetTimer: null
    })
    // 主窗口已被隐藏，最后一张便利贴关闭后插件应随之结束
    startStickyWatcher()
    return 'created'
  } catch (e) {
    console.error('创建便利贴窗口失败:', e)
    return 'failed'
  }
}

/**
 * 在同一屏同一侧，给新标签找一个不与现有标签重叠的 y：从偏好位置向下压，
 * 压到工作区底部仍有重叠时，再从顶部找第一个空档。
 */
function freeTabY(
  wa: WorkArea,
  side: 'left' | 'right',
  height: number,
  preferredY: number
): number {
  const onRight = side === 'right'
  const others: Array<{ y: number; h: number }> = []
  for (const entry of stickies.values()) {
    if (!entry.tabWin || entry.tabWin.isDestroyed()) continue
    const [w, h] = entry.tabWin.getSize()
    const [x, ty] = entry.tabWin.getPosition()
    if (x + w / 2 > wa.x + wa.width / 2 !== onRight) continue
    others.push({ y: ty, h })
  }
  others.sort((a, b) => a.y - b.y)

  const overlaps = (yy: number) => others.some((o) => yy + height > o.y && o.y + o.h > yy)
  let y = preferredY
  for (const o of others) {
    if (overlaps(y)) y = o.y + o.h + TAB_EDGE_GAP
  }
  y = clamp(y, wa.y + TAB_EDGE_GAP, wa.y + wa.height - height - TAB_EDGE_GAP)
  if (overlaps(y)) {
    y = wa.y + TAB_EDGE_GAP
    for (const o of others) {
      if (overlaps(y)) y = o.y + o.h + TAB_EDGE_GAP
    }
    y = clamp(y, wa.y + TAB_EDGE_GAP, wa.y + wa.height - height - TAB_EDGE_GAP)
  }
  return Math.round(y)
}

/**
 * 把标签窗口吸附到所在屏幕的左 / 右边缘。
 * 顺带把「贴哪一边」告诉标签窗口自己 —— 贴边那一侧不画边框，换边后要跟着变。
 */
function dockTabWindow(entry: StickyEntry): void {
  if (!entry.tabWin || entry.tabWin.isDestroyed()) return
  const [width, height] = entry.tabWin.getSize()
  const [x, y] = entry.tabWin.getPosition()
  const wa = workAreaOf({ x, y, width, height })

  const onRight = x + width / 2 > wa.x + wa.width / 2
  const nx = Math.round(onRight ? wa.x + wa.width - width : wa.x)
  const ny = Math.round(clamp(y, wa.y + TAB_EDGE_GAP, wa.y + wa.height - height - TAB_EDGE_GAP))

  if (nx !== x || ny !== y) entry.tabWin.setPosition(nx, ny)

  const id = entry.tabWin.webContents?.id
  if (id) getBridge()?.toWindow(id, { type: 'side', side: onRight ? 'right' : 'left' })
}

/**
 * 标签窗口拖动：子窗口改不了自己的位置，只能把光标的屏幕坐标报过来，由管家 setPosition。
 * 拖动中自由移动（可以换边、换屏），松手后吸附到最近的边缘。
 */
function dragTabWindow(msg: { phase?: string; x?: number; y?: number }, entry: StickyEntry): void {
  if (!entry.tabWin || entry.tabWin.isDestroyed()) return

  if (msg.phase === 'start') {
    const [winX, winY] = entry.tabWin.getPosition()
    entry.drag = { cursorX: msg.x ?? 0, cursorY: msg.y ?? 0, winX, winY }
    return
  }
  const drag = entry.drag
  if (!drag) return

  if (msg.phase === 'move') {
    const x = Math.round(drag.winX + ((msg.x ?? 0) - drag.cursorX))
    const y = Math.round(drag.winY + ((msg.y ?? 0) - drag.cursorY))
    entry.tabWin.setPosition(x, y)
    return
  }

  // end：松手就吸附，保证它始终是"贴在边缘的一条"
  entry.drag = null
  entry.tabDragged = true
  dockTabWindow(entry)
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
function greetTabWindow(entry: StickyEntry) {
  stopGreet(entry)
  const bridge = getBridge()
  if (!bridge) return

  let times = 0
  const greet = () => {
    const id = entry.tabWin?.webContents?.id
    if (!id || !entry.tabWin || entry.tabWin.isDestroyed() || times >= 10) {
      stopGreet(entry)
      return
    }
    times++
    bridge.toWindow(id, { type: 'hello' })
  }
  greet()
  entry.greetTimer = setInterval(greet, 200)
}

/**
 * 最小化便利贴：把便利贴藏起来，在它靠近的那一侧屏幕边缘放一个竖排标签。
 * 便利贴只是 hide、不销毁 —— 未保存的草稿、光标、滚动位置都原样留着。
 * 多张便签都折叠时，标签在偏好位置向下自动找空档堆叠，不互相覆盖。
 */
function collapseSticky(entry: StickyEntry, title: string, noteType: 'note' | 'todo'): void {
  if (!isStandaloneSupported()) return
  if (entry.win.isDestroyed()) return
  if (entry.prev) return // 已经折叠过了

  const prev = entry.win.getBounds()
  const wa = workAreaOf(prev)
  const height = tabHeight(title)

  // 吸附边：按窗口中心落在屏幕哪一半自动决定左右；y 从偏好位置向下找空档
  const onRight = prev.x + prev.width / 2 > wa.x + wa.width / 2
  const preferredY = prev.y + prev.height / 2 - height / 2
  const y = freeTabY(wa, onRight ? 'right' : 'left', height, preferredY)
  const x = Math.round(onRight ? wa.x + wa.width - TAB_W : wa.x)

  try {
    entry.win.hide()
  } catch (e) {
    console.error('隐藏便利贴窗口失败:', e)
    return
  }
  entry.prev = prev
  entry.collapsedAt = Date.now()
  entry.tabDragged = false

  const base = location.href.split('?')[0]
  const label = [...title].slice(0, TAB_TITLE_MAX).join('')
  const url =
    `${base}?view=tab&side=${onRight ? 'right' : 'left'}` +
    `&type=${noteType === 'todo' ? 'todo' : 'note'}&title=${encodeURIComponent(label)}`

  try {
    entry.tabWin = createChildWindow(
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
      () => greetTabWindow(entry)
    )
    // 不指望那个回调一定来（页面加载异常时不会触发），这里就先开始问候，
    // 回调到了再重启一轮，两边都不耽误
    if (entry.tabWin) greetTabWindow(entry)
  } catch (e) {
    console.error('创建边缘标签窗口失败:', e)
    destroyTab(entry)
    entry.prev = null
    entry.collapsedAt = null
    try {
      entry.win.show()
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
function restoreSticky(entry: StickyEntry): void {
  const prev = entry.prev
  const tabRect =
    entry.tabDragged && entry.tabWin && !entry.tabWin.isDestroyed()
      ? entry.tabWin.getBounds()
      : null
  entry.prev = null
  entry.collapsedAt = null
  entry.tabDragged = false
  destroyTab(entry)

  if (entry.win.isDestroyed()) return
  const target = prev && tabRect ? boundsNearTab(prev, tabRect) : prev
  try {
    if (target) {
      entry.win.setSize(target.width, target.height)
      entry.win.setPosition(target.x, target.y)
    }
    entry.win.show()
    entry.win.focus()
  } catch (e) {
    console.error('还原便利贴窗口失败:', e)
  }
}

/**
 * 标签上的关闭：先把便利贴还原出来，再让它走自己那套关闭流程
 * （含未保存修改的确认弹窗）—— 关不关、要不要二次确认，判断逻辑只在 StickyNote 里有一份。
 */
function closeStickyFromTab(senderId?: number): void {
  const entry = entryByTabId(senderId)
  if (!entry) return
  const target = entry.win
  const wasCollapsed = entry.prev !== null
  restoreSticky(entry)
  if (!wasCollapsed || target.isDestroyed()) return

  const id = target.webContents?.id
  if (!id) return
  // 等窗口显示出来再发，免得确认弹窗挂在还没画出来的窗口上
  setTimeout(() => {
    const bridge = getBridge()
    if (!bridge || target.isDestroyed()) return
    bridge.toWindow(id, { type: 'close-request' })
  }, 60)
}

/**
 * 便利贴窗口自己请求关闭（窗口内 X 按钮）：管家判断是不是最后一张。
 * - 最后一张 → 让该窗口自己执行 outPlugin(true)（历史验证过的可靠退出路径，
 *   主窗口侧调用在部分环境结束不掉插件进程，1.5.x 版本踩过这个坑）。
 * - 其余情况 → 管家直接关掉该窗口（含它的标签）。
 */
function closeStickyBySelf(senderId?: number): void {
  const entry = entryByStickyId(senderId)
  if (!entry) return

  if (aliveEntries().length === 1) {
    const id = entry.win.webContents?.id
    if (id) getBridge()?.toWindow(id, { type: 'exit' })
    // 若 exit 消息丢失，子窗口自身的延时兜底会 window.close()，再由看门狗收尾
    return
  }

  destroyTab(entry)
  if (!entry.win.isDestroyed()) {
    try {
      entry.win.close()
    } catch {
      /* ignore */
    }
  }
  stickies.delete(entry.win)
}

/**
 * 主窗口启动时调用一次：接便利贴 / 标签窗口发来的指令。
 * 只有主窗口需要注册（子窗口用 getBridge().toHost 往外发）。
 * 消息身份：senderId 即发送方 webContents.id，据此反查是哪一张便利贴 / 哪个标签。
 */
export function initHostBridge(): void {
  const bridge = getBridge()
  if (!bridge || hostBridgeInited) return
  hostBridgeInited = true

  bridge.onCmd((msg, senderId) => {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'collapse': {
        const entry = entryByStickyId(senderId)
        if (entry) {
          collapseSticky(entry, msg.title || '便签', msg.noteType === 'todo' ? 'todo' : 'note')
        }
        break
      }
      case 'restore': {
        const entry = entryByTabId(senderId)
        if (entry) restoreSticky(entry)
        break
      }
      case 'request-close':
        closeStickyFromTab(senderId)
        break
      case 'tab-drag': {
        const entry = entryByTabId(senderId)
        if (entry) dragTabWindow(msg, entry)
        break
      }
      case 'hello-ack': {
        const entry = entryByTabId(senderId)
        if (entry) stopGreet(entry)
        break
      }
      case 'note-id': {
        // 草稿窗口保存后拿到（或被删重建换了）便签 id，同步进注册表——
        // 否则管家始终记着 null，从主页再打开同一张便签时去重匹配不上，会另开新窗口
        const entry = entryByStickyId(senderId)
        if (entry && msg.noteId) entry.noteId = msg.noteId
        break
      }
      case 'close-sticky':
        closeStickyBySelf(senderId)
        break
      default:
        break
    }
  })
}
