import { useState } from 'react'
import { MoreVertical, BookMarked, Search, Trash2 } from 'lucide-react'
import type { ShelfBook } from '@/shared/types'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function BookCard(props: {
  book: ShelfBook
  cover?: string
  progress: number
  onOpen: () => void
  onChapter: () => void
  onSearch: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="group relative">
      <button
        onClick={props.onOpen}
        className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition hover:ring-2 hover:ring-primary"
        onContextMenu={(e) => { e.preventDefault(); props.onOpen() }}
      >
        {props.cover ? (
          <img src={props.cover} className="h-full w-full object-cover" alt="" />
        ) : (
          <span className="line-clamp-4 px-2 text-center text-sm font-medium opacity-80">{props.book.name}</span>
        )}
        <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
          {props.book.lastChapter != null && (
            <span className="truncate rounded bg-black/60 px-1 text-[10px] text-white">
              {props.book.lastChapterTitle || `第${(props.book.lastChapter ?? 0) + 1}章`}
            </span>
          )}
          {props.progress > 0 && (
            <span className="shrink-0 rounded bg-black/60 px-1 text-[10px] text-white">{Math.min(100, props.progress)}%</span>
          )}
        </div>
      </button>
      <div className="mt-1 truncate text-xs text-muted-foreground">{props.book.name}</div>
      <div className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100">
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <button className="rounded-md bg-background/80 p-1 shadow hover:bg-accent">
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={props.onChapter}><BookMarked className="mr-2 h-4 w-4" /> 章节跳转</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onSearch}><Search className="mr-2 h-4 w-4" /> 搜索跳转</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={props.onDelete}><Trash2 className="mr-2 h-4 w-4" /> 删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}