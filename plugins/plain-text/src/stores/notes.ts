const NOTES_KEY = 'plain-text-notes'
const ACTIVE_KEY = 'plain-text-active'

export type EditMode = 'text' | 'markdown'

export interface Note {
  id: string
  title: string
  content: string
  mode: EditMode
  updatedAt: number
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function getTitle(content: string): string {
  const first = content.split('\n').find(line => line.trim()) || ''
  return first.slice(0, 20) || '未命名文稿'
}

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveNotes(notes: Note[]): void {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

export function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function getActiveNote(): Note | null {
  const notes = loadNotes()
  const activeId = loadActiveId()
  if (activeId) {
    const found = notes.find(n => n.id === activeId)
    if (found) return found
  }
  // 回退到第一条或创建新文稿
  if (notes.length > 0) {
    saveActiveId(notes[0].id)
    return notes[0]
  }
  return createNote()
}

export function createNote(): Note {
  const note: Note = {
    id: generateId(),
    title: '未命名文稿',
    content: '',
    mode: 'text',
    updatedAt: Date.now(),
  }
  const notes = loadNotes()
  notes.unshift(note)
  saveNotes(notes)
  saveActiveId(note.id)
  return note
}

export function updateNote(id: string, updates: Partial<Pick<Note, 'content' | 'mode'>>): Note | null {
  const notes = loadNotes()
  const note = notes.find(n => n.id === id)
  if (!note) return null

  if (updates.content !== undefined) {
    note.content = updates.content
    note.title = getTitle(updates.content)
  }
  if (updates.mode !== undefined) {
    note.mode = updates.mode
  }
  note.updatedAt = Date.now()

  saveNotes(notes)
  return note
}

export function deleteNote(id: string): void {
  const notes = loadNotes().filter(n => n.id !== id)
  saveNotes(notes)
  if (loadActiveId() === id) {
    if (notes.length > 0) {
      saveActiveId(notes[0].id)
    } else {
      localStorage.removeItem(ACTIVE_KEY)
    }
  }
}

export function switchNote(id: string): Note | null {
  const notes = loadNotes()
  const note = notes.find(n => n.id === id)
  if (!note) return null
  saveActiveId(id)
  return note
}
