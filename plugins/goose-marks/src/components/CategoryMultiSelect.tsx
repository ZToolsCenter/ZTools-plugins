import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { BookmarkLocation } from '@/types/bookmark'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import { cn } from '@/lib/utils'
import { deferInlineRenameCommit, handleInlineRenameEnter } from '@/lib/inlineEditKeys'

/**
 * CategoryMultiSelect（React 版）
 * 样式由 .goose-home .form-category-select 下的 home.css 接管（勿用 bg-primary/bg-popover 等全局 token，避免深色露白）。
 */
export interface CategoryMultiSelectProps {
  value: BookmarkLocation[]
  onChange: (value: BookmarkLocation[]) => void
  readonly?: boolean
  inline?: boolean
  onClose?: () => void
}

export function CategoryMultiSelect({
  value,
  onChange,
  readonly,
  inline,
  onClose
}: CategoryMultiSelectProps) {
  const groups = useBookmarkStore((s) => s.groups)
  const addSubGroup = useBookmarkStore((s) => s.addSubGroup)
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null)
  const [addVal, setAddVal] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  const displayGroups = useMemo(
    () => groups.filter((g) => g.id !== TRASH_GROUP_ID),
    [groups]
  )

  useEffect(() => {
    if (addingGroupId) addInputRef.current?.focus()
  }, [addingGroupId])

  const isSelected = (groupId: string, subGroupId: string) =>
    value.some((loc) => loc.groupId === groupId && loc.subGroupId === subGroupId)

  const toggleLocation = (groupId: string, subGroupId: string) => {
    if (readonly) return
    onChange(
      isSelected(groupId, subGroupId)
        ? value.filter((loc) => !(loc.groupId === groupId && loc.subGroupId === subGroupId))
        : [...value, { groupId, subGroupId }]
    )
  }

  const removeLocation = (loc: BookmarkLocation) => {
    if (readonly) return
    onChange(value.filter((l) => !(l.groupId === loc.groupId && l.subGroupId === loc.subGroupId)))
  }

  const getLocationLabel = (loc: BookmarkLocation) => {
    const group = groups.find((g) => g.id === loc.groupId)
    const sub = group?.children.find((c) => c.id === loc.subGroupId)
    return sub?.name ?? ''
  }

  const startAddSub = (groupId: string) => {
    if (readonly) return
    setAddingGroupId(groupId)
    setAddVal('')
  }

  const cancelAddSub = () => {
    setAddingGroupId(null)
    setAddVal('')
  }

  const commitAddSub = (groupId: string) => {
    const name = addVal.trim()
    if (!name) {
      cancelAddSub()
      return
    }
    const sub = addSubGroup(name, groupId)
    if (sub) {
      onChange([...value, { groupId, subGroupId: sub.id }])
    }
    cancelAddSub()
  }

  return (
    <div
      className={cn('cat-ms-root', inline && 'cat-ms-root--inline')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={cn('cat-ms-scroll', !inline && 'cat-ms-scroll--modal')}>
        <div className="cat-ms-sections">
          {displayGroups.map((group) => (
            <div key={group.id} className="cat-ms-section">
              <div className="cat-ms-heading">
                <span className="cat-ms-dot" />
                <span className="cat-ms-heading-label">{group.name}</span>
              </div>

              <div className="cat-ms-chips">
                {group.children.map((sub) => {
                  const selected = isSelected(group.id, sub.id)
                  return (
                    <button
                      key={`${group.id}-${sub.id}`}
                      type="button"
                      className={cn('cat-ms-chip', selected && 'cat-ms-chip--on')}
                      disabled={readonly}
                      onClick={() => toggleLocation(group.id, sub.id)}
                    >
                      <span className={cn('cat-ms-chip-check', selected && 'cat-ms-chip-check--on')}>
                        {selected && <Check className="lucide" strokeWidth={3} />}
                      </span>
                      <span className="cat-ms-chip-label">{sub.name}</span>
                    </button>
                  )
                })}
                {!readonly && addingGroupId === group.id && (
                  <input
                    ref={addInputRef}
                    className="cat-ms-chip-input"
                    placeholder="子分组名称…"
                    value={addVal}
                    onChange={(e) => setAddVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelAddSub()
                        return
                      }
                      handleInlineRenameEnter(e, () => commitAddSub(group.id))
                    }}
                    onBlur={() => deferInlineRenameCommit(() => commitAddSub(group.id))}
                  />
                )}
                {!readonly && addingGroupId !== group.id && (
                  <button
                    type="button"
                    className="cat-ms-chip cat-ms-chip--add"
                    title="新建子分组"
                    onClick={() => startAddSub(group.id)}
                  >
                    <Plus className="lucide" strokeWidth={2} />
                    <span className="cat-ms-chip-label">新建</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          {displayGroups.length === 0 && <div className="cat-ms-empty">暂无分组</div>}
        </div>
      </div>

      {value.length > 0 && (
        <div className="cat-ms-picked">
          <div className="cat-ms-picked-chips">
            {value.map((loc) => (
              <div key={`${loc.groupId}-${loc.subGroupId}`} className="cat-ms-picked-chip">
                <span className="cat-ms-picked-label">{getLocationLabel(loc)}</span>
                {!readonly && (
                  <button
                    type="button"
                    className="cat-ms-picked-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeLocation(loc)
                    }}
                  >
                    <X className="lucide" strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!inline && onClose && (
        <div className="cat-ms-footer">
          <button type="button" className="cat-ms-done" onClick={onClose}>
            完成
          </button>
        </div>
      )}
    </div>
  )
}

export default CategoryMultiSelect