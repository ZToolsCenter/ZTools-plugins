import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { removeBookData, loadAllCovers, saveCover, saveCustomCover } from '../utils/db'
import { optimizeCover, isCoverOversized } from '../utils/cover'
import type { BookSource } from '../utils/onlineBook'

export interface Bookmark {
  id: string
  chapterIndex: number
  charIndex: number
  readingPercent: number
  text: string
  createdAt: number
}

export type BookFormat = 'epub' | 'txt' | 'mobi' | 'online'

export interface Book {
  id: string
  title: string
  author: string
  description?: string
  format: BookFormat
  filePath: string
  coverColor?: string
  coverImage?: string
  customCoverImage?: string
  categories?: string[]
  addedAt: number
  updatedAt?: number
  firstReadAt?: number
  lastReadAt?: number
  lastChapter?: number
  lastPage?: number
  progressIndex?: number
  totalChapters?: number
  readingPercent?: number
  readingTimeMs?: number
  readingSpeed?: number
  lastSaveReadChars?: number
  fileModifiedAt?: number | null
  finishedAt?: number
  bookmarks?: Bookmark[]
  // 在线书籍（在线书源 / 开源阅读同步）
  onlineKind?: 'source' | 'legado'
  source?: BookSource
  bookUrl?: string
  bookId?: string
  sourceName?: string
  /** 目录页地址（与详情页不同时有效，Legado 分离设计） */
  tocUrl?: string
  /** 最新章节标题 */
  latestChapterTitle?: string
  /** 字数文本 */
  wordCount?: string
  /** 分类（标签） */
  kind?: string
}

export interface OnlineBookMeta {
  title: string
  author: string
  description?: string
  onlineKind: 'source' | 'legado'
  bookUrl: string
  bookId?: string
  source?: BookSource
  sourceName?: string
  cover?: string
  /** 书架分组（分类），如 Legado 同步的分组映射而来 */
  categories?: string[]
  progress?: number
  chapterProgress?: number
  chapterCount?: number
  updateTime?: number
  tocUrl?: string
  latestChapterTitle?: string
  wordCount?: string
  kind?: string
}

function storageGet(key: string): string | null {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.getItem) {
      const val = zStorage.getItem(key)
      if (val != null) return typeof val === 'string' ? val : JSON.stringify(val)
    }
  } catch { }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.setItem) {
      zStorage.setItem(key, value)
      return
    }
  } catch { }
  try {
    window.localStorage.setItem(key, value)
  } catch { }
}

