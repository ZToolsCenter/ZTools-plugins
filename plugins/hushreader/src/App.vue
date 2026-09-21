<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import Bookshelf from './components/Bookshelf/index.vue'
import Toast from './components/Bookshelf/Toast.vue'
import { useReaderStore } from './stores/reader'
import { useBookStore, type Bookmark } from './stores/books'
import { useConfigStore } from './stores/config'
import { parseTxt } from './utils/txtParser'
import { parseEpub } from './utils/epubParser'
import { parseMobi } from './utils/mobiParser'
import { loadChapters, saveChapters } from './utils/db'
import { useOnlineStore } from './stores/online'
import { useReplaceStore } from './stores/replace'
import { fetchChapterMenu, fetchChapterContent, clearOnlineCaches, sourceKey } from './utils/onlineBook'
import { applyContentReplaceRules, applyTitleReplaceRules } from './utils/replaceRules'

type HushreaderCommand = string | { type?: string; width?: number; height?: number; x?: number; y?: number; percent?: number }
type HushreaderBounds = { x: number; y: number; width: number; height: number }
type AppBrowserWindow = {
  id: number
  show?: () => void
  hide?: () => void
  close?: () => void
  focus?: () => void
  blur?: () => void
  isDestroyed?: () => boolean
  setFocusable?: (flag: boolean) => void
  setSkipTaskbar?: (flag: boolean) => void
  setSize?: (width: number, height: number) => void
  setContentSize?: (width: number, height: number) => void
  setContentBounds?: (bounds: HushreaderBounds) => void
  setBounds?: (bounds: HushreaderBounds) => void
  setResizable?: (flag: boolean) => void
  setPosition?: (x: number, y: number) => void
  setAlwaysOnTop?: (flag: boolean) => void
  moveTop?: () => void
  webContents?: {
    executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  }
}

const FISH_MIN_WIDTH = 280
const FISH_MAX_WIDTH = 1180
const FISH_MIN_HEIGHT = 22
const FISH_MAX_HEIGHT = 500
const FISH_META_ROW_HEIGHT = 18
const FISH_SIDE_CONTROLS_WIDTH = 44
const FISH_CONTENT_PADDING = 20

const route = ref('')
const enterAction = ref<any>({})

const readerStore = useReaderStore()
const bookStore = useBookStore()
const configStore = useConfigStore()
const onlineStore = useOnlineStore()
const replaceStore = useReplaceStore()

/** 净化规则匹配用的书源标识（书名 + 书源URL/名称） */
function getBookOriginForReplace(book: any): string {
  return book?.sourceName || sourceKey(book?.source) || book?.source?.bookSourceUrl || ''
}

const isReaderHidden = ref(false)
const isAutoPaging = ref(false)
const isHushreaderKeyboardActive = ref(false)
const hushreaderActivated = ref(false)
const toastMsg = ref('')
const toastType = ref<'info' | 'error' | 'success'>('info')
let toastTimer = 0
let autoTimer = 0
let readingTimer = 0
let readingTimerStart = 0
let readingTimerWarning = 0
let isAutoPageTickRunning = false

let hushreaderWindow: AppBrowserWindow | null = null
let hushreaderWindowAnchor: { x: number; y: number } | null = null
let offHushreaderCommand: (() => void) | undefined
// 右键菜单撑高临时状态：菜单打开期间窗口临时撑高（不写进配置），关闭后还原。
// snapshot 记录撑高前的窗口 bounds 与配置，用于还原时区分「未拖动 → 精确还原」与
// 「撑高期间拖动/缩放过 → 按新配置还原」。
let hushreaderMenuExpandedHeight: number | null = null
let hushreaderMenuExpandSnapshot: { bounds: HushreaderBounds; width: number; height: number; x: number; y: number } | null = null

// 在线阅读（在线书源 / 开源阅读）会话状态
const readingOnlineBook = ref<any>(null)
const onlineChapterLoadings = new Set<number>()
const onlineChapterPromises = new Map<number, Promise<void>>()

const cfg = computed(() => configStore.config)
const hushreaderCfg = computed(() => cfg.value.hushreader)

const currentBook = computed(() => {
  const id = bookStore.currentBookId
  return id ? bookStore.books.find(b => b.id === id) ?? null : null
})

const currentChapter = computed(() =>
  readerStore.chapters[readerStore.currentChapterIndex] ?? null
)

const hushreaderLines = computed(() => readerStore.hushreaderLines)

const progressLabel = computed(() => {
  if (hushreaderCfg.value.progressMode === 'percent') {
    return `${readerStore.readingPercent.toFixed(2)}%`
  }
  const total = readerStore.chapters.length
  const ci = readerStore.currentChapterIndex
  return total > 0 ? `${ci + 1}/${total}` : ''
})

const activeBookLabel = computed(() => currentBook.value?.title ?? '')

function clampNumber(value: number, min: number, max: number) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? Math.max(safeMin, max) : safeMin
  const safeValue = Number.isFinite(value) ? value : safeMin
  return Math.min(safeMax, Math.max(safeMin, Math.round(safeValue)))
}

// 工作区（显示器可用区域）缓存：拖动/缩放预览期间不反复走
// ztools.getPrimaryDisplay() 的 IPC，改为短 TTL 缓存，避免每帧一次跨进程查询。
const WORK_AREA_CACHE_MS = 1000
let cachedWorkArea: HushreaderBounds | null = null
let cachedWorkAreaAt = 0

