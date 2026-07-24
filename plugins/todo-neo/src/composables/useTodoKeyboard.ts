import { ref, type ComputedRef, type Ref } from 'vue'
import type { GroupDoc, TaskDoc, ViewName } from '../types'

type ReadableRef<T> = Ref<T> | ComputedRef<T>

interface TodoKeyboardOptions {
  route: Ref<ViewName>
  settingsOpen: Ref<boolean>
  groups: ReadableRef<GroupDoc[]>
  activeGroupId: Ref<string>
  activeTaskId: Ref<string>
  visibleTasks: ReadableRef<TaskDoc[]>
  taskById: (id: string) => TaskDoc | undefined
  selectTaskAndReveal: (id: string) => void
  selectGroup: (id: string) => void
  toggleTask: (task: TaskDoc) => void
  startEditTask: (task: TaskDoc) => void
  requestDeleteTask: (task: TaskDoc) => void
  beginCreateTask: (groupId?: string, afterTaskId?: string | null) => void
  openTaskSearch: () => void
}

export function useTodoKeyboard(options: TodoKeyboardOptions) {
  const keyBuffer = ref('')

  function handleKeyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (options.route.value !== 'main') return

    if (options.settingsOpen.value) {
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const content = document.querySelector<HTMLElement>('.settings-content')
        content?.scrollBy({ top: event.key === 'j' ? 72 : -72, behavior: 'smooth' })
        return
      }
    }

    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

    const taskList = options.visibleTasks.value
    const taskIndex = taskList.findIndex((task) => task._id === options.activeTaskId.value)
    const groupIndex = options.groups.value.findIndex((group) => group._id === options.activeGroupId.value)
    const activeTask = options.taskById(options.activeTaskId.value)

    if (event.key === '?') {
      event.preventDefault()
      options.settingsOpen.value = true
      return
    }

    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      options.openTaskSearch()
      return
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      options.beginCreateTask(options.activeGroupId.value, options.activeTaskId.value || null)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      options.beginCreateTask(options.activeGroupId.value, options.activeTaskId.value || null)
      return
    }
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = taskIndex >= 0 ? (taskIndex + 1) % taskList.length : 0
      const next = taskList[nextIndex]
      if (next) options.selectTaskAndReveal(next._id)
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = taskIndex >= 0 ? (taskIndex - 1 + taskList.length) % taskList.length : taskList.length - 1
      const prev = taskList[prevIndex]
      if (prev) options.selectTaskAndReveal(prev._id)
    } else if (event.key === 'h' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const groupCount = options.groups.value.length
      const prevIndex = groupIndex >= 0 ? (groupIndex - 1 + groupCount) % groupCount : groupCount - 1
      const group = options.groups.value[prevIndex]
      if (group) options.selectGroup(group._id)
    } else if (event.key === 'l' || event.key === 'ArrowRight') {
      event.preventDefault()
      const groupCount = options.groups.value.length
      const nextIndex = groupIndex >= 0 ? (groupIndex + 1) % groupCount : 0
      const group = options.groups.value[nextIndex]
      if (group) options.selectGroup(group._id)
    } else if ((event.key === ' ' || event.key === 'Spacebar') && activeTask) {
      event.preventDefault()
      options.toggleTask(activeTask)
    } else if ((event.key === 'Enter' || event.key === 'i') && activeTask) {
      event.preventDefault()
      options.startEditTask(activeTask)
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && activeTask) {
      event.preventDefault()
      options.requestDeleteTask(activeTask)
    } else if (event.key === 'G') {
      event.preventDefault()
      const lastTask = taskList[taskList.length - 1]
      if (lastTask) options.selectTaskAndReveal(lastTask._id)
    } else if (event.key === 'g') {
      keyBuffer.value += 'g'
      if (keyBuffer.value.endsWith('gg')) {
        event.preventDefault()
        const firstTask = taskList[0]
        if (firstTask) options.selectTaskAndReveal(firstTask._id)
        keyBuffer.value = ''
      }
    } else if (event.key === 'd') {
      keyBuffer.value += 'd'
      if (keyBuffer.value.endsWith('dd') && activeTask) {
        event.preventDefault()
        options.requestDeleteTask(activeTask)
        keyBuffer.value = ''
      }
    } else {
      keyBuffer.value = ''
    }
  }

  function handleSettingsEscape(event: KeyboardEvent) {
    if (options.route.value !== 'main' || !options.settingsOpen.value || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    options.settingsOpen.value = false
  }

  return {
    handleKeyboard,
    handleSettingsEscape
  }
}

