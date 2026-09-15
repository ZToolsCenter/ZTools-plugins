/**
 * SidebarNav —— 侧栏导航（分组 + 子分组 + 回收站）
 * 包含：
 *  - 右键菜单 / hover ⋯ 按钮（分组/子分组编辑操作）
 *  - 内联重命名 / 新建子分组（一级分组的新建已移至顶栏 Tab 栏）
 *  - 排序（上移/下移）、移动、提升为一级分组、删除（带二次确认）
 *
 * 警告：本文件对 TDZ 极度敏感。所有 const/useCallback 必须严格按使用顺序声明，
 * 禁止在声明前引用（见 vite-build-misses-hook-tdz.md）。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Group, SubGroup } from '@/types/bookmark'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import type { HomeGroup } from './viewModel'
import { deferInlineRenameCommit, handleInlineRenameEnter } from '@/lib/inlineEditKeys'
import { Ico } from './icon'

// ── SortableNavItem：侧栏子分组可拖拽单项（模块顶层，避免 TDZ）────────────
interface SortableNavItemProps {
  id: string
  name: string
  count: number
  isActive: boolean
  isEditing: boolean
  groupId: string
  inputVal: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onSubClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMoreClick: (e: React.MouseEvent) => void
  onInputChange: (val: string) => void
  onInputKeyDown: (e: React.KeyboardEvent) => void
  onInputBlur: () => void
}

function SortableNavItem({
  id,
  name,
  count,
  isActive,
  isEditing,
  groupId,
  inputVal,
  inputRef,
  onSubClick,
  onContextMenu,
  onMoreClick,
  onInputChange,
  onInputKeyDown,
  onInputBlur,
}: SortableNavItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled: isEditing,
    data: { type: 'sub', groupId },
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`nav-item${isActive ? ' on' : ''} nav-item-editing`}
      >
        <input
          ref={inputRef}
          className="sidebar-inline-input"
          value={inputVal}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={onInputBlur}
        />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`nav-item nav-item-hoverable${isActive ? ' on' : ''}${isDragging ? ' dragging' : ''}${isOver ? ' drop-over' : ''}`}
      data-nav-type="sub"
      data-group-id={groupId}
      data-sub-id={id}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSubClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSubClick() } }}
      onContextMenu={onContextMenu}
    >
      <span>{name}</span>
      <span className="nav-item-trailing">
        <span className="count nav-item-count">{count}</span>
        <button
          className="nav-icon-btn nav-item-more"
          title="更多操作"
          onClick={onMoreClick}
        >
          <Ico name="more-horizontal" />
        </button>
      </span>
    </div>
  )
}

// ── 菜单状态机 ──────────────────────────────────────────────────────────────
type MenuTarget =
  | { type: 'group'; groupId: string }
  | { type: 'sub'; groupId: string; subId: string }

type MenuMode = 'menu' | 'move' | 'confirmDelete'

interface NavMenuState {
  open: boolean
  x: number
  y: number
  target: MenuTarget | null
  mode: MenuMode
}

// ── 编辑态 ───────────────────────────────────────────────────────────────────
type EditingState =
  | { kind: 'renameGroup'; groupId: string }
  | { kind: 'renameSub'; groupId: string; subId: string }
  | { kind: 'newSub'; groupId: string }
  | null

// ── Props ────────────────────────────────────────────────────────────────────
export interface SidebarNavProps {
  homeGroups: HomeGroup[]
  activeGroupId: string | null
  activeSubId: string | null
  screen: string
  onSubClick: (groupId: string, subId: string) => void
  fireToast: (title?: string) => void
  onActiveSubIdFix: (subId: string, groupId: string) => void
  /** 主动定位信号：每次自增表示"本次 activeSubId 变化由用户主动操作触发，应居中"。被动滚动跟随不传/不变。 */
  centerSignal?: number
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────
/** 找到分组在 raw groups 中的索引（排除回收站）*/
function getNonTrashGroups(groups: Group[]): Group[] {
  return groups.filter((g) => g.id !== TRASH_GROUP_ID && !g.isDeleted)
}

