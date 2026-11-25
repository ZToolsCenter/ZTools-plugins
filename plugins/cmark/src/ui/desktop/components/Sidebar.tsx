import { useEffect, useMemo, useState, useRef } from 'react'
import type { TreeNode } from '../../../types/global.d.ts'
import { useNotes } from '../../../service/store/notes'
import { getPorts } from '../../../runtime/ports'
import { PromptDialog, ConfirmDialog } from '../../shared/components/Dialogs'
import { BranchBar } from './BranchBar'
import { IconChevron, IconGear } from '../../shared/components/icons'
import { noteState, notes } from '../../../runtime/legacy-bridge'

/** 数某个目录下的笔记数量（删除文件夹前的非空判断，不必读全文） */
function countNotesIn(nodes: TreeNode[], dirRel: string): number {
  const walk = (list: TreeNode[]): number =>
    list.reduce<number>((acc, n) => acc + (n.type === 'note' ? 1 : walk(n.children || [])), 0)
  for (const n of nodes) {
    if (n.rel === dirRel) return walk(n.children || [])
    if (n.children?.length) {
      const sub = countNotesIn(n.children, dirRel)
      if (sub > 0) return sub
    }
  }
  return 0
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

function Row(props: {
  node: TreeNode
  depth: number
  open: Set<string>
  toggle: (id: string) => void
  active: string
  onPick: (rel: string) => void
  onMenu: (e: React.MouseEvent, node: TreeNode) => void
  /** 行右侧快捷操作 */
  onQuickNewNote?: (dirRel: string) => void
  onQuickNewFolder?: (dirRel: string) => void
  onQuickOpenBrowser?: (rel: string) => void
  onQuickReveal?: (rel: string) => void
  dragRel: string | null
  dragOver: DragOver | null
  setDragRel: (v: string | null) => void
  setDragOver: (v: DragOver | null) => void
  onDrop: (src: string, targetDir: string) => void
  onReorder?: (src: string, target: string, zone: 'before' | 'after') => void
}) {
  const { node, depth, open, toggle, active, onPick, onMenu } = props
  const isFolder = node.type === 'folder'
  const expanded = open.has(node.id)
  const overZone = props.dragOver?.rel === node.rel && props.dragRel !== node.rel ? props.dragOver.zone : null
  const isDragging = props.dragRel === node.rel
  const rowRef = useRef<HTMLDivElement>(null)
  /** 鼠标是否停在行右侧的按钮区域（只有停在那块上才浮出快捷操作） */
  const [inRightZone, setInRightZone] = useState(false)

  // 用键盘在命中列表里移动时，当前行可能滚出可视区，这里保证它始终可见
  useEffect(() => {
    if (active !== node.rel) return
    const el = rowRef.current
    if (!el) return
    try {
      el.scrollIntoView({ block: 'nearest' })
    } catch (e) {}
  }, [active, node.rel])

  return (
    <div
      ref={rowRef}
      className={
        'row' +
        (active === node.rel ? ' active' : '') +
        (overZone ? ' drop-' + overZone : '') +
        (isDragging ? ' dragging' : '')
      }
      style={{ paddingLeft: 4 + depth * 14 }}
      draggable
      onDragStart={(e) => {
        props.setDragRel(node.rel)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', node.rel)
      }}
      onDragOver={(e) => {
        if (!props.dragRel || props.dragRel === node.rel) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        // 落点三态：文件夹上 28% 插到前面、下 28% 插到后面、中间移入；
        // 笔记只有上下两段（不能"移入"一篇笔记）
        const r = e.currentTarget.getBoundingClientRect()
        const ratio = (e.clientY - r.top) / Math.max(r.height, 1)
        const zone: DropZone = isFolder
          ? ratio < 0.28
            ? 'before'
            : ratio > 0.72
              ? 'after'
              : 'inside'
          : ratio < 0.5
            ? 'before'
            : 'after'
        if (props.dragOver?.rel !== node.rel || props.dragOver?.zone !== zone) {
          props.setDragOver({ rel: node.rel, zone })
        }
      }}
      onDragLeave={() => {
        if (props.dragOver?.rel === node.rel) props.setDragOver(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const src = props.dragRel || e.dataTransfer.getData('text/plain')
        const zone = props.dragOver?.rel === node.rel ? props.dragOver.zone : isFolder ? 'inside' : 'after'
        props.setDragOver(null)
        props.setDragRel(null)
        if (!src || src === node.rel) return
        const targetDir = dirOf(node.rel)
        // 移入文件夹
        if (zone === 'inside' && isFolder) {
          props.onDrop(src, node.rel)
          return
        }
        // 跨目录：先移到目标所在目录（排序只在同一层内做）
        if (dirOf(src) !== targetDir) {
          props.onDrop(src, targetDir)
          return
        }
        props.onReorder?.(src, node.rel, zone === 'inside' ? 'after' : zone)
      }}
      onDragEnd={() => {
        props.setDragRel(null)
        props.setDragOver(null)
      }}
      onClick={() => (isFolder ? toggle(node.id) : onPick(node.rel))}
      onContextMenu={(e) => onMenu(e, node)}
      title={node.rel}
    >
      <span className="caret">{isFolder ? <IconChevron open={expanded} /> : null}</span>
      <span className="label">{node.name}</span>

      <span
        className={'row-actions-slot' + (inRightZone ? ' is-open' : '')}
        style={{ width: isFolder ? 42 : 21 }}
        onMouseOver={() => setInRightZone(true)}
        onMouseOut={(e) => {
          const to = e.relatedTarget as Node | null
          // 移到自己的子按钮上不算离开
          if (to && (e.currentTarget as HTMLElement).contains(to)) return
          setInRightZone(false)
        }}
      >
        {inRightZone ? (
        <span className="row-actions">
          {isFolder ? (
            <>
              <button
                type="button"
                title="新建文件夹"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onQuickNewFolder?.(node.rel)
                }}
              >
                <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.2 1.5h5.2A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z" />
                  <path d="M8 7.5v3M6.5 9h3" />
                </svg>
              </button>
              <button
                type="button"
                title="新建笔记"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onQuickNewNote?.(node.rel)
                }}
              >
                <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5z" />
                  <path d="M9.5 2.5v3h3" />
                  <path d="M8 8.5v3M6.5 10h3" />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button"
              title="用默认程序打开（.md 关联的程序）"
              onClick={(e) => {
                e.stopPropagation()
                props.onQuickOpenBrowser?.(node.rel)
              }}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="5.7" />
                <path d="M2.4 8h11.2M8 2.3c1.6 1.7 2.4 3.6 2.4 5.7S9.6 12 8 13.7C6.4 12 5.6 10.1 5.6 8S6.4 4 8 2.3z" />
              </svg>
            </button>
          )}
        </span>
        ) : null}
      </span>
    </div>
  )
}

