import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBook, Chapter, BookFormat, Settings, ReadingProgress, TriggerKey } from '@/shared/types'
import { getSettings, getProgress, saveProgress, addRecentBook } from '@/shared/storage'
import { parseTxt, buildEpub, renderChapterHtml } from '@/shared/parser'
import { PdfView } from './components/PdfView'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => getSettings())
  const [book, setBook] = useState<ParsedBook | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [chapterIdx, setChapterIdx] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [charOffset, setCharOffset] = useState(0)
  const [stealth, setStealth] = useState(false)
  const [resizeN, setResizeN] = useState(0)
  // PDF
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfTotal, setPdfTotal] = useState(0)
  // 分页
  const [pages, setPages] = useState<string[]>(['<p style="padding-top:40vh;text-align:center;opacity:.4">正在加载…</p>'])
  const measureRef = useRef<HTMLDivElement>(null)
  const [dragWin, setDragWin] = useState<{ sx: number; sy: number } | null>(null)

  const ipc = (window as any)._ipcRenderer
  const sendParent = (window as any)._sendToParent as ((c: string, d?: any) => void) | undefined

  /* ---- 接收主窗推送 ---- */
  useEffect(() => {
    ipc?.on('sr:reading-state', (_e: unknown, state: any) => loadState(state))
    ipc?.on('sr:show-reader', () => setStealth(false))
    ipc?.on('sr:settings', (_e: unknown, s: Settings) => { if (s) setSettings(s) })
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadState(state: any) {
    if (!state?.filePath) return
    setStealth(false)
    void loadBook(state.filePath, state.format as BookFormat, state)
  }

  async function loadBook(filePath: string, format: BookFormat, state?: any) {
    const svc = window.services
    let pb: ParsedBook | null = null
    if (format === 'txt') {
      const txt = svc?.readTxt(filePath)
      if (txt) pb = parseTxt(txt, filePath)
    } else if (format === 'epub') {
      const eb = svc?.readEpub(filePath)
      if (eb) pb = buildEpub(eb, filePath)
    } else if (format === 'pdf') {
      const buf = svc?.readPdf(filePath)
      if (buf) {
        setPdfData(buf)
        setPdfPage(state?.pdfPage ?? state?.chapterIndex ?? 1)
        const fake = { title: filePath.split(/[\\/]/).pop()!, filePath, format: 'pdf' as BookFormat, chapters: [], totalChapters: 1 }
        setBook(fake)
        addRecentBook({ filePath, title: fake.title, format: 'pdf', lastRead: Date.now() })
        saveProgress({ filePath, format: 'pdf', chapterIndex: state?.pdfPage ?? 1, pageIndex: 0, timestamp: Date.now() })
      }
      return
    }
    if (!pb) return
    setPdfData(null)
    setBook(pb)
    addRecentBook({ filePath, title: pb.title, format, lastRead: Date.now() })
    const prog = getProgress(filePath)
    const ci = state?.chapterIndex ?? prog?.chapterIndex ?? 0
    setChapterIdx(ci)
    setCharOffset(state?.charOffset ?? prog?.charOffset ?? (pb.chapters[ci]?.charOffset ?? 0))
    setPageIndex(state?.pageIndex ?? prog?.pageIndex ?? 0)
  }

  const currentChapter = book?.chapters[chapterIdx] ?? null
  useEffect(() => { setChapter(currentChapter) }, [currentChapter])
  const chapterHtml = useMemo(
    () => {
      if (!book || !chapter) return ''
      const body = renderChapterHtml(chapter.content, book.format, settings.reader.cleanEmptyLines)
      if (book.format === 'txt' && chapter.title && chapter.title !== '全文') {
        const esc = chapter.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return `<h2 style="text-align:center;margin:0 0 .8em 0;font-size:1.05em;font-weight:700;line-height:inherit">${esc}</h2>${body}`
      }
      return body
    },
    [book, chapter, settings.reader.cleanEmptyLines],
  )

  /* ---- 高度测量分页（txt/epub） ---- */
  useLayoutEffect(() => {
    if (!book || book.format === 'pdf' || !chapterHtml) return
    const measure = measureRef.current
    if (!measure) return
    const pageH = window.innerHeight - 16
    const pageW = window.innerWidth - 24
    measure.style.width = pageW + 'px'
    measure.style.fontSize = settings.reader.fontSize + 'px'
    measure.style.lineHeight = String(settings.reader.lineHeight)
    measure.style.fontFamily = settings.reader.fontFamily || 'inherit'
    measure.style.fontWeight = String(settings.reader.fontWeight)
    measure.innerHTML = chapterHtml
    const nodes: { height: number; html: string }[] = []
    const blockTags = ['P', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'TABLE', 'SECTION', 'ARTICLE', 'BODY']
    function collectFrom(parent: Node) {
      const children = Array.from(parent.childNodes)
      for (const node of children) {
        if (node.nodeType === 3 && node.textContent?.trim()) {
          const span = document.createElement('span')
          span.textContent = node.textContent
          node.parentNode?.replaceChild(span, node)
          const cs = getComputedStyle(span)
          nodes.push({ height: span.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom), html: span.outerHTML })
        } else if (node.nodeType === 1) {
          const el = node as HTMLElement
          const hasBlockChildren = Array.from(el.children).some((child) => blockTags.includes(child.tagName))
          if (hasBlockChildren) {
            collectFrom(el)
          } else {
            const cs = getComputedStyle(el)
            nodes.push({ height: el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom), html: el.outerHTML })
          }
        }
      }
    }
    collectFrom(measure)
    const result: string[] = []
    let cur = ''
    let used = 0
    for (const n of nodes) {
      if (used + n.height > pageH && used > 0) { result.push(cur); cur = ''; used = 0 }
      cur += n.html
      used += n.height
    }
    if (cur) result.push(cur)
    measure.innerHTML = ''
    setPages(result.length ? result : ['<p style="text-align:center;opacity:.4">本章无内容</p>'])
    setPageIndex((p) => p === -1 ? result.length - 1 : Math.min(p, result.length - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterHtml, settings.reader.fontSize, settings.reader.lineHeight, settings.reader.fontWeight, settings.reader.fontFamily, resizeN])

  /* ---- 百分比 ---- */
  const percent = useMemo(() => {
    if (!book) return 0
    if (book.format === 'pdf') return pdfTotal ? (pdfPage / pdfTotal) * 100 : 0
    if (book.fullText) return ((charOffset / book.fullText.length) * 100)
    return book.totalChapters ? ((chapterIdx + 1) / book.totalChapters) * 100 : 0
  }, [book, charOffset, chapterIdx, pdfPage, pdfTotal])

  /* ---- 翻页 ---- */
  const nextPage = useCallback(() => {
    if (book?.format === 'pdf') { setPdfPage((p) => Math.min(p + 1, pdfTotal || p + 1)); return }
    if (pageIndex < pages.length - 1) setPageIndex(pageIndex + 1)
    else nextChapter()
  }, [book, pageIndex, pages.length])

  const prevPage = useCallback(() => {
    if (book?.format === 'pdf') { setPdfPage((p) => Math.max(1, p - 1)); return }
    if (pageIndex > 0) setPageIndex(pageIndex - 1)
    else prevChapter()
  }, [book, pageIndex])

  // 用 ref 持有最新回调/状态，避免 document 事件监听反复挂载
  const nextPageRef = useRef(nextPage); nextPageRef.current = nextPage
  const prevPageRef = useRef(prevPage); prevPageRef.current = prevPage
  const pagesRef = useRef(pages); pagesRef.current = pages
  const hideRef = useRef(settings.hide); hideRef.current = settings.hide
  const pageCfgRef = useRef(settings.page); pageCfgRef.current = settings.page
  const stealthRef = useRef(stealth); stealthRef.current = stealth

  function nextChapter() {
    if (!book || book.format === 'pdf') return
    if (chapterIdx < book.totalChapters - 1) {
      const ni = chapterIdx + 1
      setPages(['<p style="padding-top:40vh;text-align:center;opacity:.4">…</p>'])
      setChapterIdx(ni)
      setCharOffset(book.chapters[ni]?.charOffset ?? 0)
      setPageIndex(0)
    }
  }
  function prevChapter() {
    if (!book || book.format === 'pdf') return
    if (chapterIdx > 0) {
      const pi = chapterIdx - 1
      setPages(['<p style="padding-top:40vh;text-align:center;opacity:.4">…</p>'])
      setChapterIdx(pi)
      setCharOffset(book.chapters[pi]?.charOffset ?? 0)
      setPageIndex(-1)
    }
  }
  function goChapter(idx: number) {
    if (!book || book.format === 'pdf') return
    if (idx >= 0 && idx < book.totalChapters) {
      setChapterIdx(idx)
      setCharOffset(book.chapters[idx]?.charOffset ?? 0)
      setPageIndex(0)
    }
  }

  /* ---- 进度保存 ---- */
  useEffect(() => {
    if (!book) return
    const t = setTimeout(() => {
      const pg: ReadingProgress = {
        filePath: book.filePath, format: book.format,
        chapterIndex: book.format === 'pdf' ? pdfPage : chapterIdx,
        chapterTitle: book.format === 'pdf' ? `第${pdfPage}页` : (book.chapters[chapterIdx]?.title || ''),
        pageIndex, charOffset, totalChapters: book.totalChapters, timestamp: Date.now(),
      }
      saveProgress(pg)
      sendParent?.('sr:save-progress', pg)
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, pageIndex, charOffset, pdfPage])

  /* ---- document 级事件：阅读窗容器是 drag region，React 事件会被吞掉 ---- */
  function dispatchTrigger(key: TriggerKey, e?: Event) {
    const hide = hideRef.current
    if (hide.realHide.includes(key)) { e?.preventDefault?.(); sendParent?.('sr:hide-reader'); return }
    const isStealth = stealthRef.current
    if (!isStealth && hide.stealthHide.includes(key)) { setStealth(true); return }
    if (isStealth && hide.stealthShow.includes(key)) { setStealth(false); return }
  }
  useEffect(() => {
    window.focus()
    const onKey = (e: KeyboardEvent) => {
      const hide = hideRef.current
      if (e.key === 'Escape' && (hide.stealthHide.includes('escape') || hide.stealthShow.includes('escape') || hide.realHide.includes('escape'))) { dispatchTrigger('escape', e); e.preventDefault(); return }
      const p = pageCfgRef.current
      if (p.arrow && e.key === 'ArrowRight') { nextPageRef.current(); e.preventDefault() }
      if (p.arrow && e.key === 'ArrowLeft') { prevPageRef.current(); e.preventDefault() }
      if (p.pgupdn && e.key === 'PageDown') { nextPageRef.current(); e.preventDefault() }
      if (p.pgupdn && e.key === 'PageUp') { prevPageRef.current(); e.preventDefault() }
      if (p.space && e.key === ' ') { nextPageRef.current(); e.preventDefault() }
      if (e.key === 'Home') { setPageIndex(0) }
      if (e.key === 'End') { setPageIndex(pagesRef.current.length - 1) }
    }
    const onDbl = (e: MouseEvent) => { dispatchTrigger('dblclick', e) }
    const onDown = (e: MouseEvent) => { if (e.button === 1) dispatchTrigger('middleClick', e) }
    const onCtx = (e: MouseEvent) => {
      const hide = hideRef.current
      if (hide.realHide.includes('rightClick') || hide.stealthHide.includes('rightClick') || hide.stealthShow.includes('rightClick')) { e.preventDefault(); dispatchTrigger('rightClick', e) }
    }
    const onLeave = () => { dispatchTrigger('mouseleave') }
    const onEnter = () => { dispatchTrigger('mouseenter') }
    const onWheel = (e: WheelEvent) => {
      if (pageCfgRef.current.wheel) { e.preventDefault(); if (e.deltaY > 0 || e.deltaX > 0) nextPageRef.current(); else prevPageRef.current() }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('dblclick', onDbl)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('contextmenu', onCtx)
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('dblclick', onDbl)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('mouseenter', onEnter)
      document.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- 自动翻页 ---- */
  useEffect(() => {
    const interval = settings.autoPage.interval
    if (!interval || interval <= 0) return
    if (stealth && settings.autoPage.pauseOnStealth) return
    const t = setInterval(() => nextPage(), interval * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoPage, nextPage, stealth])

  /* ---- 中间区域拖动移动窗口 ---- */
  useEffect(() => {
    if (!dragWin) return
    const onMove = (e: MouseEvent) => {
      sendParent?.('sr:win-delta', { type: 'move', dx: e.screenX - dragWin.sx, dy: e.screenY - dragWin.sy })
    }
    const onUp = () => {
      sendParent?.('sr:win-end')
      setDragWin(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragWin, sendParent])

  /* ---- resize 重排 ---- */
  useEffect(() => {
    const onRes = () => setResizeN((n) => n + 1)
    window.addEventListener('resize', onRes)
    const saveT = setInterval(() => sendBounds(), 5000)
    window.addEventListener('beforeunload', sendBounds)
    return () => { window.removeEventListener('resize', onRes); clearInterval(saveT); window.removeEventListener('beforeunload', sendBounds) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sendBounds() {
    const x = window.screenLeft, y = window.screenTop, w = window.innerWidth, h = window.innerHeight
    if (w > 120 && h > 120 && w < 8000 && h < 8000) sendParent?.('sr:save-bounds', { x, y, width: w, height: h })
  }

  /* ---- 百分比跳转 ---- */
  function jumpPercent(v: number) {
    if (!book) return
    if (book.format === 'pdf') { setPdfPage(Math.max(1, Math.ceil((v / 100) * pdfTotal))); return }
    if (book.fullText) {
      const target = Math.round((v / 100) * book.fullText.length)
      let ci = 0
      for (let i = 0; i < book.chapters.length; i++) {
        const c = book.chapters[i]
        if ((c.charOffset ?? 0) <= target) ci = i
      }
      setChapterIdx(ci); setCharOffset(target); setPageIndex(0)
    } else {
      const ci = Math.min(book.totalChapters - 1, Math.floor((v / 100) * book.totalChapters))
      goChapter(ci)
    }
  }

  if (!book && !pdfData) {
    return <div className="sr-no-drag flex h-full w-full items-center justify-center text-sm text-muted-foreground">正在加载…</div>
  }

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${stealth ? 'sr-stealth' : ''}`}
      style={{
        background: stealth ? 'transparent' : settings.reader.bgColor,
        color: stealth ? 'transparent' : settings.reader.textColor,
        opacity: stealth ? 1 : settings.reader.opacity,
        fontSize: settings.reader.fontSize,
        lineHeight: settings.reader.lineHeight,
        fontFamily: settings.reader.fontFamily === 'default' ? 'inherit' : settings.reader.fontFamily,
        fontWeight: settings.reader.fontWeight,
      }}
    >
      {/* 纯 JS 窗口移动 + 缩放把手（不使用 drag region，避免吞掉右键/中键） */}
      <WindowHandles sendParent={sendParent} />

      {/* 内容区：整窗无 drag region，右键/中键/双击/滚轮/翻页全部正常 */}
      <div
        className="absolute inset-0 overflow-hidden select-none"
        onCopy={(e) => e.preventDefault()}
      >
        {/* 测量容器 */}
        <div ref={measureRef} className="absolute left-[-9999px] top-0" style={{ visibility: 'hidden' }} />

        {/* PDF 模式 */}
        {book?.format === 'pdf' && pdfData ? (
          <div className="h-full w-full">
            <PdfView data={pdfData} page={pdfPage} scale={1.2} onPageReady={setPdfTotal} />
          </div>
        ) : (
          <>
            {/* 分页内容条：绝对定位单页切换 */}
            <div
              className="relative h-full w-full"
              style={{
                transform: `translateX(-${pageIndex * 100}%)`,
                transition: settings.page.transition === 'slide' ? 'transform 200ms ease' : 'none',
              }}
            >
              {pages.map((p, i) => (
                <div
                  key={i}
                  className="absolute left-0 top-0 h-full overflow-hidden px-3 py-2 select-none"
                  style={{ width: '100%', left: `${i * 100}%` }}
                  dangerouslySetInnerHTML={{ __html: p }}
                />
              ))}
            </div>

            {/* 翻页点击区（左右各 30%）+ 中间拖动移动区（40%） */}
            {settings.page.click && !stealth ? (
              <>
                <button className="absolute top-0 left-0 h-full" style={{ width: '30vw' }} onClick={prevPage} />
                <button className="absolute top-0 right-0 h-full" style={{ width: '30vw' }} onClick={nextPage} />
                <div className="absolute top-0 h-full cursor-move" style={{ left: '30vw', width: '40vw' }}
                  onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); sendParent?.('sr:win-start', { type: 'move' }); setDragWin({ sx: e.screenX, sy: e.screenY }) } }}
                />
              </>
            ) : !stealth ? (
              <div className="absolute inset-0 cursor-move"
                onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); sendParent?.('sr:win-start', { type: 'move' }); setDragWin({ sx: e.screenX, sy: e.screenY }) } }}
              />
            ) : null}

            {/* 进度条 */}
            {!stealth && settings.showProgressBar && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-black/5">
                <div className="h-full bg-black/25" style={{ width: ((pages.length ? (pageIndex + 1) / pages.length : 1)) * 100 + '%' }} />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

/**
 * 纯 JS 窗口移动 + 缩放把手。
 * 不使用 -webkit-app-region:drag（会吞掉右键/中键），改为鼠标按下后通过 IPC
 * 让主窗调用 win.setPosition / win.setBounds 完成移动与缩放。
 * 整窗保持 no-drag，右键/中键/双击/滚轮/翻页触发全部正常。
 */
function WindowHandles({ sendParent }: { sendParent?: (c: string, d?: any) => void }) {
  const [drag, setDrag] = useState<{ type: string; sx: number; sy: number } | null>(null)

  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent) => {
      sendParent?.('sr:win-delta', { type: drag.type, dx: e.screenX - drag.sx, dy: e.screenY - drag.sy })
    }
    const onUp = () => {
      sendParent?.('sr:win-end')
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, sendParent])

  const start = (type: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    sendParent?.('sr:win-start', { type })
    setDrag({ type, sx: e.screenX, sy: e.screenY })
  }

  const handles = [
    // 缩放：四边/四角，全部放在窗口内并置于最上层
    { type: 'w', cls: 'left-0 top-0 bottom-0 w-1.5 z-[60] cursor-ew-resize' },
    { type: 'e', cls: 'right-0 top-0 bottom-0 w-1.5 z-[60] cursor-ew-resize' },
    { type: 's', cls: 'left-0 right-0 bottom-0 h-1.5 z-[60] cursor-ns-resize' },
    { type: 'nw', cls: 'left-0 top-0 w-3 h-3 z-[60] cursor-nw-resize' },
    { type: 'ne', cls: 'right-0 top-0 w-3 h-3 z-[60] cursor-ne-resize' },
    { type: 'sw', cls: 'left-0 bottom-0 w-3 h-3 z-[60] cursor-sw-resize' },
    { type: 'se', cls: 'right-0 bottom-0 w-3 h-3 z-[60] cursor-se-resize' },
  ]

  return (
    <>
      {handles.map((h) => (
        <div key={h.type} className={`absolute ${h.cls}`} title={h.type === 'move' ? '拖拽移动' : '拖拽缩放'} onMouseDown={start(h.type)} />
      ))}
    </>
  )
}