<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBookStore, type Bookmark } from '../../stores/books'
import { useConfigStore } from '../../stores/config'
import { useReaderStore } from '../../stores/reader'
import { parseTxt } from '../../utils/txtParser'
import { parseEpub } from '../../utils/epubParser'
import { parseMobi } from '../../utils/mobiParser'
import { saveCover, loadCover, removeCover, saveCustomCover, loadCustomCover, removeCustomCover, removeBookData, saveChapters, removeChapters } from '../../utils/db'
import SettingsModal from '../Settings/index.vue'
import ContextMenu from './ContextMenu.vue'
import BookCard from './BookCard.vue'
import Toast from './Toast.vue'
import Modal from './Modal.vue'
import BookInfoModal from './BookInfoModal.vue'
import ThemeToggle from './ThemeToggle.vue'

const props = defineProps<{ enterAction?: any }>()

const bookStore = useBookStore()
const configStore = useConfigStore()
const readerStore = useReaderStore()

const openBookAndHushreader = inject<(id: string) => void>('openBookAndHushreader')
const hideHushreaderWindow = inject<() => void>('hideHushreaderWindow')

function handleHideHushreaderWindow() {
  hideHushreaderWindow?.()
  toast('隐阅窗口已关闭', 'success')
}

const showSettings = ref(false)
const isLoading = ref(false)

// Toast
const toastMsg = ref('')
const toastType = ref<'info' | 'error' | 'success'>('info')
let toastTimer = 0
function toast(msg: string, type: 'info' | 'error' | 'success' = 'info') {
  toastMsg.value = msg
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMsg.value = '' }, 3000)
}

// Context menu
const contextMenuBook = ref<string | null>(null)
const contextMenuPos = ref({ x: 0, y: 0 })

function onContextMenu(bookId: string, e: MouseEvent) {
  e.preventDefault()
  contextMenuBook.value = bookId
  const target = (e.currentTarget as HTMLElement)
  const rect = target?.getBoundingClientRect()
  if (rect) {
    contextMenuPos.value = {
      x: rect.right - rect.width / 3,
      y: rect.bottom - rect.height / 3
    }
  } else {
    contextMenuPos.value = { x: e.clientX, y: e.clientY }
  }
}

function closeContextMenu() {
  contextMenuBook.value = null
}

// Chapter list modal
const showChapterList = ref(false)
const chapterListBookId = ref<string | null>(null)
const chapterListLoading = ref(false)
const chapterListItems = ref<{ index: number; title: string }[]>([])
const chapterListCurrentIndex = ref(-1)

async function openChapterList(bookId: string) {
  closeContextMenu()
  chapterListBookId.value = bookId
  chapterListItems.value = []
  chapterListCurrentIndex.value = -1
  showChapterList.value = true
  chapterListLoading.value = true

  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) { chapterListLoading.value = false; return }

  chapterListCurrentIndex.value = book.lastChapter ?? -1

  try {
    if (book.format === 'txt') {
      const text = window.services?.readFile(book.filePath) ?? ''
      const chapters = parseTxt(text, configStore.config.other.chapterRegex || undefined)
      chapterListItems.value = chapters.map(c => ({ index: c.index, title: c.title }))
    } else if (book.format === 'mobi') {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (content) {
        const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
        const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
        const result = await parseMobi(file)
        if (result.error) { toast(`加载章节失败：${result.error}`, 'error'); showChapterList.value = false; return }
        chapterListItems.value = result.chapters.map(c => ({ index: c.index, title: c.title }))
      }
    } else {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (content) {
        const blob = new Blob([content], { type: 'application/epub+zip' })
        const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
        const { chapters } = await parseEpub(file)
        chapterListItems.value = chapters.map(c => ({ index: c.index, title: c.title }))
      }
    }
  } catch (e: any) {
    toast(`加载章节失败：${e.message}`, 'error')
    showChapterList.value = false
  } finally {
    chapterListLoading.value = false
    if (chapterListCurrentIndex.value >= 0) {
      requestAnimationFrame(() => {
        const el = document.querySelector('.chapter-item.current')
        el?.scrollIntoView({ block: 'center', behavior: 'instant' })
      })
    }
  }
}

function jumpToChapter(chapterIndex: number) {
  showChapterList.value = false
  const bookId = chapterListBookId.value
  if (!bookId) return
  bookStore.updateBook(bookId, { lastChapter: chapterIndex, lastPage: 0 })
  openBookAndHushreader?.(bookId)
}

// Bookmark list modal
const showBookmarkList = ref(false)
const bookmarkListBookId = ref<string | null>(null)

function openBookmarkList(bookId: string) {
  closeContextMenu()
  bookmarkListBookId.value = bookId
  showBookmarkList.value = true
}

function getBookmarkList(): Bookmark[] {
  if (!bookmarkListBookId.value) return []
  const book = bookStore.books.find(b => b.id === bookmarkListBookId.value)
  return book?.bookmarks ?? []
}

function formatBookmarkDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatBookmarkText(text: string): string {
  if (text.length <= 50) return text
  return text.slice(0, 50) + '...'
}

function jumpToBookmark(bookmark: Bookmark) {
  const bookId = bookmarkListBookId.value
  if (!bookId) return
  showBookmarkList.value = false
  bookStore.updateBook(bookId, { lastChapter: bookmark.chapterIndex, progressIndex: bookmark.charIndex })
  openBookAndHushreader?.(bookId)
}

function deleteBookmark(bookmarkId: string) {
  if (!bookmarkListBookId.value) return
  const book = bookStore.books.find(b => b.id === bookmarkListBookId.value)
  if (!book?.bookmarks) return
  bookStore.updateBook(bookmarkListBookId.value, {
    bookmarks: book.bookmarks.filter(bm => bm.id !== bookmarkId)
  })
}

// Change file path
const showPathModal = ref(false)
const pathModalBookId = ref<string | null>(null)
const pathModalValue = ref('')

function openPathModal(bookId: string) {
  closeContextMenu()
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return
  pathModalBookId.value = bookId
  pathModalValue.value = book.filePath
  showPathModal.value = true
}

function confirmPath() {
  if (!pathModalBookId.value || !pathModalValue.value.trim()) return
  bookStore.updateBook(pathModalBookId.value, { filePath: pathModalValue.value.trim() })
  showPathModal.value = false
  toast('路径已更新', 'success')
}

function openFileLocation(bookId: string) {
  closeContextMenu()
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return
  try {
    const result = (window as any).ztools?.shellShowItemInFolder?.(book.filePath)
    if (!result) toast('无法打开文件位置', 'error')
  } catch {
    toast('无法打开文件位置', 'error')
  }
}

// Category modal
const showCategoryModal = ref(false)
const categoryModalBookId = ref<string | null>(null)
const categoryModalSelected = ref<string[]>([])
const categoryModalNew = ref('')

function openCategoryModal(bookId: string) {
  closeContextMenu()
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return
  categoryModalBookId.value = bookId
  categoryModalSelected.value = [...(book.categories || [])]
  categoryModalNew.value = ''
  showCategoryModal.value = true
}

