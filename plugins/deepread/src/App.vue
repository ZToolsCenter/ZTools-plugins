<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  BookOpen,
  ClipboardPaste,
  Eye,
  FileText,
  FolderOpen,
  Info,
  Library,
  List,
  MoreVertical,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  X
} from '@lucide/vue'
import {
  loadOnlineChapter,
  loadOnlineBook,
  loadOnlineBookDetail,
  isSourceVerificationError,
  SourceVerificationError,
  normalizeBookSources,
  parseBookSources,
  searchSourceBooks
} from './bookSource'
import type {
  BookSourceConfig,
  SourceChapter,
  SourceRequest,
  SourceSearchResult,
  SourceVerificationHandler,
  SourceVerificationOptions
} from './bookSource'
import { decodeTextBytes } from './textDecoder'

type Chapter = {
  title: string
  index: number
  sourceChapter?: SourceChapter
}

type PageSlice = {
  text: string
  lines: string[]
  endIndex: number
}

type BookKind = 'local' | 'online'

type OnlineBookInfo = {
  sourceId: string
  sourceName: string
  bookUrl: string
  author: string
  coverUrl: string
  latestChapter: string
  currentChapterIndex: number
  chapters: SourceChapter[]
}

type Book = {
  id: string
  kind: BookKind
  title: string
  sourceName: string
  sourceKey?: string
  path?: string
  content: string
  createdAt: number
  updatedAt: number
  progressIndex: number
  size: number
  mtime?: number
  online?: OnlineBookInfo
}

type OnlineBookDetailDialog = {
  open: boolean
  loading: boolean
  error: string
  result: SourceSearchResult | null
  book: SourceSearchResult | null
  chapters: SourceChapter[]
}

type OnlineVerificationState = {
  sourceId: string
  sourceName: string
  url: string
  mode: SourceVerificationOptions['mode']
  opened: boolean
  waiting: boolean
  message: string
}

type OnlineVerificationItem = {
  sourceId: string
  sourceName: string
  url: string
  mode: SourceVerificationOptions['mode']
  request?: SourceRequest
}

type OnlineSearchFailureItem = {
  sourceId: string
  sourceName: string
  message: string
}

type OnlineCaptchaDialog = {
  open: boolean
  loading: boolean
  error: string
  sourceName: string
  imageUrl: string
  code: string
  request: SourceRequest | null
}

type FishSkin = 'statusbar' | 'code' | 'terminal'
type FishSkinBackgrounds = Record<FishSkin, string>

type ReaderSettings = {
  theme: 'work' | 'paper' | 'night' | 'transparent'
  fishSkin: FishSkin
  fishBackgrounds: FishSkinBackgrounds
  fontSize: number
  lineHeight: number
  fishWidth: number
  fishHeight: number
  fishX: number | null
  fishY: number | null
  letterSpacing: number
  opacity: number
  autoSeconds: number
  prevPageKey: string
  nextPageKey: string
  stealth: boolean
  showFishPrefix: boolean
  showFishMeta: boolean
  hideOnMouseLeave: boolean
  wheelTurnPage: boolean
}

type Panel = 'library' | 'online' | 'sources' | 'settings'
type PageKeyAction = 'prev' | 'next'

type FishCommand = string | { type?: string; width?: number; height?: number; x?: number; y?: number }
type FishBounds = { x: number; y: number; width: number; height: number }
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
  setContentBounds?: (bounds: FishBounds) => void
  setPosition?: (x: number, y: number) => void
  setAlwaysOnTop?: (flag: boolean) => void
  moveTop?: () => void
  webContents?: {
    executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  }
}

const LIBRARY_KEY = 'deepread.library.v1'
const BOOK_SOURCES_KEY = 'deepread.bookSources.v1'
const SETTINGS_KEY = 'deepread.settings.v1'
const LAST_BOOK_KEY = 'deepread.lastBookId.v1'
const DISCLAIMER_ACCEPTED_KEY = 'deepread.disclaimerAccepted.v1'
const AUTO_HIDE_MIGRATION_KEY = 'deepread.autoHideDefaulted.v1'
const STEALTH_DEFAULT_MIGRATION_KEY = 'deepread.stealthDefaulted.v1'
const FISH_MIN_WIDTH = 280
const FISH_MAX_WIDTH = 1180
const FISH_MIN_HEIGHT = 22
const FISH_MAX_HEIGHT = 160
const FISH_META_ROW_HEIGHT = 18
const THEMES: ReaderSettings['theme'][] = ['work', 'paper', 'night', 'transparent']
const FISH_SKINS: FishSkin[] = ['code', 'statusbar', 'terminal']
const DEFAULT_FISH_BACKGROUNDS: FishSkinBackgrounds = {
  statusbar: '#f4f5f5',
  code: '#1e1f22',
  terminal: '#0c1011'
}

const defaultSettings: ReaderSettings = {
  theme: 'transparent',
  fishSkin: 'code',
  fishBackgrounds: { ...DEFAULT_FISH_BACKGROUNDS },
  fontSize: 13,
  lineHeight: 1.35,
  fishWidth: 700,
  fishHeight: 100,
  fishX: null,
  fishY: null,
  letterSpacing: 0,
  opacity: 82,
  autoSeconds: 12,
  prevPageKey: 'ArrowLeft',
  nextPageKey: 'ArrowRight',
  stealth: false,
  showFishPrefix: false,
  showFishMeta: false,
  hideOnMouseLeave: true,
  wheelTurnPage: true
}

const books = ref<Book[]>([])
const activeBookId = ref('')
const activePanel = ref<Panel>('library')
const searchText = ref('')
const searchCursor = ref(0)
const isBookSearchDialogOpen = ref(false)
const isChapterDialogOpen = ref(false)
const isReaderHidden = ref(false)
const isAutoPaging = ref(false)
const isDragging = ref(false)
const isFishKeyboardActive = ref(false)
const keyBindingCapture = ref<PageKeyAction | null>(null)
const importError = ref('')
const bookSources = ref<BookSourceConfig[]>([])
const sourceEditorText = ref('')
const sourceUrlText = ref('')
const sourceMessage = ref('')
const isSourceJsonDialogOpen = ref(false)
const isDisclaimerDialogOpen = ref(false)
const onlineKeyword = ref('')
const onlineSearchResults = ref<SourceSearchResult[]>([])
const onlineVerificationItems = ref<OnlineVerificationItem[]>([])
const onlineSearchFailures = ref<OnlineSearchFailureItem[]>([])
const onlineSearchError = ref('')
const isClipboardImporting = ref(false)
const isSourceUrlImporting = ref(false)
const isOnlineSearching = ref(false)
const onlineImportingKey = ref('')
const onlineImportStatus = ref('')
const loadingChapterKey = ref('')
const chapterLoadMessage = ref('')
const onlineVerification = reactive<OnlineVerificationState>({
  sourceId: '',
  sourceName: '',
  url: '',
  mode: 'browser',
  opened: false,
  waiting: false,
  message: ''
})
const onlineCaptchaDialog = reactive<OnlineCaptchaDialog>({
  open: false,
  loading: false,
  error: '',
  sourceName: '',
  imageUrl: '',
  code: '',
  request: null
})
const onlineDetailDialog = reactive<OnlineBookDetailDialog>({
  open: false,
  loading: false,
  error: '',
  result: null,
  book: null,
  chapters: []
})
const contextMenu = reactive({
  show: false,
  bookId: '',
  x: 0,
  y: 0
})
const settings = reactive<ReaderSettings>({
  ...defaultSettings,
  fishBackgrounds: { ...defaultSettings.fishBackgrounds }
})
const fileInputRef = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const captchaInputRef = ref<HTMLInputElement | null>(null)
const sourceJsonTextareaRef = ref<HTMLTextAreaElement | null>(null)
const disclaimerAcceptButtonRef = ref<HTMLButtonElement | null>(null)

const activeOnlineVerificationItem = computed(() =>
  onlineVerificationItems.value.find((item) => item.sourceId === onlineVerification.sourceId) || null
)

let autoTimer = 0
let isAutoPageTickRunning = false
let onlineDetailRequestId = 0
let captchaResolve: ((code: string) => void) | null = null
let captchaReject: ((error: Error) => void) | null = null
let captchaPromptQueue: Promise<unknown> = Promise.resolve()
let verificationResolve: ((body: string) => void) | null = null
let verificationReject: ((error: Error) => void) | null = null
let verificationRequest: SourceRequest | null = null
let verificationOptions: SourceVerificationOptions | null = null
let wheelLock = false
let dragDepth = 0
let fishWindowAnchor: { x: number; y: number } | null = null
let fishWindow: AppBrowserWindow | null = null
let onlineVerificationWindow: AppBrowserWindow | null = null
let offFishCommand: (() => void) | undefined

const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const zStorage = window.ztools?.dbStorage
      const stored = zStorage?.getItem?.(key)
      if (stored !== undefined && stored !== null && stored !== '') {
        if (typeof stored !== 'string') return stored as T

        try {
          return JSON.parse(stored) as T
        } catch (error) {
          return stored as T
        }
      }

      const raw = window.localStorage.getItem(key)
      if (raw === null || raw === '') return fallback
      return JSON.parse(raw) as T
    } catch (error) {
      return fallback
    }
  },

  set(key: string, value: unknown) {
    try {
      const zStorage = window.ztools?.dbStorage
      if (zStorage?.setItem) {
        zStorage.setItem(key, value)
      } else {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    } catch (error) {
      console.warn('[DeepRead] save failed', error)
    }
  }
}

const fishLineLength = computed(() => {
  const sideControlsWidth = 44
  const contentPadding = settings.fishSkin === 'statusbar' ? 16 : 20
  const prefixWidth = settings.showFishPrefix ? (settings.fishSkin === 'statusbar' ? 42 : 24) : 0
  const readableWidth = Math.max(24, settings.fishWidth - sideControlsWidth - contentPadding - prefixWidth)
  const cjkCharacterWidth = Math.max(1, settings.fontSize + settings.letterSpacing)

  return Math.max(1, Math.floor(readableWidth / cjkCharacterWidth))
})

const fishLineCount = computed(() => {
  const linePx = settings.fontSize * settings.lineHeight
  const reservedHeight = settings.showFishMeta ? FISH_META_ROW_HEIGHT : 0
  const readableHeight = Math.max(18, settings.fishHeight - 6 - reservedHeight)

  return Math.max(1, Math.floor(readableHeight / Math.max(12, linePx)))
})

const activeBook = computed(() => books.value.find((book) => book.id === activeBookId.value) ?? null)

function getEmptyPageSlice(): PageSlice {
  return { text: '', lines: [], endIndex: 0 }
}

function getVisualPage(content: string, startIndex: number, lineLength: number, lineCount: number): PageSlice {
  const safeLineLength = Math.max(1, Math.round(lineLength))
  const safeLineCount = Math.max(1, Math.round(lineCount))
  const start = clampNumber(startIndex, 0, content.length)
  const lines: string[] = []
  let cursor = start

  while (cursor < content.length && lines.length < safeLineCount) {
    let line = ''
    let columns = 0

    while (cursor < content.length && columns < safeLineLength) {
      const char = content[cursor]
      if (char === '\n') {
        cursor += 1
        break
      }

      line += char
      cursor += 1
      columns += 1
    }

    if (columns >= safeLineLength && content[cursor] === '\n') {
      cursor += 1
    }

    lines.push(line)
  }

  return {
    text: content.slice(start, cursor),
    lines,
    endIndex: cursor
  }
}

function buildPageStarts(content: string, lineLength: number, lineCount: number) {
  const safeLineLength = Math.max(1, Math.round(lineLength))
  const safeLineCount = Math.max(1, Math.round(lineCount))
  const starts = [0]
  let cursor = 0

  while (cursor < content.length) {
    const startCursor = cursor
    let lines = 0

    // This path runs for the whole book during re-pagination, so keep it allocation-free.
    while (cursor < content.length && lines < safeLineCount) {
      let columns = 0

      while (cursor < content.length && columns < safeLineLength) {
        if (content[cursor] === '\n') {
          cursor += 1
          break
        }

        cursor += 1
        columns += 1
      }

      if (columns >= safeLineLength && content[cursor] === '\n') {
        cursor += 1
      }

      lines += 1
    }

    if (cursor <= startCursor) break
    if (cursor < content.length) starts.push(cursor)
  }

  return starts
}

function getMaxVisualPageStart(content: string, lineLength: number, lineCount: number) {
  return buildPageStarts(content, lineLength, lineCount).at(-1) ?? 0
}

function getPageIndexForStart(index: number, starts: number[]) {
  let low = 0
  let high = Math.max(0, starts.length - 1)
  let result = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] <= index) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

function getPreviousPageStart(index: number, starts: number[]) {
  const pageIndex = getPageIndexForStart(index, starts)
  if (starts[pageIndex] === index) return starts[Math.max(0, pageIndex - 1)] ?? 0
  return starts[pageIndex] ?? 0
}

function getProgressPercent(progressIndex: number, contentLength: number, maxPageStart: number) {
  if (contentLength <= 0) return 0
  if (maxPageStart <= 0) return 100

  const safeIndex = clampNumber(progressIndex, 0, maxPageStart)
  return Math.round((safeIndex / maxPageStart) * 1000) / 10
}

function getApproxMaxPageStart(contentLength: number) {
  return Math.max(0, contentLength - fishLineLength.value * fishLineCount.value)
}

const activePageStarts = computed(() => {
  if (!activeBook.value) return [0]
  return buildPageStarts(activeBook.value.content, fishLineLength.value, fishLineCount.value)
})

const activeMaxPageStart = computed(() => activePageStarts.value.at(-1) ?? 0)

const pageCount = computed(() => {
  if (!activeBook.value) return 0
  return activePageStarts.value.length
})

const currentIndex = computed(() => {
  if (!activeBook.value) return 0
  return clampNumber(activeBook.value.progressIndex, 0, activeMaxPageStart.value)
})

const currentPage = computed(() => {
  if (!activeBook.value) return 0
  return getPageIndexForStart(currentIndex.value, activePageStarts.value)
})

const currentPageSlice = computed(() => {
  if (!activeBook.value) return getEmptyPageSlice()
  return getVisualPage(activeBook.value.content, currentIndex.value, fishLineLength.value, fishLineCount.value)
})

const currentText = computed(() => currentPageSlice.value.text)