function getWorkArea(): HushreaderBounds {
  const now = Date.now()
  if (cachedWorkArea && now - cachedWorkAreaAt < WORK_AREA_CACHE_MS) {
    return cachedWorkArea
  }
  const display = (window as any).ztools?.getPrimaryDisplay?.()
  const area: HushreaderBounds = display?.workArea ?? { x: 0, y: 0, width: window.screen.availWidth, height: window.screen.availHeight }
  cachedWorkArea = area
  cachedWorkAreaAt = now
  return area
}

function getHushreaderSizeLimits() {
  const area = getWorkArea()
  return {
    minWidth: FISH_MIN_WIDTH,
    maxWidth: Math.max(FISH_MIN_WIDTH, Math.min(area.width, FISH_MAX_WIDTH)),
    minHeight: FISH_MIN_HEIGHT,
    maxHeight: Math.max(FISH_MIN_HEIGHT, Math.min(area.height, FISH_MAX_HEIGHT))
  }
}

function clampHushreaderSize(width: number, height: number) {
  const limits = getHushreaderSizeLimits()
  return {
    width: clampNumber(width, limits.minWidth, limits.maxWidth),
    height: clampNumber(height, limits.minHeight, limits.maxHeight)
  }
}

function getInitialHushreaderWindowBoundsForSize(width: number, height: number) {
  const area = getWorkArea()
  const size = clampHushreaderSize(width, height)
  return {
    ...size,
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + area.height - size.height)
  }
}

function getStoredHushreaderAnchor() {
  const fc = hushreaderCfg.value
  if (Number.isFinite(fc.hushreaderX) && Number.isFinite(fc.hushreaderY) && (fc.hushreaderX !== 0 || fc.hushreaderY !== 0)) {
    return { x: fc.hushreaderX, y: fc.hushreaderY }
  }
  return null
}

function getAnchoredHushreaderWindowBoundsForSize(width: number, height: number) {
  const area = getWorkArea()
  const size = clampHushreaderSize(width, height)
  const fallback = hushreaderWindowAnchor ?? getStoredHushreaderAnchor() ?? getInitialHushreaderWindowBoundsForSize(size.width, size.height)
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)
  return {
    ...size,
    x: clampNumber(fallback.x, area.x, maxX),
    y: clampNumber(fallback.y, area.y, maxY)
  }
}

function getMovedHushreaderWindowBounds(x: number, y: number) {
  const area = getWorkArea()
  const size = clampHushreaderSize(hushreaderCfg.value.hushreaderWidth, hushreaderCfg.value.hushreaderHeight)
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)
  return {
    ...size,
    x: clampNumber(x, area.x, maxX),
    y: clampNumber(y, area.y, maxY)
  }
}

// 若右键菜单正处于撑高状态，将给定 bounds 叠加临时高度（底边不动、向上增长），
// 保证菜单打开期间的状态推送 / 缩放预览不会把窗口缩回菜单放不下的高度。
function applyHushreaderMenuExpansion(bounds: HushreaderBounds): HushreaderBounds {
  const target = hushreaderMenuExpandedHeight
  if (!target || !hushreaderWindow || hushreaderWindow.isDestroyed?.()) return bounds
  if (target <= bounds.height) return bounds
  const limits = getHushreaderSizeLimits()
  const height = Math.min(target, limits.maxHeight)
  if (height <= bounds.height) return bounds
  const grow = height - bounds.height
  const area = getWorkArea()
  const maxY = area.y + Math.max(0, area.height - height)
  return { ...bounds, height, y: clampNumber(bounds.y - grow, area.y, maxY) }
}

function getHushreaderWindowBounds() {
  return applyHushreaderMenuExpansion(getAnchoredHushreaderWindowBoundsForSize(hushreaderCfg.value.hushreaderWidth, hushreaderCfg.value.hushreaderHeight))
}

function getHushreaderLineLength(): number {
  const readableWidth = Math.max(24, hushreaderCfg.value.hushreaderWidth - FISH_SIDE_CONTROLS_WIDTH - FISH_CONTENT_PADDING)
  const cjkCharWidth = Math.max(1, hushreaderCfg.value.fontSize + hushreaderCfg.value.letterSpacing)
  return Math.max(1, Math.floor(readableWidth / cjkCharWidth))
}

function getHushreaderLineCount(): number {
  const linePx = hushreaderCfg.value.fontSize * hushreaderCfg.value.lineHeight
  const reservedHeight = hushreaderCfg.value.showHushreaderMeta ? FISH_META_ROW_HEIGHT : 0
  const readableHeight = Math.max(18, hushreaderCfg.value.hushreaderHeight - 6 - reservedHeight)
  return Math.max(1, Math.floor(readableHeight / Math.max(12, linePx)))
}

function updateHushreaderLayout() {
  readerStore.setHushreaderLayout(getHushreaderLineLength(), getHushreaderLineCount())
}

