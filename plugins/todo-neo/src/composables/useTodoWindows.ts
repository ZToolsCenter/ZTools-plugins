import type { ComputedRef, Ref } from 'vue'
import type { GroupDoc, TaskDoc } from '../types'
import { featureFlags } from '../featureFlags'

interface TodoWindowsOptions {
  activeGroup: ComputedRef<GroupDoc | undefined>
  activeTaskId: Ref<string>
  noteGroup: ComputedRef<GroupDoc | undefined>
  noteDraft: Ref<string>
  taskById: (id: string) => TaskDoc | undefined
  createTask: (text: string, groupId?: string, afterTaskId?: string | null) => void
}

export function useTodoWindows(options: TodoWindowsOptions) {
  function openNote(group = options.activeGroup.value) {
    if (!featureFlags.noteWindow) return
    if (!group) return
    window.services?.openNote({ group: group.title })
  }

  function openTomato(task = options.taskById(options.activeTaskId.value)) {
    if (!featureFlags.tomatoWindow) return
    window.services?.openTomato(task?._id)
  }

  function createNoteTask() {
    if (!options.noteGroup.value) return
    options.createTask(options.noteDraft.value, options.noteGroup.value._id, null)
    options.noteDraft.value = ''
  }

  function closeCurrentWindow() {
    window.services?.closeWindow?.()
  }

  return {
    openNote,
    openTomato,
    createNoteTask,
    closeCurrentWindow
  }
}

