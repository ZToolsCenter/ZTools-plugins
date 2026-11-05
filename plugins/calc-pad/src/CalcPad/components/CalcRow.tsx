import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pinyin } from 'pinyin-pro'
import { tokenizeForDisplay } from '../engine/parser'
import type { CellResult } from '../engine/evaluator'
import { formatNumber } from '../engine/evaluator'
import { colorForSeq } from '../palette'
import { CONSTANT_NAMES, FUNCTION_NAMES } from '../engine/evaluator'
import NumberCell from './NumberCell'

export type CalcRowProps = {
  rowId: string
  index: number
  seq: number
  expr: string
  subtitle?: string
  result: CellResult
  color: string
  refColorFor?: (pos: number) => string
  refSubtitleFor?: (pos: number) => string | undefined
  isEditing: boolean
  isActive: boolean
  isUpstream: boolean
  inboundFrom?: number
  onChange: (expr: string) => void
  onFocus: () => void
  onBlur: () => void
  onEnter: () => void
  onEscape: () => void
  onCopy: (text: string) => void
  onInject: (text: string) => void
  onRequestEdit: () => void
  onNavigate: (direction: 'up' | 'down') => void
  onInputTab: (fromInput: 'expr' | 'subtitle', direction: 'up' | 'down') => void
  subtitleFocusPending: boolean
  isFlashed?: boolean
  onRefClick?: (pos: number) => void
  refOptions?: Array<{ pos: number; subtitle?: string }>
  onAtClick?: (page: string, ref: string) => void
  atSubtitleFor?: (page: string, ref: string) => string | undefined
  atRowSubtitleFor?: (page: string, ref: string) => string | undefined
  pageOptions?: Array<{ id: string; name: string; rows: Array<{ pos: number; subtitle?: string }> }>
  onSubtitleChange: (subtitle: string) => void
  onDelete: () => void
  onMove: (rowId: string, toIndex: number, position: 'before' | 'after') => void
  onDragStateChange?: (dragging: boolean) => void
}

