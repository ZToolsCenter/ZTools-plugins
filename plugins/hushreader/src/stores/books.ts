import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { removeBookData, loadAllCovers } from '../utils/db'

export interface Bookmark {
  id: string
  chapterIndex: number
  charIndex: number
  readingPercent: number
  text: string
  createdAt: number
}

export interface Book {
  id: string
  title: string
  author: string
  description?: string
  format: 'epub' | 'txt' | 'mobi'
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
    } catch (e) {
      console.warn('Failed to load books', e)
    }
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
    load, addBook, removeBook, updateBook, setCurrentBook, save
  }
})
