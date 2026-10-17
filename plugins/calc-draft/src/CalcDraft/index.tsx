import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './index.css'
import {
  docReducer,
  loadWorkspaceManager,
  migrateFromLegacyDoc,
  serializeWorkspaceManager,
  workspaceReducer,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  type Action
} from './state'
import { evaluatePage, formatNumber, upstreamRowIds, type CellResult } from './engine/evaluator'
import { colorForSeq, setPaletteDark } from './palette'
import CalcRow from './components/CalcRow'
import PageTabs from './components/PageTabs'
import WorkspaceBar from './components/WorkspaceBar'
import Toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random())
}

export default function CalcDraft() {
  const [manager, wsDispatch] = useReducer(workspaceReducer, undefined, () => {
    // 工作空间迁移：优先尝试加载新版数据，否则从旧版迁移
    if (typeof localStorage === 'undefined') {
      return loadWorkspaceManager(null)
    }
    const newRaw = localStorage.getItem(STORAGE_KEY)
    if (newRaw) return loadWorkspaceManager(newRaw)
    // 尝试从旧版迁移
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacyRaw) {
      try {
        const legacyDoc = JSON.parse(legacyRaw)
        if (legacyDoc && Array.isArray(legacyDoc.pages)) {
          return migrateFromLegacyDoc(legacyDoc)
        }
      } catch {
        // 忽略迁移失败
      }
    }
    return loadWorkspaceManager(null)
  })

  const [ready, setReady] = useState(false)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [flashRowId, setFlashRowId] = useState<string | null>(null)
  const [confirmDeletePage, setConfirmDeletePage] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null)
  const [pendingSubtitleId, setPendingSubtitleId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const toastTimer = useRef<number | null>(null)

  // 主题：使用浏览器 prefers-color-scheme 媒体查询监听深浅色切换
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (matches: boolean) => {
      setPaletteDark(matches)
      setIsDark(matches)
    }
    apply(mq.matches)
    const fn = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', isDark)
  }, [isDark])

  // 当前工作空间
  const workspace =
    manager.workspaces.find((w) => w.id === manager.activeWorkspaceId) ?? manager.workspaces[0]
  const doc = workspace.doc

  const page =
    doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]

  // 求值当前页（带跨草稿 @ 引用上下文）；任何工作空间变化都会触发重算
  const evaluation = useMemo(() => {
    const ctx = {
      getPageByIndex: (index: number) => doc.pages[index - 1],
      rowMemo: new Map(),
      stack: new Set<string>()
    }
    return evaluatePage(page.rows, ctx)
  }, [manager])

  // 辅助函数：dispatch 草稿 Action 到当前工作空间
  const dispatch = (action: Action) => wsDispatch({ type: 'dispatchToActive', action })

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeWorkspaceManager(manager))
      } catch {
        // 忽略存储失败
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [manager, ready])

  useEffect(() => {
    if (!pendingFocusId) return
    setEditingRowId(pendingFocusId)
    setPendingFocusId(null)
  }, [pendingFocusId, page.rows])

  useEffect(() => {
    if (!pendingSelectId) return
    setActiveRowId(pendingSelectId)
    setPendingSelectId(null)
  }, [pendingSelectId, page.rows])

  useEffect(() => {
    setEditingRowId(null)
    setActiveRowId(null)
  }, [doc.activePageId])

  // 保证最少有一行：页签为空（如旧数据）时自动补一行
  useEffect(() => {
    if (page.rows.length === 0) {
      dispatch({ type: 'addRow', pageId: page.id, rowId: genId(), expr: '' })
    }
  }, [page.id, page.rows.length])

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1500)
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`已抄录 ${text}`)
    } catch {
      showToast('抄录失败')
    }
  }

  const injectRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.classList.contains('cd-input')) {
        injectRef.current = e.target
      }
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  const handleInject = (text: string) => {
    const input = injectRef.current
    if (!input || !document.contains(input)) {
      showToast('先落笔一行，再续写')
      return
    }
    input.focus()
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    const next = input.value.slice(0, start) + text + input.value.slice(end)
    const cursor = start + text.length
    const rowId = input.closest('[data-row-id]')?.getAttribute('data-row-id')
    if (rowId) {
      dispatch({ type: 'editRow', pageId: page.id, rowId, expr: next })
      requestAnimationFrame(() => {
        input.setSelectionRange(cursor, cursor)
      })
    }
  }

  const addRow = (afterRowId?: string) => {
    const rowId = genId()
    dispatch({ type: 'addRow', pageId: page.id, rowId, expr: '', afterRowId })
    setPendingFocusId(rowId)
    return rowId
  }

  const navigateRow = (direction: 'up' | 'down') => {
    const index = page.rows.findIndex((r) => r.id === activeRowId)
    if (index < 0) return
    const next = direction === 'up' ? index - 1 : index + 1
    if (next < 0 || next >= page.rows.length) return
    const row = page.rows[next]
    setActiveRowId(row.id)
    setEditingRowId(row.id)
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-row-id="${row.id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  // Tab 按输入框顺序切换：#1备注 → #1公式 → #2备注 → #2公式 → ...
  const handleInputTab = (fromRowId: string, fromInput: 'expr' | 'subtitle', direction: 'up' | 'down') => {
    const rows = page.rows
    const currentIndex = rows.findIndex((r) => r.id === fromRowId)
    if (currentIndex < 0) return

    let targetRow = currentIndex
    let targetInput: 'expr' | 'subtitle'

    if (direction === 'down') {
      if (fromInput === 'subtitle') {
        targetInput = 'expr'
      } else {
        // expr → next row's subtitle
        if (currentIndex + 1 >= rows.length) return
        targetRow = currentIndex + 1
        targetInput = 'subtitle'
      }
    } else {
      if (fromInput === 'expr') {
        targetInput = 'subtitle'
      } else {
        // subtitle → prev row's expr
        if (currentIndex - 1 < 0) return
        targetRow = currentIndex - 1
        targetInput = 'expr'
      }
    }

    const row = rows[targetRow]
    const sameRow = targetRow === currentIndex
    setEditingRowId(null)
    setActiveRowId(row.id)
    if (targetInput === 'subtitle') {
      setPendingFocusId(null)
      setPendingSubtitleId(row.id)
    } else {
      setPendingSubtitleId(null)
      setPendingFocusId(row.id)
    }
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-row-id="${row.id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    // 同行切换时，blur 会清空 activeRowId，需要恢复
    if (sameRow) {
      requestAnimationFrame(() => {
        setActiveRowId(row.id)
        if (targetInput === 'subtitle') {
          setPendingSubtitleId(row.id)
        } else {
          setPendingFocusId(row.id)
        }
      })
    }
  }

  // Alt+←/→ 字段切换：跨行跳到相邻行的备注/公式（行内切换由 CalcRow 本地处理）
  // Excel 式交互：↑/↓ 选中行（无选中时选视口内第一/最后一行），回车/F2 进入编辑
  useEffect(() => {
    if (editingRowId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('.cd-dialog')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        // 取消选中
        setActiveRowId(null)
        return
      }
      if (e.key === 'Enter' || e.key === 'F2') {
        if (!activeRowId) return
        e.preventDefault()
        setEditingRowId(activeRowId)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        // 无选中：选视口内可见的第一行（↓）/最后一行（↑）
        if (!activeRowId) {
          const bodyRect = document.querySelector('.cd-body')?.getBoundingClientRect()
          if (!bodyRect) return
          const visible = [...document.querySelectorAll('.cd-row')].filter((r) => {
            const t = r.getBoundingClientRect()
            return t.bottom > bodyRect.top + 1 && t.top < bodyRect.bottom - 1
          })
          if (visible.length === 0) return
          const target = e.key === 'ArrowDown' ? visible[0] : visible[visible.length - 1]
          setActiveRowId(target.getAttribute('data-row-id') ?? '')
          return
        }
        const idx = page.rows.findIndex((r) => r.id === activeRowId)
        const next = e.key === 'ArrowUp' ? idx - 1 : idx + 1
        if (next < 0 || next >= page.rows.length) return
        const target = page.rows[next]
        setActiveRowId(target.id)
        // 选中项滚出可视区时，让视图跟上
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-row-id="${target.id}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeRowId, editingRowId, page.rows])

  const rows = page.rows

  const handleMove = (fromId: string, toIndexBase: number, position: 'before' | 'after') => {
    const fromIndex = rows.findIndex((r) => r.id === fromId)
    if (fromIndex < 0) return
    let toIndex = position === 'before' ? toIndexBase : toIndexBase + 1
    if (fromIndex < toIndex) toIndex -= 1
    if (fromIndex === toIndex) return
    dispatch({ type: 'moveRow', pageId: page.id, rowId: fromId, toIndex })
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('.cd-dialog')) return
      const mod = e.metaKey || e.ctrlKey

      // 焦点在输入框内时不拦截（行内编辑由 CalcRow 自行处理）
      const inInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement

      if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        setConfirmDeletePage(true)
      } else if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault()
        setShowShortcuts(false)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'c' && !inInput && activeRowId) {
        e.preventDefault()
        const row = page.rows.find((r) => r.id === activeRowId) || page.rows[page.rows.length - 1]
        if (!row) return
        const res = evaluation.results.get(row.id)
        if (res && res.status === 'ok') handleCopy(formatNumber(res.value))
        else showToast('这一行还没有结果')
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        dispatch({
          type: 'addPage',
          pageId: genId()
        })
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        addRow(page.rows[page.rows.length - 1]?.id)
      } else if (!mod && e.key === 'Enter' && !inInput && !activeRowId && !editingRowId) {
        // 无行选中/编辑时，回车在末尾新建一行
        e.preventDefault()
        addRow(page.rows[page.rows.length - 1]?.id)
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault()
        const num = e.key === '0' ? 10 : Number(e.key)
        const row = page.rows[num - 1]
        if (!row) {
          showToast(`＃${num} 还没写`)
          return
        }
        setActiveRowId(row.id)
        setEditingRowId(row.id)
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const rowId = activeRowId
        if (!rowId) return
        e.preventDefault()
        const fromIndex = page.rows.findIndex((r) => r.id === rowId)
        if (fromIndex < 0) return
        const toIndex = e.key === 'ArrowUp' ? fromIndex - 1 : fromIndex + 1
        if (toIndex < 0 || toIndex >= page.rows.length) return
        dispatch({ type: 'moveRow', pageId: page.id, rowId, toIndex })
        showToast(`已移到 ＃${toIndex + 1}`)
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Alt+Left/Right 切换草稿页
        if (doc.pages.length <= 1) return
        e.preventDefault()
        const currentIndex = doc.pages.findIndex((p) => p.id === page.id)
        if (currentIndex < 0) return
        const nextIndex = e.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1
        if (nextIndex < 0 || nextIndex >= doc.pages.length) return
        dispatch({ type: 'setActivePage', pageId: doc.pages[nextIndex].id })
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && activeRowId && !inInput && !editingRowId) {
        // 选中模式下 Backspace / Delete 删除当前行
        e.preventDefault()
        const row = page.rows.find((r) => r.id === activeRowId)
        if (!row) return
        const index = page.rows.findIndex((r) => r.id === row.id)
        if (page.rows.length <= 1) {
          dispatch({ type: 'editRow', pageId: page.id, rowId: row.id, expr: '' })
          return
        }
        setEditingRowId(null)
        setActiveRowId(null)
        const neighbor = page.rows[index + 1] ?? page.rows[index - 1]
        if (neighbor && neighbor.id !== row.id) setPendingSelectId(neighbor.id)
        dispatch({ type: 'deleteRow', pageId: page.id, rowId: row.id })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page, activeRowId, editingRowId, evaluation, showShortcuts])

  // 点击 #N 跳转到对应行：滚动 + 闪烁高亮，不进入编辑
  const flashTimer = useRef<number | null>(null)
  const jumpToRow = (targetId: string) => {
    setFlashRowId(targetId)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashRowId(null), 1200)
    document
      .querySelector(`[data-row-id="${targetId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const upstream = activeRowId ? upstreamRowIds(evaluation.directDeps, activeRowId) : new Set<string>()

  // 标题被省略号截断时才启用 hover 浮层
  const titleRef = useRef<HTMLSpanElement | null>(null)
  const [titleTruncated, setTitleTruncated] = useState(false)
  useEffect(() => {
    const check = () => {
      const el = titleRef.current
      setTitleTruncated(!!el && el.scrollWidth > el.clientWidth + 1)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [page.name])

  return (
    <div className="calc-draft">
      {/* 工作空间悬浮按钮 */}
      <WorkspaceBar
        workspaces={manager.workspaces}
        activeWorkspaceId={manager.activeWorkspaceId}
        onSwitch={(workspaceId) => wsDispatch({ type: 'switchWorkspace', workspaceId })}
        onCreate={() => wsDispatch({ type: 'addWorkspace', workspaceId: genId() })}
        onRename={(workspaceId, name) =>
          wsDispatch({ type: 'renameWorkspace', workspaceId, name })
        }
        onDelete={(workspaceId) =>
          wsDispatch({ type: 'deleteWorkspace', workspaceId })
        }
      />

      <div className="cd-sheet">
      <header className="cd-topbar">
        <div className={`cd-title${titleTruncated ? ' is-truncated' : ''}`} title={page.name}>
          <span className="cd-title-text" ref={titleRef}>
            {page.name}
          </span>
          {titleTruncated && (
            <span className="cd-title-pop" aria-hidden="true">
              {page.name}
            </span>
          )}
        </div>
        <PageTabs
          pages={doc.pages}
          activePageId={doc.activePageId}
          onCreate={() =>
            dispatch({
              type: 'addPage',
              pageId: genId()
            })
          }
          onRename={(pageId, name) => dispatch({ type: 'renamePage', pageId, name })}
          onSwitch={(pageId) => dispatch({ type: 'setActivePage', pageId })}
        />
        <button
          className="cd-page-delete"
          title="删除当前草稿页"
          onClick={() => setConfirmDeletePage(true)}
        >
          删除草稿
        </button>
        <button
          className="cd-shortcuts-btn"
          title="快捷键"
          onClick={() => setShowShortcuts(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
        </button>
        <div className="cd-meta">
          {page.rows.length} 行
        </div>
      </header>

      <main className={`cd-body${activeRowId ? ' has-focus' : ''}${dragging ? ' is-dragging' : ''}`}>
        {page.rows.length === 0 ? (
          <div className="cd-empty">落第一笔：输入表达式，回车起一行 · ＃1 引用上文结果</div>
        ) : (
          <div className="cd-rows">            {page.rows.map((row, index) => {
              const result: CellResult = evaluation.results.get(row.id) ?? { status: 'empty' }
              const activeRowNum = activeRowId
                ? page.rows.findIndex((r) => r.id === activeRowId) + 1
                : 0
              const inboundFrom =
                activeRowId && activeRowNum > 0 && upstream.has(row.id)
                  ? evaluation.directDeps.get(activeRowId)?.includes(row.id)
                    ? activeRowNum
                    : undefined
                  : undefined
              const refColorFor = (pos: number) => {
                const target = page.rows[pos - 1]
                return target ? colorForSeq(target.seq) : '#8b94b5'
              }
              return (
                <CalcRow
                  key={row.id}
                  rowId={row.id}
                  index={index}
                  seq={row.seq}
                  expr={row.expr}
                  subtitle={row.subtitle}
                  result={result}
                  color={colorForSeq(row.seq)}
                  refColorFor={refColorFor}
                  refSubtitleFor={(pos) => page.rows[pos - 1]?.subtitle}
                  refOptions={page.rows.map((r, i) => ({ pos: i + 1, subtitle: r.subtitle }))}
                  pageOptions={doc.pages.map((p) => ({
                    id: p.id,
                    name: p.name,
                    rows: p.rows.map((r, i) => ({ pos: i + 1, subtitle: r.subtitle }))
                  }))}
                  atSubtitleFor={(page) => doc.pages[Number(page) - 1]?.name}
                  atRowSubtitleFor={(page, ref) =>
                    doc.pages[Number(page) - 1]?.rows[Number(ref) - 1]?.subtitle
                  }
                  onAtClick={(page, ref) => {
                    const targetPage = doc.pages[Number(page) - 1]
                    if (!targetPage) {
                      showToast(`未找到第 ${page} 个草稿`)
                      return
                    }
                    const row = targetPage.rows[Number(ref) - 1]
                    if (!row) {
                      showToast(`草稿「${targetPage.name}」中没有第 ${ref} 行`)
                      return
                    }
                    const go = () => {
                      setFlashRowId(row.id)
                      if (flashTimer.current) window.clearTimeout(flashTimer.current)
                      flashTimer.current = window.setTimeout(() => setFlashRowId(null), 1200)
                      document
                        .querySelector(`[data-row-id="${row.id}"]`)
                        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    }
                    if (targetPage.id !== doc.activePageId) {
                      dispatch({ type: 'setActivePage', pageId: targetPage.id })
                      window.setTimeout(go, 80)
                    } else {
                      go()
                    }
                  }}
                  isEditing={editingRowId === row.id}
                  isActive={activeRowId === row.id}
                  isUpstream={activeRowId !== row.id && upstream.has(row.id)}
                  inboundFrom={inboundFrom}
                  isFlashed={flashRowId === row.id}
                  onRefClick={(pos) => {
                    const target = page.rows[pos - 1]
                    if (target) jumpToRow(target.id)
                    else showToast(`＃${pos} 还没写`)
                  }}
                  onChange={(expr) =>
                    dispatch({ type: 'editRow', pageId: page.id, rowId: row.id, expr })
                  }
                  onFocus={() => setActiveRowId(row.id)}
                  onBlur={() => {
                    setActiveRowId((current) => (current === row.id ? null : current))
                    setEditingRowId((current) => (current === row.id ? null : current))
                  }}
                  onEnter={() => addRow(row.id)}
                  onEscape={() => {
                    // Esc 退回选中模式，保留选中态
                    setEditingRowId(null)
                  }}
                  onNavigate={navigateRow}
                  onInputTab={(fromInput, direction) => handleInputTab(row.id, fromInput, direction)}
                  subtitleFocusPending={pendingSubtitleId === row.id}
                  onSubtitleChange={(subtitle) =>
                    dispatch({ type: 'editSubtitle', pageId: page.id, rowId: row.id, subtitle })
                  }
                  onCopy={handleCopy}
                  onInject={handleInject}
                  onRequestEdit={() => {
                    setEditingRowId(row.id)
                    setActiveRowId(row.id)
                  }}
                  onDelete={() => {
                    // 至少保留一行：删最后一行改为清空内容
                    if (page.rows.length <= 1) {
                      dispatch({ type: 'editRow', pageId: page.id, rowId: row.id, expr: '' })
                      return
                    }
                    setEditingRowId((c) => (c === row.id ? null : c))
                    setActiveRowId((c) => (c === row.id ? null : c))
                    const neighbor = page.rows[index + 1] ?? page.rows[index - 1]
                    if (neighbor && neighbor.id !== row.id) setPendingFocusId(neighbor.id)
                    dispatch({ type: 'deleteRow', pageId: page.id, rowId: row.id })
                  }}
                  onMove={handleMove}
                  onDragStateChange={setDragging}
                />
              )
            })}
          </div>
        )}
        <div
          className="cd-fill"
          title="双击新建一行"
          onDoubleClick={() => addRow(page.rows[page.rows.length - 1]?.id)}
        >
          {Array.from({ length: 40 }, (_, i) => (
            <i key={i}>
              {i === 0 && !activeRowId && !editingRowId && (
                <span className="cd-fill-hint">双击或回车，新建一行</span>
              )}
            </i>
          ))}
        </div>
      </main>

      <footer className="cd-statusbar"></footer>

      <Toast message={toast} />

      {showShortcuts && (
        <div className="cd-shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="cd-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cd-shortcuts-header">
              <h2>快捷键</h2>
              <button className="cd-shortcuts-close" onClick={() => setShowShortcuts(false)}>
                ✕
              </button>
            </div>
            <div className="cd-shortcuts-body">
              <section>
                <h3>公式行</h3>
                <dl>
                  <dt>Enter / F2 / 双击</dt><dd>进入当前选中行的编辑模式</dd>
                  <dt>Ctrl/Cmd + C</dt><dd>复制当前选中行（或末行）结果到剪贴板</dd>
                  <dt>Ctrl/Cmd + Enter</dt><dd>在末尾插入新行并聚焦</dd>
                  <dt>Alt + ↑ / Alt + ↓</dt><dd>移动公式行并同步引用</dd>
                  <dt>Tab</dt><dd>切换输入焦点到下一个输入框</dd>
                  <dt>Alt + Backspace</dt><dd>编辑模式下删除当前行</dd>
                  <dt>Backspace / Delete</dt><dd>选中模式下删除当前行</dd>
                </dl>
              </section>
              <section>
                <h3>草稿页</h3>
                <dl>
                  <dt>Ctrl/Cmd + Shift + N</dt><dd>新建草稿页</dd>
                  <dt>Ctrl/Cmd + Shift + W</dt><dd>删除草稿页</dd>
                  <dt>Alt + ← / Alt + →</dt><dd>切换草稿标签页</dd>
                </dl>
              </section>
              <section>
                <h3>鼠标</h3>
                <dl>
                  <dt>Ctrl/Cmd + 单击 @页#行</dt><dd>引用跳转</dd>
                  <dt>Alt + 单击数字按钮</dt><dd>注入到当前编辑光标处</dd>
                </dl>
              </section>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeletePage}
        title="删除草稿"
        message={`删除「${page.name}」？该草稿的所有行与引用都会移除。`}
        confirmText="删除"
        danger
        onConfirm={() => {
          dispatch({ type: 'deletePage', pageId: page.id })
          setConfirmDeletePage(false)
        }}
        onCancel={() => setConfirmDeletePage(false)}
      />
      </div>
    </div>
  )
}
