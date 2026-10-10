import { useState } from 'react'
import { PAGE_NAME_MAX, type Page } from '../state'
import { colorForSeq } from '../palette'

type PageTabsProps = {
  pages: Page[]
  activePageId: string
  onCreate: () => void
  onRename: (pageId: string, name: string) => void
  onSwitch: (pageId: string) => void
}

export default function PageTabs(props: PageTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const commitRename = (pageId: string) => {
    const name = draftName.trim().slice(0, PAGE_NAME_MAX)
    if (name) props.onRename(pageId, name)
    setEditingId(null)
  }

  return (
    <div className="cd-tabs">
      {props.pages.map((p, i) => (
        <div key={p.id} className="cd-tab-wrap" style={{ ['--tab-color' as any]: colorForSeq(i + 1) }}>
          {editingId === p.id ? (
            <input
              className="cd-tab-input"
              autoFocus
              value={draftName}
              maxLength={PAGE_NAME_MAX}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => commitRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  commitRename(p.id)
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditingId(null)
                }
              }}
            />
          ) : (
            <button
              className={`cd-tab${p.id === props.activePageId ? ' cd-tab-active' : ''}`}
              onClick={() => props.onSwitch(p.id)}
              onDoubleClick={() => {
                setDraftName(p.name)
                setEditingId(p.id)
              }}
            >
              <span
                className="cd-at-page"
                style={{ color: colorForSeq(i + 1), borderColor: colorForSeq(i + 1) }}
              >
                @{i + 1}
              </span>
              {p.name}
            </button>
          )}
        </div>
      ))}
      <button className="cd-tab-add" title="新建草稿页" onClick={props.onCreate}>
        +
      </button>
    </div>
  )
}