// ── 主组件 ───────────────────────────────────────────────────────────────────
export default function SidebarNav({
  homeGroups,
  activeGroupId,
  activeSubId,
  screen,
  onSubClick,
  fireToast,
  onActiveSubIdFix,
  centerSignal,
}: SidebarNavProps) {
  // 只显示当前选中一级分组；若 activeGroupId 为空则回退到第一个
  const visibleGroups = activeGroupId
    ? homeGroups.filter((g) => g.id === activeGroupId)
    : homeGroups.slice(0, 1)
  // ── store actions ─────────────────────────────────────────────────────────
  const updateGroup = useBookmarkStore((s) => s.updateGroup)
  const removeGroup = useBookmarkStore((s) => s.removeGroup)
  const addSubGroup = useBookmarkStore((s) => s.addSubGroup)
  const updateSubGroup = useBookmarkStore((s) => s.updateSubGroup)
  const removeSubGroup = useBookmarkStore((s) => s.removeSubGroup)
  const reorderGroups = useBookmarkStore((s) => s.reorderGroups)
  const reorderSubGroups = useBookmarkStore((s) => s.reorderSubGroups)
  const moveSubToGroup = useBookmarkStore((s) => s.moveSubToGroup)
  const promoteSubToGroup = useBookmarkStore((s) => s.promoteSubToGroup)

  // ── 局部状态 ──────────────────────────────────────────────────────────────
  const [menu, setMenu] = useState<NavMenuState>({
    open: false,
    x: 0,
    y: 0,
    target: null,
    mode: 'menu',
  })
  const [editing, setEditing] = useState<EditingState>(null)
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  // ── 打开菜单 ──────────────────────────────────────────────────────────────
  const openMenu = useCallback(
    (e: { clientX: number; clientY: number; preventDefault?: () => void }, target: MenuTarget) => {
      e.preventDefault?.()
      // 计算菜单位置（fixed 相对视口，clamp 保证不出屏）
      const menuW = 200
      const menuH = 260
      const vw = window.innerWidth
      const vh = window.innerHeight
      const x = Math.min(e.clientX, vw - menuW - 8)
      const y = Math.min(e.clientY, vh - menuH - 8)
      setMenu({ open: true, x: Math.max(8, x), y: Math.max(8, y), target, mode: 'menu' })
    },
    []
  )

  const closeMenu = useCallback(() => {
    setMenu((prev) => (prev.open ? { ...prev, open: false, target: null } : prev))
  }, [])

  // ── 关闭菜单：点外部 / Esc ────────────────────────────────────────────────
  useEffect(() => {
    if (!menu.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) closeMenu()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick, { capture: true })
    }
  }, [menu.open, closeMenu])

  // ── 编辑 input autoFocus ──────────────────────────────────────────────────
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  // ── 编辑：Esc 关闭 ────────────────────────────────────────────────────────
  const cancelEditing = useCallback(() => {
    setEditing(null)
    setInputVal('')
  }, [])

  // ── 被动跟随（内容区滚动反向更新 activeSubId）：高亮项在可视区内就不动，仅快滑出上/下边缘时轻轻滚一下 ──
  // 这样滚动内容时侧栏安静，不会一直把自己往中间拽导致抖动。瞬时定位避免与内容区 smooth 打架。
  useEffect(() => {
    const aside = asideRef.current
    if (!aside || !activeSubId) return
    const el = aside.querySelector<HTMLElement>(`[data-sub-id="${activeSubId}"]`)
    if (!el) return
    const aRect = aside.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const MARGIN = (el.offsetHeight || 31) * 1.5 // 距上下边缘小于 1.5 项高度才触发，留出缓冲
    const topGap = eRect.top - aRect.top
    const bottomGap = aRect.bottom - eRect.bottom
    if (topGap < MARGIN) {
      aside.scrollTo({ top: aside.scrollTop + (topGap - MARGIN), behavior: 'auto' })
    } else if (bottomGap < MARGIN) {
      aside.scrollTo({ top: aside.scrollTop + (MARGIN - bottomGap), behavior: 'auto' })
    }
  }, [activeSubId])

  // ── 主动定位（点击侧栏 / 键盘导航）：把高亮项滚到侧栏正中。由 centerSignal 自增触发，与被动跟随分离。 ──
  useEffect(() => {
    if (centerSignal == null) return
    const aside = asideRef.current
    if (!aside || !activeSubId) return
    const el = aside.querySelector<HTMLElement>(`[data-sub-id="${activeSubId}"]`)
    if (!el) return
    const aRect = aside.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const delta = (eRect.top - aRect.top) - (aside.clientHeight - eRect.height) / 2
    if (Math.abs(delta) < 1) return
    aside.scrollTo({ top: aside.scrollTop + delta, behavior: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerSignal])

  // ── activeSubId 修复：操作后检查并回调 ───────────────────────────────────
  // 修复范围用 visibleGroups（当前分组内检查），不在当前分组时回退到首个子分组
  const fixActiveSubIfNeeded = useCallback(
    (newGroups?: HomeGroup[]) => {
      const src = newGroups ?? visibleGroups
      // 检查 activeSubId 是否还在
      for (const g of src) {
        for (const s of g.subs) {
          if (s.id === activeSubId) return // 还在，无需修复
        }
      }
      // 不存在了，回退到第一个子分组
      const first = src[0]?.subs[0]
      if (first) {
        onActiveSubIdFix(first.id, src[0].id)
      }
    },
    [visibleGroups, activeSubId, onActiveSubIdFix]
  )

  // activeSubId 变化时也检查（store 变更后 homeGroups 重新计算触发重渲染，此时 fix）
  useEffect(() => {
    fixActiveSubIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeGroups])

  // ── 侧栏右键委托 ──────────────────────────────────────────────────────────
  const onAsideContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const el = e.target as HTMLElement
      const grpLabel = el.closest<HTMLElement>('[data-nav-type="group"]')
      const navItem = el.closest<HTMLElement>('[data-nav-type="sub"]')
      if (grpLabel) {
        openMenu(e, { type: 'group', groupId: grpLabel.dataset.groupId! })
      } else if (navItem) {
        openMenu(e, { type: 'sub', groupId: navItem.dataset.groupId!, subId: navItem.dataset.subId! })
      }
    },
    [openMenu]
  )

  // ── 提交重命名 ────────────────────────────────────────────────────────────
  const submitRename = useCallback(() => {
    if (!editing) return
    const val = inputVal.trim()
    if (editing.kind === 'renameGroup') {
      const orig = homeGroups.find((g) => g.id === editing.groupId)?.name ?? ''
      if (val && val !== orig) updateGroup(editing.groupId, val)
    } else if (editing.kind === 'renameSub') {
      const grp = homeGroups.find((g) => g.id === editing.groupId)
      const orig = grp?.subs.find((s) => s.id === editing.subId)?.name ?? ''
      if (val && val !== orig) updateSubGroup(editing.groupId, editing.subId, val)
    } else if (editing.kind === 'newSub') {
      if (val) addSubGroup(val, editing.groupId)
    }
    cancelEditing()
  }, [editing, inputVal, homeGroups, updateGroup, updateSubGroup, addSubGroup, cancelEditing])

  // ── input 键盘处理 ────────────────────────────────────────────────────────
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      handleInlineRenameEnter(e, submitRename)
      if (e.key === 'Escape') cancelEditing()
    },
    [submitRename, cancelEditing]
  )

  const onInputBlur = useCallback(() => {
    deferInlineRenameCommit(submitRename)
  }, [submitRename])

  // ── 菜单操作 ─────────────────────────────────────────────────────────────
  const startRenameGroup = useCallback(
    (groupId: string) => {
      closeMenu()
      const orig = homeGroups.find((g) => g.id === groupId)?.name ?? ''
      setInputVal(orig)
      setEditing({ kind: 'renameGroup', groupId })
    },
    [closeMenu, homeGroups]
  )

  const startRenameSub = useCallback(
    (groupId: string, subId: string) => {
      closeMenu()
      const grp = homeGroups.find((g) => g.id === groupId)
      const orig = grp?.subs.find((s) => s.id === subId)?.name ?? ''
      setInputVal(orig)
      setEditing({ kind: 'renameSub', groupId, subId })
    },
    [closeMenu, homeGroups]
  )

  const startNewSub = useCallback(
    (groupId: string) => {
      closeMenu()
      setInputVal('')
      setEditing({ kind: 'newSub', groupId })
    },
    [closeMenu]
  )

  // ── 排序操作（操作 store 原始 groups） ───────────────────────────────────
  const moveGroupUp = useCallback(
    (groupId: string) => {
      closeMenu()
      const rawGroups = useBookmarkStore.getState().groups.filter((g) => g.id !== TRASH_GROUP_ID && !g.isDeleted)
      const idx = rawGroups.findIndex((g) => g.id === groupId)
      if (idx <= 0) return
      const next = [...rawGroups]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      reorderGroups(next)
    },
    [closeMenu, reorderGroups]
  )

  const moveGroupDown = useCallback(
    (groupId: string) => {
      closeMenu()
      const rawGroups = useBookmarkStore.getState().groups.filter((g) => g.id !== TRASH_GROUP_ID && !g.isDeleted)
      const idx = rawGroups.findIndex((g) => g.id === groupId)
      if (idx < 0 || idx >= rawGroups.length - 1) return
      const next = [...rawGroups]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      reorderGroups(next)
    },
    [closeMenu, reorderGroups]
  )

  const moveSubUp = useCallback(
    (groupId: string, subId: string) => {
      closeMenu()
      const rawGroup = useBookmarkStore.getState().groups.find((g) => g.id === groupId)
      if (!rawGroup) return
      const children = rawGroup.children.filter((c) => !c.isDeleted)
      const idx = children.findIndex((c) => c.id === subId)
      if (idx <= 0) return
      const next = [...children]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      reorderSubGroups(groupId, next)
    },
    [closeMenu, reorderSubGroups]
  )

  const moveSubDown = useCallback(
    (groupId: string, subId: string) => {
      closeMenu()
      const rawGroup = useBookmarkStore.getState().groups.find((g) => g.id === groupId)
      if (!rawGroup) return
      const children = rawGroup.children.filter((c) => !c.isDeleted)
      const idx = children.findIndex((c) => c.id === subId)
      if (idx < 0 || idx >= children.length - 1) return
      const next = [...children]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      reorderSubGroups(groupId, next)
    },
    [closeMenu, reorderSubGroups]
  )

  const doMoveSubToGroup = useCallback(
    (sourceGroupId: string, subId: string, targetGroupId: string) => {
      closeMenu()
      const ok = moveSubToGroup(sourceGroupId, subId, targetGroupId)
      if (!ok) fireToast('移动失败')
      else fixActiveSubIfNeeded()
    },
    [closeMenu, moveSubToGroup, fireToast, fixActiveSubIfNeeded]
  )

  const doPromote = useCallback(
    (groupId: string, subId: string) => {
      closeMenu()
      const result = promoteSubToGroup(groupId, subId)
      if (!result) fireToast('提升失败')
      else fixActiveSubIfNeeded()
    },
    [closeMenu, promoteSubToGroup, fireToast, fixActiveSubIfNeeded]
  )

  const confirmDelete = useCallback(() => {
    setMenu((prev) => ({ ...prev, mode: 'confirmDelete' }))
  }, [])

  const doDelete = useCallback(() => {
    if (!menu.target) return
    let ok = false
    if (menu.target.type === 'group') {
      ok = removeGroup(menu.target.groupId)
      if (!ok) fireToast('至少保留一个分组')
    } else {
      ok = removeSubGroup(menu.target.groupId, menu.target.subId)
      if (!ok) fireToast('至少保留一个子分组')
    }
    if (ok) fixActiveSubIfNeeded()
    closeMenu()
  }, [menu.target, removeGroup, removeSubGroup, fireToast, fixActiveSubIfNeeded, closeMenu])

  const switchToMoveMode = useCallback(() => {
    setMenu((prev) => ({ ...prev, mode: 'move' }))
  }, [])

  const backToMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, mode: 'menu' }))
  }, [])

  // 用于显示"删除XX？"的名称
  const menuTargetName = useCallback(() => {
    if (!menu.target) return ''
    if (menu.target.type === 'group') {
      return homeGroups.find((g) => g.id === (menu.target as { type: 'group'; groupId: string }).groupId)?.name ?? ''
    }
    const t = menu.target as { type: 'sub'; groupId: string; subId: string }
    const grp = homeGroups.find((g) => g.id === t.groupId)
    return grp?.subs.find((s) => s.id === t.subId)?.name ?? ''
  }, [menu.target, homeGroups])

  // ── 菜单内容渲染 ─────────────────────────────────────────────────────────
  const renderMenu = useCallback(() => {
    if (!menu.open || !menu.target) return null
    const target = menu.target

    if (menu.mode === 'confirmDelete') {
      const name = menuTargetName()
      return (
        <div
          ref={menuRef}
          className="ctx-menu sidebar-ctx-menu"
          style={{ display: 'flex', position: 'fixed', left: menu.x, top: menu.y, zIndex: 200 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sidebar-ctx-confirm-msg">
            <span>删除「{name}」？</span>
            <span className="sidebar-ctx-confirm-sub">书签将移入回收站</span>
          </div>
          <div className="ctx-sep" />
          <button className="danger" onClick={doDelete}>
            <Ico name="trash-2" />
            确认删除
          </button>
          <button onClick={closeMenu}>
            <Ico name="x" />
            取消
          </button>
        </div>
      )
    }

    if (menu.mode === 'move' && target.type === 'sub') {
      const t = target as { type: 'sub'; groupId: string; subId: string }
      const otherGroups = homeGroups.filter((g) => g.id !== t.groupId)
      return (
        <div
          ref={menuRef}
          className="ctx-menu sidebar-ctx-menu"
          style={{ display: 'flex', position: 'fixed', left: menu.x, top: menu.y, zIndex: 200 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sidebar-ctx-move-title">移动到…</div>
          {otherGroups.map((g) => (
            <button key={g.id} onClick={() => doMoveSubToGroup(t.groupId, t.subId, g.id)}>
              <Ico name="folder" />
              {g.name}
            </button>
          ))}
          <div className="ctx-sep" />
          <button onClick={backToMenu}>
            <Ico name="arrow-left" />
            返回
          </button>
        </div>
      )
    }

    // mode === 'menu'
    if (target.type === 'group') {
      const gId = target.groupId
      const gIdx = homeGroups.findIndex((g) => g.id === gId)
      const isFirst = gIdx === 0
      const isLast = gIdx === homeGroups.length - 1
      return (
        <div
          ref={menuRef}
          className="ctx-menu sidebar-ctx-menu"
          style={{ display: 'flex', position: 'fixed', left: menu.x, top: menu.y, zIndex: 200 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => startRenameGroup(gId)}>
            <Ico name="pencil" />
            重命名
          </button>
          <button onClick={() => startNewSub(gId)}>
            <Ico name="plus" />
            新建子分组
          </button>
          {!isFirst && (
            <button onClick={() => moveGroupUp(gId)}>
              <Ico name="chevron-up" />
              上移
            </button>
          )}
          {!isLast && (
            <button onClick={() => moveGroupDown(gId)}>
              <Ico name="chevron-down" />
              下移
            </button>
          )}
          <div className="ctx-sep" />
          <button className="danger" onClick={confirmDelete}>
            <Ico name="trash-2" />
            删除分组
          </button>
        </div>
      )
    }

    // target.type === 'sub'
    const t = target as { type: 'sub'; groupId: string; subId: string }
    const grp = homeGroups.find((g) => g.id === t.groupId)
    const subs = grp?.subs ?? []
    const sIdx = subs.findIndex((s) => s.id === t.subId)
    const isFirst = sIdx === 0
    const isLast = sIdx === subs.length - 1
    const canMove = homeGroups.length > 1

    return (
      <div
        ref={menuRef}
        className="ctx-menu sidebar-ctx-menu"
        style={{ display: 'flex', position: 'fixed', left: menu.x, top: menu.y, zIndex: 200 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={() => startRenameSub(t.groupId, t.subId)}>
          <Ico name="pencil" />
          重命名
        </button>
        {!isFirst && (
          <button onClick={() => moveSubUp(t.groupId, t.subId)}>
            <Ico name="chevron-up" />
            上移
          </button>
        )}
        {!isLast && (
          <button onClick={() => moveSubDown(t.groupId, t.subId)}>
            <Ico name="chevron-down" />
            下移
          </button>
        )}
        {canMove && (
          <button onClick={switchToMoveMode}>
            <Ico name="arrow-right" />
            移动到其他分组
          </button>
        )}
        <button onClick={() => doPromote(t.groupId, t.subId)}>
          <Ico name="arrow-up-to-line" />
          提升为一级分组
        </button>
        <div className="ctx-sep" />
        <button className="danger" onClick={confirmDelete}>
          <Ico name="trash-2" />
          删除
        </button>
      </div>
    )
  }, [
    menu,
    homeGroups,
    menuTargetName,
    startRenameGroup,
    startNewSub,
    startRenameSub,
    moveGroupUp,
    moveGroupDown,
    moveSubUp,
    moveSubDown,
    switchToMoveMode,
    doPromote,
    doMoveSubToGroup,
    confirmDelete,
    doDelete,
    closeMenu,
    backToMenu,
  ])

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <>
      <aside ref={asideRef} className="sidebar" onContextMenu={onAsideContextMenu}>
        {visibleGroups.map((g) => {
          return (
            <div className="grp" key={g.id}>
              {/* 子分组分区标题：hover 右侧浮现 + 就地新建（一级分组标题已移至顶栏 Tab） */}
              <div className="sub-sec-head">
                <span className="sub-sec-title">子分组</span>
                <button
                  className="sub-sec-add"
                  title="新建子分组"
                  onClick={() => startNewSub(g.id)}
                >
                  <Ico name="plus" />
                </button>
              </div>
              <SortableContext items={g.subs.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {g.subs.map((s) => {
                    const isRenamingSub =
                      editing?.kind === 'renameSub' && editing.groupId === g.id && editing.subId === s.id
                    const isActive = s.id === activeSubId
                    return (
                      <SortableNavItem
                        key={s.id}
                        id={s.id}
                        name={s.name}
                        count={s.items.length}
                        isActive={isActive}
                        isEditing={isRenamingSub}
                        groupId={g.id}
                        inputVal={inputVal}
                        inputRef={inputRef}
                        onSubClick={() => onSubClick(g.id, s.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openMenu(e, { type: 'sub', groupId: g.id, subId: s.id })
                        }}
                        onMoreClick={(e) => {
                          e.stopPropagation()
                          openMenu(e, { type: 'sub', groupId: g.id, subId: s.id })
                        }}
                        onInputChange={setInputVal}
                        onInputKeyDown={onInputKeyDown}
                        onInputBlur={onInputBlur}
                      />
                    )
                  })}
                </SortableContext>

              {/* 新建子分组 inline input */}
              {editing?.kind === 'newSub' && editing.groupId === g.id && (
                <div className="nav-item nav-item-editing">
                  <input
                    ref={inputRef}
                    className="sidebar-inline-input"
                    placeholder="子分组名称…"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    onBlur={onInputBlur}
                  />
                </div>
              )}
            </div>
          )
        })}

      </aside>

      {/* 侧栏菜单（fixed 定位，逃出 sidebar overflow） */}
      {renderMenu()}
    </>
  )
}