const chapters = computed<Chapter[]>(() => {
  const book = activeBook.value
  if (!book) return []

  if (book.kind === 'online' && book.online?.chapters.length) {
    return book.online.chapters.map((chapter) => ({
      title: chapter.title,
      index: chapter.index,
      sourceChapter: chapter
    }))
  }

  const found: Chapter[] = []
  const chapterPattern =
    /(^|\n)\s*((第[零一二三四五六七八九十百千万\d]{1,8}[章章节回卷集部篇幕][^\n]{0,36})|(楔子|序章|引子|前言|尾声|番外[^\n]{0,28}))\s*(?=\n|$)/g
  let match: RegExpExecArray | null

  while ((match = chapterPattern.exec(book.content)) !== null) {
    const title = (match[2] || '').trim()
    if (title) {
      found.push({ title, index: match.index + (match[1] ? 1 : 0) })
    }
  }

  if (!found.length) {
    return [{ title: book.title, index: 0 }]
  }

  return found
})

const currentChapter = computed(() => {
  const book = activeBook.value
  if (!book) return null
  if (book.kind === 'online' && book.online) {
    return chapters.value.find((chapter) => chapter.index === book.online?.currentChapterIndex) ?? chapters.value[0]
  }

  const index = currentIndex.value
  return [...chapters.value].reverse().find((chapter) => chapter.index <= index) ?? chapters.value[0]
})

const searchMatches = computed(() => {
  const book = activeBook.value
  const term = searchText.value.trim()
  if (!book || term.length < 1) return []

  const matches: number[] = []
  const lowerContent = book.content.toLocaleLowerCase()
  const lowerTerm = term.toLocaleLowerCase()
  let cursor = 0

  while (matches.length < 80) {
    const index = lowerContent.indexOf(lowerTerm, cursor)
    if (index === -1) break
    matches.push(index)
    cursor = index + Math.max(1, lowerTerm.length)
  }

  return matches
})

const progressLabel = computed(() => {
  if (!activeBook.value) return '0%'
  return `${getProgressPercent(currentIndex.value, activeBook.value.content.length, activeMaxPageStart.value)}%`
})

function getBookProgressPercent(book: Book) {
  const maxPageStart = book.id === activeBookId.value ? activeMaxPageStart.value : getApproxMaxPageStart(book.content.length)
  return getProgressPercent(book.progressIndex, book.content.length, maxPageStart)
}

function sortBooks(items: Book[]) {
  return [...items].sort((a, b) => {
    if (a.id === activeBookId.value) return -1
    if (b.id === activeBookId.value) return 1
    return b.updatedAt - a.updatedAt
  })
}

const sortedBooks = computed(() =>
  sortBooks(books.value)
)

const sortedLocalBooks = computed(() => sortBooks(books.value.filter((book) => book.kind === 'local')))

const sortedOnlineBooks = computed(() => sortBooks(books.value.filter((book) => book.kind === 'online')))

const bookSections = computed(() =>
  [
    { key: 'local', title: '本地书籍', books: sortedLocalBooks.value },
    { key: 'online', title: '在线书籍', books: sortedOnlineBooks.value }
  ].filter((section) => section.books.length)
)

const enabledBookSources = computed(() => bookSources.value.filter((source) => source.enabled))

const onlineDetailBook = computed(() => onlineDetailDialog.book ?? onlineDetailDialog.result)

const onlineDetailChapterPreview = computed(() => onlineDetailDialog.chapters.slice(0, 40))

const shellTitle = computed(() => (settings.stealth ? '项目资料审阅' : 'DeepRead 深读'))

const shellSubtitle = computed(() => {
  if (!activeBook.value) return 'Library'
  return settings.stealth ? currentChapter.value?.title ?? 'Document' : activeBook.value.title
})

const readerStyle = computed(() => ({
  '--reader-font-size': `${settings.fontSize}px`,
  '--reader-line-height': String(settings.lineHeight),
  '--reader-opacity': `${settings.opacity / 100}`,
  '--fish-width': `${settings.fishWidth}px`,
  '--fish-height': `${settings.fishHeight}px`,
  '--fish-letter-spacing': `${settings.letterSpacing}px`
}))

const activeBookLabel = computed(() => activeBook.value?.title ?? '未选择书籍')

const fishLines = computed(() => {
  if (currentPageSlice.value.lines.length) {
    return currentPageSlice.value.lines
  }

  return ['导入一本书后，DeepRead 会在这里显示摸鱼阅读文本。']
})

function persistLibrary() {
  storage.set(LIBRARY_KEY, books.value)
}

function persistBookSources() {
  storage.set(BOOK_SOURCES_KEY, bookSources.value)
}

function persistSettings() {
  storage.set(SETTINGS_KEY, settings)
}

function loadState() {
  Object.assign(settings, normalizeSettings(storage.get<Partial<ReaderSettings>>(SETTINGS_KEY, {})))
  books.value = normalizeBooks(storage.get<unknown>(LIBRARY_KEY, []))
  bookSources.value = normalizeBookSources(storage.get<unknown>(BOOK_SOURCES_KEY, []))
  isDisclaimerDialogOpen.value = !storage.get<boolean>(DISCLAIMER_ACCEPTED_KEY, false)
  if (isDisclaimerDialogOpen.value) nextTick(() => disclaimerAcceptButtonRef.value?.focus())
  syncSourceEditorText()
  persistLibrary()
  persistBookSources()
  if (!storage.get<boolean>(AUTO_HIDE_MIGRATION_KEY, false)) {
    settings.hideOnMouseLeave = true
    storage.set(AUTO_HIDE_MIGRATION_KEY, true)
    persistSettings()
  }
  if (!storage.get<boolean>(STEALTH_DEFAULT_MIGRATION_KEY, false)) {
    settings.stealth = false
    storage.set(STEALTH_DEFAULT_MIGRATION_KEY, true)
    persistSettings()
  }
  const lastBookId = storage.get<string>(LAST_BOOK_KEY, '')
  activeBookId.value = books.value.some((book) => book.id === lastBookId) ? lastBookId : books.value[0]?.id || ''
}

function acceptDisclaimer() {
  storage.set(DISCLAIMER_ACCEPTED_KEY, true)
  isDisclaimerDialogOpen.value = false
}

function notify(message: string) {
  try {
    window.ztools?.showNotification?.(message, 'DeepRead 深读')
  } catch (error) {
    console.info(message)
  }
}

function normalizeTitle(name: string) {
  return name.replace(/\.(txt|md)$/i, '').replace(/[_-]+/g, ' ').trim() || '未命名书籍'
}

