import { useEffect, useState, useRef, useCallback } from 'react'
import Fuse from 'fuse.js'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FolderIcon, RemoteIcon, TopIcon, isRemoteProject } from './icons'
import type { RecentItem } from '../types'
import './index.css'

const CUSTOM_NAMES_KEY = 'vscode-recent-custom-names'
const PINNED_ITEMS_KEY = 'vscode-recent-pinned-items'

// 自定义名称存储
function loadCustomNames(): Record<string, string> {
  try {
    const data = window.ztools.dbStorage.getItem(CUSTOM_NAMES_KEY)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

function saveCustomNames(names: Record<string, string>) {
  window.ztools.dbStorage.setItem(CUSTOM_NAMES_KEY, JSON.stringify(names))
}

// 置顶存储
function loadPinnedItems(): string[] {
  try {
    const data = window.ztools.dbStorage.getItem(PINNED_ITEMS_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function savePinnedItems(ids: string[]) {
  window.ztools.dbStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(ids))
}

export default function VSCodeRecent() {
  const [items, setItems] = useState<RecentItem[]>([])
  const [view, setView] = useState<RecentItem[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: RecentItem } | null>(null)
  
  const fuseRef = useRef<Fuse<RecentItem> | null>(null)
  const itemsRef = useRef<RecentItem[]>([])
  const editInputRef = useRef<HTMLInputElement>(null)

  // 加载数据
  useEffect(() => {
    async function loadItems() {
      try {
        const loadedItems = await window.services.vscodeRecent.list()
        itemsRef.current = loadedItems
        
        // 加载自定义名称和置顶
        const names = loadCustomNames()
        const pinned = loadPinnedItems()
        setCustomNames(names)
        setPinnedIds(new Set(pinned))
        
        // 按置顶状态排序
        const sorted = sortItems(loadedItems, new Set(pinned))
        setItems(sorted)
        setView(sorted)
        
        fuseRef.current = new Fuse(loadedItems, {
          keys: ['title', 'subtitle'],
          threshold: 0.4,
          includeScore: true,
        })
      } catch (e) {
        setError('读取 VSCode 历史失败：' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setLoading(false)
      }
    }
    
    loadItems()
  }, [])

  // 按置顶状态排序
  function sortItems(items: RecentItem[], pinned: Set<string>): RecentItem[] {
    const pinnedItems: RecentItem[] = []
    const otherItems: RecentItem[] = []
    
    for (const item of items) {
      if (pinned.has(item.id)) {
        pinnedItems.push(item)
      } else {
        otherItems.push(item)
      }
    }
    
    return [...pinnedItems, ...otherItems]
  }

  // 搜索
  useEffect(() => {
    window.ztools.setSubInput((arg: { text: string }) => {
      const text = arg.text.trim()
      if (text && fuseRef.current) {
        const results = fuseRef.current.search(text)
        setView(results.map(r => r.item))
      } else {
        setView(items)
      }
      setHighlighted(0)
    }, '搜索 VSCode 项目')
  }, [items])

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑模式下不处理导航
      if (editingId) return
      
      if (view.length === 0) return

      if (e.key === 'ArrowDown') {
        setHighlighted(Math.min(highlighted + 1, view.length - 1))
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        setHighlighted(Math.max(highlighted - 1, 0))
        e.preventDefault()
      } else if (e.key === 'Enter') {
        if (view[highlighted]) {
          if (e.ctrlKey) {
            // Ctrl+Enter: 置顶/取消置顶
            togglePinned(view[highlighted])
          } else {
            // Enter: 打开项目
            openItem(view[highlighted])
          }
        }
        e.preventDefault()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [view, highlighted, editingId, pinnedIds])

  // 编辑输入框聚焦
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // 获取显示标题
  const getDisplayTitle = useCallback((item: RecentItem) => {
    return customNames[item.id] || item.title
  }, [customNames])

  // 打开项目
// 打开项目
  function openItem(item: RecentItem) {
    try {
      window.services.vscodeRecent.openProject(item)
      // 隐藏窗口
      window.ztools.hide?.()
    } catch (e) {
      window.ztools.showNotification('启动失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // 置顶/取消置顶
  const togglePinned = useCallback((item: RecentItem) => {
    const newPinnedIds = new Set(pinnedIds)
    const isPinned = newPinnedIds.has(item.id)
    
    if (isPinned) {
      newPinnedIds.delete(item.id)
    } else {
      newPinnedIds.add(item.id)
    }
    
    setPinnedIds(newPinnedIds)
    savePinnedItems(Array.from(newPinnedIds))
    
    // 重新排序
    const sorted = sortItems(itemsRef.current, newPinnedIds)
    setItems(sorted)
    setView(sorted)
    
    window.ztools.showNotification(isPinned ? '已取消置顶' : '已置顶')
  }, [pinnedIds])

  // 判断是否置顶
  const isPinned = useCallback((item: RecentItem) => {
    return pinnedIds.has(item.id)
  }, [pinnedIds])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, item: RecentItem) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // 菜单项操作
  const handleMenuSelect = useCallback((key: string) => {
    if (!contextMenu) return
    
    if (key === 'rename') {
      setEditingId(contextMenu.item.id)
      setEditValue(getDisplayTitle(contextMenu.item))
    } else if (key === 'reset-name') {
      // 重置名称
      const newNames = { ...customNames }
      delete newNames[contextMenu.item.id]
      setCustomNames(newNames)
      saveCustomNames(newNames)
    } else if (key === 'pin') {
      togglePinned(contextMenu.item)
    }
  }, [contextMenu, customNames, getDisplayTitle, togglePinned])

  // 编辑保存
  const saveEdit = useCallback(() => {
    if (!editingId || !editValue.trim()) {
      cancelEdit()
      return
    }
    
    const newNames = { ...customNames, [editingId]: editValue.trim() }
    setCustomNames(newNames)
    saveCustomNames(newNames)
    cancelEdit()
  }, [editingId, editValue, customNames])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit()
      e.preventDefault()
      e.stopPropagation()
    } else if (e.key === 'Escape') {
      cancelEdit()
      e.preventDefault()
      e.stopPropagation()
    }
  }, [saveEdit, cancelEdit])

  // 菜单项
  const menuItems: MenuItem[] = contextMenu ? [
    {
      key: 'pin',
      label: isPinned(contextMenu.item) ? '取消置顶' : '置顶',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2v6M8 8l-3 4h6l-3-4z"/>
          <path d="M5 2h6"/>
        </svg>
      ),
    },
    {
      key: 'rename',
      label: '修改名称',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M11.5 2.5l2 2-7 7H4v-2.5l7-6.5z"/>
        </svg>
      ),
    },
    ...(customNames[contextMenu.item.id] ? [{
      key: 'reset-name',
      label: '重置名称',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 8a5 5 0 1 0 0-1M3 5v3"/>
        </svg>
      ),
    }] : []),
  ] : []

  if (loading) {
    return <div className="vscode-recent-loading">加载中...</div>
  }

  if (error) {
    return <div className="vscode-recent-error">{error}</div>
  }

  return (
    <div className="vscode-recent-container">
      {view.length === 0 ? (
        <div className="vscode-recent-empty">
          没有找到最近的 VSCode 项目。先在 VSCode 中打开一次项目，再回来试试。
        </div>
      ) : (
        <ul className="vscode-recent-list">
          {view.map((item, idx) => (
            <li
              key={item.id}
              className={ `vscode-recent-item ${idx === highlighted ? 'active' : ''} ${isPinned(item) ? 'pinned' : ''}`}
              onClick={() => !editingId && openItem(item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
            >
{editingId === item.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  className="edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={saveEdit}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div className="item-icon">
                    {isRemoteProject(item) ? <RemoteIcon /> : <FolderIcon />}
                  </div>
                  <div className="item-content">
                    <div className="title">{getDisplayTitle(item)}</div>
                    <div className="subtitle">{item.subtitle}</div>
                  </div>
                  {isPinned(item) && (
                    <div className="pin-icon">
                      <TopIcon />
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      
      {contextMenu && (
        <ContextMenu
          items={menuItems}
          x={contextMenu.x}
          y={contextMenu.y}
          onSelect={handleMenuSelect}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}