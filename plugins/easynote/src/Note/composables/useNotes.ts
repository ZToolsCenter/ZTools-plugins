import { ref, computed } from 'vue'
import { extractTitle } from '../utils/md'

export type NoteType = 'note' | 'todo'

export interface Note {
  id: string
  title: string
  content: string
  /** 类型：笔记 / 待办 */
  type: NoteType
  /** 待办是否已完成 */
  done: boolean
  /** 待办完成时间（仅待办且 done=true 时有值） */
  doneAt?: number
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
      if (Array.isArray(arr)) {
        // 兼容旧数据：缺省 type/done 的便签视为普通笔记
        return (arr as Note[]).map((n) => ({ type: 'note' as NoteType, done: false, ...n }))
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

function persist(notes: Note[]) {
  window.ztools.dbStorage.setItem(NOTES_KEY, JSON.stringify(notes))
}

function createNote(content: string, type: NoteType, now: number): Note {
  return {
    id: genId(),
    title: extractTitle(content),
    content,
    type,
    done: false,
    createdAt: now,
    updatedAt: now
  }
}

// 已保存列表（主窗口/便利贴各自进程独立加载，但共享同一 dbStorage）
const savedNotes = ref<Note[]>(loadNotes())

// 草稿：便签当前编辑内容（仅当前进程内存，默认不落库）
export interface Draft {
  noteId: string | null // null = 新建草稿；非空 = 编辑已存在便签
  content: string
  type: NoteType
  done: boolean
}
const draft = ref<Draft>({ noteId: null, content: '', type: 'note', done: false })

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
      draft.value = {
        noteId,
        content: n?.content || '',
        type: n?.type || 'note',
        done: n?.done || false
      }
    } else {
      draft.value = { noteId: null, content: '', type: 'note', done: false }
    }
  }

  function updateDraft(content: string) {
    draft.value.content = content
  }

  /** 保存草稿到 dbStorage（新则插入，已有则更新），返回保存后的便签。
   *  type 为空时沿用草稿/原便签类型（新便签未指定默认笔记）。 */
  function saveDraft(type?: NoteType): Note | null {
    const content = draft.value.content
    const now = Date.now()
    const noteType: NoteType = type ?? draft.value.type ?? 'note'
    let notes = [...savedNotes.value]
    let targetId = draft.value.noteId

    if (targetId) {
      const i = notes.findIndex((x) => x.id === targetId)
      if (i >= 0) {
        notes[i] = {
          ...notes[i],
          content,
          title: extractTitle(content),
          type: noteType,
          updatedAt: now
        }
      } else {
        // 原便签已被删除，作为新便签重新创建，防止数据丢失
        const n = createNote(content, noteType, now)
        notes.unshift(n)
        targetId = n.id
      }
    } else {
      const n = createNote(content, noteType, now)
      notes.unshift(n)
      targetId = n.id
    }

    draft.value.noteId = targetId
    draft.value.type = noteType
    persist(notes)
    savedNotes.value = notes
    return notes.find((x) => x.id === targetId) ?? null
  }

  /** 切换待办完成状态 */
  function toggleDone(id: string) {
    const i = savedNotes.value.findIndex((x) => x.id === id)
    if (i >= 0) {
      const notes = [...savedNotes.value]
      const cur = notes[i]
      const newDone = !cur.done
      notes[i] = {
        ...cur,
        done: newDone,
        doneAt: newDone ? Date.now() : undefined
      }
      persist(notes)
      savedNotes.value = notes
    }
  }

  /** 切换便签类型：笔记 ↔ 待办 */
  function changeType(id: string) {
    const i = savedNotes.value.findIndex((x) => x.id === id)
    if (i >= 0) {
      const notes = [...savedNotes.value]
      const cur = notes[i]
      notes[i] = {
        ...cur,
        type: cur.type === 'note' ? 'todo' : 'note',
        done: false,
        doneAt: undefined, // 转换类型时清除完成时间
        updatedAt: Date.now()
      }
      persist(notes)
      savedNotes.value = notes
    }
  }

  function deleteNote(id: string) {
    const notes = savedNotes.value.filter((x) => x.id !== id)
    persist(notes)
    savedNotes.value = notes
  }

  /** 清空指定类型的便签（笔记 / 待办），返回被清除的条数 */
  function clearByType(type: NoteType): number {
    const remaining = savedNotes.value.filter((x) => x.type !== type)
    const count = savedNotes.value.length - remaining.length
    if (!count) return 0

    persist(remaining)
    savedNotes.value = remaining

    // 草稿若指向已被清空的便签，断开关联但保留内容，
    // 由用户再次保存时决定是重新创建还是放弃
    if (draft.value.noteId && !remaining.some((x) => x.id === draft.value.noteId)) {
      draft.value = {
        noteId: null,
        content: draft.value.content,
        type: draft.value.type,
        done: false
      }
    }
    return count
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
    toggleDone,
    changeType,
    deleteNote,
    clearByType
  }
}
