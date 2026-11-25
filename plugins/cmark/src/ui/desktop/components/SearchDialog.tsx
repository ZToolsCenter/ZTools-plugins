/**
 * 搜索：Ctrl+F 打开
 *
 * 两种范围（对齐 V1.0.0）：
 *   - 当前笔记：在编辑器里高亮命中，Enter / Shift+Enter 上下跳
 *   - 全部笔记：后端遍历工作区，列出笔记与命中片段，点击打开
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor as SlateEditor, Range, Transforms, Node } from 'slate'
import type { Editor as SlateEditorType } from 'slate'
import { ReactEditor } from 'slate-react'
import { useNotes } from '../../../service/store/notes'
import { notes } from '../../../runtime/legacy-bridge'

type Hit = { rel: string; name: string; snippet: string; count: number }
type Scope = 'note' | 'all'

type Api = {
  searchNotes?: (q: string, limit?: number) => { ok: boolean; data?: Hit[]; message?: string }
}

export function SearchDialog({
  open,
  onClose,
  editor,
}: {
  open: boolean
  onClose: () => void
  editor: SlateEditorType
}) {
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>('note')
  const [hits, setHits] = useState<Hit[]>([])
  const [idx, setIdx] = useState(0)
  const [total, setTotal] = useState(0)
  const openNote = useNotes((s) => s.openNote)
  const setFindTerm = useNotes((s) => s.setFindTerm)
  const currentRel = useNotes((s) => s.currentRel)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 打开前的正文高亮词（主搜索维护的那个），关闭时要还回去 */
  const prevFindRef = useRef('')

  useEffect(() => {
    if (open) {
      // 记住主搜索的正文高亮词，但不清空它：清了会让「目录树还筛着、正文却不亮」
      prevFindRef.current = useNotes.getState().findTerm
      setQ('')
      setHits([])
      setIdx(0)
      setTotal(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  /** 当前笔记：数出所有命中（用于 x/y 显示），并跳到第 idx 个 */
  const locateInNote = useCallback(
    (query: string, target: number, focusEditor = false) => {
      if (!query || !currentRel) {
        setTotal(0)
        return
      }
      const lower = query.toLowerCase()
      const positions: { path: number[]; offset: number }[] = []
      for (const [node, path] of Node.nodes(editor)) {
        if (!('text' in node) || typeof node.text !== 'string') continue
        const t = node.text.toLowerCase()
        let from = 0
        for (;;) {
          const i = t.indexOf(lower, from)
          if (i < 0) break
          positions.push({ path, offset: i })
          from = i + lower.length
        }
      }
      setTotal(positions.length)
      if (!positions.length) return
      const p = positions[Math.max(0, Math.min(positions.length - 1, target))]
      try {
        const sel = {
          anchor: { path: p.path, offset: p.offset },
          focus: { path: p.path, offset: p.offset + query.length },
        }
        Transforms.select(editor, sel as never)
        // 不能在这里 ReactEditor.focus：搜索框还在输入，抢焦点会让后续字符
        // 直接写进正文、并且替换掉刚选中的命中区间
        if (focusEditor) ReactEditor.focus(editor)
        const el = ReactEditor.toDOMRange(editor, sel as never)
        void el
      } catch (e) {}
    },
    [editor, currentRel]
  )

  const search = useCallback(
    (query: string) => {
      setIdx(0)
      if (!query.trim()) {
        setHits([])
        setTotal(0)
        return
      }
      if (scope === 'note') locateInNote(query, 0, false)
      else {
        const api = notes() as unknown as Api
        const r = api?.searchNotes?.(query, 80)
        setHits(r?.ok && Array.isArray(r.data) ? r.data : [])
      }
    },
    [scope, locateInNote]
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      if (scope !== 'note' || total === 0) return
      const next = (idx + dir + total) % total
      setIdx(next)
      locateInNote(q, next, true)
    },
    [scope, idx, total, q, locateInNote]
  )

  const closeAll = useCallback(() => {
    // 还原打开前的正文高亮词，交还给主搜索
    setFindTerm(prevFindRef.current)
    onClose()
  }, [onClose, setFindTerm])

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setFindTerm('')
        onClose()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) step(-1)
        else step(1)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setScope((s) => (s === 'note' ? 'all' : 'note'))
      }
    },
    [onClose, step]
  )

  /**
   * 把命中词包成 <mark>：结果列表里的标题和片段要能一眼看到命中的位置。
   * 之前这里是纯文本，搜索后只能逐条肉眼找关键词。
   */
  const hl = (text: string) => {
    const kw = q.trim()
    if (!kw) return text
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = String(text || '').split(new RegExp('(' + esc + ')', 'gi'))
    return parts.map((p, i) =>
      i % 2 === 1 ? (
        <mark className="search-hl" key={i}>
          {p}
        </mark>
      ) : (
        p
      )
    )
  }

  // 切范围时用同一个词重搜
  useEffect(() => {
    if (open && q) search(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  if (!open) return null

  return (
    <div className="search-mask" onClick={closeAll}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <div className="search-head">
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            placeholder={scope === 'note' ? '在当前笔记中查找' : '在所有笔记中查找'}
            onChange={(e) => {
              const v = e.target.value
              setQ(v)
              setFindTerm(scope === 'note' ? v : '')
              search(v)
            }}
            onKeyDown={onKey}
          />
          <span className="search-count">
            {scope === 'note' ? (total ? `${idx + 1} / ${total}` : '无结果') : hits.length ? `${hits.length} 篇` : '无结果'}
          </span>
          <button
            className={'search-scope' + (scope === 'note' ? ' on' : '')}
            type="button"
            title="仅当前笔记（Tab 切换）"
            onClick={() => setScope('note')}
          >
            当前笔记
          </button>
          <button
            className={'search-scope' + (scope === 'all' ? ' on' : '')}
            type="button"
            title="所有笔记（Tab 切换）"
            onClick={() => {
              setScope('all')
              setFindTerm('')
            }}
          >
            所有笔记
          </button>
          <button className="gp-close" type="button" title="关闭" onClick={closeAll} style={{ position: 'static' }}>
            ×
          </button>
        </div>

        {scope === 'all' && hits.length ? (
          <div className="search-list">
            {hits.map((h) => (
              <button
                key={h.rel}
                type="button"
                className="search-hit"
                onClick={() => {
                  // 打开前把词交给「笔记内查找」，正文里命中的地方才高亮
                  setFindTerm(q)
                  openNote(h.rel)
                  onClose()
                }}
              >
                <span className="search-name">{hl(h.name)}</span>
                <span className="search-badge">{h.count}</span>
                <span className="search-snip">{hl(h.snippet)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="search-foot">
          {scope === 'note' ? 'Enter 下一个 · Shift+Enter 上一个 · Tab 切换范围 · Esc 关闭' : '点击结果打开笔记 · Tab 切换范围 · Esc 关闭'}
        </div>
      </div>
    </div>
  )
}

void Range
void SlateEditor