function getBookColorClass(title: string) {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % 8
  return `book-color-${index}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTheme(value: unknown): value is ReaderSettings['theme'] {
  return typeof value === 'string' && THEMES.includes(value as ReaderSettings['theme'])
}

function isFishSkin(value: unknown): value is FishSkin {
  return typeof value === 'string' && FISH_SKINS.includes(value as FishSkin)
}

function toFiniteNumber(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function normalizeKeyboardKey(key: string) {
  if (key === ' ') return 'Space'

  const trimmed = key.trim()
  const lower = trimmed.toLowerCase()
  const aliases: Record<string, string> = {
    esc: 'Escape',
    return: 'Enter',
    space: 'Space',
    spacebar: 'Space',
    up: 'ArrowUp',
    right: 'ArrowRight',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    arrowup: 'ArrowUp',
    arrowright: 'ArrowRight',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    pageup: 'PageUp',
    pagedown: 'PageDown'
  }

  if (!trimmed) return ''
  if (trimmed === '+') return 'Plus'
  if (trimmed === '-') return 'Minus'
  if (trimmed === '=') return 'Equal'
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase()
  if (trimmed.length === 1) return trimmed.toUpperCase()
  return aliases[lower] ?? trimmed
}

function normalizeKeyBinding(value: unknown, fallback: string) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean)
  const key = normalizeKeyboardKey(parts.at(-1) ?? '')
  const modifiers = new Set<string>()

  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'control' || lower === 'ctrl') modifiers.add('Ctrl')
    else if (lower === 'option' || lower === 'alt') modifiers.add('Alt')
    else if (lower === 'shift') modifiers.add('Shift')
    else if (lower === 'command' || lower === 'cmd' || lower === 'meta') modifiers.add('Meta')
  }

  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(key)) return fallback
  return [...modifiers, key].join('+')
}

function getKeyboardEventBinding(event: KeyboardEvent) {
  if (event.isComposing) return ''

  const key = normalizeKeyboardKey(event.key)
  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(key)) return ''

  return [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
    key
  ]
    .filter(Boolean)
    .join('+')
}

function getKeyBindingLabel(binding: string) {
  const labels: Record<string, string> = {
    ArrowLeft: '<',
    ArrowRight: '>',
    ArrowUp: '^',
    ArrowDown: 'v',
    Escape: 'Esc',
    Space: 'Space',
    Plus: '+',
    Minus: '-',
    Equal: '='
  }

  return normalizeKeyBinding(binding, defaultSettings.nextPageKey)
    .split('+')
    .map((part) => labels[part] ?? part)
    .join(' + ')
}

function isKeyboardShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function hasCommandModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
}

function clampFloat(value: unknown, min: number, max: number, fallback: number, precision = 2) {
  const multiplier = 10 ** precision
  const safeValue = Math.min(max, Math.max(min, toFiniteNumber(value, fallback)))
  return Math.round(safeValue * multiplier) / multiplier
}

function normalizeHexColor(value: unknown, fallback: string) {
  const color = typeof value === 'string' ? value.trim() : ''
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }

  return fallback
}

function normalizeFishBackgrounds(input: unknown): FishSkinBackgrounds {
  const stored = isRecord(input) ? input : {}

  return {
    statusbar: normalizeHexColor(stored.statusbar, DEFAULT_FISH_BACKGROUNDS.statusbar),
    code: normalizeHexColor(stored.code, DEFAULT_FISH_BACKGROUNDS.code),
    terminal: normalizeHexColor(stored.terminal, DEFAULT_FISH_BACKGROUNDS.terminal)
  }
}

function normalizeSettings(input: unknown): ReaderSettings {
  const stored = isRecord(input) ? input : {}
  const storedFishX = toFiniteNumber(stored.fishX, Number.NaN)
  const storedFishY = toFiniteNumber(stored.fishY, Number.NaN)
  const prevPageKey = normalizeKeyBinding(stored.prevPageKey, defaultSettings.prevPageKey)
  const normalizedNextPageKey = normalizeKeyBinding(stored.nextPageKey, defaultSettings.nextPageKey)
  const nextPageKey =
    normalizedNextPageKey === prevPageKey
      ? prevPageKey === defaultSettings.nextPageKey
        ? defaultSettings.prevPageKey
        : defaultSettings.nextPageKey
      : normalizedNextPageKey

  return {
    theme: isTheme(stored.theme) ? stored.theme : defaultSettings.theme,
    fishSkin: isFishSkin(stored.fishSkin) ? stored.fishSkin : defaultSettings.fishSkin,
    fishBackgrounds: normalizeFishBackgrounds(stored.fishBackgrounds),
    fontSize: clampNumber(toFiniteNumber(stored.fontSize, defaultSettings.fontSize), 10, 20),
    lineHeight: clampFloat(stored.lineHeight, 1.05, 1.8, defaultSettings.lineHeight),
    fishWidth: clampNumber(toFiniteNumber(stored.fishWidth, defaultSettings.fishWidth), FISH_MIN_WIDTH, FISH_MAX_WIDTH),
    fishHeight: clampNumber(toFiniteNumber(stored.fishHeight, defaultSettings.fishHeight), FISH_MIN_HEIGHT, FISH_MAX_HEIGHT),
    fishX: Number.isFinite(storedFishX) ? storedFishX : defaultSettings.fishX,
    fishY: Number.isFinite(storedFishY) ? storedFishY : defaultSettings.fishY,
    letterSpacing: clampFloat(stored.letterSpacing, 0, 3, defaultSettings.letterSpacing, 1),
    opacity: clampNumber(toFiniteNumber(stored.opacity, defaultSettings.opacity), 0, 100),
    autoSeconds: clampNumber(toFiniteNumber(stored.autoSeconds, defaultSettings.autoSeconds), 3, 60),
    prevPageKey,
    nextPageKey,
    stealth: toBoolean(stored.stealth, defaultSettings.stealth),
    showFishPrefix: toBoolean(stored.showFishPrefix, defaultSettings.showFishPrefix),
    showFishMeta: toBoolean(stored.showFishMeta, defaultSettings.showFishMeta),
    hideOnMouseLeave: toBoolean(stored.hideOnMouseLeave, defaultSettings.hideOnMouseLeave),
    wheelTurnPage: toBoolean(stored.wheelTurnPage, defaultSettings.wheelTurnPage)
  }
}

function normalizeBooks(input: unknown) {
  if (!Array.isArray(input)) return []

  const seenIds = new Set<string>()
  const normalized: Book[] = []

  for (const item of input) {
    const book = normalizeBook(item)
    if (!book || seenIds.has(book.id)) continue

    seenIds.add(book.id)
    normalized.push(book)
  }

  return normalized
}

function normalizeBook(input: unknown): Book | null {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id.trim() || typeof input.content !== 'string') {
    return null
  }

  const kind: BookKind = input.kind === 'online' ? 'online' : 'local'
  const sourceName = typeof input.sourceName === 'string' && input.sourceName.trim() ? input.sourceName.trim() : '未命名书籍'
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : normalizeTitle(sourceName)
  const createdAt = toFiniteNumber(input.createdAt, Date.now())
  const updatedAt = toFiniteNumber(input.updatedAt, createdAt)
  const size = Math.max(0, toFiniteNumber(input.size, input.content.length))
  const mtime = toFiniteNumber(input.mtime, Number.NaN)
  const online = normalizeOnlineBookInfo(input.online)

  return {
    id: input.id.trim(),
    kind,
    title,
    sourceName,
    sourceKey: typeof input.sourceKey === 'string' && input.sourceKey.trim() ? input.sourceKey : undefined,
    path: typeof input.path === 'string' && input.path.trim() ? input.path : undefined,
    content: input.content,
    createdAt,
    updatedAt,
    progressIndex: clampNumber(
      toFiniteNumber(input.progressIndex, 0),
      0,
      getApproxMaxPageStart(input.content.length)
    ),
    size,
    mtime: Number.isFinite(mtime) ? mtime : undefined,
    online: kind === 'online' ? online : undefined
  }
}

function normalizeOnlineBookInfo(input: unknown): OnlineBookInfo | undefined {
  if (!isRecord(input)) return undefined

  const sourceId = typeof input.sourceId === 'string' ? input.sourceId : ''
  const sourceName = typeof input.sourceName === 'string' ? input.sourceName : ''
  const bookUrl = typeof input.bookUrl === 'string' ? input.bookUrl : ''
  const chapters = Array.isArray(input.chapters)
    ? input.chapters
        .map((chapter, index) => {
          if (!isRecord(chapter)) return null
          const title = typeof chapter.title === 'string' && chapter.title.trim() ? chapter.title.trim() : `第 ${index + 1} 章`
          const url = typeof chapter.url === 'string' ? chapter.url : ''
          return {
            title,
            url,
            index
          }
        })
        .filter((chapter): chapter is SourceChapter => Boolean(chapter))
    : []
  const requestedChapterIndex = clampNumber(
    toFiniteNumber(input.currentChapterIndex, chapters[0]?.index ?? 0),
    0,
    Math.max(0, chapters.length - 1)
  )
  const currentChapterIndex = chapters.some((chapter) => chapter.index === requestedChapterIndex)
    ? requestedChapterIndex
    : chapters[0]?.index ?? 0

  if (!bookUrl && !chapters.length) return undefined

  return {
    sourceId,
    sourceName,
    bookUrl,
    author: typeof input.author === 'string' ? input.author : '',
    coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl : '',
    latestChapter: typeof input.latestChapter === 'string' ? input.latestChapter : '',
    currentChapterIndex,
    chapters
  }
}

function createBook(input: { name: string; content: string; path?: string; size?: number; mtime?: number }): Book {
  const now = Date.now()
  const stable = input.path ?? `${input.name}:${input.content.length}:${now}`

  return {
    id: `book:${btoa(unescape(encodeURIComponent(stable))).slice(0, 28)}:${now.toString(36)}`,
    kind: 'local',
    title: normalizeTitle(input.name),
    sourceName: input.name,
    path: input.path,
    content: tidyContent(input.content),
    createdAt: now,
    updatedAt: now,
    progressIndex: 0,
    size: input.size ?? input.content.length,
    mtime: input.mtime
  }
}

function createOnlineBook(result: SourceSearchResult, content: string, chapters: SourceChapter[]): Book {
  const now = Date.now()
  const stable = `${result.sourceId}:${result.bookUrl}`

  return {
    id: `online:${btoa(unescape(encodeURIComponent(stable))).slice(0, 34)}`,
    kind: 'online',
    title: normalizeTitle(result.title),
    sourceName: result.sourceName,
    sourceKey: stable,
    content: tidyContent(content),
    createdAt: now,
    updatedAt: now,
    progressIndex: 0,
    size: content.length,
    online: {
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      bookUrl: result.bookUrl,
      author: result.author,
      coverUrl: result.coverUrl,
      latestChapter: result.latestChapter,
      currentChapterIndex: chapters[0]?.index ?? 0,
      chapters
    }
  }
}

function tidyContent(content: string) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function upsertBook(book: Book, options: { resetProgress?: boolean } = {}) {
  const existingIndex = books.value.findIndex(
    (item) =>
      (item.path && book.path && item.path === book.path) ||
      (item.sourceKey && book.sourceKey && item.sourceKey === book.sourceKey)
  )
  if (existingIndex >= 0) {
    const existing = books.value[existingIndex]
    books.value[existingIndex] = {
      ...book,
      id: existing.id,
      createdAt: existing.createdAt,
      progressIndex: options.resetProgress ? 0 : Math.min(existing.progressIndex, getApproxMaxPageStart(book.content.length))
    }
  } else {
    books.value.unshift(book)
  }

  activeBookId.value = existingIndex >= 0 ? books.value[existingIndex].id : book.id
  activePanel.value = 'library'
  isReaderHidden.value = false
  persistLibrary()
  storage.set(LAST_BOOK_KEY, activeBookId.value)
}

function importFromZToolsPath(filePath: string) {
  importError.value = ''

  try {
    const file = window.services?.readTextFile(filePath)
    if (!file) throw new Error('ZTools preload 未就绪')
    upsertBook(createBook(file))
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '读取文件失败'
  }
}

function importBrowserFile(file: File) {
  importError.value = ''
  const reader = new FileReader()

  reader.onload = () => {
    if (!(reader.result instanceof ArrayBuffer)) {
      importError.value = '读取文件失败'
      return
    }

    const decoded = decodeTextBytes(reader.result)

    upsertBook(
      createBook({
        name: file.name,
        content: decoded.content,
        size: file.size,
        mtime: file.lastModified
      })
    )
  }

  reader.onerror = () => {
    importError.value = '读取文件失败'
  }

  reader.readAsArrayBuffer(file)
}

function openImportDialog() {
  importError.value = ''

  if (window.ztools?.showOpenDialog) {
    const picker = window.ztools.showOpenDialog({
      title: '选择小说文件',
      buttonLabel: '导入',
      filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
      properties: ['openFile']
    })

    if (picker?.[0]) importFromZToolsPath(picker[0])
    return
  }

  fileInputRef.value?.click()
}

function handleBrowserFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) importBrowserFile(file)
  input.value = ''
}

function syncSourceEditorText() {
  sourceEditorText.value = bookSources.value.length
    ? JSON.stringify(bookSources.value.map((source) => source.raw || source), null, 2)
    : ''
}

function mergeBookSources(existing: BookSourceConfig[], incoming: BookSourceConfig[]) {
  const merged = [...existing]
  const indexById = new Map(merged.map((source, index) => [source.id, index]))
  let added = 0
  let updated = 0

  for (const source of incoming) {
    const currentIndex = indexById.get(source.id)
    if (currentIndex === undefined) {
      indexById.set(source.id, merged.length)
      merged.push(source)
      added += 1
      continue
    }

    merged[currentIndex] = {
      ...source,
      enabled: merged[currentIndex].enabled
    }
    updated += 1
  }

  return { sources: merged, added, updated }
}

function applyBookSources(incoming: BookSourceConfig[]) {
  const merged = mergeBookSources(bookSources.value, incoming)
  bookSources.value = merged.sources
  persistBookSources()
  syncSourceEditorText()
  return merged
}

function importBookSourcesFromText(text: string, actionLabel: string) {
  const parsed = parseBookSources(text)
  const merged = applyBookSources(parsed)
  sourceMessage.value = `${actionLabel} ${bookSources.value.length} 个书源（新增 ${merged.added}，更新 ${merged.updated}）`
  return merged
}

function openSourceJsonImportDialog() {
  sourceMessage.value = ''
  syncSourceEditorText()
  isSourceJsonDialogOpen.value = true
  nextTick(() => sourceJsonTextareaRef.value?.focus())
}

function closeSourceJsonImportDialog() {
  isSourceJsonDialogOpen.value = false
}

function saveSourceEditor() {
  sourceMessage.value = ''
  onlineSearchError.value = ''

  try {
    importBookSourcesFromText(sourceEditorText.value, '已通过 JSON 导入')
    isSourceJsonDialogOpen.value = false
  } catch (error) {
    sourceMessage.value = error instanceof Error ? error.message : '书源 JSON 导入失败'
  }
}

function getHttpSourceUrl(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return ''

  try {
    const parsedUrl = new URL(trimmed)
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : ''
  } catch {
    return ''
  }
}

async function readClipboardText() {
  try {
    const serviceText = await window.services?.readClipboardText?.()
    if (typeof serviceText === 'string') return serviceText
  } catch {
    // Fall back to the browser clipboard API below.
  }
  if (!navigator.clipboard?.readText) {
    throw new Error('当前环境无法读取剪切板，请使用 JSON 导入手动粘贴')
  }
  return (await navigator.clipboard.readText()) || ''
}

async function importSourceFromClipboard() {
  if (isClipboardImporting.value) return
  sourceMessage.value = ''
  onlineSearchError.value = ''

  isClipboardImporting.value = true
  try {
    const text = (await readClipboardText()).trim()
    if (!text) {
      sourceMessage.value = '剪切板为空'
      return
    }

    const sourceUrl = getHttpSourceUrl(text)
    if (sourceUrl) {
      sourceUrlText.value = sourceUrl
      await importSourceUrl()
      return
    }

    importBookSourcesFromText(text, '已通过剪切板导入')
  } catch (error) {
    sourceMessage.value = error instanceof Error ? error.message : '剪切板导入失败'
  } finally {
    isClipboardImporting.value = false
  }
}

async function importSourceUrl() {
  const url = sourceUrlText.value.trim()
  sourceMessage.value = ''
  onlineSearchError.value = ''

  if (!url) {
    sourceMessage.value = '请输入书源 URL'
    return
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch (error) {
    sourceMessage.value = '书源 URL 格式不正确'
    return
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    sourceMessage.value = '书源 URL 仅支持 http 或 https'
    return
  }

  isSourceUrlImporting.value = true
  try {
    const text = await fetchSourceText({ url: parsedUrl.href })
    importBookSourcesFromText(text, '已通过链接导入')
    sourceUrlText.value = ''
  } catch (error) {
    sourceMessage.value = error instanceof Error ? error.message : '书源链接导入失败'
  } finally {
    isSourceUrlImporting.value = false
  }
}

function toggleBookSource(sourceId: string) {
  const source = bookSources.value.find((item) => item.id === sourceId)
  if (!source) return
  source.enabled = !source.enabled
  persistBookSources()
}

function removeBookSource(sourceId: string) {
  bookSources.value = bookSources.value.filter((source) => source.id !== sourceId)
  persistBookSources()
  syncSourceEditorText()
}

async function fetchSourceText(request: SourceRequest) {
  if (window.services?.fetchText) {
    try {
      return await window.services.fetchText(request)
    } catch (serviceError) {
      try {
        return await fetchSourceTextInRenderer(request)
      } catch (browserError) {
        throw serviceError
      }
    }
  }

  return fetchSourceTextInRenderer(request)
}

async function fetchSourceTextInRenderer(request: SourceRequest) {
  const response = await fetch(request.url, {
    method: request.method || 'GET',
    headers: request.headers,
    body: request.body
  })
  if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`)
  request.responseUrl = response.url || request.url
  return response.text()
}

async function fetchSourceDataUrl(request: SourceRequest) {
  if (window.services?.fetchDataUrl) {
    try {
      return await window.services.fetchDataUrl(request)
    } catch (serviceError) {
      try {
        return await fetchSourceDataUrlInRenderer(request)
      } catch (browserError) {
        throw serviceError
      }
    }
  }

  return fetchSourceDataUrlInRenderer(request)
}

