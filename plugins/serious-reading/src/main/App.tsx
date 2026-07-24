import { useEffect, useRef, useState } from 'react'
import { Plus, Settings as SettingsIcon, BookOpen } from 'lucide-react'
import type { BookFormat, ParsedBook, ShelfBook, Settings, RecentBook } from '@/shared/types'
import { getSettings, saveSettings, getShelf, addBookToShelf, removeBookFromShelf, updateBookInShelf, coverId, getCover, saveCover, bufferToDataUrl, getProgress, addRecentBook, getHistory } from '@/shared/storage'
import { parseTxt, buildEpub, buildPdf, searchChapters } from '@/shared/parser'
import { useTheme } from './theme'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BookCard } from './components/BookCard'
import { SettingsDialog } from './components/SettingsDialog'
import { ChapterDialog } from './components/ChapterDialog'
import { SearchDialog } from './components/SearchDialog'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => getSettings())
  const [shelf, setShelf] = useState<ShelfBook[]>([])
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [recents, setRecents] = useState<RecentBook[]>([])
  // 缓存已解析的书籍（内存），供跳转/搜索复用
  const parsedRef = useRef<Record<string, ParsedBook>>({})
  const [activeBook, setActiveBook] = useState<ShelfBook | null>(null)
  const [openChapter, setOpenChapter] = useState<ShelfBook | null>(null)
  const [openSearch, setOpenSearch] = useState<ShelfBook | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { setTheme } = useTheme(settings, setSettings)

  useEffect(() => {
    setShelf(getShelf())
    setRecents(getHistory())
    refreshCovers()
    bindFeatures()
    const onShelfChange = () => { setShelf(getShelf()); refreshCovers() }
    window.addEventListener('sr:shelf-changed', onShelfChange)
    return () => window.removeEventListener('sr:shelf-changed', onShelfChange)
  }, [])

  function refreshCovers() {
    const next: Record<string, string> = {}
    for (const b of getShelf()) {
      if (b.cover) {
        const buf = getCover(b.id)
        if (buf) next[b.id] = bufferToDataUrl(buf)
      }
    }
    setCovers(next)
  }

  function bindFeatures() {
    const zt = window.ztools
    if (!zt) return
    zt.onPluginEnter((p) => {
      setShelf(getShelf())
      refreshCovers()
      const code = p.code
      if (code === 'reader_open' && p.type === 'files' && p.payload?.length) {
        openFile(p.payload[0].path)
        return
      }
      if (code === 'reader_continue') {
        const h = getHistory()
        if (h.length) openFile(h[0].filePath, h[0].format as BookFormat)
        return
      }
      if (code === 'show_reader') {
        window.services?.showReader()
        zt.hideMainWindow?.(false)
        return
      }
      if (code === 'toggle_reader') {
        const ok = window.services?.toggleReader()
        if (ok) zt.hideMainWindow?.(false)
        else openContinue()
        return
      }
      if (code === 'reader') {
        zt.setExpendHeight?.(660)
      }
    })
  }

  function openContinue() {
    const h = getHistory()
    if (h.length) openFile(h[0].filePath, h[0].format as BookFormat)
  }

  /** 解析文件 → 入书架 → 创建悬浮阅读窗 */
  function openFile(filePath: string, fmt?: BookFormat) {
    const ext = (filePath.split('.').pop() || '').toLowerCase() as BookFormat
    const format = fmt ?? (['txt', 'epub', 'pdf'].includes(ext) ? ext : 'txt')
    let book: ParsedBook | null = null
    let epubData: EBook | null = null
    const svc = window.services
    try {
      if (format === 'txt') {
        const txt = svc?.readTxt(filePath)
        if (txt) book = parseTxt(txt, filePath)
      } else if (format === 'epub') {
        epubData = svc?.readEpub(filePath) ?? null
        if (epubData) book = buildEpub(epubData, filePath)
      } else if (format === 'pdf') {
        const buf = svc?.readPdf(filePath)
        if (buf) book = buildPdf(filePath, 0) // PDF 总页数由阅读窗 pdfjs 获取
      }
    } catch (e) {}
    if (!book) {
      ztShow('无法打开: ' + filePath)
      return
    }
    parsedRef.current[filePath] = book
    const id = Date.now().toString()
    const sb: ShelfBook = { id, type: format, name: book.title, path: filePath, totalChapters: book.totalChapters, progress: 0, lastRead: Date.now() }
    if (!addBookToShelf(sb)) {
      // 已存在，复用原 id，并更新 totalChapters（旧数据可能缺失）
      const exist = getShelf().find((b) => b.path === filePath)
      if (exist) {
        sb.id = exist.id
        if (book.totalChapters && exist.totalChapters !== book.totalChapters) {
          updateBookInShelf(exist.id, { totalChapters: book.totalChapters })
        }
      }
    } else if (format === 'epub' && epubData?.cover) {
      saveCover(sb.id, epubData.cover)
      refreshCovers()
    }
    setShelf(getShelf())
    addRecentBook({ filePath, title: book.title, format, lastRead: Date.now() })
    setRecents(getHistory())
    setActiveBook(sb)
    launchReader(sb, book)
  }

  function launchReader(sb: ShelfBook, book: ParsedBook, skipTo?: { chapterIndex: number; charOffset?: number }) {
    const prog = skipTo ? null : getProgress(sb.path)
    const state: any = {
      filePath: sb.path,
      format: sb.type,
      settings: getSettings(),
      chapterIndex: skipTo?.chapterIndex ?? prog?.chapterIndex ?? 0,
      pageIndex: skipTo ? 0 : (prog?.pageIndex ?? 0),
      charOffset: skipTo?.charOffset ?? prog?.charOffset,
      pdfPage: skipTo?.chapterIndex ?? prog?.chapterIndex,
    }
    zt_hide()
    window.services?.createReaderWindow(state)
  }

  function zt_hide() {
    window.ztools?.hideMainWindow?.(false)
  }
  function ztShow(msg: string) {
    window.ztools?.showNotification?.(msg)
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <BookOpen className="h-4 w-4 text-primary" />
          <span>严肃阅读</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => pickFile()}>
            <Plus className="mr-1 h-4 w-4" /> 打开文件
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)} title="设置">
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1 p-4">
        {shelf.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <button onClick={pickFile} className="flex aspect-[3/4] items-center justify-center rounded-lg border-2 border-dashed border-muted text-muted-foreground hover:border-primary hover:text-primary">
              <Plus className="h-8 w-8" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {shelf.map((b) => (
              <BookCard
                key={b.id}
                book={b}
                cover={covers[b.id]}
                progress={
                  b.totalChapters
                    ? Math.round(((b.lastChapter ?? 0) + 1) / b.totalChapters * 100)
                    : 0
                }
                onOpen={() => openBook(b)}
                onChapter={() => setOpenChapter(b)}
                onSearch={() => setOpenSearch(b)}
                onDelete={() => {
                  removeBookFromShelf(b.id)
                  setShelf(getShelf())
                }}
              />
            ))}
            <button onClick={pickFile} className="flex aspect-[3/4] items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary">
              <Plus className="h-8 w-8" />
            </button>
          </div>
        )}

        {recents.length > 0 && shelf.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">最近阅读</div>
            <div className="space-y-1">
              {recents.slice(0, 8).map((r) => (
                <button
                  key={r.filePath}
                  onClick={() => openFile(r.filePath, r.format)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="truncate">{r.title}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{new Date(r.lastRead).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} setSettings={setSettings} setTheme={setTheme} />
      {openChapter && (
        <ChapterDialog
          book={openChapter}
          parsed={parsedRef.current[openChapter.path]}
          settings={settings}
          onSkip={(idx, offset) => {
            jumpTo(openChapter, idx, offset)
            setOpenChapter(null)
          }}
        />
      )}
      {openSearch && parsedRef.current[openSearch.path] && (
        <SearchDialog
          book={openSearch}
          parsed={parsedRef.current[openSearch.path]}
          settings={settings}
          onSkip={(idx, offset) => {
            jumpTo(openSearch, idx, offset)
            setOpenSearch(null)
          }}
        />
      )}
    </div>
  )

  function openBook(b: ShelfBook) {
    if (parsedRef.current[b.path]) {
      launchReader(b, parsedRef.current[b.path])
    } else {
      openFile(b.path, b.type)
    }
  }

  function jumpTo(b: ShelfBook, chapterIndex: number, charOffset?: number) {
    updateBookInShelf(b.id, { lastChapter: chapterIndex, progress: charOffset })
    b.lastChapter = chapterIndex
    b.progress = charOffset
    const book = parsedRef.current[b.path]
    if (book) launchReader(b, book, { chapterIndex, charOffset })
  }

  function pickFile() {
    const files = window.services?.showOpenDialog?.({
      title: '选择阅读文件',
      filters: [{ name: '支持的格式', extensions: ['txt', 'epub', 'pdf'] }],
      properties: ['openFile'],
    })
    if (files?.length) openFile(files[0])
  }
}