function toggleCategorySelection(cat: string) {
  const idx = categoryModalSelected.value.indexOf(cat)
  if (idx > -1) {
    categoryModalSelected.value.splice(idx, 1)
  } else {
    categoryModalSelected.value.push(cat)
  }
}

function confirmCategory() {
  if (!categoryModalBookId.value) return
  const newCats = categoryModalNew.value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
  const finalCats = [...new Set([...categoryModalSelected.value, ...newCats])]
  bookStore.updateBook(categoryModalBookId.value, { categories: finalCats.length > 0 ? finalCats : undefined })
  showCategoryModal.value = false
  toast('分类已更新', 'success')
}

// Edit metadata
const showMetadataModal = ref(false)
const metadataModalBookId = ref<string | null>(null)
const metadataModalTitle = ref('')
const metadataModalAuthor = ref('')

function openMetadataModal(bookId: string) {
  closeContextMenu()
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return
  metadataModalBookId.value = bookId
  metadataModalTitle.value = book.title
  metadataModalAuthor.value = book.author
  showMetadataModal.value = true
}

function confirmMetadata() {
  if (!metadataModalBookId.value) return
  bookStore.updateBook(metadataModalBookId.value, {
    title: metadataModalTitle.value.trim() || '未命名',
    author: metadataModalAuthor.value.trim(),
    updatedAt: Date.now()
  })
  showMetadataModal.value = false
  toast('元数据已更新', 'success')
}

// Custom cover
function openCoverPicker(bookId: string) {
  closeContextMenu()
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result as string
      bookStore.updateBook(bookId, { customCoverImage: data, updatedAt: Date.now() })
      saveCustomCover(bookId, data).catch(() => { })
      toast('封面已更新', 'success')
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

async function repairCover(bookId: string) {
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book || book.format !== 'epub' || configStore.config.other.plainTextCover) {
    bookStore.updateBook(bookId, { coverImage: undefined })
    removeCover(bookId).catch(() => { })
    return
  }
  try {
    const content = window.services?.readFileBinary?.(book.filePath)
    if (!content) {
      bookStore.updateBook(bookId, { coverImage: undefined })
      removeCover(bookId).catch(() => { })
      return
    }
    const blob = new Blob([content], { type: 'application/epub+zip' })
    const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
    const result = await parseEpub(file)
    if (result.coverUrl) {
      bookStore.updateBook(bookId, { coverImage: result.coverUrl })
      saveCover(bookId, result.coverUrl).catch(() => { })
    } else {
      bookStore.updateBook(bookId, { coverImage: undefined })
      removeCover(bookId).catch(() => { })
    }
  } catch {
    bookStore.updateBook(bookId, { coverImage: undefined })
    removeCover(bookId).catch(() => { })
  }
}

