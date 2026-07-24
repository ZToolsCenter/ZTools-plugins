import { ref, computed } from 'vue'
import { extractTitle } from '../utils/md'

export interface Note {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const NOTES_KEY = 'easynote:notes'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadNotes(): Note[] {
  try {
    const raw = window.ztools.dbStorage.getItem(NOTES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? (arr as Note[]) : []
    }
  } catch {
    /* ignore */
  }
  return []
}

function persist(notes: Note[]) {
  window.ztools.dbStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

// 已保存列表（主窗口/便利贴各自进程独立加载，但共享同一 dbStorage）
const savedNotes = ref<Note[]>(loadNotes())

// 草稿：便利贴当前编辑内容（仅当前进程内存，默认不落库）
export interface Draft {
  noteId: string | null // null = 新建草稿；非空 = 编辑已存在便签
  content: string
}
const draft = ref<Draft>({ noteId: null, content: '' })

export function useNotes() {
  /** 重新从 dbStorage 加载已保存列表（主窗口每次显示时调用） */
  function reloadNotes() {
    savedNotes.value = loadNotes()
  }

  /** 加载草稿：noteId 为空=新建空白草稿；否则加载指定便签作为草稿 */
  function loadDraft(noteId: string | null) {
    if (noteId) {
      const notes = loadNotes()
      const n = notes.find((x) => x.id === noteId)
      draft.value = { noteId, content: n?.content || '' }
    } else {
      draft.value = { noteId: null, content: '' }
    }
  }

  function updateDraft(content: string) {
    draft.value.content = content
  }

  /** 保存草稿到 dbStorage（新则插入，已有则更新），返回保存后的便签 */
  function saveDraft(): Note | null {
    const content = draft.value.content
    const now = Date.now()
    let notes = loadNotes()

    if (draft.value.noteId) {
      const i = notes.findIndex((x) => x.id === draft.value.noteId)
      if (i >= 0) {
        notes[i] = { ...notes[i], content, title: extractTitle(content), updatedAt: now }
      } else {
        // 原便签已被删除，作为新便签重新创建，防止数据丢失
        const n: Note = {
          id: genId(),
          title: extractTitle(content),
          content,
          createdAt: now,
          updatedAt: now
        }
        notes.unshift(n)
        draft.value.noteId = n.id
      }
    } else {
      const n: Note = {
        id: genId(),
        title: extractTitle(content),
        content,
        createdAt: now,
        updatedAt: now
      }
      notes.unshift(n)
      draft.value.noteId = n.id
    }

    persist(notes)
    savedNotes.value = notes
    return notes.find((x) => x.id === draft.value.noteId) ?? null
  }

  function deleteNote(id: string) {
    const notes = loadNotes().filter((x) => x.id !== id)
    persist(notes)
    savedNotes.value = notes
  }

  const sortedNotes = computed(() =>
    [...savedNotes.value].sort((a, b) => b.updatedAt - a.updatedAt)
  )

  return {
    savedNotes,
    sortedNotes,
    draft,
    reloadNotes,
    loadDraft,
    updateDraft,
    saveDraft,
    deleteNote
  }
}
