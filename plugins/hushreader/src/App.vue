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

function getWorkArea() {
  const display = (window as any).ztools?.getPrimaryDisplay?.()
  return display?.workArea ?? { x: 0, y: 0, width: window.screen.availWidth, height: window.screen.availHeight }
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

function getHushreaderWindowBounds() {
  return getAnchoredHushreaderWindowBoundsForSize(hushreaderCfg.value.hushreaderWidth, hushreaderCfg.value.hushreaderHeight)
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
  return {
    visible: hushreaderActivated.value && Boolean(currentBook.value) && readerStore.chapters.length > 0 && !isReaderHidden.value,
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

function applyHushreaderWindowBounds(bounds: HushreaderBounds, positionOnly = false) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.()) return
  hushreaderWindowAnchor = { x: bounds.x, y: bounds.y }
  hushreaderWindow.setContentBounds?.(bounds)
  hushreaderWindow.setContentSize?.(bounds.width, bounds.height)
  hushreaderWindow.setSize?.(bounds.width, bounds.height)
  hushreaderWindow.setPosition?.(bounds.x, bounds.y)
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
  stopReadingTimer()
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
  const bounds = getMovedHushreaderWindowBounds(x, y)
  hushreaderCfg.value.hushreaderX = bounds.x
  hushreaderCfg.value.hushreaderY = bounds.y
  applyHushreaderWindowBounds(bounds)
  configStore.save()
}

function previewHushreaderWindowSize(width: number, height: number) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.() || !Number.isFinite(width) || !Number.isFinite(height)) return
  applyHushreaderWindowBounds(getAnchoredHushreaderWindowBoundsForSize(width, height), true)
}

function previewHushreaderWindowPosition(x: number, y: number) {
  if (!hushreaderWindow || hushreaderWindow.isDestroyed?.() || !Number.isFinite(x) || !Number.isFinite(y)) return
  applyHushreaderWindowBounds(getMovedHushreaderWindowBounds(x, y), true)
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
  else if (command === 'destroy') { saveReadingProgress(); hushreaderActivated.value = false; stopReadingTimer(); hushreaderWindow?.close?.(); hushreaderWindow = null }
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
    ; (window as any).ztools?.onPluginEnter?.((action: any) => {
      route.value = action.code
      enterAction.value = action
    })
    ; (window as any).ztools?.onPluginOut?.((processExit: boolean) => {
      if (processExit) {
        saveReadingProgress()
        hushreaderActivated.value = false
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
