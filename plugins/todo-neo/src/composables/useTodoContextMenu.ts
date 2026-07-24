import { computed, ref } from 'vue'
import type { GroupDoc, TaskDoc } from '../types'

interface TodoContextMenuOptions {
  taskById: (id: string) => TaskDoc | undefined
  groupById: (id: string) => GroupDoc | undefined
  selectTask: (id: string) => void
}

export function useTodoContextMenu(options: TodoContextMenuOptions) {
  const contextMenu = ref<{ open: boolean; x: number; y: number; kind: 'task' | 'group' | ''; id: string }>({
    open: false,
    x: 0,
    y: 0,
    kind: '',
    id: ''
  })

  const contextTask = computed(() => (contextMenu.value.kind === 'task' ? options.taskById(contextMenu.value.id) : undefined))
  const contextGroup = computed(() => (contextMenu.value.kind === 'group' ? options.groupById(contextMenu.value.id) : undefined))

  function openTaskContextMenu(event: MouseEvent, task: TaskDoc) {
    options.selectTask(task._id)
    contextMenu.value = {
      open: true,
      x: event.clientX,
      y: event.clientY,
      kind: 'task',
      id: task._id
    }
  }

  function openGroupContextMenu(event: MouseEvent, group: GroupDoc) {
    contextMenu.value = {
      open: true,
      x: event.clientX,
      y: event.clientY,
      kind: 'group',
      id: group._id
    }
  }

  function closeContextMenu() {
    contextMenu.value.open = false
  }

  return {
    contextMenu,
    contextTask,
    contextGroup,
    openTaskContextMenu,
    openGroupContextMenu,
    closeContextMenu
  }
}