export default function CalcRow(props: CalcRowProps) {
  const { rowId, index, seq, expr, result, color, isEditing, isActive, isUpstream, inboundFrom } =
    props
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [subtitleDraft, setSubtitleDraft] = useState('')
  const subtitleSizerRef = useRef<HTMLSpanElement | null>(null)
  const escSkipBlurRef = useRef(false)
  const [subtitleInputWidth, setSubtitleInputWidth] = useState<number | null>(null)

  // 引用自动补全：# 引用本行所在草稿；@ 进入跨草稿模式（先选草稿再选行）
  const exprInputRef = useRef<HTMLInputElement | null>(null)
  const [ac, setAc] = useState<{
    start: number
    mode: 'ref' | 'at' | 'atRow' | 'func'
    page?: string
    query: string
  } | null>(null)
  const [acIndex, setAcIndex] = useState(0)
  const [acPos, setAcPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const [acFlip, setAcFlip] = useState(false)
  const acItemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const acRootRef = useRef<HTMLDivElement | null>(null)

  const matchPy = (sub: string, rest: string) => {
    const lower = sub.toLowerCase()
    if (lower.includes(rest)) return true
    const full = pinyin(sub, { pattern: 'pinyin', toneType: 'none', type: 'array' }).join('')
    if (full.includes(rest)) return true
    const first = pinyin(sub, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
    return first.includes(rest)
  }

  type AcCandidate = { label: string; note: string; insert: string }
  const acCandidates: AcCandidate[] = (() => {
    if (!ac) return []
    if (ac.mode === 'at') {
      return (props.pageOptions ?? [])
        .map((p, i) => ({ p, idx: i + 1 }))
        .filter(({ p, idx }) => !ac.query || String(idx).startsWith(ac.query) || matchPy(p.name, ac.query))
        .map(({ p, idx }) => ({
          label: `@${idx}`,
          note: `${p.name} · ${p.rows.length} 行`,
          insert: `@${idx}#`
        }))
    }
    if (ac.mode === 'func') {
      const q = ac.query.toLowerCase()
      return [
        ...FUNCTION_NAMES.filter((n) => n.startsWith(q)).map((n) => ({
          label: `${n}(`,
          note: '函数',
          insert: `${n}(`
        })),
        ...CONSTANT_NAMES.filter((n) => n.startsWith(q)).map((n) => ({
          label: n,
          note: '常量',
          insert: n
        }))
      ]
    }
    const rows =
      ac.mode === 'atRow'
        ? props.pageOptions?.[Number(ac.page) - 1]?.rows ?? []
        : props.refOptions ?? []
    const digits = /^\d*/.exec(ac.query)![0]
    const rest = ac.query.slice(digits.length)
    return rows
      .filter((o) => String(o.pos).startsWith(digits) && (!rest || matchPy(o.subtitle ?? '', rest)))
      .map((o) => ({
        label: `#${o.pos}`,
        note: o.subtitle || (ac.mode === 'atRow' ? `草稿「${ac.page}」` : '（无备注）'),
        insert: `#${o.pos}`
      }))
  })()

  const closeAc = () => setAc(null)

  // 方向键在补全列表中移动时，最小滚动让当前选中项可见：
  // 向下选对齐容器底部，向上选对齐容器顶部
  useEffect(() => {
    const root = acRootRef.current
    const el = acItemRefs.current.get(acIndex)
    if (!root || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < root.scrollTop) {
      root.scrollTop = top
    } else if (bottom > root.scrollTop + root.clientHeight) {
      root.scrollTop = bottom - root.clientHeight
    }
  }, [acIndex, ac, acCandidates.length])

  const detectAc = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    let m = /@(\d+)#([^#\s@+\-*/^%(),:]*)$/.exec(before)
    if (m) {
      setAc({ start: caret - m[0].length, mode: 'atRow', page: m[1], query: m[2] })
      setAcIndex(0)
    } else if ((m = /@([^#@]*)$/.exec(before))) {
      setAc({ start: caret - m[0].length, mode: 'at', query: m[1] })
      setAcIndex(0)
    } else if ((m = /#(\d*)([^#\s@]*)$/.exec(before))) {
      setAc({ start: caret - m[0].length, mode: 'ref', query: m[0].slice(1) })
      setAcIndex(0)
    } else if ((m = /([A-Za-z][A-Za-z0-9]*)$/.exec(before))) {
      // 函数/常量补全：仅当标识符处于表达式位置（行首、运算符或括号之后）
      const start = caret - m[0].length
      const prev = start > 0 ? before[start - 1] : ''
      if (!prev || '+-*/^%(),: 	'.includes(prev)) {
        setAc({ start, mode: 'func', query: m[0] })
        setAcIndex(0)
      } else {
        closeAc()
        return
      }
    } else {
      closeAc()
      return
    }
    const rect = exprInputRef.current?.getBoundingClientRect()
    if (rect) {
      // 下方空间不足且上方更宽裕时，翻转到输入框上方
      const spaceBelow = window.innerHeight - rect.bottom
      const flip = spaceBelow < 300 && rect.top > spaceBelow
      setAcFlip(flip)
      setAcPos({ left: rect.left, top: flip ? rect.top - 6 : rect.bottom + 6 })
    }
  }

  // 页面滚动时关闭补全，避免固定定位的浮层与输入框错位；
  // 下拉容器自身的滚动（键盘 scrollIntoView / 鼠标滚轮）不算，忽略之
  useEffect(() => {
    if (!ac) return
    const close = (e: Event) => {
      if (acRootRef.current && e.target instanceof Node && acRootRef.current.contains(e.target)) return
      closeAc()
    }
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [ac])

  const selectAc = (cand: AcCandidate) => {
    if (!ac) return
    const input = exprInputRef.current
    const caret = input?.selectionStart ?? ac.start + ac.query.length + 1
    // 跨草稿行引用要保留页前缀：@草稿1#1
    const insertText = ac.mode === 'atRow' ? `@${ac.page}${cand.insert}` : cand.insert
    const next = props.expr.slice(0, ac.start) + insertText + props.expr.slice(caret)
    props.onChange(next)
    if (ac.mode === 'at') {
      // 选完草稿后保持补全开启，下一步直接选该草稿的行
      const newCaret = ac.start + cand.insert.length
      requestAnimationFrame(() => {
        const el = exprInputRef.current
        if (el) el.setSelectionRange(newCaret, newCaret)
        detectAc(next, newCaret)
      })
    } else {
      closeAc()
      const newCaret = ac.start + insertText.length
      requestAnimationFrame(() => {
        const el = exprInputRef.current
        if (el) el.setSelectionRange(newCaret, newCaret)
      })
    }
  }

  // 备注输入框宽度：用隐藏镜像 span 测量实际像素宽（中英文都精确），空时量 "[备注]"
  useEffect(() => {
    const el = subtitleSizerRef.current
    if (el) setSubtitleInputWidth(el.getBoundingClientRect().width + 12)
  }, [subtitleDraft])

  // Alt+方向键跨行跳转：父组件指定本行备注获得焦点
  useEffect(() => {
    if (props.subtitleFocusPending) {
      setSubtitleDraft(props.subtitle ?? '')
      setEditingSubtitle(true)
    }
  }, [props.subtitleFocusPending])

  const openSubtitleEdit = () => {
    setSubtitleDraft(props.subtitle ?? '')
    setEditingSubtitle(true)
  }

  const commitSubtitleEdit = () => {
    props.onSubtitleChange(subtitleDraft)
    setEditingSubtitle(false)
  }
  const classes = [
    'cd-row',
    isActive ? 'cd-row-active' : '',
    isUpstream ? 'cd-row-upstream' : '',
    isEditing ? 'cd-row-editing' : '',
    props.isFlashed ? 'cd-row-flash' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      data-row-id={rowId}
      style={{ ['--row-color' as any]: color }}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/row-id', rowId)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStateChange?.(true)
      }}
      onDragEnd={() => props.onDragStateChange?.(false)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const fromId = e.dataTransfer.getData('text/row-id')
        if (!fromId || fromId === rowId) return
        const rect = e.currentTarget.getBoundingClientRect()
        const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        props.onMove(fromId, index, position)
      }}
      onClick={() => {
        if (!isEditing) props.onFocus()
      }}
    >
      <span className="cd-seq">{index + 1}</span>
      {typeof inboundFrom === 'number' && isUpstream && (
        <span className="cd-inbound">← ＃{inboundFrom} 引用</span>
      )}

      <div className="cd-flow">
        <span className="cd-subtitle-sizer" ref={subtitleSizerRef} aria-hidden="true">
          {subtitleDraft || '[备注]'}
        </span>
        {editingSubtitle ? (
          <input
            className="cd-subtitle-input"
            autoFocus
            value={subtitleDraft}
            placeholder=""
            spellCheck={false}
            style={{
              width: subtitleInputWidth ? `${subtitleInputWidth}px` : '3.4em'
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSubtitleDraft(e.target.value)}
            onBlur={() => {
              props.onSubtitleChange(subtitleDraft)
              setEditingSubtitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                commitSubtitleEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setEditingSubtitle(false)
              } else if (e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                commitSubtitleEdit()
                props.onInputTab('subtitle', e.shiftKey ? 'up' : 'down')
              }
            }}
          />
        ) : (
        <div
          className={`cd-subtitle${props.subtitle ? '' : ' is-empty'}`}
          title="点击编辑备注"
            onClick={(e) => {
              e.stopPropagation()
              setSubtitleDraft(props.subtitle ?? '')
              setEditingSubtitle(true)
            }}
          >
            {props.subtitle ? (
              <>
                {props.subtitle}
                <span className="cd-subtitle-colon">:</span>
              </>
            ) : (
              <span className="cd-subtitle-placeholder">[备注]</span>
            )}
          </div>
        )}

        <div className="cd-expr" onDoubleClick={props.onRequestEdit}>
        {isEditing ? (
          <>
          <input
            className="cd-input"
            autoFocus
            ref={exprInputRef}
            value={expr}
            placeholder="输入表达式…"
            spellCheck={false}
            onChange={(e) => {
              props.onChange(e.target.value)
              detectAc(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onFocus={props.onFocus}
            onBlur={() => {
              closeAc()
              if (escSkipBlurRef.current) {
                escSkipBlurRef.current = false
                return
              }
              props.onBlur()
            }}
            onKeyDown={(e) => {
              if (ac && acCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  e.stopPropagation()
                  setAcIndex((i) => (i + 1) % acCandidates.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  e.stopPropagation()
                  setAcIndex((i) => (i - 1 + acCandidates.length) % acCandidates.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  e.stopPropagation()
                  selectAc(acCandidates[acIndex])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  closeAc()
                  return
                }
              }

              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                props.onEnter()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                // Esc 退回选中模式：跳过随后的 blur，避免取消选中
                escSkipBlurRef.current = true
                props.onEscape()
              } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
                // Alt+方向键留给全局的移动行/翻页处理，这里只管裸方向键切行
                e.preventDefault()
                props.onNavigate(e.key === 'ArrowUp' ? 'up' : 'down')
              } else if (e.key === 'Backspace' && e.altKey) {
                e.preventDefault()
                props.onDelete()
              } else if (e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                props.onInputTab('expr', e.shiftKey ? 'up' : 'down')
              }
            }}
          />
          </>
        ) : (
          <span className="cd-expr-view">
            {tokenizeForDisplay(expr).map((t, i) => {
              if (t.type === 'number') {
                return (
                  <NumberCell
                    key={i}
                    text={t.text}
                    className="cd-num-inline"
                    onCopy={props.onCopy}
                    onInject={props.onInject}
                  />
                )
              }
              if (t.type === 'atref') {
                return (
                  <span
                    key={i}
                    className="cd-ref cd-atref"
                    title="Ctrl+点击跳转到对应草稿"
                    onClick={(e) => {
                      if (!(e.ctrlKey || e.metaKey)) return
                      e.stopPropagation()
                      props.onAtClick?.(t.page, t.ref)
                    }}
                  >
                    [<span
                      className="cd-at-page"
                      style={{ color: colorForSeq(Number(t.page)), borderColor: colorForSeq(Number(t.page)) }}
                    >
                      @{t.page}
                    </span>
                    <span className="cd-ref-note">{props.atSubtitleFor?.(t.page, t.ref)}</span>
                    <span className="cd-at-row" style={{ color: colorForSeq(Number(t.ref)) }}>
                      #{t.ref}
                    </span>
                    <span className="cd-ref-note">{props.atRowSubtitleFor?.(t.page, t.ref)}</span>]
                  </span>
                )
              }
              if (t.type === 'ref') {
                const note = props.refSubtitleFor?.(t.seq!)
                return (
                  <span
                    key={i}
                    className="cd-ref"
                    title="Ctrl+点击跳转到对应行"
                    style={{
                      color: props.refColorFor
                        ? props.refColorFor(t.seq!)
                        : colorForSeq(t.seq!)
                    }}
                    onClick={(e) => {
                      if (!(e.ctrlKey || e.metaKey)) return
                      e.stopPropagation()
                      props.onRefClick?.(t.seq!)
                    }}
                  >
                    [<span className="cd-ref-num">{t.text}</span>
                    {note && <span className="cd-ref-note">{note}</span>}]
                  </span>
                )
              }
              return <span key={i}>{t.text}</span>
            })}
            {expr.trim() === '' && (
              <span className="cd-placeholder">
                {isActive ? '回车或双击编辑' : '输入表达式，回车起一行'}
              </span>
            )}
          </span>
        )}
        </div>
      </div>

      <div className="cd-result">
        {result.status === 'ok' && (
          <NumberCell
            text={formatNumber(result.value)}
            className="cd-num-result"
            onCopy={props.onCopy}
            onInject={props.onInject}
          />
        )}
        {result.status === 'error' && <span className="cd-error">{result.message}</span>}
        {result.status === 'empty' && <span className="cd-result-empty">=</span>}
      </div>

      {ac &&
        createPortal(
          <div
            ref={acRootRef}
            className={`cd-ac${acFlip ? ' is-flipped' : ''}`}
            style={{ left: acPos.left, top: acPos.top }}
          >
            {acCandidates.length === 0 && (
              <div className="cd-ac-item is-empty-hint">无匹配</div>
            )}
            {acCandidates.map((c, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) acItemRefs.current.set(i, el)
                  else acItemRefs.current.delete(i)
                }}
                className={`cd-ac-item${i === acIndex ? ' is-hot' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectAc(c)
                }}
              >
                <span className="cd-ac-num">{c.label}</span>
                <span className="cd-ac-note">{c.note}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