function getHushreaderPayload(bounds = getHushreaderWindowBounds()) {
  // 在线书目录为空时（onlineMode + 错误提示）也允许显示阅读窗，否则「已打开阅读器」却无窗口
  const hasContent = readerStore.chapters.length > 0 || (readerStore.onlineMode && readerStore.onlineChapterError !== '')
  return {
    visible: hushreaderActivated.value && Boolean(currentBook.value) && hasContent && !isReaderHidden.value,
    title: activeBookLabel.value,
    chapter: currentChapter.value?.title ?? '',
    progress: progressLabel.value,
    readingPercent: readerStore.readingPercent,
    currentPage: readerStore.currentPage + 1,
    pageCount: readerStore.totalPages,
    lines: hushreaderLines.value,
    bounds,
    resizeLimits: getHushreaderSizeLimits(),
    settings: {
      fontSize: hushreaderCfg.value.fontSize,
      lineHeight: hushreaderCfg.value.lineHeight,
      hushreaderWidth: hushreaderCfg.value.hushreaderWidth,
      hushreaderHeight: hushreaderCfg.value.hushreaderHeight,
      hushreaderX: hushreaderCfg.value.hushreaderX,
      hushreaderY: hushreaderCfg.value.hushreaderY,
      letterSpacing: hushreaderCfg.value.letterSpacing,
      opacity: hushreaderCfg.value.opacity,
      bgOpacity: hushreaderCfg.value.bgOpacity,
      prevPageKey: hushreaderCfg.value.prevPageKey,
      nextPageKey: hushreaderCfg.value.nextPageKey,
      addBookmarkKey: hushreaderCfg.value.addBookmarkKey,
      destroyKey: hushreaderCfg.value.destroyKey,
      showHushreaderMeta: hushreaderCfg.value.showHushreaderMeta,
      progressMode: hushreaderCfg.value.progressMode,
      hideOnMouseLeave: hushreaderCfg.value.hideOnMouseLeave,
      mouseEnterDelay: hushreaderCfg.value.mouseEnterDelay,
      wheelTurnPage: hushreaderCfg.value.wheelTurnPage,
      bgColor: hushreaderCfg.value.bgColor,
      textColor: hushreaderCfg.value.textColor,
      autoFlipEnabled: hushreaderCfg.value.autoFlipEnabled,
      fontFamily: hushreaderCfg.value.fontFamily,
      windowMovable: cfg.value.function.windowMovable,
      windowSizeLocked: cfg.value.function.windowSizeLocked,
      timerEnabled: cfg.value.other.timerEnabled,
      timerRemaining: getReadingTimerRemaining()
    }
  }
}

// 更新隐阅窗口的位置/尺寸。
// 关键：每帧（拖动/缩放预览）只发 1 次窗口调用，避免多方法冗余调用。
// ztools.createBrowserWindow 返回的 Proxy<BrowserWindow> 每个方法都是一次跨进程 IPC，
// 原来连调 setContentBounds / setContentSize / setSize / setPosition 四个方法（它们互相
// 冗余，setBounds 本来就同时携带位置与尺寸），导致拖动/缩放时每帧多次 IPC 往返、严重不跟手。
// 参考摸鱼阅读：阅读窗每帧只发 1 条消息，主窗口只 setBounds 1 次。
// 窗口为无边框(frame:false)+无阴影，窗口 bounds 与内容 bounds 一致，单次 setBounds 即可。
function applyHushreaderWindowBounds(bounds: HushreaderBounds, positionOnly = false) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  hushreaderWindowAnchor = { x: bounds.x, y: bounds.y }
  const rect: HushreaderBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  if (hushreaderWindow.setBounds) {
    hushreaderWindow.setBounds(rect)
  } else if (hushreaderWindow.setContentBounds) {
    hushreaderWindow.setContentBounds(rect)
  } else {
    hushreaderWindow.setSize?.(bounds.width, bounds.height)
    hushreaderWindow.setPosition?.(bounds.x, bounds.y)
  }
  if (!positionOnly) {
    hushreaderWindow.setAlwaysOnTop?.(true)
    hushreaderWindow.setSkipTaskbar?.(true)
    hushreaderWindow.moveTop?.()
  }
}

function positionHushreaderWindow() {
  applyHushreaderWindowBounds(getHushreaderWindowBounds())
}

function pushHushreaderState(options?: { skipShow?: boolean }) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  const bounds = getHushreaderWindowBounds()
  const payload = getHushreaderPayload(bounds)
  if (payload.visible && !options?.skipShow) {
    applyHushreaderWindowBounds(bounds)
    hushreaderWindow.show?.()
  } else if (payload.visible && options?.skipShow) {
    applyHushreaderWindowBounds(bounds)
  } else {
    hushreaderWindow.hide?.()
  }
  const sync = hushreaderWindow.webContents?.executeJavaScript?.(
    `window.hushreaderSetState?.(${JSON.stringify(payload)})`
  )
  void sync?.catch((error) => {
    console.warn('[HushReader] hushreader window sync failed', error)
  })
}

let pendingNotificationCallback: (() => void) | null = null

function pushHushreaderNotification(message: string, onClose?: () => void) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) {
    onClose?.()
    return
  }
  pendingNotificationCallback = onClose ?? null
  const sync = hushreaderWindow.webContents?.executeJavaScript?.(
    `window.hushreaderShowNotification?.(${JSON.stringify(message)})`
  )
  void sync?.catch((error) => {
    console.warn('[HushReader] notification push failed', error)
    onClose?.()
  })
}

function ensureHushreaderWindow(options?: { skipShow?: boolean }) {
  if (!hushreaderActivated.value || !(window as any).ztools?.createBrowserWindow || !currentBook.value) return
  if (hushreaderWindow && !hushreaderWindow.isDestroyed?.()) {
    pushHushreaderState(options)
    return
  }
  const bounds = getHushreaderWindowBounds()
  hushreaderWindowAnchor = { x: bounds.x, y: bounds.y }
  hushreaderWindow = (window as any).ztools.createBrowserWindow(
    'hushreader.html',
    {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      title: '隐阅盒',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      skipTaskBar: true,
      showInTaskbar: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      focusable: true,
      acceptFirstMouse: true,
      alwaysOnTop: true,
      useContentSize: true,
      webPreferences: {
        devTools: false,
        zoomFactor: 1,
        nodeIntegration: false,
        contextIsolation: false
      }
    },
    () => pushHushreaderState()
  )
  pushHushreaderState()
}