function Branch(props: Omit<React.ComponentProps<typeof Row>, 'node' | 'depth'> & { nodes: TreeNode[]; depth: number }) {
  const { nodes, depth, ...rest } = props
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <Row node={n} depth={depth} {...rest} />
          {n.type === 'folder' && rest.open.has(n.id) && n.children && n.children.length > 0 && (
            <Branch nodes={n.children} depth={depth + 1} {...rest} />
          )}
        </div>
      ))}
    </>
  )
}


/** 右键菜单图标（path 取自 V1.0.0 sidebar-menu.js） */
const ICONS = {
  folder: (
    <svg viewBox="0 0 16 16">
      <path d="M1.75 3A1.75 1.75 0 0 1 3.5 1.25h2.31c.46 0 .9.18 1.22.5l1.06 1.06h4.41A1.75 1.75 0 0 1 14.25 4.5v8A1.75 1.75 0 0 1 12.5 14.25h-9A1.75 1.75 0 0 1 1.75 12.5V3zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .14.11.25.25.25h9a.25.25 0 0 0 .25-.25V4.5a.25.25 0 0 0-.25-.25H7.88L6.5 2.88a.25.25 0 0 0-.18-.07H3.5z" />
    </svg>
  ),
  open: (
    <svg viewBox="0 0 16 16">
      <path d="M1.75 3A1.75 1.75 0 0 1 3.5 1.25h2.31c.46 0 .9.18 1.22.5l1.06 1.06h4.41A1.75 1.75 0 0 1 14.25 4.5v1.2c-.28-.1-.58-.16-.9-.16H1.75V3zm0 4.29h11.5l.29.03v.02l-1.9 5.7a1.2 1.2 0 0 1-1.14.81H3.5a1.75 1.75 0 0 1-1.75-1.75V7.29z" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 16 16">
      <path d="M2.75 1A1.75 1.75 0 0 0 1 2.75v10.5C1 14.22 1.78 15 2.75 15h6.6a4.5 4.5 0 0 1-1.3-6.28 4.5 4.5 0 0 1 5.2-1.6V2.75A1.75 1.75 0 0 0 11.5 1H2.75zm0 1.5h8.75a.25.25 0 0 1 .25.25v2.4a4.5 4.5 0 0 0-1.5-.26V4.25A.75.75 0 0 0 9.5 3.5H4.25a.75.75 0 0 0 0 1.5h4v3.9a4.5 4.5 0 0 0-2.4 3.35H2.75a.25.25 0 0 1-.25-.25V2.75c0-.14.11-.25.25-.25z" />
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm.75 1.5v1.75H14a.75.75 0 0 1 0 1.5h-1.25V15a.75.75 0 0 1-1.5 0v-1.75H10a.75.75 0 0 1 0-1.5h1.25V10a.75.75 0 0 1 1.5 0z" />
    </svg>
  ),
  rename: (
    <svg viewBox="0 0 16 16">
      <path d="M11.7 1.3a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L5.9 13.1l-3.4.9a.6.6 0 0 1-.7-.7l.9-3.4L11.7 1.3zm.9 1.2L3.4 11.7l-.5 1.9 1.9-.5L14 3.9l-1.4-1.4z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 16 16">
      <path d="M5 1.75A1.75 1.75 0 0 1 6.75 0h5.5A1.75 1.75 0 0 1 14 1.75v7.5A1.75 1.75 0 0 1 12.25 11h-1v1.25A1.75 1.75 0 0 1 9.5 14h-5.5A1.75 1.75 0 0 1 2.25 12.25v-7.5A1.75 1.75 0 0 1 4 3h1V1.75zM4 4.5a.25.25 0 0 0-.25.25v7.5c0 .14.11.25.25.25h5.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25H4zm3-3a.25.25 0 0 0-.25.25V3h2.75A1.75 1.75 0 0 1 11.25 4.75V9.5h1a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25H7z" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 16 16">
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3zm0 1.5A1.5 1.5 0 0 1 9.5 4v2h-3V4A1.5 1.5 0 0 1 8 2.5zM4.5 7.5h7v6h-7v-6z" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 16 16">
      <path d="M6 1.75A.75.75 0 0 1 6.75 1h2.5a.75.75 0 0 1 .75.75V2.5h2.75a.75.75 0 0 1 0 1.5h-.53l-.66 9.3A1.75 1.75 0 0 1 9.82 15H6.18a1.75 1.75 0 0 1-1.74-1.7L3.78 4h-.53a.75.75 0 0 1 0-1.5H6v-.75zM5.29 4l.64 9.13a.25.25 0 0 0 .25.24h3.64a.25.25 0 0 0 .25-.24L10.71 4H5.29z" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 16 16">
      <path d="M2 3.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.25zm0 9.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75zM8 5.6l3.1 3.1a.75.75 0 0 1-1.06 1.06L8 7.72l-2.04 2.04A.75.75 0 1 1 4.9 8.7L8 5.6z" />
    </svg>
  ),
}

