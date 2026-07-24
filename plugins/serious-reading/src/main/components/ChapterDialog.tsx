import { useState, useMemo } from 'react'
import type { ShelfBook, ParsedBook, Settings } from '@/shared/types'
import { searchChapters } from '@/shared/parser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'

export function ChapterDialog(props: {
  book: ShelfBook
  parsed: ParsedBook | undefined
  settings: Settings
  onSkip: (chapterIndex: number, charOffset?: number) => void
}) {
  const [kw, setKw] = useState('')
  const [committed, setCommitted] = useState('')
  const list = useMemo(() => {
    if (!props.parsed) return []
    if (!committed) return props.parsed.chapters
    return searchChapters(props.parsed.chapters, committed)
  }, [props.parsed, committed])

  const curIdx = props.book.lastChapter ?? 0

  return (
    <Dialog open onOpenChange={() => props.onSkip(curIdx)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>章节跳转 · {props.book.name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="搜索章节标题…" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setCommitted(kw) }} />
          <Button size="icon" onClick={() => setCommitted(kw)}><Search className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {list.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">无匹配章节</div>}
          {list.map((ch) => (
            <button
              key={ch.index}
              className={`block w-full truncate rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent ${ch.index === curIdx ? 'bg-accent font-semibold' : ''}`}
              onClick={() => props.onSkip(ch.index, ch.charOffset)}
            >
              {ch.title}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}