function showHushreaderWindow() {
  if (!hushreaderActivated.value) return
  isReaderHidden.value = false
  ensureHushreaderWindow()
  nextTick(pushHushreaderState)
}

function hideHushreaderWindow() {
  isReaderHidden.value = true
  blurHushreaderKeyboard()
  stopReadingTimer()
}

function focusHushreaderKeyboard() {
  isHushreaderKeyboardActive.value = true
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  hushreaderWindow.setSkipTaskbar?.(true)
  hushreaderWindow.setAlwaysOnTop?.(true)
  hushreaderWindow.moveTop?.()
}

function blurHushreaderKeyboard() {
  isHushreaderKeyboardActive.value = false
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  hushreaderWindow.setSkipTaskbar?.(true)
}

function toggleHidden() {
  isReaderHidden.value = !isReaderHidden.value
  if (isReaderHidden.value) blurHushreaderKeyboard()
}

function toggleAutoPaging() {
  if (!currentBook.value) return
  isAutoPaging.value = !isAutoPaging.value
  hushreaderCfg.value.autoFlipEnabled = isAutoPaging.value
}

function toast(msg: string, type: 'info' | 'error' | 'success' = 'info') {
  toastMsg.value = msg
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMsg.value = '' }, 3000)
}

function startReadingTimer() {
  stopReadingTimer()
  if (!cfg.value.other.timerEnabled || !hushreaderActivated.value) return
  const minutes = Number(cfg.value.other.timerMinutes)
  if (isNaN(minutes) || minutes <= 0) return
  readingTimerStart = Date.now()
  const ms = minutes * 60 * 1000
  const warningMs = Math.round(ms * 0.9)
  readingTimerWarning = window.setTimeout(() => {
    const elapsed = Math.round((Date.now() - readingTimerStart) / 1000)
    const remaining = Math.round((ms - (Date.now() - readingTimerStart)) / 1000)
    const elapsedMin = Math.floor(elapsed / 60)
    const elapsedSec = elapsed % 60
    const remainingMin = Math.floor(remaining / 60)
    const remainingSec = remaining % 60
    const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分${elapsedSec}秒` : `${elapsedSec}秒`
    const remainingStr = remainingMin > 0 ? `${remainingMin}分${remainingSec}秒` : `${remainingSec}秒`
    pushHushreaderNotification(`已阅读${elapsedStr}，${remainingStr}后将自动关闭`)
  }, warningMs)
  readingTimer = window.setTimeout(() => {
    const elapsedMin = minutes
    pushHushreaderNotification(`阅读定时器已到 ${elapsedMin} 分钟，即将关闭`, () => {
      hideHushreaderWindow()
    })
    readingTimerStart = 0
  }, ms)
}

function stopReadingTimer() {
  clearTimeout(readingTimer)
  clearTimeout(readingTimerWarning)
  readingTimer = 0
  readingTimerWarning = 0
  readingTimerStart = 0
}

function getReadingTimerRemaining(): number | null {
  if (!readingTimerStart || !cfg.value.other.timerEnabled) return null
  const elapsed = Date.now() - readingTimerStart
  const total = cfg.value.other.timerMinutes * 60 * 1000
  return Math.max(0, total - elapsed)
}

function closePlugin() {
  isReaderHidden.value = true
  hushreaderActivated.value = false
  hushreaderMenuExpandedHeight = null
  hushreaderMenuExpandSnapshot = null
  stopReadingTimer()
  readerStore.setOnlineMode(false)
  readingOnlineBook.value = null
  onlineChapterLoadings.clear(); onlineChapterPromises.clear()
  try { (window as any).ztools?.outPlugin?.() } catch { }
}

function saveReadingProgress() {
  const book = bookStore.currentBook
  if (!book) return
  const now = Date.now()
  const updates: Partial<typeof book> = {
    lastChapter: readerStore.currentChapterIndex,
    progressIndex: readerStore.progressIndex,
    lastReadAt: now,
    totalChapters: readerStore.chapters.length,
    readingPercent: readerStore.readingPercent
  }
  if (!book.firstReadAt) {
    updates.firstReadAt = now
  }

  // 初始化或重置会话计时器，避免将跨会话的闲置时间计入阅读时长
  if ((window as any).__hushreaderSessionBookId !== book.id) {
    (window as any).__hushreaderSessionBookId = book.id;
    (window as any).__hushreaderSessionLastActive = now
  }

  const lastActive = (window as any).__hushreaderSessionLastActive || now
  const elapsed = now - lastActive

  if (elapsed > 0 && elapsed < 30 * 60 * 1000) {
    const totalMs = (book.readingTimeMs || 0) + elapsed
    updates.readingTimeMs = totalMs
    const totalChars = readerStore.chapters.reduce((sum, ch) => sum + ch.content.length, 0)
    const currentReadChars = Math.round(totalChars * (readerStore.readingPercent / 100))
    const prevReadChars = book.lastSaveReadChars || 0
    const deltaChars = Math.max(0, currentReadChars - prevReadChars)
    updates.lastSaveReadChars = currentReadChars
    const elapsedMinutes = elapsed / 60000
    if (elapsedMinutes > 0 && deltaChars > 0) {
      const sessionSpeed = deltaChars / elapsedMinutes
      const prevSpeed = book.readingSpeed || 0
      if (prevSpeed > 0) {
        updates.readingSpeed = Math.round(prevSpeed * 0.6 + sessionSpeed * 0.4)
      } else {
        updates.readingSpeed = Math.round(sessionSpeed)
      }
    }
  } else {
    const totalChars = readerStore.chapters.reduce((sum, ch) => sum + ch.content.length, 0)
    updates.lastSaveReadChars = Math.round(totalChars * (readerStore.readingPercent / 100))
  }

  if (readerStore.readingPercent >= 100 && !book.finishedAt) {
    updates.finishedAt = now
  }

  (window as any).__hushreaderSessionLastActive = now
  bookStore.updateBook(book.id, updates)
  // 开源阅读同步的书回写阅读进度
  if (book.format === 'online' && book.onlineKind === 'legado') {
    onlineStore.pushProgress(bookStore.currentBook)
  }
}

function getFileModifiedTime(filePath: string): number | null {
  try {
    return (window as any).services?.getFileModifiedTime?.(filePath) ?? null
  } catch {
    return null
  }
}

async function parseBookAndGetChapters(book: typeof bookStore.currentBook): Promise<any[] | null> {
  if (!book) { toast('书籍不存在', 'error'); return null }

  if (book.format === 'txt') {
    const text = (window as any).services?.readFile(book.filePath) ?? ''
    return parseTxt(text, configStore.config.other.chapterRegex || undefined)
  } else if (book.format === 'mobi') {
    const content = (window as any).services?.readFileBinary?.(book.filePath)
    if (!content) { toast('无法读取MOBI文件', 'error'); return null }
    const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
    const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
    const result = await parseMobi(file)
    if (result.error) { toast(`MOBI解析失败：${result.error}`, 'error'); return null }
    return result.chapters
  } else {
    const content = (window as any).services?.readFileBinary?.(book.filePath)
    if (!content) { toast('无法读取EPUB文件', 'error'); return null }
    const blob = new Blob([content], { type: 'application/epub+zip' })
    const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
    try {
      const { chapters } = await parseEpub(file)
      return chapters
    } catch (e: any) {
      toast(`EPUB解析失败：${e.message}`, 'error')
      return null
    }
  }
}

async function openBookAndHushreader(bookId: string) {
  bookStore.setCurrentBook(bookId)
  const book = bookStore.currentBook
  if (!book) return

  // 在线书籍：按需加载章节列表与正文
  if (book.format === 'online') {
    await openOnlineBook(book)
    return
  }
  readingOnlineBook.value = null
  readerStore.setOnlineMode(false)
  onlineChapterLoadings.clear(); onlineChapterPromises.clear()

  const startChapter = book.lastChapter ?? 0
  const startIndex = book.progressIndex ?? 0

  readerStore.isLoading = true

  try {
    let chapters = await loadChapters(bookId)
    const currentModified = getFileModifiedTime(book.filePath)
    const fileChanged = currentModified !== book.fileModifiedAt

    if (!chapters || fileChanged) {
      chapters = await parseBookAndGetChapters(book)
      if (!chapters) return
      saveChapters(bookId, chapters).catch(() => { })
    }

    readerStore.setChapters(chapters)

    if (currentModified !== book.fileModifiedAt) {
      bookStore.updateBook(bookId, { fileModifiedAt: currentModified })
    }

    updateHushreaderLayout()

    readerStore.goToProgress(startChapter, startIndex)

    hushreaderActivated.value = true
    isReaderHidden.value = false
    ensureHushreaderWindow()
    startReadingTimer()
    nextTick(() => {
      pushHushreaderState()
    })
  } catch (e: any) {
    toast(`打开失败：${e.message}`, 'error')
  } finally {
    readerStore.isLoading = false
  }
}

/** Cookie Jar 上下文：在线阅读请求自动携带/保存书源域名 Cookie（对标 Legado enabledCookieJar） */
function buildCookieCtx() {
  return {
    getCookie: (url: string) => onlineStore.jarCookie(url),
    saveCookies: (url: string, cookies: string[]) => onlineStore.saveJarCookies(url, cookies)
  }
}

/** 打开在线书籍：拉取章节列表 → 占位章节 → 加载当前章正文 */
async function openOnlineBook(book: any) {
  readerStore.isLoading = true
  try {
    const menu = await fetchChapterMenu(
      { id: book.id, bookUrl: book.bookUrl, tocUrl: book.tocUrl, onlineKind: book.onlineKind, source: book.source },
      { legado: onlineStore.legado, cookie: buildCookieCtx() }
    )
    // 净化规则：章节标题替换（对标 Legado ContentProcessor 标题规则）
    const bookOrigin = getBookOriginForReplace(book)
    const titled = menu.map((m, i) => ({
      index: i,
      title: applyTitleReplaceRules(m.title || `第${i + 1}章`, replaceStore.rules, book.title, bookOrigin),
      content: ''
    }))
    readerStore.setChapters(titled)
    readerStore.setOnlineMode(true)
    readingOnlineBook.value = book
    onlineChapterLoadings.clear(); onlineChapterPromises.clear()
    bookStore.updateBook(book.id, { totalChapters: menu.length })

    if (!menu.length) {
      // 章节列表解析不到：仍打开阅读器，正文加载失败才阻止阅读
      readerStore.onlineChapterError = '未能解析到章节列表，请检查书源规则（正文可能无法加载）'
      toast('未能解析到章节列表，已打开阅读器', 'info')
      updateHushreaderLayout()
      hushreaderActivated.value = true
      isReaderHidden.value = false
      ensureHushreaderWindow()
      startReadingTimer()
      nextTick(() => pushHushreaderState())
      return
    }

    const startChapter = Math.max(0, Math.min(book.lastChapter ?? 0, menu.length - 1))
    readerStore.goToChapter(startChapter)
    await ensureOnlineChapterContent(book, startChapter)
    readerStore.goToProgress(startChapter, Math.min(book.progressIndex ?? 0, readerStore.chapters[startChapter]?.content?.length ?? 0))

    updateHushreaderLayout()
    hushreaderActivated.value = true
    isReaderHidden.value = false
    ensureHushreaderWindow()
    startReadingTimer()
    nextTick(() => pushHushreaderState())
  } catch (e: any) {
    toast(`打开失败：${e.message}`, 'error')
    readerStore.setOnlineMode(false)
    readingOnlineBook.value = null
  } finally {
    readerStore.isLoading = false
  }
}

/** 加载在线书籍某章节正文（带去重与加载状态），成功后自动刷新阅读窗 */
async function ensureOnlineChapterContent(book: any, index: number) {
  const chapters = readerStore.chapters
  if (index < 0 || index >= chapters.length) return
  if (chapters[index]?.content) return
  const pending = onlineChapterPromises.get(index)
  if (pending) return pending
  const promise = loadOnlineChapter(book, index).finally(() => {
    onlineChapterPromises.delete(index)
  })
  onlineChapterPromises.set(index, promise)
  return promise
}

async function loadOnlineChapter(book: any, index: number) {
  onlineChapterLoadings.add(index)
  readerStore.onlineChapterLoading = true
  readerStore.onlineChapterError = ''
  try {
    const text = await fetchChapterContent(
      { id: book.id, bookUrl: book.bookUrl, tocUrl: book.tocUrl, onlineKind: book.onlineKind, source: book.source },
      index,
      { legado: onlineStore.legado, cookie: buildCookieCtx() }
    )
    // 期间可能已切换其它书籍，避免写错章节
    if (readingOnlineBook.value?.id !== book.id) return
    const cur = readerStore.chapters[index]
    if (cur) {
      // 净化规则：正文替换（对标 Legado ContentProcessor 正文规则）
      cur.content = applyContentReplaceRules(text, replaceStore.rules, book.title, getBookOriginForReplace(book))
    }
  } catch (e: any) {
    if (readingOnlineBook.value?.id !== book.id) return
    readerStore.onlineChapterError = e?.message || '章节加载失败'
  } finally {
    onlineChapterLoadings.delete(index)
    readerStore.onlineChapterLoading = false
    if (readingOnlineBook.value?.id === book.id) {
      nextTick(() => pushHushreaderState())
    }
  }
}

provide('openBookAndHushreader', openBookAndHushreader)
provide('hideHushreaderWindow', hideHushreaderWindow)

function resizeHushreaderWindow(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  const size = clampHushreaderSize(width, height)
  hushreaderCfg.value.hushreaderWidth = size.width
  hushreaderCfg.value.hushreaderHeight = size.height
  positionHushreaderWindow()
  updateHushreaderLayout()
  configStore.save()
}

function moveHushreaderWindow(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  // 配置始终存小尺寸下的坐标（撑高是临时叠加，不入配置），保证还原后底边位置一致
  const base = getMovedHushreaderWindowBounds(x, y)
  hushreaderCfg.value.hushreaderX = base.x
  hushreaderCfg.value.hushreaderY = base.y
  applyHushreaderWindowBounds(applyHushreaderMenuExpansion(base))
  configStore.save()
}

function previewHushreaderWindowSize(width: number, height: number) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.() || !Number.isFinite(width) || !Number.isFinite(height)) return
  applyHushreaderWindowBounds(applyHushreaderMenuExpansion(getAnchoredHushreaderWindowBoundsForSize(width, height)), true)
}

// 右键菜单撑高：菜单打开期间把窗口临时撑到能完整放下菜单的高度（底边不动、向上增长），
// 不写入持久化配置，菜单关闭后由 context-menu-restore 还原。
function expandHushreaderForContextMenu(requiredHeight: number) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.() || !Number.isFinite(requiredHeight)) return
  const limits = getHushreaderSizeLimits()
  const current = getHushreaderWindowBounds()
  const targetHeight = clampNumber(Math.max(current.height, requiredHeight), limits.minHeight, limits.maxHeight)
  if (targetHeight <= current.height) return
  hushreaderMenuExpandedHeight = targetHeight
  hushreaderMenuExpandSnapshot = {
    bounds: current,
    width: hushreaderCfg.value.hushreaderWidth,
    height: hushreaderCfg.value.hushreaderHeight,
    x: hushreaderCfg.value.hushreaderX,
    y: hushreaderCfg.value.hushreaderY
  }
  const grow = targetHeight - current.height
  const area = getWorkArea()
  const maxY = area.y + Math.max(0, area.height - targetHeight)
  applyHushreaderWindowBounds({ ...current, height: targetHeight, y: clampNumber(current.y - grow, area.y, maxY) })
}

// 还原撑高：若撑高期间用户拖动/缩放改过配置，按配置 x/y 直接还原（不覆盖用户操作，
// 也不走锚点——锚点已被撑高过程更新过，会带偏位置）；否则精确还原撑高前的窗口 bounds。
function restoreHushreaderAfterContextMenu() {
  const snapshot = hushreaderMenuExpandSnapshot
  hushreaderMenuExpandSnapshot = null
  hushreaderMenuExpandedHeight = null
  if (!snapshot || !hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  const cfgChanged =
    snapshot.width !== hushreaderCfg.value.hushreaderWidth ||
    snapshot.height !== hushreaderCfg.value.hushreaderHeight ||
    snapshot.x !== hushreaderCfg.value.hushreaderX ||
    snapshot.y !== hushreaderCfg.value.hushreaderY
  if (cfgChanged) {
    applyHushreaderWindowBounds(getMovedHushreaderWindowBounds(hushreaderCfg.value.hushreaderX, hushreaderCfg.value.hushreaderY))
  } else {
    applyHushreaderWindowBounds(snapshot.bounds)
  }
}

function previewHushreaderWindowPosition(x: number, y: number) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.() || !Number.isFinite(x) || !Number.isFinite(y)) return
  applyHushreaderWindowBounds(applyHushreaderMenuExpansion(getMovedHushreaderWindowBounds(x, y)), true)
}

function handleHushreaderCommand(command: HushreaderCommand) {
  if (typeof command !== 'string') {
    if (command?.type === 'resize-preview' && typeof command.width === 'number' && typeof command.height === 'number') {
      previewHushreaderWindowSize(command.width, command.height)
    }
    if (command?.type === 'resize' && typeof command.width === 'number' && typeof command.height === 'number') {
      resizeHushreaderWindow(command.width, command.height)
    }
    if (command?.type === 'move-preview' && typeof command.x === 'number' && typeof command.y === 'number') {
      previewHushreaderWindowPosition(command.x, command.y)
    }
    if (command?.type === 'move' && typeof command.x === 'number' && typeof command.y === 'number') {
      moveHushreaderWindow(command.x, command.y)
    }
    if (command?.type === 'context-menu-expand' && typeof command.height === 'number') {
      expandHushreaderForContextMenu(command.height)
    }
    if (command?.type === 'context-menu-restore') {
      restoreHushreaderAfterContextMenu()
    }
    if (command?.type === 'jump-percent' && typeof command.percent === 'number') {
      const percent = clampNumber(command.percent, 0, 100)
      const totalChars = readerStore.chapters.reduce((sum, ch) => sum + ch.content.length, 0)
      if (totalChars > 0) {
        const targetChar = Math.round((percent / 100) * totalChars)
        let accumulated = 0
        let targetChapter = 0
        for (let i = 0; i < readerStore.chapters.length; i++) {
          const chapterLen = readerStore.chapters[i].content.length
          if (accumulated + chapterLen >= targetChar) {
            targetChapter = i
            break
          }
          accumulated += chapterLen
          targetChapter = i
        }
        const charInChapter = Math.max(0, Math.min(targetChar - accumulated, readerStore.chapters[targetChapter]?.content.length ?? 0))
        readerStore.goToProgress(targetChapter, charInChapter)
        saveReadingProgress()
      }
    }
    return
  }
  if (command === 'prev') { readerStore.prevPage(); saveReadingProgress() }
  else if (command === 'next') { readerStore.nextPage(); saveReadingProgress() }
  else if (command === 'focus') focusHushreaderKeyboard()
  else if (command === 'blur') blurHushreaderKeyboard()
  else if (command === 'hide') hideHushreaderWindow()
  else if (command === 'close') closePlugin()
  else if (command === 'auto') toggleAutoPaging()
  else if (command === 'close-reader') { isReaderHidden.value = true; blurHushreaderKeyboard() }
  else if (command === 'destroy') {
    saveReadingProgress()
    hushreaderActivated.value = false
    stopReadingTimer()
    readerStore.setOnlineMode(false)
    readingOnlineBook.value = null
    onlineChapterLoadings.clear(); onlineChapterPromises.clear()
    clearOnlineCaches()
    hushreaderMenuExpandedHeight = null
    hushreaderMenuExpandSnapshot = null
    hushreaderWindow?.close?.()
    hushreaderWindow = null
  }
  else if (command === 'show-main') { (window as any).ztools?.showMainWindow?.() }
  else if (command === 'stop-auto') { isAutoPaging.value = false; hushreaderCfg.value.autoFlipEnabled = false }
  else if (command === 'start-auto') { if (currentBook.value) { isAutoPaging.value = true; hushreaderCfg.value.autoFlipEnabled = true } }
  else if (command === 'add-bookmark') {
    const book = currentBook.value
    if (book) {
      const pageText = hushreaderLines.value.join('')
      const boundaryRe = /[。！？…!?\.\」\』\）\】\」]/
      let start = 0
      const boundary = boundaryRe.exec(pageText)
      if (boundary) {
        start = boundary.index + boundary[0].length
        while (start < pageText.length && /[\s\u3000]/.test(pageText[start])) start++
      }
      if (start >= pageText.length) start = 0
      const rest = pageText.slice(start)
      const sentenceEndRe = /[。！？…!?\.]/
      let text = ''
      const endMatch = sentenceEndRe.exec(rest)
      if (endMatch) {
        text = rest.slice(0, endMatch.index + endMatch[0].length).trim()
      } else {
        text = rest.trim().slice(0, 50)
      }
      if (text.length > 50) text = text.slice(0, 50) + '...'
      const bookmark: Bookmark = {
        id: `bm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        chapterIndex: readerStore.currentChapterIndex,
        charIndex: readerStore.currentPageSlice.startIndex,
        readingPercent: readerStore.readingPercent,
        text,
        createdAt: Date.now()
      }
      const existing = book.bookmarks ?? []
      bookStore.updateBook(book.id, { bookmarks: [...existing, bookmark] })
      toast('书签已添加', 'success')
    }
  }
  else if (command === 'notification-close') { pendingNotificationCallback?.(); pendingNotificationCallback = null }
}