/**
 * 按搜索命中表过滤目录树，同时收集「需要展开」的目录 id。
 * 命中来源有两类（对齐 V1.0.0）：
 *   文件名命中   field = 'title'
 *   正文命中     field = 'content'
 */
function filterTree(
  nodes: TreeNode[],
  hits: Record<string, unknown>,
  q: unknown
): { nodes: TreeNode[]; expand: string[] } {
  const kw = String(q ?? '').trim().toLowerCase()
  if (!kw) return { nodes, expand: [] }
  const expand = new Set<string>()
  const isHit = (rel?: string) => !!rel && Object.prototype.hasOwnProperty.call(hits, rel)

  const walk = (list: TreeNode[]): TreeNode[] =>
    list
      .map((n) => {
        const selfHit = n.name.toLowerCase().includes(kw)
        if (n.type === 'folder') {
          if (selfHit) {
            // 目录名命中：整棵保留，且自身展开
            expand.add(n.id)
            return n
          }
          const kids = walk(n.children || [])
          if (kids.length) {
            expand.add(n.id)
            return { ...n, children: kids }
          }
          return null
        }
        return isHit(n.rel) || selfHit ? n : null
      })
      .filter(Boolean) as TreeNode[]

  return { nodes: walk(nodes), expand: [...expand] }
}