export const useBookStore = defineStore('books', () => {
  const books = ref<Book[]>([])
  const currentBookId = ref<string | null>(null)
  const sortBy = ref<'addedAt' | 'name' | 'author' | 'lastReadAt'>('addedAt')
  const searchQuery = ref('')
  const activeCategory = ref<string>('全部')

  async function load() {
    try {
      const data = storageGet('hushreader_books')
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          parsed.forEach((b: any) => {
            if (b.category && !b.categories) {
              b.categories = [b.category]
              delete b.category
            }
            if (!Array.isArray(b.categories)) b.categories = []
            delete b.coverImage
            delete b.customCoverImage
          })
          books.value = parsed
          const ids = parsed.map((b: any) => b.id as string).filter(Boolean)
          if (ids.length) {
            const covers = await loadAllCovers(ids)
            for (const book of books.value) {
              const c = covers[book.id]
              if (c?.cover) book.coverImage = c.cover
              if (c?.customCover) book.customCoverImage = c.customCover
            }
          }
        }
      }
      const cur = storageGet('hushreader_current')
      if (cur) currentBookId.value = cur

      await migrateOversizedCovers()
    } catch (e) {
      console.warn('Failed to load books', e)
    }
  }

  /**
   * 一次性迁移：把落库的大幅面高清封面归一化为适合展示的缩略图。
   * 用版本标记保证只在升级后首次启动执行一次，避免每次启动都解码大图。
   */
  async function migrateOversizedCovers() {
    if (storageGet('hushreader_cover_opt_v1')) return
    for (const book of books.value) {
      if (isCoverOversized(book.coverImage)) {
        const next = await optimizeCover(book.coverImage!)
        if (next !== book.coverImage) {
          book.coverImage = next
          saveCover(book.id, next).catch(() => { })
        }
      }
      if (isCoverOversized(book.customCoverImage)) {
        const next = await optimizeCover(book.customCoverImage!)
        if (next !== book.customCoverImage) {
          book.customCoverImage = next
          saveCustomCover(book.id, next).catch(() => { })
        }
      }
    }
    storageSet('hushreader_cover_opt_v1', '1')
  }

  function save() {
    try {
      const stripped = books.value.map(b => {
        const { coverImage, customCoverImage, ...rest } = b
        return rest as any
      })
      storageSet('hushreader_books', JSON.stringify(stripped))
    } catch (e) {
      console.warn('Failed to save books', e)
    }
  }

  function addBook(book: Omit<Book, 'id' | 'addedAt' | 'updatedAt'>) {
    const filePathName = book.filePath.split(/[\\/]/).pop() ?? book.filePath
    if (books.value.some(b => {
      if (b.filePath === book.filePath) return true
      const existingName = b.filePath.split(/[\\/]/).pop() ?? b.filePath
      return existingName === filePathName
    })) return undefined
    const now = Date.now()
    const newBook: Book = {
      ...book,
      id: `book_${now}_${Math.random().toString(36).slice(2)}`,
      addedAt: now,
      updatedAt: now
    }
    books.value.unshift(newBook)
    save()
    return newBook
  }

  function removeBook(id: string) {
    books.value = books.value.filter(b => b.id !== id)
    if (currentBookId.value === id) currentBookId.value = null
    save()
    removeBookData(id).catch(() => { })
  }

  /** 添加在线书籍（在线书源 / 开源阅读同步），按 bookUrl 去重 */
  function addOnlineBook(meta: OnlineBookMeta) {
    if (meta.bookUrl && books.value.some(b => {
      return b.format === 'online' && b.onlineKind === meta.onlineKind && b.bookUrl === meta.bookUrl
    })) return undefined
    const now = Date.now()
    const newBook: Book = {
      id: `book_${now}_${Math.random().toString(36).slice(2)}`,
      title: meta.title || '未命名',
      author: meta.author || '',
      description: meta.description,
      format: 'online',
      filePath: '',
      onlineKind: meta.onlineKind,
      source: meta.source,
      bookUrl: meta.bookUrl,
      bookId: meta.bookId,
      sourceName: meta.sourceName || (meta.onlineKind === 'legado' ? '开源阅读' : ''),
      coverImage: meta.cover,
      categories: meta.categories,
      tocUrl: meta.tocUrl,
      latestChapterTitle: meta.latestChapterTitle,
      wordCount: meta.wordCount,
      kind: meta.kind,
      lastChapter: meta.progress ?? 0,
      progressIndex: meta.chapterProgress ?? 0,
      totalChapters: meta.chapterCount,
      addedAt: now,
      updatedAt: now
    }
    books.value.unshift(newBook)
    save()
    if (meta.cover) saveCover(newBook.id, meta.cover).catch(() => { })
    return newBook
  }

  function updateBook(id: string, updates: Partial<Book>) {
    const idx = books.value.findIndex(b => b.id === id)
    if (idx !== -1) {
      books.value[idx] = { ...books.value[idx], ...updates }
      save()
    }
  }

  function setCurrentBook(id: string | null) {
    currentBookId.value = id
    try {
      storageSet('hushreader_current', id || '')
    } catch { }
  }

  const currentBook = computed(() =>
    books.value.find(b => b.id === currentBookId.value) ?? null
  )

  const categories = computed(() => {
    const cats = new Set<string>()
    books.value.forEach(b => {
      if (b.categories) {
        b.categories.forEach(c => { if (c) cats.add(c) })
      }
    })
    return ['全部', ...Array.from(cats)]
  })

  const filteredBooks = computed(() => {
    let list = [...books.value]
    if (activeCategory.value !== '全部') {
      list = list.filter(b =>
        b.categories?.some(c => c === activeCategory.value) ?? false
      )
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      )
    }
    if (sortBy.value === 'name') {
      list.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy.value === 'author') {
      list.sort((a, b) => (a.author || '').localeCompare(b.author || ''))
    } else if (sortBy.value === 'lastReadAt') {
      list.sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))
    } else {
      list.sort((a, b) => b.addedAt - a.addedAt)
    }
    return list
  })

  return {
    books, currentBookId, currentBook,
    sortBy, searchQuery, activeCategory, filteredBooks, categories,
    load, addBook, addOnlineBook, removeBook, updateBook, setCurrentBook, save
  }
})