async function fetchSourceDataUrlInRenderer(request: SourceRequest) {
  const response = await fetch(request.url, {
    method: request.method || 'GET',
    headers: request.headers,
    body: request.body
  })
  if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`)
  request.responseUrl = response.url || request.url
  const blob = await response.blob()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('验证码图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

const requestOnlineVerificationCode: SourceVerificationHandler = async (request, source, options = { mode: 'image' }) => {
  const prompt = captchaPromptQueue
    .catch(() => undefined)
    .then(() =>
      options.mode === 'browser'
        ? openOnlineBrowserVerification(request, source, options)
        : openOnlineCaptchaPrompt(request, source)
    )
  captchaPromptQueue = prompt.catch(() => undefined)
  return await prompt
}

const deferOnlineSearchVerification: SourceVerificationHandler = async (request, source, options = { mode: 'image' }) => {
  const verificationRequest = getVerificationRequest(request, source)
  const staticLoginUrl = getStaticSourceLoginUrl(source)
  const verificationUrl =
    options.mode === 'image'
      ? getRequestHeaderValue(verificationRequest.headers, 'referer') ||
        staticLoginUrl ||
        verificationRequest.sourceUrl ||
        source.url ||
        source.searchUrl ||
        verificationRequest.url
      : verificationRequest.url || staticLoginUrl || verificationRequest.sourceUrl || source.url || source.searchUrl
  throw new SourceVerificationError(
    source,
    verificationUrl,
    verificationRequest,
    options
  )
}

function getRequestHeaderValue(headers: Record<string, string> | undefined, name: string) {
  if (!headers) return ''
  const target = name.toLowerCase()
  const matched = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return matched?.[1] || ''
}

function getStaticSourceLoginUrl(source: BookSourceConfig) {
  const loginUrl = source.loginUrl.trim()
  return loginUrl && !loginUrl.startsWith('@js:') && !loginUrl.startsWith('<js>') ? loginUrl : ''
}

async function openOnlineBrowserVerification(
  request: SourceRequest,
  source: BookSourceConfig,
  options: SourceVerificationOptions
) {
  const browserRequest = getVerificationRequest(request, source)
  verificationRequest = browserRequest
  verificationOptions = options
  verificationResolve = null
  verificationReject = null

  onlineVerification.sourceId = source.id
  onlineVerification.sourceName = source.name
  onlineVerification.url = browserRequest.url
  onlineVerification.mode = options.mode || 'browser'
  onlineVerification.opened = false
  onlineVerification.waiting = Boolean(options.waitForResult)
  onlineVerification.message = options.waitForResult
    ? `书源「${source.name}」需要在浏览器完成验证，完成后点击继续。`
    : `已为书源「${source.name}」打开验证页。`
  activePanel.value = 'online'

  await openOnlineVerificationPage()
  if (!options.waitForResult) return ''

  return await new Promise<string>((resolve, reject) => {
    verificationResolve = resolve
    verificationReject = reject
  })
}

async function openOnlineCaptchaPrompt(request: SourceRequest, source: BookSourceConfig) {
  const captchaRequest = getVerificationRequest(request, source)

  resetOnlineCaptchaDialog()
  onlineCaptchaDialog.open = true
  onlineCaptchaDialog.loading = true
  onlineCaptchaDialog.sourceName = source.name
  onlineCaptchaDialog.request = captchaRequest

  try {
    onlineCaptchaDialog.imageUrl = await fetchSourceDataUrl(captchaRequest)
  } catch (error) {
    onlineCaptchaDialog.error = error instanceof Error ? error.message : '验证码图片加载失败'
  } finally {
    onlineCaptchaDialog.loading = false
    await nextTick()
    captchaInputRef.value?.focus()
  }

  return await new Promise<string>((resolve, reject) => {
    captchaResolve = resolve
    captchaReject = reject
  })
}

function getVerificationRequest(request: SourceRequest, source: BookSourceConfig): SourceRequest {
  return {
    ...request,
    headers: request.headers ? { ...request.headers } : undefined,
    sourceId: request.sourceId || source.id,
    sourceName: request.sourceName || source.name,
    sourceUrl: request.sourceUrl || source.url || request.url,
    enabledCookieJar: request.enabledCookieJar ?? source.enabledCookieJar !== false
  }
}

function resetOnlineCaptchaDialog() {
  onlineCaptchaDialog.open = false
  onlineCaptchaDialog.loading = false
  onlineCaptchaDialog.error = ''
  onlineCaptchaDialog.sourceName = ''
  onlineCaptchaDialog.imageUrl = ''
  onlineCaptchaDialog.code = ''
  onlineCaptchaDialog.request = null
}

function submitOnlineCaptcha() {
  const code = onlineCaptchaDialog.code.trim()
  if (!code) {
    onlineCaptchaDialog.error = '请输入验证码'
    return
  }

  captchaResolve?.(code)
  captchaResolve = null
  captchaReject = null
  resetOnlineCaptchaDialog()
}

function cancelOnlineCaptcha() {
  const source = bookSources.value.find((item) => item.name === onlineCaptchaDialog.sourceName)
  const request = onlineCaptchaDialog.request
  const error = source
    ? new SourceVerificationError(source, request?.url || source.url || source.searchUrl, request || undefined, { mode: 'image' })
    : new Error('已取消验证码输入')
  captchaReject?.(error)
  captchaResolve = null
  captchaReject = null
  resetOnlineCaptchaDialog()
}

async function reloadOnlineCaptcha() {
  const request = onlineCaptchaDialog.request
  if (!request) return

  onlineCaptchaDialog.loading = true
  onlineCaptchaDialog.error = ''
  onlineCaptchaDialog.imageUrl = ''
  try {
    onlineCaptchaDialog.imageUrl = await fetchSourceDataUrl({ ...request, headers: request.headers ? { ...request.headers } : undefined })
  } catch (error) {
    onlineCaptchaDialog.error = error instanceof Error ? error.message : '验证码图片加载失败'
  } finally {
    onlineCaptchaDialog.loading = false
    await nextTick()
    captchaInputRef.value?.focus()
  }
}

function clearOnlineVerification() {
  onlineVerification.sourceId = ''
  onlineVerification.sourceName = ''
  onlineVerification.url = ''
  onlineVerification.mode = 'browser'
  onlineVerification.opened = false
  onlineVerification.waiting = false
  onlineVerification.message = ''
}

function setOnlineVerificationFromItem(item: OnlineVerificationItem) {
  onlineVerification.sourceId = item.sourceId
  onlineVerification.sourceName = item.sourceName
  onlineVerification.url = item.url
  onlineVerification.mode = item.mode || 'browser'
  onlineVerification.opened = false
  onlineVerification.waiting = false
  onlineVerification.message =
    item.mode === 'image'
      ? `书源「${item.sourceName}」需要输入验证码，完成后会继续搜索该书源。`
      : `书源「${item.sourceName}」返回了验证码或人机验证页，完成验证后可重试搜索。`
}

function setOnlineVerification(error: unknown) {
  if (!isSourceVerificationError(error)) return false

  setOnlineVerificationFromItem(createOnlineVerificationItem(error))
  return true
}

function createOnlineVerificationItem(error: SourceVerificationError): OnlineVerificationItem {
  return {
    sourceId: error.sourceId,
    sourceName: error.sourceName,
    url: error.url,
    mode: error.options?.mode || 'browser',
    request: error.request
  }
}

function setOnlineVerificationItems(errors: SourceVerificationError[]) {
  const seen = new Set<string>()
  onlineVerificationItems.value = errors
    .map(createOnlineVerificationItem)
    .filter((item) => {
      if (seen.has(item.sourceId)) return false
      seen.add(item.sourceId)
      return true
    })
  if (onlineVerificationItems.value.length) setOnlineVerificationFromItem(onlineVerificationItems.value[0])
}

function getOnlineFailureMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const trimmed = message.trim()
  return trimmed ? `书源搜索规则执行失败：${trimmed}` : '书源搜索规则执行失败'
}

function createOnlineSearchFailureItem(source: BookSourceConfig, error: unknown): OnlineSearchFailureItem {
  return {
    sourceId: source.id,
    sourceName: source.name,
    message: getOnlineFailureMessage(error)
  }
}

function setOnlineSearchFailures(items: OnlineSearchFailureItem[]) {
  const seen = new Set<string>()
  onlineSearchFailures.value = items.filter((item) => {
    if (seen.has(item.sourceId)) return false
    seen.add(item.sourceId)
    return true
  })
}

function removeOnlineSearchFailureItem(sourceId: string) {
  onlineSearchFailures.value = onlineSearchFailures.value.filter((item) => item.sourceId !== sourceId)
}

function updateOnlineSearchFailureItem(item: OnlineSearchFailureItem) {
  onlineSearchFailures.value = [
    item,
    ...onlineSearchFailures.value.filter((candidate) => candidate.sourceId !== item.sourceId)
  ]
}

function removeOnlineVerificationItem(sourceId: string) {
  onlineVerificationItems.value = onlineVerificationItems.value.filter((item) => item.sourceId !== sourceId)
  if (onlineVerification.sourceId !== sourceId) return
  clearOnlineVerification()
  const next = onlineVerificationItems.value[0]
  if (next) setOnlineVerificationFromItem(next)
}

function mergeOnlineSearchResults(results: SourceSearchResult[]) {
  if (!results.length) return
  const seen = new Set(onlineSearchResults.value.map((result) => result.key))
  const next = results.filter((result) => {
    if (seen.has(result.key)) return false
    seen.add(result.key)
    return true
  })
  if (next.length) onlineSearchResults.value = [...onlineSearchResults.value, ...next]
}

function getOnlineVerificationSource() {
  return bookSources.value.find((source) => source.id === onlineVerification.sourceId)
}

function resolveOnlineVerificationUrl(source: BookSourceConfig) {
  const loginUrl = getStaticSourceLoginUrl(source)
  const fallback = source.url || source.searchUrl
  const target =
    onlineVerification.url ||
    loginUrl ||
    fallback

  try {
    return new URL(target, source.url || fallback || window.location.href).toString()
  } catch (error) {
    return target
  }
}

function getSourceCookieRequest(source: BookSourceConfig, url: string): SourceRequest {
  return {
    url,
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url || url,
    enabledCookieJar: source.enabledCookieJar !== false
  }
}

async function searchOnlineBooks() {
  const keyword = onlineKeyword.value.trim()
  const sources = enabledBookSources.value
  onlineSearchError.value = ''
  onlineSearchResults.value = []
  onlineVerificationItems.value = []
  onlineSearchFailures.value = []
  clearOnlineVerification()

  if (!keyword) {
    onlineSearchError.value = '请输入书名或作者'
    return
  }
  if (!sources.length) {
    onlineSearchError.value = '请先添加并启用书源'
    return
  }

  isOnlineSearching.value = true
  try {
    const batches = await Promise.allSettled(
      sources.map((source) => searchSourceBooks(source, keyword, fetchSourceText, deferOnlineSearchVerification))
    )
    const results = batches.flatMap((batch) => (batch.status === 'fulfilled' ? batch.value : []))
    const verificationErrors: SourceVerificationError[] = []
    const failures: OnlineSearchFailureItem[] = []

    batches.forEach((batch, index) => {
      if (batch.status !== 'rejected') return
      if (isSourceVerificationError(batch.reason)) {
        verificationErrors.push(batch.reason)
        return
      }
      failures.push(createOnlineSearchFailureItem(sources[index], batch.reason))
    })

    const failedCount = failures.length
    onlineSearchResults.value = results
    setOnlineSearchFailures(failures)
    if (verificationErrors.length) {
      setOnlineVerificationItems(verificationErrors)
      if (results.length) {
        onlineSearchError.value = `${verificationErrors.length} 个书源需要先完成验证码或访问验证，已显示其他书源结果${failedCount ? `，另有 ${failedCount} 个书源失败` : ''}`
      } else if (verificationErrors.length === batches.length) {
        onlineSearchError.value = '搜索被验证码或访问验证拦截，请先打开验证页'
      } else if (failedCount) {
        onlineSearchError.value = `没有搜到书籍，${verificationErrors.length} 个书源需要先完成验证码或访问验证，部分书源请求失败`
      } else {
        onlineSearchError.value = `没有搜到相关书籍，${verificationErrors.length} 个书源需要先完成验证码或访问验证`
      }
      return
    }
    if (!results.length) {
      onlineSearchError.value = failedCount ? '没有搜到书籍，部分书源请求失败' : '没有搜到相关书籍'
    } else if (failedCount) {
      onlineSearchError.value = `已显示可用书源结果，另有 ${failedCount} 个书源搜索失败`
    }
  } catch (error) {
    onlineSearchError.value = error instanceof Error ? error.message : '搜书失败'
  } finally {
    isOnlineSearching.value = false
  }
}

async function retryOnlineVerificationItem(item: OnlineVerificationItem) {
  const source = bookSources.value.find((candidate) => candidate.id === item.sourceId)
  const keyword = onlineKeyword.value.trim()
  if (!source) {
    onlineSearchError.value = '需要验证的书源不存在，请重新搜索'
    return
  }
  if (!keyword) {
    onlineSearchError.value = '请输入书名或作者'
    return
  }

  setOnlineVerificationFromItem(item)
  onlineSearchError.value = ''
  let verificationCode = ''
  try {
    if (item.mode === 'image' && item.request) {
      verificationCode = await openOnlineCaptchaPrompt(item.request, source)
    }

    let hasUsedVerificationCode = false
    const verificationHandler: SourceVerificationHandler = async (request, requestSource, options = { mode: 'image' }) => {
      if (verificationCode && options.mode === 'image' && !hasUsedVerificationCode) {
        hasUsedVerificationCode = true
        return verificationCode
      }
      return await requestOnlineVerificationCode(request, requestSource, options)
    }

    isOnlineSearching.value = true
    const results = await searchSourceBooks(source, keyword, fetchSourceText, verificationHandler)
    mergeOnlineSearchResults(results)
    removeOnlineVerificationItem(item.sourceId)
    onlineSearchError.value = results.length ? '' : `书源「${source.name}」没有搜到相关书籍`
  } catch (error) {
    if (isSourceVerificationError(error)) {
      const nextItem = createOnlineVerificationItem(error)
      onlineVerificationItems.value = [
        nextItem,
        ...onlineVerificationItems.value.filter((candidate) => candidate.sourceId !== nextItem.sourceId)
      ]
      setOnlineVerificationFromItem(nextItem)
      onlineSearchError.value =
        nextItem.mode === 'image'
          ? `书源「${nextItem.sourceName}」仍需要输入验证码`
          : `书源「${nextItem.sourceName}」仍需要先完成验证码或访问验证`
      return
    }
    onlineSearchError.value = error instanceof Error ? error.message : `书源「${source.name}」重试失败`
  } finally {
    isOnlineSearching.value = false
  }
}

async function retryOnlineSearchFailureItem(item: OnlineSearchFailureItem) {
  const source = bookSources.value.find((candidate) => candidate.id === item.sourceId)
  const keyword = onlineKeyword.value.trim()
  if (!source) {
    onlineSearchError.value = '搜索失败的书源不存在，请重新搜索'
    return
  }
  if (!keyword) {
    onlineSearchError.value = '请输入书名或作者'
    return
  }

  isOnlineSearching.value = true
  onlineSearchError.value = ''
  try {
    const results = await searchSourceBooks(source, keyword, fetchSourceText, requestOnlineVerificationCode)
    mergeOnlineSearchResults(results)
    removeOnlineSearchFailureItem(item.sourceId)
    onlineSearchError.value = results.length ? '' : `书源「${source.name}」没有搜到相关书籍`
  } catch (error) {
    if (isSourceVerificationError(error)) {
      const nextItem = createOnlineVerificationItem(error)
      onlineVerificationItems.value = [
        nextItem,
        ...onlineVerificationItems.value.filter((candidate) => candidate.sourceId !== nextItem.sourceId)
      ]
      removeOnlineSearchFailureItem(item.sourceId)
      setOnlineVerificationFromItem(nextItem)
      onlineSearchError.value =
        nextItem.mode === 'image'
          ? `书源「${nextItem.sourceName}」需要输入验证码`
          : `书源「${nextItem.sourceName}」需要先完成验证码或访问验证`
      return
    }

    const failure = createOnlineSearchFailureItem(source, error)
    updateOnlineSearchFailureItem(failure)
    onlineSearchError.value = failure.message
  } finally {
    isOnlineSearching.value = false
  }
}

function openOnlineVerificationItem(item: OnlineVerificationItem) {
  setOnlineVerificationFromItem(item)
  void openOnlineVerificationPage()
}

async function openOnlineVerificationPage() {
  const source = getOnlineVerificationSource()
  if (!source) {
    onlineSearchError.value = '需要验证的书源不存在，请重新搜索'
    return
  }

  const url = resolveOnlineVerificationUrl(source)
  if (!url) {
    onlineSearchError.value = '没有可打开的验证地址'
    return
  }

  onlineVerification.url = url
  onlineSearchError.value = ''

  if (onlineVerificationWindow && !onlineVerificationWindow.isDestroyed?.()) {
    onlineVerificationWindow.close?.()
  }

  try {
    const openedInChildWindow = openOnlineVerificationChildWindow(url, source)
    if (!openedInChildWindow) openOnlineVerificationExternal(url)
    markOnlineVerificationOpened(source)
  } catch (error) {
    onlineVerification.opened = false
    onlineVerification.message = `书源「${source.name}」验证页打开失败。`
    onlineSearchError.value = error instanceof Error ? error.message : '验证页打开失败'
  }
}

function openOnlineVerificationChildWindow(url: string, source: BookSourceConfig) {
  if (!window.ztools?.createBrowserWindow) return false

  const bridgeUrl = `verify.html?url=${encodeURIComponent(url)}`
  onlineVerificationWindow = window.ztools.createBrowserWindow(bridgeUrl, {
    width: 900,
    height: 700,
    show: true,
    title: `书源验证 - ${source.name}`,
    frame: true,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    skipTaskbar: false,
    skipTaskBar: false,
    showInTaskbar: true,
    focusable: true,
    acceptFirstMouse: true
  })

  if (!onlineVerificationWindow) return false
  onlineVerificationWindow.show?.()
  onlineVerificationWindow.focus?.()
  onlineVerificationWindow.moveTop?.()
  return true
}

function openOnlineVerificationExternal(url: string) {
  if (!openExternalUrl(url)) throw new Error('验证页打开失败，请检查系统是否拦截了新窗口')
}

function openExternalUrl(url: string) {
  if (window.ztools?.shellOpenExternal) {
    window.ztools.shellOpenExternal(url)
    return true
  }

  const externalWindow = window.open(url, '_blank', 'noopener,noreferrer')
  return Boolean(externalWindow)
}

function markOnlineVerificationOpened(source: BookSourceConfig) {
  onlineVerification.opened = true
  onlineVerification.message = onlineVerification.waiting
    ? `已打开「${source.name}」验证页，完成后点击继续。`
    : `已打开「${source.name}」验证页，完成验证码后回到这里重试。`
}

async function rememberOnlineVerificationCookie() {
  const source = getOnlineVerificationSource()
  if (!source || !onlineVerification.url) return false

  const webContents = onlineVerificationWindow?.webContents
  const cookie = webContents?.executeJavaScript
    ? await webContents.executeJavaScript<string>('document.cookie || ""', true).catch(() => '')
    : ''

  if (!cookie?.trim()) return false

  window.services?.rememberSourceCookie?.(getSourceCookieRequest(source, onlineVerification.url), cookie)
  return true
}

async function retryOnlineSearchAfterVerification() {
  if (verificationResolve && verificationRequest) {
    await continueOnlineVerification()
    return
  }

  const remembered = await rememberOnlineVerificationCookie()
  if (remembered) onlineVerification.message = '已保存验证 Cookie，正在重试搜索。'
  else onlineVerification.message = '正在重试搜索；如果仍被拦截，请确认验证页已完成。'
  await searchOnlineBooks()
}

async function handleOnlineVerificationPrimaryAction() {
  if (onlineVerification.mode === 'image') {
    const item = activeOnlineVerificationItem.value
    if (item) {
      await retryOnlineVerificationItem(item)
      return
    }
  }

  await retryOnlineSearchAfterVerification()
}

async function continueOnlineVerification() {
  const request = verificationRequest
  const resolve = verificationResolve
  if (!request || !resolve) return

  onlineVerification.message = '正在读取验证后的页面。'
  const remembered = await rememberOnlineVerificationCookie()
  const windowHtml = await readOnlineVerificationWindowHtml()

  try {
    const body =
      verificationOptions?.refetchAfterSuccess === false
        ? windowHtml
        : await fetchSourceText({ ...request, headers: request.headers ? { ...request.headers } : undefined }).catch((error) => {
            if (windowHtml) return windowHtml
            throw error
          })

    verificationResolve = null
    verificationReject = null
    verificationRequest = null
    verificationOptions = null
    clearOnlineVerification()
    resolve(body || windowHtml || '')
    if (remembered) onlineImportStatus.value = '已保存验证 Cookie，继续解析书源。'
  } catch (error) {
    onlineVerification.message = error instanceof Error ? error.message : '验证后的页面读取失败'
  }
}

async function readOnlineVerificationWindowHtml() {
  const webContents = onlineVerificationWindow?.webContents
  if (!webContents?.executeJavaScript) return ''

  return await webContents
    .executeJavaScript<string>('document.documentElement?.outerHTML || document.body?.innerText || ""', true)
    .catch(() => '')
}

async function importOnlineSearchResult(result: SourceSearchResult) {
  const source = bookSources.value.find((item) => item.id === result.sourceId)
  if (!source) {
    onlineSearchError.value = '书源不存在，请重新搜索'
    return
  }

  onlineImportingKey.value = result.key
  onlineImportStatus.value = '正在读取目录'
  onlineSearchError.value = ''

  try {
    const loaded = await loadOnlineBook(source, result, fetchSourceText, (finished, total, title) => {
      onlineImportStatus.value = title ? `正在读取首章：${title}` : '正在读取首章'
    }, requestOnlineVerificationCode)
    upsertBook(createOnlineBook(loaded.book, loaded.content, loaded.chapters), { resetProgress: true })
    onlineImportStatus.value = `已加入书架《${loaded.book.title}》，从第一章开始`
  } catch (error) {
    onlineSearchError.value = error instanceof Error ? error.message : '在线书籍导入失败'
  } finally {
    onlineImportingKey.value = ''
  }
}

async function openOnlineBookDetail(result: SourceSearchResult) {
  const requestId = onlineDetailRequestId + 1
  const source = bookSources.value.find((item) => item.id === result.sourceId)
  onlineDetailRequestId = requestId
  onlineDetailDialog.open = true
  onlineDetailDialog.loading = true
  onlineDetailDialog.error = ''
  onlineDetailDialog.result = result
  onlineDetailDialog.book = result
  onlineDetailDialog.chapters = []

  if (!source) {
    onlineDetailDialog.loading = false
    onlineDetailDialog.error = '书源不存在，请重新搜索'
    return
  }

  try {
    const detail = await loadOnlineBookDetail(source, result, fetchSourceText, requestOnlineVerificationCode)
    if (onlineDetailRequestId !== requestId) return
    onlineDetailDialog.book = detail.book
    onlineDetailDialog.chapters = detail.chapters
  } catch (error) {
    if (onlineDetailRequestId !== requestId) return
    onlineDetailDialog.error = error instanceof Error ? error.message : '书籍详情读取失败'
  } finally {
    if (onlineDetailRequestId === requestId) onlineDetailDialog.loading = false
  }
}

function closeOnlineBookDetail() {
  onlineDetailRequestId += 1
  onlineDetailDialog.open = false
  onlineDetailDialog.loading = false
  onlineDetailDialog.error = ''
}

function importOnlineDetailBook() {
  const book = onlineDetailBook.value
  if (!book) return
  closeOnlineBookDetail()
  void importOnlineSearchResult(book)
}

function getBookInfoText(book: Book) {
  const words = `${Math.ceil(book.content.length / 10000)} 万字`
  if (book.kind === 'online') {
    const author = book.online?.author ? `${book.online.author} · ` : ''
    const chapter = book.online?.chapters.find((item) => item.index === book.online?.currentChapterIndex)
    const chapterText = chapter && book.online?.chapters.length ? ` · ${chapter.index + 1}/${book.online.chapters.length}` : ''
    return `${getBookProgressPercent(book)}% · ${author}${book.sourceName}${chapterText} · 当前章 ${words}`
  }

  return `${getBookProgressPercent(book)}% · 本地 · ${words}`
}

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function setDropEffect(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function isDragPointInside(event: DragEvent) {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return false

  const rect = target.getBoundingClientRect()
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
}

function handleDragEnter(event: DragEvent) {
  if (!isFileDrag(event)) return

  dragDepth += 1
  setDropEffect(event)
  isDragging.value = true
}

function handleDragOver(event: DragEvent) {
  if (!isFileDrag(event)) return

  setDropEffect(event)
  isDragging.value = true
}

function handleDragLeave(event: DragEvent) {
  if (!isDragging.value) return

  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth > 0 && isDragPointInside(event)) return

  dragDepth = 0
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  dragDepth = 0
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) importBrowserFile(file)
}

function selectBook(bookId: string) {
  activeBookId.value = bookId
  activePanel.value = 'library'
  isReaderHidden.value = false
  storage.set(LAST_BOOK_KEY, bookId)
}

function updateProgressIndex(index: number) {
  const book = activeBook.value
  if (!book) return

  book.progressIndex = clampNumber(index, 0, activeMaxPageStart.value)
  book.updatedAt = Date.now()
  persistLibrary()
}

async function nextPage() {
  const book = activeBook.value
  if (!book) return false
  if (currentPageSlice.value.endIndex < book.content.length) {
    updateProgressIndex(currentPageSlice.value.endIndex)
    return true
  }

  if (book.kind === 'online') return loadNextOnlineChapter(book)
  return false
}

function getNextOnlineChapter(book: Book) {
  if (!book.online?.chapters.length) return null

  const currentPosition = book.online.chapters.findIndex((chapter) => chapter.index === book.online?.currentChapterIndex)
  const nextPosition = currentPosition >= 0 ? currentPosition + 1 : 0
  return book.online.chapters[nextPosition] ?? null
}

async function loadNextOnlineChapter(book: Book) {
  const chapter = getNextOnlineChapter(book)
  if (!chapter) {
    chapterLoadMessage.value = '已经是最后一章'
    return false
  }

  return loadOnlineChapterIntoBook(book, chapter, `正在读取下一章：${chapter.title}`)
}

function getPreviousOnlineChapter(book: Book) {
  if (!book.online?.chapters.length) return null

  const currentPosition = book.online.chapters.findIndex((chapter) => chapter.index === book.online?.currentChapterIndex)
  if (currentPosition <= 0) return null
  return book.online.chapters[currentPosition - 1] ?? null
}

async function loadPreviousOnlineChapter(book: Book) {
  const chapter = getPreviousOnlineChapter(book)
  if (!chapter) {
    chapterLoadMessage.value = '已经是第一章'
    return false
  }

  return loadOnlineChapterIntoBook(book, chapter, `正在读取上一章：${chapter.title}`, { progress: 'end' })
}

async function loadOnlineChapterIntoBook(
  book: Book,
  chapter: SourceChapter,
  message: string,
  options: { progress?: 'start' | 'end' } = {}
) {
  if (!book.online) return false

  const source = bookSources.value.find((item) => item.id === book.online?.sourceId)
  if (!source) {
    chapterLoadMessage.value = '书源不存在，请重新添加书源'
    return false
  }

  const loadingKey = getChapterLoadingKey(book, chapter)
  if (loadingChapterKey.value) return false

  loadingChapterKey.value = loadingKey
  chapterLoadMessage.value = message

  try {
    const content = await loadOnlineChapter(source, chapter, fetchSourceText, requestOnlineVerificationCode)
    const target = books.value.find((item) => item.id === book.id)
    if (!target?.online) return false

    target.content = tidyContent(content)
    target.size = target.content.length
    target.progressIndex =
      options.progress === 'end' ? getMaxVisualPageStart(target.content, fishLineLength.value, fishLineCount.value) : 0
    target.updatedAt = Date.now()
    target.online.currentChapterIndex = chapter.index
    activeBookId.value = target.id
    activePanel.value = 'library'
    isReaderHidden.value = false
    chapterLoadMessage.value = ''
    persistLibrary()
    return true
  } catch (error) {
    chapterLoadMessage.value = error instanceof Error ? error.message : '章节读取失败'
    return false
  } finally {
    if (loadingChapterKey.value === loadingKey) loadingChapterKey.value = ''
  }
}

function getChapterLoadingKey(book: Book, chapter: SourceChapter) {
  return `${book.id}:${chapter.index}:${chapter.url || ''}`
}

function isChapterLoading(chapter: Chapter) {
  const book = activeBook.value
  if (!book || !chapter.sourceChapter) return false
  return loadingChapterKey.value === getChapterLoadingKey(book, chapter.sourceChapter)
}

async function prevPage() {
  const book = activeBook.value
  if (!book) return false
  if (currentIndex.value > 0) {
    updateProgressIndex(getPreviousPageStart(currentIndex.value, activePageStarts.value))
    return true
  }

  if (book.kind === 'online') return loadPreviousOnlineChapter(book)
  return false
}

function jumpToIndex(index: number) {
  updateProgressIndex(index)
  activePanel.value = 'library'
  isReaderHidden.value = false
}

function getChapterMetaText(chapter: Chapter) {
  const book = activeBook.value
  if (!book) return ''

  if (isChapterLoading(chapter)) return '读取中'
  if (book.kind === 'online' && book.online) {
    if (book.online.currentChapterIndex === chapter.index) return '当前'
    return `${chapter.index + 1}/${book.online.chapters.length}`
  }

  return `${Math.floor(chapter.index / Math.max(1, book.content.length) * 100)}%`
}

async function jumpToChapter(chapter: Chapter) {
  const book = activeBook.value
  if (!book) return

  if (book.kind !== 'online' || !book.online || !chapter.sourceChapter) {
    jumpToIndex(chapter.index)
    closeChapterDialog()
    return
  }

  if (book.online.currentChapterIndex === chapter.index) {
    activePanel.value = 'library'
    isReaderHidden.value = false
    closeChapterDialog()
    return
  }

  const loaded = await loadOnlineChapterIntoBook(book, chapter.sourceChapter, `正在读取：${chapter.title}`)
  if (loaded) closeChapterDialog()
}

function jumpToSearchMatch(index: number) {
  const match = searchMatches.value[index]
  if (typeof match !== 'number') return
  searchCursor.value = index
  jumpToIndex(match)
  closeBookSearchDialog()
}

function jumpToNextSearchMatch() {
  if (!searchMatches.value.length) return
  const next = (searchCursor.value + 1) % searchMatches.value.length
  jumpToSearchMatch(next)
}

function openBookSearchDialog() {
  if (!activeBook.value) return
  isBookSearchDialogOpen.value = true
  nextTick(() => searchInputRef.value?.focus())
}

function closeBookSearchDialog() {
  isBookSearchDialogOpen.value = false
}

function openChapterDialog() {
  if (!activeBook.value) return
  isChapterDialogOpen.value = true
}

function closeChapterDialog() {
  isChapterDialogOpen.value = false
}

function toggleAutoPaging() {
  if (!activeBook.value) return
  isAutoPaging.value = !isAutoPaging.value
}

function focusFishKeyboard() {
  isFishKeyboardActive.value = true
  if (!fishWindow || fishWindow.isDestroyed?.()) return

  fishWindow.setSkipTaskbar?.(true)
  fishWindow.setFocusable?.(true)
  fishWindow.focus?.()
  fishWindow.setSkipTaskbar?.(true)
  fishWindow.setAlwaysOnTop?.(true)
  fishWindow.moveTop?.()
}

function blurFishKeyboard() {
  isFishKeyboardActive.value = false
  if (!fishWindow || fishWindow.isDestroyed?.()) return

  fishWindow.blur?.()
  fishWindow.setSkipTaskbar?.(true)
  fishWindow.setFocusable?.(false)
}

function canUsePageKeyboard() {
  if (!activeBook.value) return false
  if (typeof window.ztools?.createBrowserWindow === 'function') return isFishKeyboardActive.value
  return true
}

function toggleHidden() {
  isReaderHidden.value = !isReaderHidden.value
  if (isReaderHidden.value) blurFishKeyboard()
}

function hideFishWindow() {
  isReaderHidden.value = true
  blurFishKeyboard()
}

function toggleStealth() {
  settings.stealth = !settings.stealth
  persistSettings()
}

function resetFishBackgrounds() {
  Object.assign(settings.fishBackgrounds, DEFAULT_FISH_BACKGROUNDS)
}

function closePlugin() {
  isReaderHidden.value = true
  try {
    window.ztools?.outPlugin?.()
  } catch (error) {
    // Browser preview keeps the concealed reader visible.
  }
}

function removeBook(bookId: string) {
  books.value = books.value.filter((book) => book.id !== bookId)
  if (activeBookId.value === bookId) {
    activeBookId.value = books.value[0]?.id ?? ''
    storage.set(LAST_BOOK_KEY, activeBookId.value)
  }
  contextMenu.show = false
  persistLibrary()
}

function revealPanel(panel: Panel) {
  activePanel.value = activePanel.value === panel ? 'library' : panel
}

function syncPluginWindowSize() {
  window.ztools?.setExpendHeight?.(680)
  window.ztools?.resizeWindow?.(920, 680)
}

function getWorkArea() {
  const display = window.ztools?.getPrimaryDisplay?.()
  return display?.workArea ?? { x: 0, y: 0, width: window.screen.availWidth, height: window.screen.availHeight }
}

function clampNumber(value: number, min: number, max: number) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? Math.max(safeMin, max) : safeMin
  const safeValue = Number.isFinite(value) ? value : safeMin

  return Math.min(safeMax, Math.max(safeMin, Math.round(safeValue)))
}

function getFishSizeLimits() {
  const area = getWorkArea()

  return {
    minWidth: FISH_MIN_WIDTH,
    maxWidth: Math.max(FISH_MIN_WIDTH, Math.min(area.width, FISH_MAX_WIDTH)),
    minHeight: FISH_MIN_HEIGHT,
    maxHeight: Math.max(FISH_MIN_HEIGHT, Math.min(area.height, FISH_MAX_HEIGHT))
  }
}

function clampFishSize(width: number, height: number) {
  const limits = getFishSizeLimits()

  return {
    width: clampNumber(width, limits.minWidth, limits.maxWidth),
    height: clampNumber(height, limits.minHeight, limits.maxHeight)
  }
}

function hasStoredFishPosition() {
  return Number.isFinite(settings.fishX) && Number.isFinite(settings.fishY)
}

function getStoredFishAnchor() {
  if (!hasStoredFishPosition()) return null
  return { x: settings.fishX as number, y: settings.fishY as number }
}

function getFishWindowBounds() {
  return getAnchoredFishWindowBoundsForSize(settings.fishWidth, settings.fishHeight)
}

function getInitialFishWindowBoundsForSize(width: number, height: number) {
  const area = getWorkArea()
  const size = clampFishSize(width, height)

  return {
    ...size,
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + area.height - size.height)
  }
}

function getAnchoredFishWindowBoundsForSize(width: number, height: number) {
  const area = getWorkArea()
  const size = clampFishSize(width, height)
  const fallback = fishWindowAnchor ?? getStoredFishAnchor() ?? getInitialFishWindowBoundsForSize(size.width, size.height)
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)

  return {
    ...size,
    x: clampNumber(fallback.x, area.x, maxX),
    y: clampNumber(fallback.y, area.y, maxY)
  }
}

function getMovedFishWindowBounds(x: number, y: number) {
  const area = getWorkArea()
  const size = clampFishSize(settings.fishWidth, settings.fishHeight)
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)

  return {
    ...size,
    x: clampNumber(x, area.x, maxX),
    y: clampNumber(y, area.y, maxY)
  }
}

function getFishPayload(bounds = getFishWindowBounds()) {
  return {
    visible: Boolean(activeBook.value) && !isReaderHidden.value,
    title: activeBookLabel.value,
    chapter: currentChapter.value?.title ?? '',
    progress: progressLabel.value,
    currentPage: currentPage.value + 1,
    pageCount: pageCount.value,
    lines: fishLines.value,
    bounds,
    resizeLimits: getFishSizeLimits(),
    settings: {
      fishSkin: settings.fishSkin,
      fishBackgrounds: settings.fishBackgrounds,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      fishWidth: settings.fishWidth,
      fishHeight: settings.fishHeight,
      fishX: settings.fishX,
      fishY: settings.fishY,
      letterSpacing: settings.letterSpacing,
      opacity: settings.opacity,
      prevPageKey: settings.prevPageKey,
      nextPageKey: settings.nextPageKey,
      showFishPrefix: settings.showFishPrefix,
      showFishMeta: settings.showFishMeta,
      hideOnMouseLeave: settings.hideOnMouseLeave,
      wheelTurnPage: settings.wheelTurnPage,
      stealth: settings.stealth
    }
  }
}

function applyFishWindowBounds(bounds: FishBounds) {
  if (!fishWindow || fishWindow.isDestroyed?.()) return

  fishWindowAnchor = { x: bounds.x, y: bounds.y }
  fishWindow.setContentBounds?.(bounds)
  fishWindow.setContentSize?.(bounds.width, bounds.height)
  fishWindow.setSize?.(bounds.width, bounds.height)
  fishWindow.setPosition?.(bounds.x, bounds.y)
  fishWindow.setAlwaysOnTop?.(true)
  fishWindow.setSkipTaskbar?.(true)
  fishWindow.moveTop?.()
}

function positionFishWindow() {
  applyFishWindowBounds(getFishWindowBounds())
}

function previewFishWindowSize(width: number, height: number) {
  if (!fishWindow || fishWindow.isDestroyed?.() || !Number.isFinite(width) || !Number.isFinite(height)) return

  applyFishWindowBounds(getAnchoredFishWindowBoundsForSize(width, height))
}

function previewFishWindowPosition(x: number, y: number) {
  if (!fishWindow || fishWindow.isDestroyed?.() || !Number.isFinite(x) || !Number.isFinite(y)) return

  applyFishWindowBounds(getMovedFishWindowBounds(x, y))
}

function pushFishState() {
  if (!fishWindow || fishWindow.isDestroyed?.()) return

  const bounds = getFishWindowBounds()
  const payload = getFishPayload(bounds)

  if (payload.visible) {
    applyFishWindowBounds(bounds)
    fishWindow.show?.()
  } else {
    fishWindow.hide?.()
  }

  const sync = fishWindow.webContents?.executeJavaScript?.(`window.deepreadFishSetState?.(${JSON.stringify(payload)})`)
  void sync?.catch((error) => {
    console.warn('[DeepRead] fish window sync failed', error)
  })
}

function ensureFishWindow() {
  if (!window.ztools?.createBrowserWindow || !activeBook.value) return
  if (fishWindow && !fishWindow.isDestroyed?.()) {
    pushFishState()
    return
  }

  const bounds = getFishWindowBounds()
  fishWindowAnchor = { x: bounds.x, y: bounds.y }
  fishWindow = window.ztools.createBrowserWindow(
    'fish.html',
    {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      title: 'DeepRead Fish',
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
      alwayOnTop: true,
      alwaysOnTop: true,
      webPreferences: {
        devTools: false,
        zoomFactor: 1,
        nodeIntegration: false,
        contextIsolation: false
      }
    },
    () => pushFishState()
  )

  pushFishState()
}

function showFishWindow() {
  isReaderHidden.value = false
  ensureFishWindow()
  nextTick(pushFishState)
}

function resizeFishWindow(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return

  const size = clampFishSize(width, height)
  settings.fishWidth = size.width
  settings.fishHeight = size.height
  positionFishWindow()
  nextTick(pushFishState)
}

function moveFishWindow(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return

  const bounds = getMovedFishWindowBounds(x, y)
  settings.fishX = bounds.x
  settings.fishY = bounds.y
  applyFishWindowBounds(bounds)
  nextTick(pushFishState)
}

function startPageKeyCapture(action: PageKeyAction) {
  keyBindingCapture.value = action
}

function cancelPageKeyCapture(action: PageKeyAction) {
  if (keyBindingCapture.value === action) keyBindingCapture.value = null
}

function setPageKeyBinding(action: PageKeyAction, event: KeyboardEvent) {
  const binding = getKeyboardEventBinding(event)
  if (!binding) return

  const previousPrevKey = settings.prevPageKey
  const previousNextKey = settings.nextPageKey

  if (action === 'prev') {
    settings.prevPageKey = binding
    if (previousNextKey === binding) settings.nextPageKey = previousPrevKey
  } else {
    settings.nextPageKey = binding
    if (previousPrevKey === binding) settings.prevPageKey = previousNextKey
  }

  keyBindingCapture.value = null
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
}

function handlePageKeyButtonKeydown(action: PageKeyAction, event: KeyboardEvent) {
  if (keyBindingCapture.value !== action) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      startPageKeyCapture(action)
    }
    return
  }

  event.preventDefault()
  event.stopPropagation()
  setPageKeyBinding(action, event)
}

function handleWheel(event: WheelEvent) {
  if (!settings.wheelTurnPage || wheelLock || !activeBook.value || isReaderHidden.value) return
  if (Math.abs(event.deltaY) < 18) return

  wheelLock = true
  event.preventDefault()
  if (event.deltaY > 0) void nextPage()
  else void prevPage()

  window.setTimeout(() => {
    wheelLock = false
  }, 260)
}

function handleKeydown(event: KeyboardEvent) {
  if (keyBindingCapture.value) return

  if (isDisclaimerDialogOpen.value) {
    const key = normalizeKeyboardKey(event.key)
    if (!['Tab', 'Enter', 'Space'].includes(key)) event.preventDefault()
    return
  }

  if (isSourceJsonDialogOpen.value && normalizeKeyboardKey(event.key) === 'Escape') {
    event.preventDefault()
    closeSourceJsonImportDialog()
    return
  }

  if (isChapterDialogOpen.value && normalizeKeyboardKey(event.key) === 'Escape') {
    event.preventDefault()
    closeChapterDialog()
    return
  }

  if (isBookSearchDialogOpen.value && normalizeKeyboardKey(event.key) === 'Escape') {
    event.preventDefault()
    closeBookSearchDialog()
    return
  }

  if (onlineCaptchaDialog.open && normalizeKeyboardKey(event.key) === 'Escape') {
    event.preventDefault()
    cancelOnlineCaptcha()
    return
  }

  if (onlineDetailDialog.open && normalizeKeyboardKey(event.key) === 'Escape') {
    event.preventDefault()
    closeOnlineBookDetail()
    return
  }

  if (isKeyboardShortcutTarget(event.target)) return

  const binding = getKeyboardEventBinding(event)
  const prevPageKey = normalizeKeyBinding(settings.prevPageKey, defaultSettings.prevPageKey)
  const nextPageKey = normalizeKeyBinding(settings.nextPageKey, defaultSettings.nextPageKey)

  if (canUsePageKeyboard() && binding && binding === nextPageKey) {
    event.preventDefault()
    void nextPage()
    return
  }

  if (canUsePageKeyboard() && binding && binding === prevPageKey) {
    event.preventDefault()
    void prevPage()
    return
  }

  if (hasCommandModifier(event)) return

  const key = normalizeKeyboardKey(event.key)
  if (key === 'H' || key === 'Escape') {
    event.preventDefault()
    toggleHidden()
  } else if (key === 'A') {
    event.preventDefault()
    toggleAutoPaging()
  } else if (key === 'S') {
    event.preventDefault()
    toggleStealth()
  }
}

function openContextMenu(book: Book, event: MouseEvent) {
  contextMenu.show = true
  contextMenu.bookId = book.id
  contextMenu.x = Math.min(event.clientX, window.innerWidth - 190)
  contextMenu.y = Math.min(event.clientY, window.innerHeight - 210)
}

function closeContextMenu() {
  contextMenu.show = false
}

function handleContextAction(action: 'read' | 'chapters' | 'search' | 'remove') {
  const bookId = contextMenu.bookId
  contextMenu.show = false

  if (action === 'remove') {
    removeBook(bookId)
    return
  }

  selectBook(bookId)
  if (action === 'chapters') openChapterDialog()
  if (action === 'search') openBookSearchDialog()
}

function handlePluginCommand(action: ZToolsFeatureEnterAction) {
  if (action.code === 'deepread-import' && action.type === 'files') {
    const filePath = (action.payload as ZToolsFilePayload[] | undefined)?.[0]?.path
    if (filePath) importFromZToolsPath(filePath)
    return
  }

  if (action.code === 'deepread-search-books') activePanel.value = 'online'
  else if (action.code === 'deepread-prev-page') void prevPage()
  else if (action.code === 'deepread-next-page') void nextPage()
  else if (action.code === 'deepread-toggle-show') toggleHidden()
  else if (action.code === 'deepread-close') closePlugin()
  else if (action.code === 'deepread-toggle-auto') toggleAutoPaging()
  else if (action.code === 'deepread-toggle-stealth') toggleStealth()
  else {
    nextTick(() => {
      if (activeBook.value) ensureFishWindow()
    })
  }
}

function handleFishCommand(command: FishCommand) {
  if (typeof command !== 'string') {
    if (command?.type === 'resize-preview' && typeof command.width === 'number' && typeof command.height === 'number') {
      previewFishWindowSize(command.width, command.height)
    }
    if (command?.type === 'resize' && typeof command.width === 'number' && typeof command.height === 'number') {
      resizeFishWindow(command.width, command.height)
    }
    if (command?.type === 'move-preview' && typeof command.x === 'number' && typeof command.y === 'number') {
      previewFishWindowPosition(command.x, command.y)
    }
    if (command?.type === 'move' && typeof command.x === 'number' && typeof command.y === 'number') {
      moveFishWindow(command.x, command.y)
    }
    return
  }

  if (command === 'prev') void prevPage()
  else if (command === 'next') void nextPage()
  else if (command === 'focus') focusFishKeyboard()
  else if (command === 'blur') blurFishKeyboard()
  else if (command === 'hide') hideFishWindow()
  else if (command === 'close') closePlugin()
  else if (command === 'auto') toggleAutoPaging()
}

watch(
  settings,
  () => persistSettings(),
  { deep: true }
)

watch(
  () => [isAutoPaging.value, settings.autoSeconds, activeBookId.value, isReaderHidden.value],
  () => {
    window.clearInterval(autoTimer)
    if (!isAutoPaging.value || !activeBook.value || isReaderHidden.value) return

    autoTimer = window.setInterval(() => {
      void (async () => {
        if (isAutoPageTickRunning) return
        isAutoPageTickRunning = true
        try {
          const wasAtEnd = currentPage.value >= pageCount.value - 1
          const advanced = await nextPage()
          if (wasAtEnd && !advanced) isAutoPaging.value = false
        } finally {
          isAutoPageTickRunning = false
        }
      })()
    }, Math.max(3, settings.autoSeconds) * 1000)
  },
  { immediate: true }
)

watch(
  () => activeBookId.value,
  (id) => storage.set(LAST_BOOK_KEY, id)
)

watch(
  () => [
    activeBookId.value,
    currentIndex.value,
    currentPage.value,
    isReaderHidden.value,
    settings.fishSkin,
    settings.fishBackgrounds.statusbar,
    settings.fishBackgrounds.code,
    settings.fishBackgrounds.terminal,
    settings.fontSize,
    settings.lineHeight,
    settings.fishWidth,
    settings.fishHeight,
    settings.fishX,
    settings.fishY,
    settings.letterSpacing,
    settings.opacity,
    settings.prevPageKey,
    settings.nextPageKey,
    settings.showFishPrefix,
    settings.showFishMeta,
    settings.hideOnMouseLeave,
    settings.wheelTurnPage,
    settings.stealth
  ],
  () => {
    nextTick(() => {
      if (activeBook.value) {
        ensureFishWindow()
      } else {
        pushFishState()
      }
    })
  },
  { immediate: true }
)

onMounted(() => {
  loadState()
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('click', closeContextMenu)

  window.ztools?.onPluginEnter?.((action) => {
    handlePluginCommand(action)
    nextTick(() => {
      syncPluginWindowSize()
    })
  })

  window.ztools?.onPluginOut?.((processExit) => {
    if (processExit) fishWindow?.close?.()
  })

  nextTick(syncPluginWindowSize)
  offFishCommand = window.services?.onFishCommand?.(handleFishCommand)
  nextTick(() => {
    if (activeBook.value) ensureFishWindow()
  })
})

onBeforeUnmount(() => {
  window.clearInterval(autoTimer)
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('click', closeContextMenu)
  offFishCommand?.()
  fishWindow?.close?.()
  onlineVerificationWindow?.close?.()
})
</script>

<template>
  <main
    class="app-shell"
    :class="[`theme-${settings.theme}`, { stealth: settings.stealth, concealed: isReaderHidden }]"
    :style="readerStyle"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <input ref="fileInputRef" class="hidden-input" type="file" accept=".txt,.md,text/plain,text/markdown" @change="handleBrowserFile" />

    <div v-if="isDragging" class="drop-layer">
      <Upload :size="34" />
      <span>释放文件</span>
    </div>

    <section class="topbar">
      <div class="brand">
        <span class="brand-mark"><BookOpen :size="18" /></span>
        <div>
          <strong>{{ shellTitle }}</strong>
          <small>{{ shellSubtitle }}</small>
        </div>
      </div>

      <div class="command-strip">
        <button class="icon-button" title="书架" :class="{ active: activePanel === 'library' }" @click="revealPanel('library')">
          <Library :size="18" />
        </button>
        <button class="icon-button" title="找书" :class="{ active: activePanel === 'online' }" @click="revealPanel('online')">
          <Search :size="18" />
        </button>
        <button class="icon-button" title="书源设置" :class="{ active: activePanel === 'sources' }" @click="revealPanel('sources')">
          <FileText :size="18" />
        </button>
        <button class="icon-button" title="设置" :class="{ active: activePanel === 'settings' }" @click="revealPanel('settings')">
          <Settings :size="18" />
        </button>
        <button class="icon-button" title="导入" @click="openImportDialog">
          <Upload :size="18" />
        </button>
        <button class="icon-button" :title="isAutoPaging ? '暂停自动翻页' : '自动翻页'" :disabled="!activeBook" @click="toggleAutoPaging">
          <Pause v-if="isAutoPaging" :size="18" />
          <Play v-else :size="18" />
        </button>
      </div>
    </section>

    <section class="workspace">
      <aside class="side-panel">
        <template v-if="activePanel === 'library'">
          <div class="panel-head">
            <span><Library :size="16" /> 书架</span>
            <div class="panel-actions">
              <button class="text-button" @click="activePanel = 'online'"><Search :size="15" /> 找书</button>
              <button class="text-button" @click="openImportDialog"><FolderOpen :size="15" /> 导入</button>
            </div>
          </div>

          <p v-if="importError" class="error-line">{{ importError }}</p>

          <div v-if="!books.length" class="empty-state">
            <div class="empty-decor">
              <div class="empty-glow"></div>
              <BookOpen :size="48" class="empty-icon" />
            </div>
            <strong>书架空空如也</strong>
            <p>“书籍是人类进步的阶梯，也是绝佳的摸鱼道具。”</p>
            <div class="empty-actions">
              <button class="primary-button import-glow" @click="activePanel = 'online'"><Search :size="16" /> 在线找书</button>
              <button class="text-button" @click="openImportDialog"><Upload :size="16" /> 导入本地</button>
            </div>
          </div>

          <div v-else class="book-sections">
            <section v-for="section in bookSections" :key="section.key" class="book-section">
              <div class="book-section-head">
                <strong>{{ section.title }}</strong>
                <small>{{ section.books.length }} 本</small>
              </div>
              <div class="book-list">
                <article
                  v-for="book in section.books"
                  :key="book.id"
                  class="book-card"
                  :class="[{ active: book.id === activeBookId, online: book.kind === 'online' }, getBookColorClass(book.title)]"
                  @click="selectBook(book.id)"
                  @contextmenu.prevent="openContextMenu(book, $event)"
                >
                  <div class="book-cover-container">
                    <div class="book-pages-stack"></div>
                    <div class="book-cover">
                      <div class="book-spine"></div>
                      <div class="book-cover-glare"></div>
                      <div class="book-cover-title">
                        <span class="book-cover-text-vertical">{{ book.title.slice(0, 4) }}</span>
                      </div>
                      <div class="book-ribbon" :style="{ height: `${Math.max(15, Math.min(45, getBookProgressPercent(book)))}px` }"></div>
                    </div>
                  </div>
                  <div class="book-meta">
                    <div class="book-title-row">
                      <strong class="book-title-text">{{ book.title }}</strong>
                      <span class="book-kind-badge">{{ book.kind === 'online' ? '在线' : '本地' }}</span>
                    </div>
                    <small class="book-info-text">{{ getBookInfoText(book) }}</small>
                    <small v-if="book.online?.latestChapter" class="book-extra-text">{{ book.online.latestChapter }}</small>
                    <div class="progress-track">
                      <span :style="{ width: `${getBookProgressPercent(book)}%` }"></span>
                    </div>
                  </div>
                  <button class="mini-icon card-more-btn" title="更多" @click.stop="openContextMenu(book, $event)">
                    <MoreVertical :size="16" />
                  </button>
                </article>
              </div>
            </section>
          </div>
        </template>

        <template v-if="activePanel === 'online'">
          <div class="panel-head">
            <span><Search :size="16" /> 找书</span>
            <div class="panel-actions">
              <button class="text-button" @click="activePanel = 'sources'"><FileText :size="15" /> 书源设置</button>
              <button class="icon-button small" @click="activePanel = 'library'"><X :size="16" /></button>
            </div>
          </div>

          <div class="online-panel">
            <section class="online-search-pane">
              <div class="settings-section-head">
                <strong>在线搜索</strong>
                <small>{{ enabledBookSources.length }} 个书源 · {{ onlineSearchResults.length }} 条结果</small>
              </div>
              <div v-if="!enabledBookSources.length" class="online-search-empty">
                <strong>还没有可用书源</strong>
                <button class="primary-button" @click="activePanel = 'sources'"><FileText :size="15" /> 添加书源</button>
              </div>
              <div class="search-box online-search-box">
                <input v-model.trim="onlineKeyword" placeholder="书名或作者" @keydown.enter="searchOnlineBooks" />
                <button class="primary-button" :disabled="isOnlineSearching" @click="searchOnlineBooks">
                  {{ isOnlineSearching ? '搜索中' : '搜书' }}
                </button>
              </div>
              <p v-if="onlineSearchError" class="error-line">{{ onlineSearchError }}</p>
              <p v-if="onlineImportStatus" class="status-line">{{ onlineImportStatus }}</p>
              <div v-if="onlineVerification.sourceId && !onlineVerificationItems.length" class="verification-box">
                <div class="verification-copy">
                  <strong><Info :size="15" /> {{ onlineVerification.sourceName }}</strong>
                  <p>{{ onlineVerification.message }}</p>
                </div>
                <div class="verification-actions">
                  <button v-if="onlineVerification.mode !== 'image'" class="text-button" @click="openOnlineVerificationPage">
                    <Eye :size="15" />
                    打开验证页
                  </button>
                  <button
                    class="primary-button"
                    :disabled="isOnlineSearching && !onlineVerification.waiting"
                    @click="handleOnlineVerificationPrimaryAction"
                  >
                    <RotateCcw :size="15" />
                    {{
                      onlineVerification.mode === 'image'
                        ? isOnlineSearching
                          ? '重试中'
                          : '输入验证码'
                        : onlineVerification.waiting
                          ? '验证完成，继续'
                          : isOnlineSearching
                            ? '重试中'
                            : '验证完成，重试搜索'
                    }}
                  </button>
                </div>
              </div>

              <div class="online-result-list">
                <article
                  v-for="item in onlineVerificationItems"
                  :key="`verify:${item.sourceId}`"
                  class="online-result online-result-verification"
                >
                  <div class="online-result-content">
                    <strong>{{ item.sourceName }}</strong>
                    <small>{{ item.mode === 'image' ? '需要输入验证码' : '需要访问验证' }}</small>
                    <p>
                      {{
                        item.mode === 'image'
                          ? '该书源需要验证码，输入后只重试这个书源。'
                          : '该书源需要完成站点验证，其他书源结果不受影响。'
                      }}
                    </p>
                  </div>
                  <div class="online-result-actions">
                    <button
                      v-if="item.mode === 'image'"
                      class="primary-button"
                      :disabled="isOnlineSearching"
                      @click="retryOnlineVerificationItem(item)"
                    >
                      <Info :size="15" />
                      输入验证码
                    </button>
                    <button
                      v-else
                      class="text-button"
                      :disabled="isOnlineSearching"
                      @click="openOnlineVerificationItem(item)"
                    >
                      <Eye :size="15" />
                      打开验证页
                    </button>
                    <button
                      v-if="item.mode !== 'image'"
                      class="text-button"
                      :disabled="isOnlineSearching"
                      @click="retryOnlineVerificationItem(item)"
                    >
                      <RotateCcw :size="15" />
                      重试此源
                    </button>
                  </div>
                </article>
                <article
                  v-for="item in onlineSearchFailures"
                  :key="`failure:${item.sourceId}`"
                  class="online-result online-result-failure"
                >
                  <div class="online-result-content">
                    <strong>{{ item.sourceName }}</strong>
                    <small>搜索失败</small>
                    <p>{{ item.message }}</p>
                  </div>
                  <div class="online-result-actions">
                    <button
                      class="text-button"
                      :disabled="isOnlineSearching"
                      @click="retryOnlineSearchFailureItem(item)"
                    >
                      <RotateCcw :size="15" />
                      重试此源
                    </button>
                  </div>
                </article>
                <article v-for="result in onlineSearchResults" :key="result.key" class="online-result">
                  <div class="online-result-content">
                    <strong>{{ result.title }}</strong>
                    <small>{{ result.author || '佚名' }} · {{ result.sourceName }}</small>
                    <p v-if="result.intro">{{ result.intro }}</p>
                    <em v-if="result.latestChapter">{{ result.latestChapter }}</em>
                  </div>
                  <div class="online-result-actions">
                    <button
                      class="primary-button"
                      :disabled="Boolean(onlineImportingKey)"
                      @click="importOnlineSearchResult(result)"
                    >
                      <Library :size="15" />
                      {{ onlineImportingKey === result.key ? '加入中' : '加入书架' }}
                    </button>
                    <button
                      class="text-button"
                      :disabled="onlineDetailDialog.loading && onlineDetailDialog.result?.key === result.key"
                      @click="openOnlineBookDetail(result)"
                    >
                      <Info :size="15" />
                      {{ onlineDetailDialog.loading && onlineDetailDialog.result?.key === result.key ? '读取中' : '详情' }}
                    </button>
                  </div>
                </article>
                <p v-if="!onlineSearchResults.length && !onlineSearchError && !isOnlineSearching" class="online-result-empty">
                  {{ onlineKeyword ? '暂无搜索结果' : '输入书名或作者开始搜索' }}
                </p>
              </div>
            </section>
          </div>
        </template>

        <template v-if="activePanel === 'sources'">
          <div class="panel-head">
            <span><FileText :size="16" /> 书源设置</span>
            <div class="panel-actions">
              <button class="text-button" @click="activePanel = 'online'"><Search :size="15" /> 找书</button>
              <button class="icon-button small" @click="activePanel = 'library'"><X :size="16" /></button>
            </div>
          </div>

          <div class="source-settings-panel">
            <section class="source-editor">
              <div class="settings-section-head">
                <strong>书源</strong>
                <small>{{ enabledBookSources.length }}/{{ bookSources.length }} 启用</small>
              </div>
              <div class="source-url-box">
                <button
                  class="text-button"
                  :disabled="isClipboardImporting || isSourceUrlImporting"
                  @click="importSourceFromClipboard"
                >
                  <ClipboardPaste :size="15" />
                  {{ isClipboardImporting ? '读取中' : '剪切板导入' }}
                </button>
                <input
                  v-model.trim="sourceUrlText"
                  type="url"
                  placeholder="输入书源 URL"
                  @keydown.enter="importSourceUrl"
                />
                <button class="primary-button" :disabled="isSourceUrlImporting" @click="importSourceUrl">
                  <Upload :size="15" />
                  {{ isSourceUrlImporting ? '导入中' : '导入链接' }}
                </button>
                <button class="text-button" @click="openSourceJsonImportDialog">
                  <FileText :size="15" />
                  JSON 导入
                </button>
              </div>
              <div v-if="sourceMessage && !isSourceJsonDialogOpen" class="source-toolbar">
                <span class="source-message">{{ sourceMessage }}</span>
              </div>
              <div v-if="bookSources.length" class="source-list">
                <div v-for="source in bookSources" :key="source.id" class="source-row">
                  <button
                    class="source-toggle"
                    :class="{ active: source.enabled }"
                    type="button"
                    @click="toggleBookSource(source.id)"
                  >
                    {{ source.enabled ? '启用' : '停用' }}
                  </button>
                  <span>{{ source.name }}</span>
                  <button class="mini-icon" title="删除书源" @click="removeBookSource(source.id)">
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </section>
          </div>
        </template>

        <template v-if="activePanel === 'settings'">
          <div class="panel-head">
            <span><SlidersHorizontal :size="16" /> 设置</span>
            <button class="icon-button small" @click="activePanel = 'library'"><X :size="16" /></button>
          </div>

          <div class="settings-stack">
            <section class="settings-section">
              <div class="settings-section-head">
                <strong>外观</strong>
              </div>
              <div class="segmented-control four">
                <button :class="{ active: settings.theme === 'work' }" @click="settings.theme = 'work'">工作台</button>
                <button :class="{ active: settings.theme === 'paper' }" @click="settings.theme = 'paper'">纸张</button>
                <button :class="{ active: settings.theme === 'night' }" @click="settings.theme = 'night'">夜间</button>
                <button :class="{ active: settings.theme === 'transparent' }" @click="settings.theme = 'transparent'">透明</button>
              </div>
              <label class="switch-row">
                <span>低调外观（伪装标题）</span>
                <input v-model="settings.stealth" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
            </section>

            <section class="settings-section">
              <div class="settings-section-head">
                <strong>阅读</strong>
              </div>
              <label class="range-row">
                <span>字号</span>
                <input v-model.number="settings.fontSize" type="range" min="10" max="20" />
                <output>{{ settings.fontSize }}</output>
              </label>
              <label class="range-row">
                <span>行距</span>
                <input v-model.number="settings.lineHeight" type="range" min="1.05" max="1.8" step="0.05" />
                <output>{{ settings.lineHeight.toFixed(2) }}</output>
              </label>
            </section>

            <section class="settings-section">
              <div class="settings-section-head">
                <strong>底栏</strong>
                <button class="reset-button" type="button" @click="resetFishBackgrounds">
                  <RotateCcw :size="13" /> 重置
                </button>
              </div>
              <div class="segmented-control">
                <button :class="{ active: settings.fishSkin === 'code' }" @click="settings.fishSkin = 'code'">代码</button>
                <button :class="{ active: settings.fishSkin === 'statusbar' }" @click="settings.fishSkin = 'statusbar'">状态栏</button>
                <button :class="{ active: settings.fishSkin === 'terminal' }" @click="settings.fishSkin = 'terminal'">终端</button>
              </div>
              <label class="color-row">
                <span>状态栏背景</span>
                <input v-model="settings.fishBackgrounds.statusbar" type="color" />
                <output>{{ settings.fishBackgrounds.statusbar }}</output>
              </label>
              <label class="color-row">
                <span>代码背景</span>
                <input v-model="settings.fishBackgrounds.code" type="color" />
                <output>{{ settings.fishBackgrounds.code }}</output>
              </label>
              <label class="color-row">
                <span>终端背景</span>
                <input v-model="settings.fishBackgrounds.terminal" type="color" />
                <output>{{ settings.fishBackgrounds.terminal }}</output>
              </label>
              <label class="range-row">
                <span>宽度</span>
                <input v-model.number="settings.fishWidth" type="range" min="280" max="1180" step="10" />
                <output>{{ settings.fishWidth }}</output>
              </label>
              <label class="range-row">
                <span>高度</span>
                <input v-model.number="settings.fishHeight" type="range" min="22" max="160" step="2" />
                <output>{{ settings.fishHeight }}</output>
              </label>
              <label class="range-row">
                <span>字距</span>
                <input v-model.number="settings.letterSpacing" type="range" min="0" max="3" step="0.1" />
                <output>{{ settings.letterSpacing.toFixed(1) }}</output>
              </label>
              <label class="range-row">
                <span>窗口透明度</span>
                <input v-model.number="settings.opacity" type="range" min="0" max="100" />
                <output>{{ settings.opacity }}%</output>
              </label>
              <label class="switch-row">
                <span>显示左侧标识</span>
                <input v-model="settings.showFishPrefix" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
              <label class="switch-row">
                <span>显示进度角标</span>
                <input v-model="settings.showFishMeta" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
            </section>

            <section class="settings-section">
              <div class="settings-section-head">
                <strong>行为</strong>
              </div>
              <label class="range-row">
                <span>自动翻页</span>
                <input v-model.number="settings.autoSeconds" type="range" min="3" max="60" />
                <output>{{ settings.autoSeconds }}s</output>
              </label>
              <label class="keybind-row">
                <span>上一页</span>
                <button
                  class="keybind-button"
                  :class="{ capturing: keyBindingCapture === 'prev' }"
                  type="button"
                  @click="startPageKeyCapture('prev')"
                  @blur="cancelPageKeyCapture('prev')"
                  @keydown="handlePageKeyButtonKeydown('prev', $event)"
                >
                  {{ keyBindingCapture === 'prev' ? '按键中' : getKeyBindingLabel(settings.prevPageKey) }}
                </button>
              </label>
              <label class="keybind-row">
                <span>下一页</span>
                <button
                  class="keybind-button"
                  :class="{ capturing: keyBindingCapture === 'next' }"
                  type="button"
                  @click="startPageKeyCapture('next')"
                  @blur="cancelPageKeyCapture('next')"
                  @keydown="handlePageKeyButtonKeydown('next', $event)"
                >
                  {{ keyBindingCapture === 'next' ? '按键中' : getKeyBindingLabel(settings.nextPageKey) }}
                </button>
              </label>
              <label class="switch-row">
                <span>鼠标移出隐藏</span>
                <input v-model="settings.hideOnMouseLeave" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
              <label class="switch-row">
                <span>滚轮翻页</span>
                <input v-model="settings.wheelTurnPage" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
            </section>
          </div>
        </template>
      </aside>
    </section>

    <div v-if="contextMenu.show" class="context-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
      <button @click="handleContextAction('read')"><BookOpen :size="15" /> 阅读</button>
      <button @click="handleContextAction('chapters')"><List :size="15" /> 章节跳转</button>
      <button @click="handleContextAction('search')"><Search :size="15" /> 搜索跳转</button>
      <button class="danger" @click="handleContextAction('remove')"><Trash2 :size="15" /> 移除</button>
    </div>

    <div v-if="isSourceJsonDialogOpen" class="detail-backdrop source-json-backdrop" @click.self="closeSourceJsonImportDialog">
      <section class="source-json-dialog" role="dialog" aria-modal="true" aria-labelledby="source-json-title">
        <header class="book-detail-head">
          <span id="source-json-title"><FileText :size="16" /> JSON 导入</span>
          <button class="icon-button small" title="关闭" @click="closeSourceJsonImportDialog"><X :size="16" /></button>
        </header>

        <div class="source-json-body">
          <textarea
            ref="sourceJsonTextareaRef"
            v-model="sourceEditorText"
            spellcheck="false"
            placeholder="粘贴阅读 APP 书源 JSON，可为单个书源对象或书源数组"
          ></textarea>
          <p v-if="sourceMessage" class="source-message">{{ sourceMessage }}</p>
        </div>

        <footer class="book-detail-actions">
          <button class="text-button" @click="closeSourceJsonImportDialog">取消</button>
          <button class="primary-button" @click="saveSourceEditor">
            <Upload :size="15" />
            导入 JSON
          </button>
        </footer>
      </section>
    </div>

    <div v-if="isChapterDialogOpen" class="detail-backdrop chapter-backdrop" @click.self="closeChapterDialog">
      <section class="book-search-dialog chapter-dialog" role="dialog" aria-modal="true" aria-labelledby="chapter-dialog-title">
        <header class="book-detail-head">
          <span id="chapter-dialog-title"><List :size="16" /> 目录</span>
          <button class="icon-button small" title="关闭" @click="closeChapterDialog"><X :size="16" /></button>
        </header>

        <div class="book-search-body chapter-dialog-body">
          <div class="book-search-meta">
            <small>{{ activeBookLabel }}</small>
            <small>{{ chapters.length }} 章</small>
          </div>
          <p class="status-line chapter-status" :class="{ empty: !chapterLoadMessage }">
            {{ chapterLoadMessage || ' ' }}
          </p>
          <div class="chapter-list chapter-dialog-list">
            <button
              v-for="chapter in chapters"
              :key="`${chapter.index}-${chapter.title}`"
              :class="{ active: currentChapter?.index === chapter.index }"
              :disabled="Boolean(loadingChapterKey)"
              @click="jumpToChapter(chapter)"
            >
              <span>{{ chapter.title }}</span>
              <small>{{ getChapterMetaText(chapter) }}</small>
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="isBookSearchDialogOpen" class="detail-backdrop book-search-backdrop" @click.self="closeBookSearchDialog">
      <section class="book-search-dialog" role="dialog" aria-modal="true" aria-labelledby="book-search-title">
        <header class="book-detail-head">
          <span id="book-search-title"><Search :size="16" /> 书内搜索</span>
          <button class="icon-button small" title="关闭" @click="closeBookSearchDialog"><X :size="16" /></button>
        </header>

        <div class="book-search-body">
          <div class="search-box book-search-box">
            <input
              ref="searchInputRef"
              v-model.trim="searchText"
              placeholder="关键字"
              @keydown.enter="jumpToNextSearchMatch"
            />
            <button class="primary-button" :disabled="!searchMatches.length" @click="jumpToNextSearchMatch">跳转</button>
          </div>

          <div class="book-search-meta">
            <small>{{ activeBookLabel }}</small>
            <small>{{ searchMatches.length }} 处</small>
          </div>

          <div class="search-list book-search-list">
            <button v-for="(match, index) in searchMatches" :key="match" @click="jumpToSearchMatch(index)">
              <strong>{{ index + 1 }}</strong>
              <span>{{ activeBook?.content.slice(Math.max(0, match - 16), match + searchText.length + 38) }}</span>
            </button>
            <p v-if="searchText && !searchMatches.length" class="book-detail-empty">没有匹配</p>
          </div>
        </div>
      </section>
    </div>

    <div v-if="onlineCaptchaDialog.open" class="detail-backdrop captcha-backdrop" @click.self="cancelOnlineCaptcha">
      <section class="captcha-dialog" role="dialog" aria-modal="true" aria-labelledby="online-captcha-title">
        <header class="book-detail-head">
          <span id="online-captcha-title"><Info :size="16" /> 验证码</span>
          <button class="icon-button small" title="关闭" @click="cancelOnlineCaptcha"><X :size="16" /></button>
        </header>

        <div class="captcha-body">
          <div class="captcha-meta">
            <strong>{{ onlineCaptchaDialog.sourceName }}</strong>
            <small>{{ onlineCaptchaDialog.loading ? '正在加载' : '请输入图片内容' }}</small>
          </div>

          <div class="captcha-image-box">
            <img v-if="onlineCaptchaDialog.imageUrl" :src="onlineCaptchaDialog.imageUrl" alt="验证码" />
            <span v-else>{{ onlineCaptchaDialog.loading ? '加载中' : '无法显示' }}</span>
          </div>

          <input
            ref="captchaInputRef"
            v-model.trim="onlineCaptchaDialog.code"
            class="captcha-input"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="验证码"
            @keydown.enter="submitOnlineCaptcha"
          />
          <p v-if="onlineCaptchaDialog.error" class="error-line captcha-error">{{ onlineCaptchaDialog.error }}</p>
        </div>

        <footer class="book-detail-actions">
          <button class="text-button" :disabled="onlineCaptchaDialog.loading" @click="reloadOnlineCaptcha">
            <RotateCcw :size="15" />
            换一张
          </button>
          <button class="primary-button" :disabled="onlineCaptchaDialog.loading" @click="submitOnlineCaptcha">提交</button>
        </footer>
      </section>
    </div>

    <div v-if="onlineDetailDialog.open" class="detail-backdrop" @click.self="closeOnlineBookDetail">
      <section class="book-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="online-book-detail-title">
        <header class="book-detail-head">
          <span><Info :size="16" /> 书籍详情</span>
          <button class="icon-button small" title="关闭" @click="closeOnlineBookDetail"><X :size="16" /></button>
        </header>

        <div v-if="onlineDetailBook" class="book-detail-body">
          <div class="book-detail-summary">
            <div class="book-detail-cover">
              <img v-if="onlineDetailBook.coverUrl" :src="onlineDetailBook.coverUrl" :alt="onlineDetailBook.title" />
              <BookOpen v-else :size="34" />
            </div>
            <div class="book-detail-main">
              <h2 id="online-book-detail-title">{{ onlineDetailBook.title }}</h2>
              <p>{{ onlineDetailBook.author || '佚名' }} · {{ onlineDetailBook.sourceName }}</p>
              <span v-if="onlineDetailBook.latestChapter">{{ onlineDetailBook.latestChapter }}</span>
            </div>
          </div>

          <p v-if="onlineDetailDialog.loading" class="status-line detail-status">正在读取详情和目录</p>
          <p v-if="onlineDetailDialog.error" class="error-line detail-error">{{ onlineDetailDialog.error }}</p>

          <section v-if="onlineDetailBook.intro" class="book-detail-section">
            <strong>简介</strong>
            <p>{{ onlineDetailBook.intro }}</p>
          </section>

          <section class="book-detail-section">
            <div class="book-detail-section-head">
              <strong>目录</strong>
              <small>{{ onlineDetailDialog.chapters.length ? `${onlineDetailDialog.chapters.length} 章` : '暂无目录' }}</small>
            </div>
            <ol v-if="onlineDetailChapterPreview.length" class="book-detail-chapters" aria-label="章节目录">
              <li v-for="chapter in onlineDetailChapterPreview" :key="`${chapter.index}-${chapter.url}-${chapter.title}`">
                <span class="book-detail-chapter-index">{{ chapter.index + 1 }}</span>
                <span class="book-detail-chapter-title">{{ chapter.title }}</span>
              </li>
            </ol>
            <p v-else class="book-detail-empty">暂无章节目录</p>
          </section>
        </div>

        <footer class="book-detail-actions">
          <button class="text-button" @click="closeOnlineBookDetail">关闭</button>
          <button class="primary-button" :disabled="!onlineDetailBook || Boolean(onlineImportingKey)" @click="importOnlineDetailBook">
            <Library :size="15" />
            {{ onlineImportingKey === onlineDetailBook?.key ? '加入中' : '加入书架' }}
          </button>
        </footer>
      </section>
    </div>

    <div v-if="isDisclaimerDialogOpen" class="detail-backdrop disclaimer-backdrop">
      <section class="disclaimer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="disclaimer-title">
        <header class="book-detail-head">
          <span id="disclaimer-title"><Info :size="16" /> 使用免责声明</span>
        </header>

        <div class="disclaimer-body">
          <p class="disclaimer-lead">
            DeepRead 深读只提供本地阅读和用户自定义书源解析能力。插件本身不提供、不托管、不上传、不分发任何第三方作品、书籍内容或书源。
          </p>

          <section class="disclaimer-section">
            <strong>你需要确认</strong>
            <ul>
              <li>只导入你拥有合法权利、已获授权，或法律允许使用的本地文件、书源和作品内容。</li>
              <li>自行判断书源、搜索结果、章节内容的来源和版权状态。</li>
              <li>自行承担因导入、搜索、保存、阅读或传播相关内容产生的责任。</li>
            </ul>
          </section>

          <section class="disclaimer-section">
            <strong>请不要这样使用</strong>
            <ul>
              <li>获取、保存、分享或传播未授权的作品内容。</li>
              <li>绕过付费、登录、验证码、访问控制或其他技术保护措施。</li>
              <li>在发现书源或内容可能侵权后继续使用或传播。</li>
            </ul>
          </section>

          <p class="disclaimer-confirm">
            点击“同意并继续使用”即表示你已理解以上内容，并承诺合法、合规使用本插件。
          </p>
        </div>

        <footer class="book-detail-actions">
          <button ref="disclaimerAcceptButtonRef" class="primary-button disclaimer-accept-button" @click="acceptDisclaimer">
            <Info :size="15" />
            同意并继续使用
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>