watch(
  () => hushreaderCfg.value.autoFlipEnabled,
  (enabled) => {
    if (enabled && currentBook.value && !isReaderHidden.value) {
      isAutoPaging.value = true
    } else {
      isAutoPaging.value = false
    }
  }
)

watch(
  () => [isAutoPaging.value, hushreaderCfg.value.autoFlipInterval, bookStore.currentBookId, isReaderHidden.value],
  () => {
    window.clearInterval(autoTimer)
    if (!isAutoPaging.value || !currentBook.value || isReaderHidden.value) return
    autoTimer = window.setInterval(() => {
      if (isAutoPageTickRunning) return
      isAutoPageTickRunning = true
      try {
        const advanced = readerStore.nextPage()
        if (advanced) saveReadingProgress()
        else {
          if (!hushreaderCfg.value.continuousFlip) {
            isAutoPaging.value = false
            hushreaderCfg.value.autoFlipEnabled = false
          }
        }
      } finally {
        isAutoPageTickRunning = false
      }
    }, Math.max(1000, hushreaderCfg.value.autoFlipInterval))
  },
  { immediate: true }
)

watch(
  () => readerStore.currentChapterIndex,
  () => {
    if (currentBook.value) {
      updateHushreaderLayout()
      saveReadingProgress()
    }
    // 在线书籍：预加载当前章与相邻章正文
    if (readingOnlineBook.value) {
      const ci = readerStore.currentChapterIndex
      ensureOnlineChapterContent(readingOnlineBook.value, ci)
      ensureOnlineChapterContent(readingOnlineBook.value, ci + 1)
      ensureOnlineChapterContent(readingOnlineBook.value, ci - 1)
    }
  }
)

