import { useState } from 'react'
import type { ShelfBook, ParsedBook, Settings } from '@/shared/types'
import { searchFullText } from '@/shared/parser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'

export function SearchDialog(props: {
  book: ShelfBook
  parsed: ParsedBook
  settings: Settings
  onSkip: (chapterIndex: number, charOffset: number) => void
}) {
  const [kw, setKw] = useState('')
  const [items, setItems] = useState<{ index: number; snippet: string }[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [from, setFrom] = useState(0)

  const fullText = props.parsed.fullText
  if (!fullText) {
    return (
      <Dialog open onOpenChange={() => props.onSkip(props.book.lastChapter ?? 0, props.book.progress ?? 0)}>
        <DialogContent>
          <DialogTitle>搜索跳转</DialogTitle>
          <p className="text-sm text-muted-foreground">PDF 暂不支持全文搜索，仅支持按页跳转。</p>
        </DialogContent>
      </Dialog>
    )
  }

  function doSearch(reset: boolean) {
    const start = reset ? 0 : from
    const { results, hasMore: hm } = searchFullText(fullText!, kw, 10, start)
    setItems(reset ? results : [...items, ...results])
    setHasMore(hm)
    setFrom(start + results.length + 1)
  }

  /** 由字符 offset 定位所属章节 + 页内偏移 */
  function locate(offset: number) {
    const chapters = props.parsed.chapters
    let chapter = 0
    for (let i = 0; i < chapters.length; i++) {
      const nextOffset = chapters[i + 1] ? (chapters[i + 1].charOffset ?? Infinity) : Infinity
      if ((chapters[i].charOffset ?? 0) <= offset && offset < nextOffset) {
        chapter = i
        break
      }
    }
    props.onSkip(chapter, offset)
  }

  return (
    <Dialog open onOpenChange={() => props.onSkip(props.book.lastChapter ?? 0, props.book.progress ?? 0)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>搜索跳转 · {props.book.name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="输入关键字（≥2 字）" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(true) }} />
          <Button size="icon" onClick={() => doSearch(true)}><Search className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.index}
              onClick={() => locate(it.index)}
              className="block w-full rounded-md bg-muted/50 px-3 py-2 text-left text-xs hover:bg-accent"
              dangerouslySetInnerHTML={{ __html: it.snippet }}
            />
          ))}
          {hasMore && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => doSearch(false)}>加载更多</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}