async function restoreCover(bookId: string) {
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return

  bookStore.updateBook(bookId, { customCoverImage: undefined })
  await removeCustomCover(bookId)

  if (book.format === 'txt') {
    bookStore.updateBook(bookId, { coverImage: undefined })
    await removeCover(bookId)
    toast('封面已恢复为纯色', 'success')
    return
  }

  if (configStore.config.other.plainTextCover) {
    bookStore.updateBook(bookId, { coverImage: undefined })
    await removeCover(bookId)
    toast('封面已恢复', 'success')
    return
  }

  try {
    const content = window.services?.readFileBinary?.(book.filePath)
    if (!content) {
      bookStore.updateBook(bookId, { coverImage: undefined })
      await removeCover(bookId)
      toast('封面已恢复', 'success')
      return
    }

    let coverImage: string | undefined
    if (book.format === 'epub') {
      const blob = new Blob([content], { type: 'application/epub+zip' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
      const result = await parseEpub(file)
      coverImage = result.coverUrl || undefined
    } else if (book.format === 'mobi') {
      const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
      const result = await parseMobi(file)
      if (!result.error) coverImage = result.coverUrl || undefined
    }

    if (coverImage) {
      bookStore.updateBook(bookId, { coverImage })
      saveCover(bookId, coverImage).catch(() => { })
    } else {
      bookStore.updateBook(bookId, { coverImage: undefined })
      await removeCover(bookId)
    }
    toast('封面已恢复', 'success')
  } catch {
    bookStore.updateBook(bookId, { coverImage: undefined })
    await removeCover(bookId)
    toast('封面已恢复', 'success')
  }
}

function openRestoreCover(bookId: string) {
  closeContextMenu()
  restoreCover(bookId)
}

// Delete modal
const showDeleteModal = ref(false)
const deleteBookId = ref<string | null>(null)

// Book info modal
const showBookInfo = ref(false)
const bookInfoId = ref<string | null>(null)

const bookInfoBook = computed(() => bookStore.books.find(b => b.id === bookInfoId.value))

function openBookInfo(bookId: string) {
  closeContextMenu()
  bookInfoId.value = bookId
  showBookInfo.value = true
}
function onBookInfoSaved(updates: Partial<typeof bookStore.books[0]>) {
  if (!bookInfoId.value) return
  bookStore.updateBook(bookInfoId.value, updates)
  toast('信息已更新', 'success')
}

function openDeleteModal(bookId: string) {
  closeContextMenu()
  deleteBookId.value = bookId
  showDeleteModal.value = true
}

function markUnfinished(bookId: string) {
  closeContextMenu()
  bookStore.updateBook(bookId, { finishedAt: undefined })
  toast('已标记为未读完', 'success')
}

function confirmDelete() {
  if (!deleteBookId.value) return
  bookStore.removeBook(deleteBookId.value)
  showDeleteModal.value = false
  toast('已删除', 'info')
}

// Reload metadata
async function reloadMetadata(bookId: string, silent = false) {
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return

  try {
    let title = book.title
    let author = book.author
    let description = book.description || ''
    let coverImage: string | undefined
    let totalChapters: number | undefined

    if (book.format === 'epub') {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (!content) {
        throw new Error('无法读取文件，请检查文件是否存在或路径是否正确')
      }
      const blob = new Blob([content], { type: 'application/epub+zip' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
      const result = await parseEpub(file)
      title = result.title || title
      author = result.author || author
      description = result.description || description
      totalChapters = result.chapters?.length
      if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
      if (result.chapters?.length) saveChapters(bookId, result.chapters).catch(() => { })
    } else if (book.format === 'mobi') {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (!content) {
        throw new Error('无法读取文件，请检查文件是否存在或路径是否正确')
      }
      const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
      const result = await parseMobi(file)
      if (result.error) { throw new Error(result.error) }
      title = result.title || title
      author = result.author || author
      description = result.description || description
      totalChapters = result.chapters?.length
      if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
      if (result.chapters?.length) saveChapters(bookId, result.chapters).catch(() => { })
    } else {
      const text = window.services?.readFile(book.filePath)
      if (text === undefined || text === null) {
        throw new Error('无法读取文件，请检查文件是否存在或路径是否正确')
      }
      const chapters = parseTxt(text, configStore.config.other.chapterRegex || undefined)
      totalChapters = chapters.length
      if (chapters.length) saveChapters(bookId, chapters).catch(() => { })
    }

    const fileModifiedAt = window.services?.getFileModifiedTime?.(book.filePath)
    const updates: Partial<typeof book> = { title, author, description: description || undefined, totalChapters, fileModifiedAt, customCoverImage: undefined }

    removeCustomCover(bookId).catch(() => { })

    if (coverImage) {
      updates.coverImage = coverImage
      saveCover(bookId, coverImage).catch(() => { })
    } else {
      updates.coverImage = undefined
      removeCover(bookId).catch(() => { })
    }

    bookStore.updateBook(bookId, updates)
    if (!silent) toast(`《${title}》元数据已重载`, 'success')
  } catch (e: any) {
    if (!silent) toast(`重载失败：${e.message}`, 'error')
    throw e
  }
}

function openReloadMetadata(bookId: string) {
  closeContextMenu()
  reloadMetadata(bookId)
}

// Full-text search modal
const showSearchModal = ref(false)
const searchBookId = ref<string | null>(null)
const searchKeyword = ref('')
const searchResults = ref<{ charOffset: number; sentence: string; percent: number }[]>([])
const searchLoading = ref(false)
const searchPage = ref(1)

function openSearchModal(bookId: string) {
  closeContextMenu()
  searchBookId.value = bookId
  searchKeyword.value = ''
  searchResults.value = []
  searchPage.value = 1
  showSearchModal.value = true
}

const SEARCH_PAGE_SIZE = 10

const searchPagedResults = computed(() => {
  const start = (searchPage.value - 1) * SEARCH_PAGE_SIZE
  return searchResults.value.slice(start, start + SEARCH_PAGE_SIZE)
})

const searchTotalPages = computed(() => Math.max(1, Math.ceil(searchResults.value.length / SEARCH_PAGE_SIZE)))

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function highlightKeyword(text: string, keyword: string): string {
  const safeText = escapeHtml(text)
  if (!keyword) return safeText
  const safeKeyword = escapeHtml(keyword)
  const escaped = safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safeText.replace(new RegExp(escaped, 'gi'), '<mark>$&</mark>')
}

function formatSearchResult(sentence: string, keyword: string): string {
  const maxLen = 20
  const idx = sentence.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) return sentence.length <= maxLen ? sentence : sentence.slice(0, maxLen) + '...'
  const minEnd = idx + keyword.length + 5
  const end = Math.max(minEnd, maxLen)
  if (sentence.length <= end) return sentence
  return sentence.slice(0, end) + '...'
}

async function executeSearch() {
  const bookId = searchBookId.value
  const keyword = searchKeyword.value.trim()
  if (!bookId || !keyword) return

  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return

  searchLoading.value = true
  searchResults.value = []
  searchPage.value = 1

  try {
    let fullText = ''

    if (book.format === 'txt') {
      fullText = window.services?.readFile(book.filePath) ?? ''
    } else if (book.format === 'mobi') {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (content) {
        const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
        const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
        const result = await parseMobi(file)
        if (result.error) { toast(`搜索失败：${result.error}`, 'error'); searchLoading.value = false; return }
        fullText = result.chapters.map(c => c.content || '').join('\n')
      }
    } else {
      const content = window.services?.readFileBinary?.(book.filePath)
      if (content) {
        const blob = new Blob([content], { type: 'application/epub+zip' })
        const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
        const { chapters: parsed } = await parseEpub(file)
        fullText = parsed.map(c => c.content || '').join('\n')
      }
    }

    if (!fullText) {
      toast('无法加载书籍内容', 'error')
      searchLoading.value = false
      return
    }

    const totalLen = fullText.length
    const fullTextLower = fullText.toLowerCase()
    const boundaryRe = /[。！？…!?\.\」\』\）\】\」]/
    const sentenceEndRe = /[。！？…!?\.]/
    const kwLower = keyword.toLowerCase()
    const BOUNDARY_WINDOW = 200
    const results: typeof searchResults.value = []
    let pos = 0

    while (pos < fullTextLower.length) {
      const kwIdx = fullTextLower.indexOf(kwLower, pos)
      if (kwIdx === -1) break

      let start = 0
      const windowStart = Math.max(0, kwIdx - BOUNDARY_WINDOW)
      const beforeKw = fullText.slice(windowStart, kwIdx)
      let lastBoundary = -1
      let searchIdx = beforeKw.length
      while (searchIdx >= 0) {
        const ch = beforeKw[searchIdx]
        if (boundaryRe.test(ch)) {
          lastBoundary = windowStart + searchIdx + 1
          break
        }
        searchIdx--
      }
      if (lastBoundary >= 0) {
        start = lastBoundary
        while (start < fullText.length && /[\s\u3000]/.test(fullText[start])) start++
      }
      if (start > kwIdx) start = 0

      const rest = fullText.slice(start)
      const endMatch = sentenceEndRe.exec(rest)
      let sentence: string
      let sentenceEnd: number
      if (endMatch) {
        sentenceEnd = start + endMatch.index + endMatch[0].length
        sentence = fullText.slice(start, sentenceEnd).trim()
      } else {
        sentence = rest.trim().slice(0, 50)
        sentenceEnd = start + rest.trim().slice(0, 50).length
      }

      const alreadyFound = results.some(r => r.charOffset >= start && r.charOffset < sentenceEnd)
      if (!alreadyFound) {
        const percent = totalLen > 0 ? (start / totalLen) * 100 : 0
        results.push({
          charOffset: start,
          sentence,
          percent
        })
      }

      pos = sentenceEnd > start ? sentenceEnd : kwIdx + 1
    }

    searchResults.value = results
  } catch (e: any) {
    toast(`搜索失败：${e.message}`, 'error')
  } finally {
    searchLoading.value = false
  }
}

function jumpToSearchResult(result: { charOffset: number }) {
  const bookId = searchBookId.value
  if (!bookId) return
  const book = bookStore.books.find(b => b.id === bookId)
  if (!book) return

  showSearchModal.value = false

  let chapters: { index: number; content: string }[] = []
  if (book.format === 'txt') {
    const text = window.services?.readFile(book.filePath) ?? ''
    const parsed = parseTxt(text, configStore.config.other.chapterRegex || undefined)
    chapters = parsed.map(c => ({ index: c.index, content: c.content || '' }))
  } else if (book.format === 'mobi') {
    const content = window.services?.readFileBinary?.(book.filePath)
    if (content) {
      const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
      parseMobi(file).then(r => {
        if (!r.error) {
          const chs = r.chapters.map(c => ({ index: c.index, content: c.content || '' }))
          jumpToOffset(bookId, chs, result.charOffset)
        }
      })
      return
    }
  } else {
    const content = window.services?.readFileBinary?.(book.filePath)
    if (content) {
      const blob = new Blob([content], { type: 'application/epub+zip' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
      parseEpub(file).then(({ chapters: parsed }) => {
        const chs = parsed.map(c => ({ index: c.index, content: c.content || '' }))
        jumpToOffset(bookId, chs, result.charOffset)
      })
      return
    }
  }

  jumpToOffset(bookId, chapters, result.charOffset)
}

function jumpToOffset(bookId: string, chapters: { index: number; content: string }[], offset: number) {
  let cumLen = 0
  for (const ch of chapters) {
    const chLen = ch.content.length + 1
    if (cumLen + ch.content.length > offset) {
      const charIndex = offset - cumLen
      bookStore.updateBook(bookId, { lastChapter: ch.index, progressIndex: charIndex })
      openBookAndHushreader?.(bookId)
      return
    }
    cumLen += chLen
  }
  const last = chapters[chapters.length - 1]
  if (last) {
    bookStore.updateBook(bookId, { lastChapter: last.index, progressIndex: 0 })
    openBookAndHushreader?.(bookId)
  }
}

// Batch category modal
const showBatchCategoryModal = ref(false)
const batchCategorySelected = ref<string[]>([])
const batchCategoryNew = ref('')

function openBatchCategory() {
  if (selectedIds.value.size === 0) return
  batchCategorySelected.value = []
  batchCategoryNew.value = ''
  showBatchCategoryModal.value = true
}

function toggleBatchCategorySelection(cat: string) {
  const idx = batchCategorySelected.value.indexOf(cat)
  if (idx > -1) {
    batchCategorySelected.value.splice(idx, 1)
  } else {
    batchCategorySelected.value.push(cat)
  }
}

function confirmBatchCategory() {
  const newCats = batchCategoryNew.value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
  const finalCats = [...new Set([...batchCategorySelected.value, ...newCats])]

  for (const id of selectedIds.value) {
    bookStore.updateBook(id, { categories: finalCats.length > 0 ? finalCats : undefined })
  }

  showBatchCategoryModal.value = false
  toast(`已为 ${selectedIds.value.size} 本书设置分类`, 'success')
  exitSelectionMode()
}

// Multi-select mode
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) selectedIds.value.clear()
  if (selectionMode.value) closeContextMenu()
}

function exitSelectionMode() {
  selectionMode.value = false
  selectedIds.value.clear()
}

function toggleBookSelect(bookId: string) {
  if (selectedIds.value.has(bookId)) {
    selectedIds.value.delete(bookId)
  } else {
    selectedIds.value.add(bookId)
  }
}

function selectAllInCategory() {
  const books = bookStore.filteredBooks
  const allSelected = books.every(b => selectedIds.value.has(b.id))
  if (allSelected) {
    books.forEach(b => selectedIds.value.delete(b.id))
  } else {
    books.forEach(b => selectedIds.value.add(b.id))
  }
}

const selectedCount = computed(() => selectedIds.value.size)

// Batch operations
const showBatchDeleteModal = ref(false)
const batchReloading = ref(false)

function openBatchDelete() {
  if (selectedIds.value.size === 0) return
  showBatchDeleteModal.value = true
}

function confirmBatchDelete() {
  for (const id of selectedIds.value) {
    bookStore.removeBook(id)
  }
  showBatchDeleteModal.value = false
  toast(`已删除 ${selectedIds.value.size} 本书`, 'info')
  exitSelectionMode()
}

async function batchReload() {
  if (selectedIds.value.size === 0) return
  batchReloading.value = true
  let success = 0
  let fail = 0
  for (const id of selectedIds.value) {
    try {
      await reloadMetadata(id, true)
      success++
    } catch {
      fail++
    }
  }
  batchReloading.value = false
  toast(`重载完成：${success} 成功${fail ? `，${fail} 失败` : ''}`, fail ? 'error' : 'success')
  exitSelectionMode()
}

// Import book
async function importBook(filePath: string) {
  if (!filePath) return
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const isEpub = /\.epub$/i.test(name)
  const isTxt = /\.txt$/i.test(name)
  const isMobi = /\.mobi$/i.test(name)
  if (!isEpub && !isTxt && !isMobi) {
    toast('仅支持 EPUB、TXT 和 MOBI 格式', 'error')
    return
  }

  isLoading.value = true
  try {
    let title = name.replace(/\.(epub|txt|mobi)$/i, '')
    let author = ''
    let description = ''
    let coverColor = randomCoverColor()
    let coverImage: string | undefined

    if (isEpub) {
      try {
        const content = window.services?.readFileBinary?.(filePath)
        if (content) {
          const blob = new Blob([content], { type: 'application/epub+zip' })
          const file = new File([blob], name)
          const result = await parseEpub(file)
          title = result.title || title
          author = result.author || ''
          description = result.description || ''
          if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
        }
      } catch { }
    }

    if (isMobi) {
      try {
        const content = window.services?.readFileBinary?.(filePath)
        if (content) {
          const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
          const file = new File([blob], name)
          const result = await parseMobi(file)
          if (result.error) { toast(`MOBI解析失败：${result.error}`, 'error'); return }
          title = result.title || title
          author = result.author || ''
          description = result.description || ''
          if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
        }
      } catch (e: any) {
        toast(`MOBI导入失败：${e.message}`, 'error'); return
      }
    }

    const fileModifiedAt = window.services?.getFileModifiedTime?.(filePath)

    const book = bookStore.addBook({
      title, author, description: description || undefined,
      format: isEpub ? 'epub' : isMobi ? 'mobi' : 'txt',
      filePath,
      coverColor,
      coverImage,
      fileModifiedAt
    })

    if (book) {
      if (coverImage) saveCover(book.id, coverImage).catch(() => { })
      toast(`《${title}》已加入书架`, 'success')
    } else {
      toast('该书籍已在书架中', 'info')
    }
  } catch (error: any) {
    toast(`导入失败: ${error.message || error}`, 'error')
  } finally {
    isLoading.value = false
  }
}

async function importDroppedFile(file: File) {
  const name = file.name
  const isEpub = /\.epub$/i.test(name)
  const isTxt = /\.txt$/i.test(name)
  const isMobi = /\.mobi$/i.test(name)
  if (!isEpub && !isTxt && !isMobi) {
    toast('仅支持 EPUB、TXT 和 MOBI 格式', 'error')
    return
  }

  isLoading.value = true
  try {
    let title = name.replace(/\.(epub|txt|mobi)$/i, '')
    let author = ''
    let description = ''
    let coverColor = randomCoverColor()
    let coverImage: string | undefined

    if (isEpub) {
      try {
        const result = await parseEpub(file)
        title = result.title || title
        author = result.author || ''
        description = result.description || ''
        if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
      } catch { }
    }

    if (isMobi) {
      try {
        const result = await parseMobi(file)
        if (result.error) { toast(`MOBI解析失败：${result.error}`, 'error'); return }
        title = result.title || title
        author = result.author || ''
        description = result.description || ''
        if (result.coverUrl && !configStore.config.other.plainTextCover) coverImage = result.coverUrl
      } catch (e: any) {
        toast(`MOBI导入失败：${e.message}`, 'error'); return
      }
    }

    const book = bookStore.addBook({
      title, author, description: description || undefined,
      format: isEpub ? 'epub' : isMobi ? 'mobi' : 'txt',
      filePath: (file as any).path || name,
      coverColor,
      coverImage
    })

    if (book) {
      if (coverImage) saveCover(book.id, coverImage).catch(() => { })
      toast(`《${title}》已加入书架`, 'success')
    } else {
      toast('该书籍已在书架中', 'info')
    }
  } catch (error: any) {
    toast(`导入失败: ${error.message || error}`, 'error')
  } finally {
    isLoading.value = false
  }
}

function handleAddBook() {
  const picker = window.ztools?.showOpenDialog({
    title: '选择书籍',
    buttonLabel: '导入',
    filters: [{ name: '书籍文件', extensions: ['epub', 'txt', 'mobi'] }],
    properties: ['openFile']
  })

  if (picker?.[0]) importBook(picker[0])
}

// Handle plugin enter with file import
watch(() => props.enterAction, async (action) => {
  if (action?.code === 'hushreader-import' && action?.type === 'files') {
    const filePath = (action.payload as { path?: string }[] | undefined)?.[0]?.path
    if (filePath) {
      await bookStore.load()
      importBook(filePath)
    }
  }
}, { immediate: true })

// Drag and drop import
const fileHovering = ref(false)
let hoverNestLevel = 0
const showDropConfirmModal = ref(false)
const pendingDropFiles = ref<File[]>([])

function hasFilePayload(ev: DragEvent) {
  return Array.from(ev.dataTransfer?.types ?? []).includes('Files')
}

function markDropCopy(ev: DragEvent) {
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function cursorInsideBounds(ev: DragEvent) {
  const el = ev.currentTarget
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
}

function onDragEnter(ev: DragEvent) {
  if (!hasFilePayload(ev)) return
  hoverNestLevel += 1
  markDropCopy(ev)
  fileHovering.value = true
}

function onDragover(ev: DragEvent) {
  if (!hasFilePayload(ev)) return
  ev.preventDefault()
  markDropCopy(ev)
  fileHovering.value = true
}

function onDragLeave(ev: DragEvent) {
  if (!fileHovering.value) return
  hoverNestLevel = Math.max(0, hoverNestLevel - 1)
  if (hoverNestLevel > 0 && cursorInsideBounds(ev)) return
  hoverNestLevel = 0
  fileHovering.value = false
}

function onDrop(ev: DragEvent) {
  ev.preventDefault()
  hoverNestLevel = 0
  fileHovering.value = false
  const files = ev.dataTransfer?.files
  if (!files?.length) return
  const validExts = /\.(epub|txt|mobi)$/i
  const valid: File[] = []
  for (let i = 0; i < files.length; i++) {
    if (validExts.test(files[i].name)) valid.push(files[i])
  }
  if (!valid.length) {
    toast('仅支持 EPUB、TXT 和 MOBI 格式', 'error')
    return
  }
  pendingDropFiles.value = valid
  showDropConfirmModal.value = true
}

async function confirmDropImport() {
  showDropConfirmModal.value = false
  for (const f of pendingDropFiles.value) {
    await importDroppedFile(f)
  }
  pendingDropFiles.value = []
}

function cancelDropImport() {
  showDropConfirmModal.value = false
  pendingDropFiles.value = []
}

// Close context menu on outside click
function onDocClick(e: MouseEvent) {
  if (contextMenuBook.value) {
    closeContextMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

function randomCoverColor(): string {
  const colors = [
    '#4a7fa5', '#5c7a6e', '#7a5c6e', '#7a6e5c',
    '#5c6e7a', '#6e7a5c', '#7a5c5c', '#5c5c7a'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

async function resolveEpubCovers() {
  if (configStore.config.other.plainTextCover) return
  const epubBooks = bookStore.books.filter(b => b.format === 'epub' && !b.coverImage && !b.customCoverImage)
  for (const book of epubBooks) {
    try {
      const cached = await loadCover(book.id)
      if (cached) {
        book.coverImage = cached
        continue
      }
      const content = window.services?.readFileBinary?.(book.filePath)
      if (!content) continue
      const blob = new Blob([content], { type: 'application/epub+zip' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.epub')
      const result = await parseEpub(file)
      if (result.coverUrl) {
        book.coverImage = result.coverUrl
        saveCover(book.id, result.coverUrl).catch(() => { })
      }
    } catch { }
  }
}

async function resolveMobiCovers() {
  if (configStore.config.other.plainTextCover) return
  const mobiBooks = bookStore.books.filter(b => b.format === 'mobi' && !b.coverImage && !b.customCoverImage)
  for (const book of mobiBooks) {
    try {
      const cached = await loadCover(book.id)
      if (cached) {
        book.coverImage = cached
        continue
      }
      const content = window.services?.readFileBinary?.(book.filePath)
      if (!content) continue
      const blob = new Blob([content], { type: 'application/x-mobipocket-ebook' })
      const file = new File([blob], book.filePath.split(/[\\/]/).pop() ?? 'book.mobi')
      const result = await parseMobi(file)
      if (result.coverUrl) {
        book.coverImage = result.coverUrl
        saveCover(book.id, result.coverUrl).catch(() => { })
      }
    } catch { }
  }
}

watch(() => bookStore.books.length, () => {
  resolveEpubCovers()
  resolveMobiCovers()
}, { immediate: true })

watch(() => configStore.config.other.plainTextCover, async (plain) => {
  if (plain) {
    for (const b of bookStore.books) {
      b.coverImage = undefined
      b.customCoverImage = undefined
    }
    await Promise.allSettled(bookStore.books.flatMap(b => [removeCover(b.id), removeCustomCover(b.id)]))
  } else {
    resolveEpubCovers()
    resolveMobiCovers()
  }
})




const cfg = computed(() => configStore.config)
const statsTotal = computed(() => bookStore.books.length)
const statsRead = computed(() => bookStore.books.filter(b => b.finishedAt).length)
const statsReadingTimeMs = computed(() => bookStore.books.reduce((sum, b) => sum + (b.readingTimeMs || 0), 0))
function formatReadingTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 60) return `${totalMin}分钟`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}小时${m}分` : `${h}小时`
}
</script>

<template>
  <div class="bookshelf" @dragenter="onDragEnter" @dragover="onDragover" @dragleave="onDragLeave" @drop="onDrop">
    <!-- Drop overlay -->
    <div v-if="fileHovering" class="drop-overlay">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span>导入书籍</span>
    </div>
    <!-- Header -->
    <header class="shelf-header">
      <h1 class="shelf-title">书架</h1>
      <div class="shelf-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input v-model="bookStore.searchQuery" class="search-input" placeholder="搜索书名或作者..." />
      </div>
      <div class="shelf-actions">
        <button class="icon-btn" :class="{ active: cfg.other.listMode }" :title="cfg.other.listMode ? '卡片视图' : '列表视图'"
          @click="configStore.config.other.listMode = !configStore.config.other.listMode">
          <svg v-if="cfg.other.listMode" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="5" y2="6" />
            <line x1="3" y1="12" x2="5" y2="12" />
            <line x1="3" y1="18" x2="5" y2="18" />
          </svg>
        </button>
        <button class="icon-btn" :class="{ active: selectionMode }" :title="selectionMode ? '退出多选' : '多选'"
          @click="toggleSelectionMode">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline v-if="selectionMode" points="18 6 6 18" />
            <polyline v-if="selectionMode" points="6 6 18 18" />
            <template v-else>
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </template>
          </svg>
        </button>
        <button class="icon-btn" title="关闭隐阅窗口" @click="handleHideHushreaderWindow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
        <button class="icon-btn" title="设置" @click="showSettings = true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Stats bar -->
    <div class="stats-bar">
      <span class="stats-item"><span class="stats-value">{{ statsTotal }}</span>本书</span>
      <span class="stats-divider"></span>
      <span class="stats-item"><span class="stats-value">{{ statsRead }}</span>本已读</span>
      <span class="stats-divider"></span>
      <span class="stats-item">累计阅读<span class="stats-value">{{ formatReadingTime(statsReadingTimeMs) }}</span></span>
    </div>

    <!-- Category tabs -->
    <div class="category-bar">
      <button v-if="selectionMode" class="category-tab select-all-btn"
        :class="{ active: bookStore.filteredBooks.length > 0 && bookStore.filteredBooks.every(b => selectedIds.has(b.id)) }"
        @click="selectAllInCategory">全选</button>
      <button v-for="cat in bookStore.categories" :key="cat" class="category-tab"
        :class="{ active: bookStore.activeCategory === cat }" @click="bookStore.activeCategory = cat">{{ cat }}</button>
      <div class="sort-group">
        <button class="sort-btn" :class="{ active: bookStore.sortBy === 'lastReadAt' }"
          @click="bookStore.sortBy = 'lastReadAt'">最近阅读</button>
        <button class="sort-btn" :class="{ active: bookStore.sortBy === 'addedAt' }"
          @click="bookStore.sortBy = 'addedAt'">最近添加</button>
        <button class="sort-btn" :class="{ active: bookStore.sortBy === 'name' }"
          @click="bookStore.sortBy = 'name'">名称</button>
        <button class="sort-btn" :class="{ active: bookStore.sortBy === 'author' }"
          @click="bookStore.sortBy = 'author'">作者</button>
      </div>
    </div>

    <!-- Book grid -->
    <main class="shelf-grid" :class="{ 'list-mode': cfg.other.listMode }">
      <!-- Add book card -->
      <div class="add-book-card" @click="handleAddBook" :class="{ loading: isLoading }">
        <div class="add-icon">
          <svg v-if="!isLoading" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <div v-else class="spinner"></div>
        </div>
        <span class="add-label">添加本地书籍</span>
        <span class="add-sub">支持 EPUB / TXT / MOBI</span>
      </div>

      <!-- Book cards -->
      <BookCard v-for="book in bookStore.filteredBooks" :key="book.id" :book="book" :list-mode="cfg.other.listMode"
        :selection-mode="selectionMode" :selected="selectedIds.has(book.id)"
        @click="!selectionMode && openBookAndHushreader?.(book.id)" @toggle-select="toggleBookSelect(book.id)"
        @contextmenu.prevent="onContextMenu(book.id, $event)" @cover-error="repairCover(book.id)" />
    </main>

    <!-- Empty state -->
    <div v-if="bookStore.filteredBooks.length === 0 && !isLoading" class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      <p>{{ bookStore.searchQuery ? '未找到匹配的书籍' : '书架空空如也，添加一本书开始阅读吧' }}</p>
    </div>

    <!-- Context Menu -->
    <ContextMenu v-if="contextMenuBook" :pos="contextMenuPos"
      :is-finished="!!bookStore.books.find(b => b.id === contextMenuBook)?.finishedAt"
      @book-info="openBookInfo(contextMenuBook!)" @chapter-list="openChapterList(contextMenuBook!)"
      @bookmark-list="openBookmarkList(contextMenuBook!)" @search-jump="openSearchModal(contextMenuBook!)"
      @change-path="openPathModal(contextMenuBook!)" @open-file-location="openFileLocation(contextMenuBook!)"
      @edit-metadata="openMetadataModal(contextMenuBook!)" @reload-metadata="openReloadMetadata(contextMenuBook!)"
      @set-category="openCategoryModal(contextMenuBook!)" @set-cover="openCoverPicker(contextMenuBook!)"
      @restore-cover="openRestoreCover(contextMenuBook!)" @mark-unfinished="markUnfinished(contextMenuBook!)"
      @delete="openDeleteModal(contextMenuBook!)" @close="closeContextMenu" />

    <!-- Settings Modal -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />

    <!-- Chapter List Modal -->
    <Modal v-if="showChapterList" title="章节列表" @close="showChapterList = false">
      <div class="chapter-list">
        <div v-if="chapterListLoading" class="modal-loading">
          <div class="spinner"></div>
          <span>正在解析章节...</span>
        </div>
        <div v-else class="chapter-items">
          <button v-for="ch in chapterListItems" :key="ch.index" class="chapter-item"
            :class="{ current: ch.index === chapterListCurrentIndex }" @click="jumpToChapter(ch.index)">
            <span class="ch-index">{{ ch.index + 1 }}</span>
            <span class="ch-title">{{ ch.title }}</span>
          </button>
        </div>
      </div>
    </Modal>

    <!-- Bookmark List Modal -->
    <Modal v-if="showBookmarkList" title="书签列表" @close="showBookmarkList = false">
      <div class="bookmark-list">
        <div v-if="getBookmarkList().length === 0" class="bookmark-empty">暂无书签</div>
        <div v-else class="bookmark-items">
          <div v-for="bm in getBookmarkList()" :key="bm.id" class="bookmark-item" @dblclick="jumpToBookmark(bm)">
            <div class="bookmark-info">
              <span class="bookmark-date">{{ formatBookmarkDate(bm.createdAt) }}</span>
              <span class="bookmark-percent">{{ bm.readingPercent.toFixed(1) }}%</span>
            </div>
            <div class="bookmark-text">{{ formatBookmarkText(bm.text) }}</div>
            <button class="bookmark-delete" @click.stop="deleteBookmark(bm.id)" title="删除书签">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <p class="bookmark-hint">双击书签跳转到对应位置</p>
      </div>
    </Modal>

    <!-- Search Jump Modal -->
    <Modal v-if="showSearchModal" title="搜索跳转" @close="showSearchModal = false">
      <div class="search-modal">
        <div class="search-bar">
          <input v-model="searchKeyword" class="form-input search-input-modal" placeholder="输入搜索关键词..."
            @keydown.enter="executeSearch" />
          <button class="btn-primary" :disabled="!searchKeyword.trim() || searchLoading" @click="executeSearch">
            <span v-if="searchLoading" class="spinner"
              style="width:14px;height:14px;border-width:1.5px;margin-right:4px"></span>
            搜索
          </button>
        </div>
        <div v-if="searchResults.length > 0" class="search-meta">
          共 {{ searchResults.length }} 条结果，第 {{ searchPage }}/{{ searchTotalPages }} 页
        </div>
        <div v-if="searchResults.length > 0" class="search-results">
          <div v-for="(r, i) in searchPagedResults" :key="i" class="search-result-item"
            @dblclick="jumpToSearchResult(r)">
            <div class="search-result-info">
              <span class="search-result-percent">{{ r.percent.toFixed(1) }}%</span>
            </div>
            <div class="search-result-text"
              v-html="highlightKeyword(formatSearchResult(r.sentence, searchKeyword), searchKeyword)"></div>
          </div>
        </div>
        <div v-if="searchResults.length === 0 && !searchLoading && searchKeyword.trim()" class="search-empty">
          暂无结果
        </div>
        <div v-if="searchResults.length > SEARCH_PAGE_SIZE" class="search-pagination">
          <button class="btn-secondary" :disabled="searchPage <= 1" @click="searchPage--">上一页</button>
          <span class="search-page-info">{{ searchPage }} / {{ searchTotalPages }}</span>
          <button class="btn-secondary" :disabled="searchPage >= searchTotalPages" @click="searchPage++">下一页</button>
        </div>
        <p class="bookmark-hint">双击结果跳转到对应位置</p>
      </div>
    </Modal>

    <!-- Path Modal -->
    <Modal v-if="showPathModal" title="修改本地路径" @close="showPathModal = false">
      <div class="form-modal">
        <label class="form-label">文件路径</label>
        <input v-model="pathModalValue" class="form-input" placeholder="/path/to/book.epub" />
        <div class="form-actions">
          <button class="btn-secondary" @click="showPathModal = false">取消</button>
          <button class="btn-primary" @click="confirmPath">确认</button>
        </div>
      </div>
    </Modal>

    <!-- Category Modal -->
    <Modal v-if="showCategoryModal" title="设置分类" @close="showCategoryModal = false">
      <div class="form-modal">
        <label class="form-label">已有分类（多选）</label>
        <div v-if="bookStore.categories.length > 1" class="category-tags">
          <button v-for="cat in bookStore.categories.filter(c => c !== '全部')" :key="cat" class="category-tag"
            :class="{ active: categoryModalSelected.includes(cat) }" @click="toggleCategorySelection(cat)">
            {{ cat }}
          </button>
        </div>
        <p v-else class="form-hint">暂无其他分类</p>
        <label class="form-label" style="margin-top: 12px">新建分类</label>
        <input v-model="categoryModalNew" class="form-input" placeholder="输入新分类名称，多个用逗号分隔..." />
        <p class="form-hint">留空则不添加新分类</p>
        <div class="form-actions">
          <button class="btn-secondary" @click="showCategoryModal = false">取消</button>
          <button class="btn-primary" @click="confirmCategory">确认</button>
        </div>
      </div>
    </Modal>

    <!-- Metadata Modal -->
    <Modal v-if="showMetadataModal" title="编辑元数据" @close="showMetadataModal = false">
      <div class="form-modal">
        <label class="form-label">书籍标题</label>
        <input v-model="metadataModalTitle" class="form-input" placeholder="输入书籍标题..." />
        <label class="form-label" style="margin-top: 12px">作者</label>
        <input v-model="metadataModalAuthor" class="form-input" placeholder="输入作者名称..." />
        <div class="form-actions">
          <button class="btn-secondary" @click="showMetadataModal = false">取消</button>
          <button class="btn-primary" @click="confirmMetadata">保存</button>
        </div>
      </div>
    </Modal>

    <!-- Delete Confirm Modal -->
    <Modal v-if="showDeleteModal" title="删除书籍" @close="showDeleteModal = false">
      <div class="form-modal">
        <p style="margin: 0 0 16px; color: var(--c-ink)">确定从书架中删除这本书吗？本地文件不会被删除。</p>
        <div class="form-actions">
          <button class="btn-secondary" @click="showDeleteModal = false">取消</button>
          <button class="btn-danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </Modal>

    <!-- Drop Confirm Modal -->
    <Modal v-if="showDropConfirmModal" title="导入书籍" @close="cancelDropImport">
      <div class="form-modal">
        <p style="margin: 0 0 8px; color: var(--c-ink)">检测到拖入的书籍文件，是否导入到书架？</p>
        <div class="drop-file-list">
          <div v-for="(f, i) in pendingDropFiles" :key="i" class="drop-file-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>{{ f.name }}</span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-secondary" @click="cancelDropImport">取消</button>
          <button class="btn-primary" @click="confirmDropImport">导入</button>
        </div>
      </div>
    </Modal>

    <!-- Batch action bar -->
    <div v-if="selectionMode" class="batch-bar">
      <span class="batch-info">已选 {{ selectedCount }} 本</span>
      <div class="batch-actions">
        <button class="btn-secondary" :disabled="selectedCount === 0 || batchReloading" @click="batchReload">
          <span v-if="batchReloading" class="spinner"
            style="width:14px;height:14px;border-width:1.5px;margin-right:4px"></span>
          批量重载
        </button>
        <button class="btn-secondary" :disabled="selectedCount === 0" @click="openBatchCategory">批量设置分类</button>
        <button class="btn-danger" :disabled="selectedCount === 0" @click="openBatchDelete">批量删除</button>
        <button class="btn-ghost" @click="exitSelectionMode">取消</button>
      </div>
    </div>

    <!-- Batch Delete Confirm Modal -->
    <Modal v-if="showBatchDeleteModal" title="批量删除" @close="showBatchDeleteModal = false">
      <div class="form-modal">
        <p style="margin: 0 0 16px; color: var(--c-ink)">确定从书架中删除选中的 {{ selectedCount }} 本书吗？本地文件不会被删除。</p>
        <div class="form-actions">
          <button class="btn-secondary" @click="showBatchDeleteModal = false">取消</button>
          <button class="btn-danger" @click="confirmBatchDelete">删除</button>
        </div>
      </div>
    </Modal>

    <!-- Batch Category Modal -->
    <Modal v-if="showBatchCategoryModal" title="批量设置分类" @close="showBatchCategoryModal = false">
      <div class="form-modal">
        <p class="form-hint" style="margin: 0 0 8px">将为选中的 {{ selectedCount }} 本书统一设置以下分类（覆盖原有分类）</p>
        <label class="form-label">已有分类（多选）</label>
        <div v-if="bookStore.categories.length > 1" class="category-tags">
          <button v-for="cat in bookStore.categories.filter(c => c !== '全部')" :key="cat" class="category-tag"
            :class="{ active: batchCategorySelected.includes(cat) }" @click="toggleBatchCategorySelection(cat)">
            {{ cat }}
          </button>
        </div>
        <p v-else class="form-hint">暂无其他分类</p>
        <label class="form-label" style="margin-top: 12px">新建分类</label>
        <input v-model="batchCategoryNew" class="form-input" placeholder="输入新分类名称，多个用逗号分隔..." />
        <p class="form-hint">留空则不添加新分类</p>
        <div class="form-actions">
          <button class="btn-secondary" @click="showBatchCategoryModal = false">取消</button>
          <button class="btn-primary" @click="confirmBatchCategory">确认</button>
        </div>
      </div>
    </Modal>

    <!-- Book Info Modal -->
    <BookInfoModal v-if="showBookInfo && bookInfoBook" :book="bookInfoBook" @close="showBookInfo = false"
      @saved="onBookInfoSaved" />

    <!-- Toast -->
    <Toast :message="toastMsg" :type="toastType" />

    <!-- Theme Toggle -->
    <div class="theme-toggle-fab">
      <ThemeToggle />
    </div>
  </div>
</template>

<style scoped>
.bookshelf {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--c-surface);
  color: var(--c-ink);
  overflow: hidden;
  position: relative;
}

.drop-overlay {
  position: absolute;
  inset: 10px;
  z-index: 20;
  pointer-events: none;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border: 1px dashed var(--c-accent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--c-surface) 86%, transparent);
  color: var(--c-accent);
  font-weight: 800;
  font-size: 14px;
  backdrop-filter: blur(18px);
}

.shelf-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px 12px;
  flex-shrink: 0;
}

.shelf-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
  color: var(--c-ink);
}

.shelf-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  color: var(--c-ink-tertiary);
  min-width: 0;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.shelf-search:focus-within {
  border-color: var(--c-accent-muted);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--c-ink);
  font-size: 13px;
  min-width: 0;
}

.search-input::placeholder {
  color: var(--c-ink-tertiary);
}

.shelf-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 8px;
  font-size: 12px;
  color: var(--c-ink-tertiary);
  flex-shrink: 0;
}

.stats-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.stats-value {
  color: var(--c-ink-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

.stats-divider {
  width: 1px;
  height: 12px;
  background: var(--c-border);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  color: var(--c-ink-secondary);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.icon-btn:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.category-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 20px 10px;
  flex-shrink: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--c-border);
}

.category-bar::-webkit-scrollbar {
  display: none;
}

.category-tab {
  padding: 5px 12px;
  border-radius: var(--radius-full);
  font-size: 13px;
  white-space: nowrap;
  color: var(--c-ink-secondary);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.category-tab:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.category-tab.active {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.sort-group {
  display: flex;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  background: var(--c-surface-sunken);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.sort-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: var(--radius-xs);
  color: var(--c-ink-tertiary);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.sort-btn:hover {
  color: var(--c-ink-secondary);
}

.sort-btn.active {
  background: var(--c-surface);
  color: var(--c-accent);
  box-shadow: var(--shadow-xs);
}

.shelf-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px;
  align-content: start;
}

.shelf-grid.list-mode {
  grid-template-columns: 1fr;
  gap: 4px;
}

.add-book-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 0.68;
  border: 2px dashed var(--c-border-strong);
  border-radius: var(--radius-lg);
  cursor: pointer;
  color: var(--c-ink-tertiary);
  padding: 16px;
  text-align: center;
  transition: border-color 0.2s var(--ease-out), color 0.2s var(--ease-out), background 0.2s var(--ease-out);
}

.shelf-grid.list-mode .add-book-card {
  aspect-ratio: unset;
  flex-direction: row;
  gap: 12px;
  padding: 12px 16px;
  justify-content: flex-start;
  border-radius: var(--radius-md);
}

.add-book-card:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
  background: var(--c-accent-soft);
}

.add-book-card.loading {
  pointer-events: none;
  opacity: 0.5;
}

.add-label {
  font-size: 13px;
  font-weight: 600;
}

.add-sub {
  font-size: 11px;
  opacity: 0.7;
}

.shelf-grid.list-mode .add-sub {
  display: none;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--c-ink-tertiary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-state p {
  font-size: 13px;
  line-height: 1.6;
}

.chapter-list {
  max-height: 360px;
  overflow-y: auto;
}

.modal-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 28px;
  justify-content: center;
  color: var(--c-ink-tertiary);
  font-size: 13px;
}

.chapter-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chapter-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  text-align: left;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--c-ink);
  transition: background 0.12s var(--ease-out);
}

.chapter-item:hover {
  background: var(--c-surface-sunken);
}

.chapter-item.current {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}

.chapter-item.current .ch-index {
  color: var(--c-accent);
}

.ch-index {
  min-width: 28px;
  color: var(--c-ink-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

.ch-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.form-input {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.form-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.form-hint {
  font-size: 11px;
  color: var(--c-ink-tertiary);
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.category-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.category-tag {
  padding: 4px 12px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink-secondary);
  border-radius: var(--radius-full);
  font-size: 12px;
  user-select: none;
  transition: all 0.15s var(--ease-out);
}

.category-tag:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.category-tag.active {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  border-color: var(--c-accent);
}

.btn-primary,
.btn-secondary,
.btn-danger {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.btn-secondary:hover {
  background: var(--c-border);
}

.btn-danger {
  background: var(--c-danger);
  color: var(--c-ink-inverse);
}

.btn-danger:hover {
  opacity: 0.85;
}

.drop-file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 12px;
  max-height: 180px;
  overflow-y: auto;
}

.drop-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--c-surface-sunken);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--c-ink-secondary);
}

.drop-file-item svg {
  flex-shrink: 0;
  color: var(--c-accent);
}

.drop-file-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--c-surface-overlay);
  border-top: 1px solid var(--c-border);
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.15s var(--ease-out);
}

.batch-info {
  font-size: 13px;
  color: var(--c-ink-secondary);
  font-weight: 500;
}

.batch-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.batch-actions .btn-secondary,
.batch-actions .btn-danger {
  display: flex;
  align-items: center;
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.batch-actions .btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.batch-actions .btn-secondary:hover:not(:disabled) {
  background: var(--c-border);
}

.batch-actions .btn-danger {
  background: var(--c-danger);
  color: var(--c-ink-inverse);
}

.batch-actions .btn-danger:hover:not(:disabled) {
  opacity: 0.85;
}

.batch-actions .btn-secondary:disabled,
.batch-actions .btn-danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.batch-actions .btn-ghost {
  color: var(--c-ink-tertiary);
  font-size: 13px;
  padding: 7px 12px;
}

.batch-actions .btn-ghost:hover {
  color: var(--c-ink);
}

.select-all-btn {
  font-weight: 600;
}

.icon-btn.active {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}

.theme-toggle-fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
}

.bookmark-list {
  min-width: 280px;
}

.bookmark-empty {
  text-align: center;
  color: var(--c-ink-tertiary);
  padding: 24px 0;
  font-size: 13px;
}

.bookmark-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.bookmark-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 32px 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s var(--ease-out);
}

.bookmark-item:hover {
  background: var(--c-surface-sunken);
}

.bookmark-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bookmark-date {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  font-variant-numeric: tabular-nums;
}

.bookmark-percent {
  font-size: 11px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.bookmark-text {
  font-size: 13px;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-delete {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  opacity: 0;
  transition: all 0.12s var(--ease-out);
}

.bookmark-item:hover .bookmark-delete {
  opacity: 1;
}

.bookmark-delete:hover {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.bookmark-hint {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--c-ink-tertiary);
  text-align: center;
}

.search-modal {
  min-width: 320px;
}

.search-bar {
  display: flex;
  gap: 8px;
}

.search-input-modal {
  flex: 1;
}

.search-meta {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  margin-top: 8px;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
}

.search-result-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s var(--ease-out);
}

.search-result-item:hover {
  background: var(--c-surface-sunken);
}

.search-result-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-result-chapter {
  font-size: 12px;
  color: var(--c-ink-tertiary);
}

.search-result-percent {
  font-size: 11px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.search-result-text {
  font-size: 13px;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-text :deep(mark) {
  background: var(--c-accent-soft);
  color: var(--c-accent);
  padding: 0 2px;
  border-radius: 2px;
}

.search-empty {
  text-align: center;
  color: var(--c-ink-tertiary);
  padding: 24px 0;
  font-size: 13px;
}

.search-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
}

.search-page-info {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