watch(
  () => [hushreaderCfg.value.hushreaderHeight, hushreaderCfg.value.hushreaderWidth, hushreaderCfg.value.fontSize, hushreaderCfg.value.lineHeight, hushreaderCfg.value.letterSpacing],
  () => {
    if (currentBook.value && readerStore.chapters.length > 0) {
      updateHushreaderLayout()
    }
  }
)

watch(
  () => [
    bookStore.currentBookId,
    readerStore.currentChapterIndex,
    readerStore.progressIndex,
    readerStore.readingPercent,
    isReaderHidden.value,
    hushreaderCfg.value.fontSize,
    hushreaderCfg.value.lineHeight,
    hushreaderCfg.value.hushreaderWidth,
    hushreaderCfg.value.hushreaderHeight,
    hushreaderCfg.value.hushreaderX,
    hushreaderCfg.value.hushreaderY,
    hushreaderCfg.value.letterSpacing,
    hushreaderCfg.value.opacity,
    hushreaderCfg.value.bgOpacity,
    hushreaderCfg.value.prevPageKey,
    hushreaderCfg.value.nextPageKey,
    hushreaderCfg.value.addBookmarkKey,
    hushreaderCfg.value.destroyKey,
    hushreaderCfg.value.showHushreaderMeta,
    hushreaderCfg.value.progressMode,
    hushreaderCfg.value.hideOnMouseLeave,
    hushreaderCfg.value.mouseEnterDelay,
    hushreaderCfg.value.wheelTurnPage,
    hushreaderCfg.value.bgColor,
    hushreaderCfg.value.textColor,
    hushreaderCfg.value.autoFlipEnabled,
    hushreaderCfg.value.fontFamily,
    cfg.value.function.windowMovable,
    cfg.value.function.windowSizeLocked
  ],
  () => {
    nextTick(() => {
      if (hushreaderActivated.value && currentBook.value) {
        ensureHushreaderWindow({ skipShow: true })
      } else {
        pushHushreaderState()
      }
    })
  }
)

