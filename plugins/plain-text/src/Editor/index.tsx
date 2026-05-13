import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  loadNotes,
  getActiveNote,
  createNote,
  updateNote,
  deleteNote,
  switchNote,
  saveActiveId,
  type Note,
  type EditMode,
} from '../stores/notes'
import './index.css'

const SIZES = [14, 16, 18, 20]
const FONT_SIZE_KEY = 'plain-text-fontsize'

function loadFontSize(): number {
  const saved = localStorage.getItem(FONT_SIZE_KEY)
  if (saved) {
    const n = parseInt(saved, 10)
    if (SIZES.includes(n)) return n
  }
  return 16
}

export default function Editor() {
  const [note, setNote] = useState<Note | null>(null)
  const [showDrawer, setShowDrawer] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [fontSize, setFontSize] = useState(loadFontSize)
  const [showLineNumbers] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 初始化：加载活跃文稿
  useEffect(() => {
    const active = getActiveNote()
    setNote(active)
    setNotes(loadNotes())
    // 聚焦编辑区
    setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  // 自动保存 debounce
  const debouncedSave = useCallback((id: string, content: string) => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      updateNote(id, { content })
      setNotes(loadNotes())
    }, 300)
  }, [])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.target.value
    setNote(prev => prev ? { ...prev, content } : null)
    if (note) {
      debouncedSave(note.id, content)
    }
  }

  // 滚动同步行号
  const handleScroll = () => {
    const textarea = textareaRef.current
    const lineNumbers = document.querySelector('.editor-line-numbers')
    if (textarea && lineNumbers) {
      lineNumbers.scrollTop = textarea.scrollTop
    }
  }

  // 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleExport()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [note])

  const handleExport = () => {
    if (!note) return
    try {
      const ext = note.mode === 'markdown' ? '.md' : '.txt'
      const outputPath = window.services.writeTextFile(note.content, ext)
      if (outputPath) {
        window.ztools.shellShowItemInFolder(outputPath)
      }
    } catch {
      window.ztools.showNotification('文件保存出错了！')
    }
  }

  const handleNewNote = () => {
    const newNote = createNote()
    setNote(newNote)
    setNotes(loadNotes())
    setShowDrawer(false)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleSwitchNote = (id: string) => {
    const switched = switchNote(id)
    if (switched) {
      setNote(switched)
      setShowDrawer(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const handleDeleteNote = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('确定删除这篇文稿吗？')) return
    deleteNote(id)
    const updatedNotes = loadNotes()
    setNotes(updatedNotes)
    if (note?.id === id) {
      if (updatedNotes.length > 0) {
        saveActiveId(updatedNotes[0].id)
        setNote(updatedNotes[0])
      } else {
        const newNote = createNote()
        setNote(newNote)
        setNotes(loadNotes())
      }
    }
  }

  const handleToggleMode = () => {
    if (!note) return
    const newMode: EditMode = note.mode === 'text' ? 'markdown' : 'text'
    updateNote(note.id, { mode: newMode })
    setNote(prev => prev ? { ...prev, mode: newMode } : null)
  }

  const handleFontSize = () => {
    const idx = SIZES.indexOf(fontSize)
    const next = SIZES[(idx + 1) % SIZES.length]
    setFontSize(next)
    localStorage.setItem(FONT_SIZE_KEY, String(next))
  }

  const lineCount = note?.content ? note.content.split('\n').length : 1

  const formatTime = (ts: number) => {
    const now = Date.now()
    const diff = now - ts
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  if (!note) return null

  const mdHtml = note.mode === 'markdown' ? DOMPurify.sanitize(marked(note.content || '') as string) : ''
  const editorStyle = { fontSize: `${fontSize}px`, lineHeight: 1.8 } as const
  const lnStyle = { fontSize: `${fontSize - 1}px`, lineHeight: 1.8 } as const

  return (
    <div className="editor">
      <div className="editor-main">
        {note.mode === 'markdown' ? (
          <div className="editor-md-view">
            <div className="editor-content">
              {showLineNumbers && (
                <div className="editor-line-numbers" style={lnStyle}>
                  {Array.from({ length: lineCount }, (_, i) => (
                    <span key={i}>{i + 1}</span>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="editor-textarea"
                style={editorStyle}
                value={note.content}
                onChange={handleContentChange}
                onScroll={handleScroll}
                placeholder="开始写点什么..."
                spellCheck={false}
              />
            </div>
            <div
              className="editor-md-preview"
              style={editorStyle}
              dangerouslySetInnerHTML={{ __html: mdHtml }}
            />
          </div>
        ) : (
          <div className="editor-content">
            {showLineNumbers && (
              <div className="editor-line-numbers" style={lnStyle}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              style={editorStyle}
              value={note.content}
              onChange={handleContentChange}
              onScroll={handleScroll}
              placeholder="开始写点什么..."
              spellCheck={false}
            />
          </div>
        )}

        {/* 浮动底栏 */}
        <div className="editor-toolbar">
          <button
            className="editor-toolbar-btn"
            onClick={() => setShowDrawer(true)}
            title="文稿列表"
          >
            ☰
          </button>
          <div className="editor-toolbar-sep" />
          <button
            className="editor-toolbar-btn"
            onClick={handleNewNote}
            title="新建文稿"
          >
            ＋
          </button>
          <div className="editor-toolbar-sep" />
          <button
            className={`editor-toolbar-btn ${note.mode === 'markdown' ? 'active' : ''}`}
            onClick={handleToggleMode}
            title={note.mode === 'markdown' ? '切换纯文本' : '切换 Markdown'}
          >
            M↓
          </button>
          <div className="editor-toolbar-sep" />
          <button
            className="editor-toolbar-btn editor-toolbar-fontsize"
            onClick={handleFontSize}
            title={`字号：${fontSize}px（点击切换）`}
          >
            {fontSize}
          </button>
          <div className="editor-toolbar-sep" />
          <button
            className="editor-toolbar-btn"
            onClick={handleExport}
            title="导出文件"
          >
            ↓
          </button>
        </div>
      </div>

      {/* 抽屉 */}
      {showDrawer && (
        <>
          <div
            className="editor-drawer-overlay"
            onClick={() => setShowDrawer(false)}
          />
          <div className="editor-drawer">
            <div className="editor-drawer-header">
              <span>文稿列表</span>
              <button
                className="editor-drawer-close"
                onClick={() => setShowDrawer(false)}
              >
                ✕
              </button>
            </div>
            <div className="editor-drawer-list">
              {notes.map(n => (
                <div
                  key={n.id}
                  className={`editor-drawer-item ${n.id === note.id ? 'active' : ''}`}
                  onClick={() => handleSwitchNote(n.id)}
                >
                  <div className="editor-drawer-item-info">
                    <div className="editor-drawer-item-title">{n.title}</div>
                    <div className="editor-drawer-item-time">{formatTime(n.updatedAt)}</div>
                  </div>
                  <span
                    className="editor-drawer-delete"
                    onClick={(e) => handleDeleteNote(n.id, e)}
                  >
                    删除
                  </span>
                </div>
              ))}
            </div>
            <div className="editor-drawer-footer">
              <button className="editor-drawer-new" onClick={handleNewNote}>
                ＋ 新建文稿
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