/** 拖拽落点：before/after = 插到目标上/下方（同级排序），inside = 移入文件夹 */
export type DropZone = 'before' | 'inside' | 'after'
export type DragOver = { rel: string; zone: DropZone }

export function Sidebar({
  onOpenGitPanel,
  onOpenSettings,
}: {
  onOpenGitPanel: () => void
  onOpenSettings: () => void
}) {
  const tree = useNotes((s) => s.tree)
  const searchTerm = useNotes((s) => s.searchTerm)
  const searchHits = useNotes((s) => s.searchHits)
  const hitOrder = useNotes((s) => s.hitOrder)
  const buildIndex = useNotes((s) => s.buildIndex)

  // 过滤 + 收集要展开的目录
  const filtered = useMemo(
    () => filterTree(tree, searchHits, searchTerm),
    [tree, searchHits, searchTerm]
  )
  const expandKey = filtered.expand.join('|')

  /**
   * 搜索时把命中所在目录展开一次。
   * 关键：同一批命中只展开一次 —— 展开后用户手动折叠，不能再被弹开，
   * 所以用 ref 记住「这批 expand 已经处理过」，只有命中集合变了才重新展开。
   */
  const expandedOnceRef = useRef('')
  useEffect(() => {
    if (!String(searchTerm || '').trim()) {
      expandedOnceRef.current = ''
      return
    }
    if (!expandKey) return
    if (expandKey === expandedOnceRef.current) return
    expandedOnceRef.current = expandKey
    const ids = expandKey.split('|').filter(Boolean)
    setOpen((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [expandKey, searchTerm])
  const currentRel = useNotes((s) => s.currentRel)
  const refreshTree = useNotes((s) => s.refreshTree)
  const openNote = useNotes((s) => s.openNote)
  const setMessage = useNotes((s) => s.setMessage)
  const locked = useNotes((s) => s.locked)
  const clearCurrent = useNotes((s) => s.clearCurrent)

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  /** 自绘弹窗：原生 prompt 在 Electron 里不可用，原生 confirm 会抢焦点让宿主隐藏窗口 */
  const [dlg, setDlg] = useState<
    | { kind: 'prompt'; title: string; value: string; onSubmit: (v: string) => void }
    | { kind: 'confirm'; message: string; okText: string; danger?: boolean; onOk: () => void }
    | null
  >(null)
  const [dragRel, setDragRel] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<DragOver | null>(null)

  useEffect(() => {
    refreshTree()
  }, [refreshTree])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const contextDir = useMemo(() => {
    if (!menu?.node) return ''
    if (menu.node.type === 'folder') return menu.node.rel
    return dirOf(menu.node.rel)
  }, [menu])

  /**
   * 右键菜单：左键点页面任意位置都关（V1.0.0 的做法），
   * 同时补上 Esc / 滚动 / 窗口尺寸变化。
   * 排除菜单自身与右键本身，否则菜单刚弹出来就被关掉。
   */
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (e.button === 2) return
      const el = e.target as HTMLElement | null
      if (el && el.closest && el.closest('.zctx')) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onScroll = () => setMenu(null)
    const onResize = () => setMenu(null)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [menu])

  const newNode = (kind: 'note' | 'folder', dirRel?: string) => {
    // dirRel 由行右侧的快捷按钮传入；右键菜单走 contextDir
    const dir = dirRel !== undefined ? dirRel : contextDir
    setMenu(null)
    setDlg({
      kind: 'prompt',
      title: kind === 'note' ? '新建笔记' : '新建文件夹',
      value: kind === 'note' ? '未命名' : '新建文件夹',
      onSubmit: (name) => {
        setDlg(null)
        void (async () => {
          const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim()
          if (!clean) {
            setMessage('名称不能为空')
            return
          }
          const base = (dir ? dir + '/' : '') + clean
          // 端口层只认完整 rel，扩展名由这里补，避免各端各自猜
          const rel = kind === 'note' && !/\.(md|markdown)$/i.test(clean) ? base + '.md' : base
          const r = await getPorts().ws.create(rel, kind === 'note' ? 'note' : 'folder', '')
          if (!r.ok) {
            setMessage(r.message || '创建失败')
            return
          }
          refreshTree()
          // 新文件要能立刻被搜到（索引只在启动时建过）
          window.setTimeout(() => { void buildIndex() }, 120)
          if (kind === 'note') openNote(r.value.rel)
          // 新建完成后把目标目录展开，否则折叠状态下看不到刚建出来的东西
          // 树节点的 id 就等于 rel，可以直接加进 open 集合
          // 搜索态下新文件通常不匹配当前关键词，会被过滤看不见，这里顺手清掉搜索
          try {
            const sn = (useNotes.getState() as unknown as { searchNotes?: (v: string) => void }).searchNotes
            if (sn && useNotes.getState().searchTerm) sn('')
          } catch (e) {}
          if (dir) {
            setOpen((prev) => {
              if (prev.has(dir)) return prev
              const next = new Set(prev)
              next.add(dir)
              return next
            })
          }
        })()
      },
    })
  }

  const rename = () => {
    const node = menu?.node
    setMenu(null)
    if (!node) return
    setDlg({
      kind: 'prompt',
      title: node.type === 'note' ? '重命名笔记' : '重命名文件夹',
      value: node.name,
      onSubmit: (next) => {
        setDlg(null)
        doRename(node, next)
      },
    })
  }

  const doRename = (node: TreeNode, next: string) => {
    if (!next || next === node.name) return
    void (async () => {
      // 改的是当前打开的笔记：先把未保存内容写进旧路径，否则改名后 openNote 的 save 会重建成旧文件
      if (node.rel === currentRel) {
        const st = useNotes.getState()
        if (st.content !== st.savedContent) {
          await st.save()
          // save 可能因为只读/写失败/冲突而没落盘，那就不能改名，否则未保存内容永久丢失
          if (useNotes.getState().content !== useNotes.getState().savedContent) {
            setMessage('当前笔记还有未保存的改动，改名已取消', 3600)
            return
          }
        }
      }
      const r = await getPorts().ws.rename(node.rel, next)
      if (!r.ok) {
        setMessage(r.message || '重命名失败')
        return
      }
      refreshTree()
      if (node.type === 'note') {
        // 动态指令是 note/<rel> 写死的路径，改名后旧 code 就成了死链，必须跟着搬
        try {
          const z = (window as unknown as {
            ztools?: { removeFeature?: (code: string) => void; setFeature?: (f: unknown) => void }
          }).ztools
          z?.removeFeature?.('note/' + node.rel)
          const st = await getPorts().ws.noteState(r.value.rel)
          if (st.ok && st.value.near) {
            const title = r.value.rel.split('/').pop()!.replace(/\.(md|markdown)$/i, '')
            z?.setFeature?.({ code: 'note/' + r.value.rel, icon: 'logo.png', explain: '打开笔记「' + title + '」', cmds: [title] })
          }
        } catch (e) {}
        openNote(r.value.rel)
      }
      window.setTimeout(() => { void buildIndex() }, 120)
    })()
  }

  const del = () => {
    const node = menu?.node
    setMenu(null)
    if (!node) return
    void (async () => {
      if (node.type === 'folder') {
        const n = countNotesIn(tree, node.rel)
        if (n > 0) {
          setMessage(`文件夹内仍有 ${n} 篇笔记，请先移出或删除后再试`, 4000)
          return
        }
      }
      const tip =
        node.type === 'note'
          ? `删除笔记「${node.name}」？\n删除后将无法恢复，请确认是否继续。`
          : `删除文件夹「${node.name}」？`
      setDlg({
        kind: 'confirm',
        message: tip,
        okText: '删除',
        danger: true,
        onOk: () => {
          setDlg(null)
          void (async () => {
            if (node.rel === currentRel) clearCurrent()
            const r = await getPorts().ws.remove(node.rel)
            if (!r.ok) {
              setMessage(r.message || '删除失败')
              return
            }
            refreshTree()
            // 删掉的笔记若设过全局搜索，指令留着就是死链，会点开一个「已不存在」
            try {
              ;(window as unknown as { ztools?: { removeFeature?: (code: string) => void } }).ztools?.removeFeature?.('note/' + node.rel)
            } catch (e) {}
            window.setTimeout(() => { void buildIndex() }, 120)
          })()
        },
      })
    })()
  }

  const duplicate = () => {
    const node = menu?.node
    setMenu(null)
    if (!node) return
    void (async () => {
      const r = await getPorts().ws.duplicate(node.rel)
      if (!r.ok) {
        setMessage(r.message || '复制失败')
        return
      }
      refreshTree()
      setMessage('已复制一份', 1600)
    })()
  }

  const reveal = () => {
    const node = menu?.node
    setMenu(null)
    if (node) void getPorts().shell.revealInFolder(node.rel)
  }

  const toggleLock = () => {
    const node = menu?.node
    setMenu(null)
    if (!node || node.type !== 'note') return
    const useNotesState = useNotes.getState()
    const cur = noteState()?.readNoteState?.(node.rel)?.locked
    if (node.rel === useNotesState.currentRel) {
      useNotesState.toggleLocked()
      return
    }
    const r = noteState()?.setNoteLocked?.(node.rel, !cur)
    setMessage(r?.ok ? (!cur ? '已设为只读' : '已取消只读') : r?.message || '操作失败', 1800)
  }

  const doMove = (src: string, targetDir: string) => {
    if (dirOf(src) === targetDir) return

    void (async () => {
      const st = useNotes.getState()

      // 被移动的东西是否会影响当前打开的笔记：
      //   1) 拖的就是这篇笔记本身
      //   2) 拖的是它所在的目录（或更上层目录）—— 移动后 currentRel 直接失效
      const insideSubtree = !!currentRel && (currentRel === src || currentRel.startsWith(src + '/'))
      const moving = currentRel === src

      if (insideSubtree && st.content !== st.savedContent) {
        // 未保存的编辑必须先落盘并确认成功，否则移动后 openNote 会把没保存的内容丢掉
        await st.save()
        const after = useNotes.getState()
        if (after.content !== after.savedContent) {
          setMessage('有未保存的改动，已暂停移动，请稍后重试', 2600)
          return
        }
      }

      const r = await getPorts().ws.move(src, targetDir)
      if (!r.ok) {
        setMessage(r.message || '移动失败')
        return
      }

      // 移动后重新定位当前笔记，否则 currentRel 指向不存在的路径，
      // 后续 save 会命中 exists 守卫并把未落盘内容标记成「已保存」
      if (insideSubtree && currentRel) {
        const newRel = moving ? r.value.rel : r.value.rel + currentRel.slice(src.length)
        useNotes.getState().openNote(newRel)
      }
      refreshTree()
    })()
  }

  /** 拖到同一目录下的某个条目上：把 src 挪到 target 的位置，写 order.txt */
  const reorder = (srcRel: string, targetRel: string, zone: 'before' | 'after' = 'after') => {
    if (srcRel === targetRel) return
    const clone = structuredClone(tree) as TreeNode[]
    const parentOf = (rel: string) => dirOf(rel)
    const wantDir = parentOf(targetRel)
    if (parentOf(srcRel) !== wantDir) return

    // 找到同一层的数组
    const findList = (list: TreeNode[], dir: string): TreeNode[] | null => {
      for (const n of list) {
        if (n.type === 'folder') {
          if (n.rel === dir) return n.children || []
          const sub = findList(n.children || [], dir)
          if (sub) return sub
        }
      }
      return dir === '' ? list : null
    }
    const list = findList(clone, wantDir)
    if (!list) return

    const si = list.findIndex((n) => n.rel === srcRel)
    if (si < 0 || list.findIndex((n) => n.rel === targetRel) < 0) return
    const [moved] = list.splice(si, 1)
    // 摘掉 src 之后 target 的下标会变，必须重新找
    const ti = list.findIndex((n) => n.rel === targetRel)
    if (ti < 0) return
    list.splice(zone === 'before' ? ti : ti + 1, 0, moved)

    void (async () => {
      const r = await getPorts().ws.saveOrder(clone)
      if (!r.ok) setMessage(r.message || '排序保存失败')
      refreshTree()
    })()
  }

  // 拖到空白处 = 移到根目录
  const rootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const src = dragRel || e.dataTransfer.getData('text/plain')
    setDragOver(null)
    setDragRel(null)
    if (src && dirOf(src) !== '') doMove(src, '')
  }

  const collapseAll = () => setOpen(new Set())

  /* 行右侧快捷操作：复用右键菜单那套实现 */
  const quickNewNote = (dirRel: string) => newNode('note', dirRel)
  const quickNewFolder = (dirRel: string) => newNode('folder', dirRel)
  const quickReveal = (rel: string) => {
    void getPorts().shell.revealInFolder(rel)
  }
    /**
   * 在浏览器中打开：直接打开真实的笔记文件。
   * 用户的浏览器装了 Markdown 渲染插件，能直接渲染 .md；
   * 之前生成临时 HTML 的做法改变了路径来源，图片相对路径也全是断的。
   *
   * 宿主接口现在返回 Promise（preload 用 electron.shell.openPath 拿真实错误信息），
   * 所以这里必须 await：否则 Promise 没有 ok 字段，成功也会被判成失败。
   */
  const quickOpenBrowser = (rel: string) => {
    void (async () => {
      try {
        const r = await notes().openNoteInBrowser?.(rel)
        if (!r) setMessage('打开失败：宿主接口不可用', 3600)
        else if (!r.ok) setMessage('打开失败：' + (r.message || '未知错误'), 4000)
        else setMessage('已在浏览器中打开', 1800)
      } catch (e) {
        setMessage('在浏览器中打开失败：' + (e as Error).message, 4000)
      }
    })()
  }


  /**
   * 只有「有目录展开 且 内容溢出」时才显示右下角的折叠按钮：
   * 没展开时折叠没意义，没溢出时用户能直接看到全部，也不需要。
   */
  const treeRef = useRef<HTMLDivElement>(null)

  /**
   * 搜索后把焦点交给目录树。
   *
   * 宿主顶部搜索框是宿主自己渲染的元素，它的按键不会转发给插件页面，
   * 只要焦点停在那儿，↑↓ 就永远到不了插件，命中切换等于不存在。
   * 所以 searchNotes 打开首个命中后会派发 cmark-focus-tree，这里把焦点收到树上，
   * 用户立刻可以 ↑↓ 翻命中；想改关键词按 Ctrl+F 回到搜索框。
   */
  useEffect(() => {
    const h = () => {
      try {
        treeRef.current?.focus({ preventScroll: true })
      } catch (e) {}
    }
    window.addEventListener('cmark-focus-tree', h)
    return () => window.removeEventListener('cmark-focus-tree', h)
  }, [])

  /** ↑↓ 切到折叠目录里的笔记时，把它的祖先目录展开，否则树上看不到当前位置 */
  useEffect(() => {
    const h = (ev: Event) => {
      const rel = String((ev as CustomEvent<string>).detail || '')
      if (!rel) return
      const parts = rel.split('/')
      parts.pop()
      if (!parts.length) return
      const ancestors: string[] = []
      let acc = ''
      for (const seg of parts) {
        acc = acc ? acc + '/' + seg : seg
        ancestors.push(acc)
      }
      setOpen((prev) => {
        if (ancestors.every((a) => prev.has(a))) return prev
        const next = new Set(prev)
        for (const a of ancestors) next.add(a)
        return next
      })
    }
    window.addEventListener('cmark-reveal-note', h)
    return () => window.removeEventListener('cmark-reveal-note', h)
  }, [])
  const [treeOverflow, setTreeOverflow] = useState(false)
  useEffect(() => {
    const el = treeRef.current
    if (!el) return
    const check = () => {
      try {
        setTreeOverflow(el.scrollHeight > el.clientHeight + 4)
      } catch (e) {}
    }
    check()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(check)
      ro.observe(el)
    } catch (e) {}
    window.addEventListener('resize', check)
    return () => {
      try {
        ro?.disconnect()
      } catch (e) {}
      window.removeEventListener('resize', check)
    }
  }, [tree, open, searchTerm])

  return (
    <aside className="sidebar">
      {/* 顶部分支栏 36px */}
      <BranchBar onOpenPanel={onOpenGitPanel} />

      {String(searchTerm || '').trim() ? (
        <div className="tree-hitbar">
          <span className="tree-hitbar-count">
            {hitOrder.length
              ? `${
                  hitOrder.indexOf(currentRel) < 0 ? 0 : hitOrder.indexOf(currentRel) + 1
                }/${hitOrder.length}`
              : '0/0'}
          </span>
          <span className="tree-hitbar-tip">↑↓ 切换命中 · Esc 清除搜索</span>
        </div>
      ) : null}

      <div
        className="tree"
        ref={treeRef}
        tabIndex={0}
        onContextMenu={(e) => {
          // 空白处右键：新建到根目录
          if (e.target === e.currentTarget) {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, node: null })
          }
        }}
        onDragOver={(e) => {
          if (dragRel) {
            e.preventDefault()
            // 空白处不是某一行的落点，只清掉行级高亮（拖到空白 = 移到根目录）
            if (dragOver) setDragOver(null)
          }
        }}
        onDrop={rootDrop}
      >
        {String(searchTerm || '').trim() && filtered.nodes.length === 0 ? (
          <div className="tree-empty">没有匹配「{searchTerm}」的笔记</div>
        ) : tree.length === 0 ? (
          <div className="tree-empty">右键新建笔记</div>
        ) : (
          <Branch
            nodes={filtered.nodes}
            depth={0}
            open={open}
            toggle={toggle}
            onQuickNewNote={quickNewNote}
            onQuickNewFolder={quickNewFolder}
            onQuickOpenBrowser={quickOpenBrowser}
            onQuickReveal={quickReveal}
            active={currentRel}
            onPick={openNote}
            onMenu={(e, node) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, node })
            }}
            dragRel={dragRel}
            dragOver={dragOver}
            setDragRel={setDragRel}
            setDragOver={setDragOver}
            onDrop={doMove}
            onReorder={reorder}
          />
        )}
      </div>

      {/* 底部设置条 43px */}
      <div className="footer">
        <button onClick={onOpenSettings}>
          <IconGear />
          设置
        </button>
      </div>

      {open.size > 0 && treeOverflow ? (
        <button
          type="button"
          className="tree-collapse-fab"
          title="折叠全部目录"
          onClick={collapseAll}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5 8 5.5l4 4" />
            <path d="M4 13 8 9l4 4" />
          </svg>
        </button>
      ) : null}

      {menu && (
        <div
          className="zctx"
          style={{
            left: Math.min(menu.x, window.innerWidth - 160),
            top: Math.min(menu.y, window.innerHeight - 300),
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.node ? (
            <>
              <button type="button" onClick={() => newNode('note')}>
                {ICONS.note}
                <span>新建笔记</span>
              </button>
              <button type="button" onClick={() => newNode('folder')}>
                {ICONS.folder}
                <span>新建文件夹</span>
              </button>
              <div className="zctx-sep" />
              <button type="button" onClick={rename}>
                {ICONS.rename}
                <span>重命名</span>
              </button>
              <button type="button" onClick={duplicate}>
                {ICONS.copy}
                <span>复制一份</span>
              </button>
              <button type="button" onClick={reveal}>
                {ICONS.open}
                <span>在资源管理器中打开</span>
              </button>
              {menu.node.type === 'note' ? (
                <button type="button" onClick={toggleLock}>
                  {ICONS.lock}
                  <span>{locked && menu.node.rel === currentRel ? '取消只读' : '设为只读'}</span>
                </button>
              ) : null}
              <div className="zctx-sep" />
              <button type="button" className="danger" onClick={del}>
                {ICONS.trash}
                <span>删除</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => newNode('folder')}>
                {ICONS.folder}
                <span>新建文件夹</span>
              </button>
              <button type="button" onClick={() => newNode('note')}>
                {ICONS.note}
                <span>新建笔记</span>
              </button>
              <div className="zctx-sep" />
              <button type="button" onClick={reveal}>
                {ICONS.open}
                <span>在资源管理器中打开</span>
              </button>
              <div className="zctx-sep" />
              <button type="button" onClick={collapseAll}>
                {ICONS.collapse}
                <span>折叠全部</span>
              </button>
            </>
          )}
        </div>
      )}

      {dlg?.kind === 'prompt' ? (
        <PromptDialog
          title={dlg.title}
          defaultValue={dlg.value}
          onSubmit={(v) => dlg.onSubmit(v)}
          onCancel={() => setDlg(null)}
        />
      ) : null}

      {dlg?.kind === 'confirm' ? (
        <ConfirmDialog
          message={dlg.message}
          okText={dlg.okText}
          danger={dlg.danger}
          onOk={() => dlg.onOk()}
          onCancel={() => setDlg(null)}
        />
      ) : null}
    </aside>
  )
}
