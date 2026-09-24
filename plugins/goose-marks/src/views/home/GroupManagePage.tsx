/**
 * GroupManagePage — 分组管理跳页式子页面
 * 双栏：左栏一级分组列表，右栏选中分组的子分组列表
 * 所有操作行内完成，无 modal 弹窗
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useBookmarkStore, TRASH_GROUP_ID } from '../../stores/bookmark'
import type { Group, SubGroup } from '../../types/bookmark'
import { deferInlineRenameCommit, handleInlineRenameEnter } from '@/lib/inlineEditKeys'
import { Ico } from './icon'

interface GroupManagePageProps {
  onBack: () => void
}

type EditState = { kind: 'none' } | { kind: 'rename-group'; id: string; val: string } | { kind: 'rename-sub'; id: string; val: string } | { kind: 'new-group'; val: string } | { kind: 'new-sub'; val: string }
type ConfirmState = { kind: 'none' } | { kind: 'del-group'; id: string } | { kind: 'del-sub'; id: string }
type MoveState = { kind: 'none' } | { kind: 'move-sub'; id: string }

export default function GroupManagePage({ onBack }: GroupManagePageProps) {
  const allGroups = useBookmarkStore((s) => s.groups)
  // 回收站是特殊分组，不参与管理（reorderGroups 内部会自动把它保留在末尾）
  const groups = allGroups.filter((g) => g.id !== TRASH_GROUP_ID)
  const addGroup = useBookmarkStore((s) => s.addGroup)
  const updateGroup = useBookmarkStore((s) => s.updateGroup)
  const removeGroup = useBookmarkStore((s) => s.removeGroup)
  const reorderGroups = useBookmarkStore((s) => s.reorderGroups)
  const addSubGroup = useBookmarkStore((s) => s.addSubGroup)
  const updateSubGroup = useBookmarkStore((s) => s.updateSubGroup)
  const removeSubGroup = useBookmarkStore((s) => s.removeSubGroup)
  const reorderSubGroups = useBookmarkStore((s) => s.reorderSubGroups)
  const moveSubToGroup = useBookmarkStore((s) => s.moveSubToGroup)
  const promoteSubToGroup = useBookmarkStore((s) => s.promoteSubToGroup)

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState>({ kind: 'none' })
  const [confirmState, setConfirmState] = useState<ConfirmState>({ kind: 'none' })
  const [moveState, setMoveState] = useState<MoveState>({ kind: 'none' })

  const inputRef = useRef<HTMLInputElement>(null)

  // 选中分组默认第一个
  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id)
    } else if (selectedGroupId && !groups.find((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? null)
    }
  }, [groups, selectedGroupId])

  // focus 输入
  useEffect(() => {
    if (editState.kind !== 'none') {
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [editState.kind])

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null

  // 计算分组书签总数
  const groupBookmarkCount = (g: Group) =>
    g.children.reduce((s, sub) => s + sub.bookmarkIds.length, 0)

  // Esc 全局
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editState.kind !== 'none') { setEditState({ kind: 'none' }); return }
        if (confirmState.kind !== 'none') { setConfirmState({ kind: 'none' }); return }
        if (moveState.kind !== 'none') { setMoveState({ kind: 'none' }); return }
        onBack()
      }
    },
    [editState, confirmState, moveState, onBack]
  )
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ---- 分组操作 ----
  const commitGroupName = (id: string | null, val: string) => {
    const name = val.trim()
    if (!name) { setEditState({ kind: 'none' }); return }
    if (id) {
      updateGroup(id, name)
    } else {
      const g = addGroup(name)
      setSelectedGroupId(g.id)
    }
    setEditState({ kind: 'none' })
  }

  const moveGroupUp = (idx: number) => {
    if (idx === 0) return
    const next = [...groups]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    reorderGroups(next)
  }

  const moveGroupDown = (idx: number) => {
    if (idx === groups.length - 1) return
    const next = [...groups]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    reorderGroups(next)
  }

  const confirmDeleteGroup = (id: string) => {
    removeGroup(id)
    setConfirmState({ kind: 'none' })
  }

  // ---- 子分组操作 ----
  const commitSubName = (groupId: string, subId: string | null, val: string) => {
    const name = val.trim()
    if (!name) { setEditState({ kind: 'none' }); return }
    if (subId) {
      updateSubGroup(groupId, subId, name)
    } else {
      addSubGroup(name, groupId)
    }
    setEditState({ kind: 'none' })
  }

  const moveSubUp = (subs: SubGroup[], idx: number) => {
    if (!selectedGroupId || idx === 0) return
    const next = [...subs]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    reorderSubGroups(selectedGroupId, next)
  }

  const moveSubDown = (subs: SubGroup[], idx: number) => {
    if (!selectedGroupId || idx === subs.length - 1) return
    const next = [...subs]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    reorderSubGroups(selectedGroupId, next)
  }

  const confirmDeleteSub = (subId: string) => {
    if (!selectedGroupId) return
    removeSubGroup(selectedGroupId, subId)
    setConfirmState({ kind: 'none' })
  }

  const handleMoveSubToGroup = (subId: string, targetGroupId: string) => {
    if (!selectedGroupId) return
    moveSubToGroup(selectedGroupId, subId, targetGroupId)
    setMoveState({ kind: 'none' })
  }

  const handlePromote = (subId: string) => {
    if (!selectedGroupId) return
    promoteSubToGroup(selectedGroupId, subId)
  }

  const subs = selectedGroup?.children ?? []

  return (
    <div className="gm-page">
      {/* 顶部 header */}
      <div className="gm-header">
        <button className="gm-back-btn" onClick={onBack}>
          <Ico name="chevron-left" />
          <span>设置</span>
        </button>
        <h1 className="gm-title">分组管理</h1>
      </div>

      {/* 双栏主体 */}
      <div className="gm-body">
        {/* 左栏：一级分组 */}
        <div className="gm-left">
          <div className="gm-col-label">分组</div>
          <div className="gm-list">
            {groups.length === 0 && editState.kind !== 'new-group' ? (
              <div className="gm-empty">
                <Ico name="folder-open" />
                <span>暂无分组</span>
                <button className="gm-text-btn" onClick={() => setEditState({ kind: 'new-group', val: '' })}>
                  新建分组
                </button>
              </div>
            ) : (
              groups.map((g, idx) => {
                const isSelected = g.id === selectedGroupId
                const isRenaming = editState.kind === 'rename-group' && editState.id === g.id
                const isConfirming = confirmState.kind === 'del-group' && confirmState.id === g.id

                if (isConfirming) {
                  return (
                    <div key={g.id} className="gm-item gm-item-confirm">
                      <span>删除「{g.name}」？含 {g.children.length} 个子分组 · {groupBookmarkCount(g)} 条书签</span>
                      <div className="gm-confirm-btns">
                        <button className="gm-btn-danger" onClick={() => confirmDeleteGroup(g.id)}>确认</button>
                        <button className="gm-btn-ghost" onClick={() => setConfirmState({ kind: 'none' })}>取消</button>
                      </div>
                    </div>
                  )
                }

                if (isRenaming) {
                  return (
                    <div key={g.id} className="gm-item gm-item-editing">
                      <input
                        ref={inputRef}
                        className="gm-inline-input"
                        value={editState.val}
                        onChange={(e) => setEditState({ kind: 'rename-group', id: g.id, val: e.target.value })}
                        onKeyDown={(e) => {
                          handleInlineRenameEnter(e, () => commitGroupName(g.id, editState.val))
                          if (e.key === 'Escape') setEditState({ kind: 'none' })
                        }}
                        onBlur={() => deferInlineRenameCommit(() => commitGroupName(g.id, editState.val))}
                      />
                    </div>
                  )
                }

                return (
                  <div
                    key={g.id}
                    className={`gm-item${isSelected ? ' on' : ''}`}
                    onClick={() => {
                      setSelectedGroupId(g.id)
                      setConfirmState({ kind: 'none' })
                      setMoveState({ kind: 'none' })
                    }}
                  >
                    <span className="gm-item-name">{g.name}</span>
                    <span className="gm-item-badge">{g.children.length} / {groupBookmarkCount(g)}</span>
                    <div className="gm-item-actions">
                      <button
                        title="上移"
                        disabled={idx === 0}
                        onClick={(e) => { e.stopPropagation(); moveGroupUp(idx) }}
                      ><Ico name="chevron-up" /></button>
                      <button
                        title="下移"
                        disabled={idx === groups.length - 1}
                        onClick={(e) => { e.stopPropagation(); moveGroupDown(idx) }}
                      ><Ico name="chevron-down" /></button>
                      <button
                        title="重命名"
                        onClick={(e) => { e.stopPropagation(); setEditState({ kind: 'rename-group', id: g.id, val: g.name }) }}
                      ><Ico name="pencil" /></button>
                      <button
                        title="删除"
                        className="danger"
                        onClick={(e) => { e.stopPropagation(); setConfirmState({ kind: 'del-group', id: g.id }) }}
                      ><Ico name="trash-2" /></button>
                    </div>
                  </div>
                )
              })
            )}

            {/* 新建分组输入行 */}
            {editState.kind === 'new-group' ? (
              <div className="gm-item gm-item-editing">
                <input
                  ref={inputRef}
                  className="gm-inline-input"
                  placeholder="分组名称…"
                  value={editState.val}
                  onChange={(e) => setEditState({ kind: 'new-group', val: e.target.value })}
                  onKeyDown={(e) => {
                    handleInlineRenameEnter(e, () => commitGroupName(null, editState.val))
                    if (e.key === 'Escape') setEditState({ kind: 'none' })
                  }}
                  onBlur={() => {
                    if (editState.val.trim()) commitGroupName(null, editState.val)
                    else setEditState({ kind: 'none' })
                  }}
                />
              </div>
            ) : (
              <button
                className="gm-add-row"
                onClick={() => setEditState({ kind: 'new-group', val: '' })}
              >
                <Ico name="plus" />
                新建分组
              </button>
            )}
          </div>
        </div>

        {/* 右栏：子分组 */}
        <div className="gm-right">
          {selectedGroup ? (
            <>
              <div className="gm-col-label">{selectedGroup.name} · 子分组</div>
              <div className="gm-list">
                {subs.length === 0 && editState.kind !== 'new-sub' ? (
                  <div className="gm-empty">
                    <Ico name="layers" />
                    <span>暂无子分组</span>
                    <button className="gm-text-btn" onClick={() => setEditState({ kind: 'new-sub', val: '' })}>
                      新建子分组
                    </button>
                  </div>
                ) : (
                  subs.map((sub, idx) => {
                    const isRenaming = editState.kind === 'rename-sub' && editState.id === sub.id
                    const isConfirming = confirmState.kind === 'del-sub' && confirmState.id === sub.id
                    const isMoving = moveState.kind === 'move-sub' && moveState.id === sub.id

                    if (isConfirming) {
                      return (
                        <div key={sub.id} className="gm-item gm-item-confirm">
                          <span>删除「{sub.name}」？含 {sub.bookmarkIds.length} 条书签</span>
                          <div className="gm-confirm-btns">
                            <button className="gm-btn-danger" onClick={() => confirmDeleteSub(sub.id)}>确认</button>
                            <button className="gm-btn-ghost" onClick={() => setConfirmState({ kind: 'none' })}>取消</button>
                          </div>
                        </div>
                      )
                    }

                    if (isRenaming) {
                      return (
                        <div key={sub.id} className="gm-item gm-item-editing">
                          <input
                            ref={inputRef}
                            className="gm-inline-input"
                            value={editState.val}
                            onChange={(e) => setEditState({ kind: 'rename-sub', id: sub.id, val: e.target.value })}
                            onKeyDown={(e) => {
                              handleInlineRenameEnter(e, () => commitSubName(selectedGroup.id, sub.id, editState.val))
                              if (e.key === 'Escape') setEditState({ kind: 'none' })
                            }}
                            onBlur={() => deferInlineRenameCommit(() => commitSubName(selectedGroup.id, sub.id, editState.val))}
                          />
                        </div>
                      )
                    }

                    return (
                      <div key={sub.id} className="gm-item">
                        <span className="gm-item-name">{sub.name}</span>
                        <span className="gm-item-badge">{sub.bookmarkIds.length}</span>
                        {isMoving && (
                          <div className="gm-move-dropdown">
                            {groups.filter((g) => g.id !== selectedGroupId).map((g) => (
                              <button key={g.id} onClick={() => handleMoveSubToGroup(sub.id, g.id)}>
                                移到「{g.name}」
                              </button>
                            ))}
                            <button className="gm-btn-ghost" onClick={() => setMoveState({ kind: 'none' })}>取消</button>
                          </div>
                        )}
                        <div className="gm-item-actions">
                          <button
                            title="上移"
                            disabled={idx === 0}
                            onClick={() => moveSubUp(subs, idx)}
                          ><Ico name="chevron-up" /></button>
                          <button
                            title="下移"
                            disabled={idx === subs.length - 1}
                            onClick={() => moveSubDown(subs, idx)}
                          ><Ico name="chevron-down" /></button>
                          <button
                            title="重命名"
                            onClick={() => setEditState({ kind: 'rename-sub', id: sub.id, val: sub.name })}
                          ><Ico name="pencil" /></button>
                          {groups.length > 1 && (
                            <button
                              title="移动到其他分组"
                              onClick={() => setMoveState(
                                moveState.kind === 'move-sub' && moveState.id === sub.id
                                  ? { kind: 'none' }
                                  : { kind: 'move-sub', id: sub.id }
                              )}
                            ><Ico name="arrow-right-left" /></button>
                          )}
                          <button
                            title="提升为一级分组"
                            onClick={() => handlePromote(sub.id)}
                          ><Ico name="arrow-up-to-line" /></button>
                          <button
                            title="删除"
                            className="danger"
                            onClick={() => setConfirmState({ kind: 'del-sub', id: sub.id })}
                          ><Ico name="trash-2" /></button>
                        </div>
                      </div>
                    )
                  })
                )}

                {editState.kind === 'new-sub' ? (
                  <div className="gm-item gm-item-editing">
                    <input
                      ref={inputRef}
                      className="gm-inline-input"
                      placeholder="子分组名称…"
                      value={editState.val}
                      onChange={(e) => setEditState({ kind: 'new-sub', val: e.target.value })}
                      onKeyDown={(e) => {
                        handleInlineRenameEnter(e, () => commitSubName(selectedGroup.id, null, editState.val))
                        if (e.key === 'Escape') setEditState({ kind: 'none' })
                      }}
                      onBlur={() => {
                        if (editState.val.trim()) commitSubName(selectedGroup.id, null, editState.val)
                        else setEditState({ kind: 'none' })
                      }}
                    />
                  </div>
                ) : (
                  <button
                    className="gm-add-row"
                    onClick={() => setEditState({ kind: 'new-sub', val: '' })}
                  >
                    <Ico name="plus" />
                    新建子分组
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="gm-empty gm-empty-right">
              <Ico name="arrow-left" />
              <span>请先选择左侧分组</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