onMounted(async () => {
  await configStore.load()
  await bookStore.load()
  onlineStore.load()
  replaceStore.load()
    ; (window as any).ztools?.onPluginEnter?.((action: any) => {
      if (action?.code === 'hushreader-close') {
        saveReadingProgress()
        hushreaderActivated.value = false
        hushreaderMenuExpandedHeight = null
        hushreaderMenuExpandSnapshot = null
        stopReadingTimer()
        readerStore.setOnlineMode(false)
        readingOnlineBook.value = null
        onlineChapterLoadings.clear(); onlineChapterPromises.clear()
        hushreaderWindow?.close?.()
        hushreaderWindow = null
        try { (window as any).ztools?.outPlugin?.() } catch { }
        return
      }
      route.value = action.code
      enterAction.value = action
    })
    ; (window as any).ztools?.onPluginOut?.((processExit: boolean) => {
      if (processExit) {
        saveReadingProgress()
        hushreaderActivated.value = false
        readerStore.setOnlineMode(false)
        readingOnlineBook.value = null
        onlineChapterLoadings.clear(); onlineChapterPromises.clear()
        hushreaderMenuExpandedHeight = null
        hushreaderMenuExpandSnapshot = null
        hushreaderWindow?.close?.()
      }
    })
  offHushreaderCommand = (window as any).services?.onHushreaderCommand?.(handleHushreaderCommand)

  if (!route.value) route.value = 'bookshelf'
})

onBeforeUnmount(() => {
  saveReadingProgress()
  window.clearInterval(autoTimer)
  stopReadingTimer()
  offHushreaderCommand?.()
})
</script>

<template>
  <Bookshelf :enter-action="enterAction" />
  <Toast :message="toastMsg" :type="toastType" />
</template>
