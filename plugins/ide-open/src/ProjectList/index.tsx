import { useEffect, useState, useRef } from 'react'
import { readProjects, openProject, deleteProject, type IDEItem, type ProjectItem } from '../store'
import './index.css'

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 2h5l1 1.5H14A1.5 1.5 0 0 1 15.5 5v6.5A1.5 1.5 0 0 1 14 13H2A1.5 1.5 0 0 1 .5 11.5V3A1.5 1.5 0 0 1 1.5 2Z" fill="currentColor" opacity=".7"/>
      <path d="M1.5 2h5l1 1.5H14A1.5 1.5 0 0 1 15.5 5v6.5A1.5 1.5 0 0 1 14 13H2A1.5 1.5 0 0 1 .5 11.5V3A1.5 1.5 0 0 1 1.5 2Z" stroke="currentColor" strokeWidth="1" fill="none"/>
    </svg>
  )
}

function IconFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 1.5h6.5L13.5 5v9A1.5 1.5 0 0 1 12 15.5H3A1.5 1.5 0 0 1 1.5 14V3A1.5 1.5 0 0 1 3 1.5Z" stroke="currentColor" strokeWidth="1" fill="none"/>
      <path d="M9.5 1.5V5h4" stroke="currentColor" strokeWidth="1" fill="none"/>
    </svg>
  )
}

function IconRemote() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1" fill="none" opacity=".5"/>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1" fill="none" opacity=".8"/>
      <circle cx="8" cy="8" r="1" fill="currentColor"/>
    </svg>
  )
}

export default function ProjectList({ ide, onBack, onEdit }: { ide: IDEItem; onBack?: () => void; onEdit?: () => void }) {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [filtered, setFiltered] = useState<ProjectItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // refs for document-level keydown (避免频繁重新注册)
  const filteredRef = useRef(filtered)
  const selectedRef = useRef(selected)
  filteredRef.current = filtered
  selectedRef.current = selected

  const load = () => {
    window.services?.debugLog('ProjectList load', { code: ide.code, command: ide.command, dbPath: ide.dbPath, shell: ide.shell })
    if (!ide.command || !ide.dbPath) {
      setError(`请先在设置页配置「${ide.name}」的数据文件路径`)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    readProjects(ide.dbPath)
      .then(items => {
        window.services?.debugLog(`ProjectList 加载完成: ${items.length} 个项目`)
        setProjects(items); setFiltered(items)
      })
      .catch((err: Error) => {
        window.services?.debugLog('ProjectList 读取失败', err.message)
        setError(`读取失败: ${err.message}`)
      })
      .finally(() => setLoading(false))
  }

  // 设置子输入框 + 加载数据
  useEffect(() => {
    setSearch('')
    window.ztools.setSubInput((input: { text: string }) => setSearch(input.text), '搜索项目，Enter 打开...', true)
    window.ztools.setSubInputValue('')
    window.ztools.setExpendHeight(500)
    load()
    return () => { window.ztools.removeSubInput() }
  }, [ide.code])

  // 过滤
  useEffect(() => {
    const q = search.toLowerCase().trim()
    if (!q) { setFiltered(projects); return }
    const terms = q.split(/\s+/)
    setFiltered(projects.filter(p =>
      terms.every(t =>
        p.name.toLowerCase().includes(t) || p.path.toLowerCase().includes(t) || p.label.toLowerCase().includes(t)
      )
    ))
    setSelected(-1)
  }, [search, projects])

  // 滚动到选中项
  useEffect(() => {
    if (selected < 0 || !listRef.current) return
    const el = listRef.current.children[selected] as HTMLElement
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const handleOpen = async (project: ProjectItem) => {
    window.services?.debugLog('handleOpen', { command: ide.command, uri: project.uri, shell: ide.shell })
    try {
      await openProject(ide.command, project.uri, ide.shell)
      window.ztools.hideMainWindow()
      window.ztools.outPlugin()
    } catch (err: any) {
      window.services?.debugLog('handleOpen 失败', err.message)
      alert(`打开失败: ${err.message}`)
    }
  }

  const handleDelete = async (project: ProjectItem) => {
    if (!confirm(`确定从历史记录中删除「${project.name}」？`)) return
    try {
      await deleteProject(ide.dbPath, project.uri)
      load()
    } catch (err: any) {
      alert(`删除失败: ${err.message}`)
    }
  }

  // 键盘导航（document 级，因为焦点在 ZTools 主搜索框上）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const f = filteredRef.current
      const s = selectedRef.current
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setSelected(i => i >= f.length - 1 ? 0 : i + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setSelected(i => i <= 0 ? f.length - 1 : i - 1)
      } else if (e.key === 'Enter' && s >= 0) {
        e.preventDefault(); handleOpen(f[s])
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className='project-list'>
      <div className='top-bar'>
        {onBack && <button className='btn-back' onClick={onBack}>← 返回</button>}
        <span className='pl-ide-name'>{ide.name}</span>
        <span className='pl-count'>{filtered.length} 个项目</span>
        {onEdit && <button className='btn-edit-top' onClick={onEdit}>编辑</button>}
      </div>

      {loading && <div className='pl-loading'>加载中...</div>}
      {error && !loading && <div className='project-error'><p>{error}</p></div>}
      {!loading && !error && filtered.length === 0 && (
        <div className='pl-empty'>{search ? '没有匹配的项目' : '暂无最近项目'}</div>
      )}

      <div className='pl-items' ref={listRef}>
        {filtered.map((p, i) => (
          <div key={p.uri || i}
            className={`pl-item ${i === selected ? 'pl-item-selected' : ''}`}
            onClick={() => handleOpen(p)}
            onContextMenu={e => { e.preventDefault(); handleDelete(p) }}
            onMouseEnter={() => setSelected(i)}>
            <div className='pl-item-icon'>
              {p.type === 'remote' ? <IconRemote /> : p.type === 'workspace' || p.type === 'file' ? <IconFile /> : <IconFolder />}
            </div>
            <div className='pl-item-info'>
              <div className='pl-item-name'>{p.name}</div>
              <div className='pl-item-path' title={p.path || p.uri}>{p.path || p.uri}</div>
            </div>
            <button className='pl-item-del' onClick={e => { e.stopPropagation(); handleDelete(p) }}
              title='删除此记录'>✕</button>
            {p.type === 'remote' && <span className='pl-item-badge'>远程</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
