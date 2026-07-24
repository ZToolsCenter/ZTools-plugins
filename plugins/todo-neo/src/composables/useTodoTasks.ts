import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import type { TaskDoc } from '../types'
import { TASKS_PREFIX } from './todoConstants'
import { removeDoc } from './todoPersistence'

type ReadableRef<T> = Ref<T> | ComputedRef<T>

interface TodoTasksOptions {
  activeGroupId: Ref<string>
  activeTaskId: Ref<string>
  visibleTasks: ReadableRef<TaskDoc[]>
  taskById: (id: string) => TaskDoc | undefined
  allTasksForGroup: (groupId: string) => TaskDoc[]
  saveTask: (task: TaskDoc, shouldRefresh?: boolean) => void
  refreshData: () => void
  selectGroup: (id: string) => void
  selectTask: (id: string) => void
}

export function useTodoTasks(options: TodoTasksOptions) {
  const composingTaskGroupId = ref('')
  const composingTaskAfterId = ref<string | null>(null)
  const composingTaskText = ref('')
  const editingTaskId = ref('')
  const editingText = ref('')
  const deleteTaskId = ref('')
  const deletingTask = computed(() => options.taskById(deleteTaskId.value))

  function createTask(text: string, groupId = options.activeGroupId.value, afterTaskId: string | null = options.activeTaskId.value || null) {
    const content = text.trim()
    if (!content) return
    const now = Date.now()
    const task: TaskDoc = {
      _id: `${TASKS_PREFIX}${now}`,
      text: content,
      groupId,
      completed: false,
      created_at: now,
      sort: now
    }

    const ordered = options.allTasksForGroup(groupId).filter((item) => item._id !== task._id)
    const afterIndex = afterTaskId ? ordered.findIndex((item) => item._id === afterTaskId) : -1
    ordered.splice(afterIndex >= 0 ? afterIndex + 1 : 0, 0, task)
    ordered.forEach((item, index) => options.saveTask({ ...item, groupId, sort: index + 1 }, false))
    options.refreshData()
    options.selectGroup(groupId)
    options.selectTask(task._id)
  }

  function beginCreateTask(groupId = options.activeGroupId.value, afterTaskId: string | null = options.activeTaskId.value || null) {
    composingTaskGroupId.value = groupId
    composingTaskAfterId.value = afterTaskId && options.taskById(afterTaskId)?.groupId === groupId ? afterTaskId : null
    composingTaskText.value = ''
    if (options.activeGroupId.value !== groupId) options.selectGroup(groupId)
    nextTick(() => document.querySelector<HTMLTextAreaElement>('.task-create-input')?.focus())
  }

  function saveComposedTask(groupId = composingTaskGroupId.value) {
    if (!composingTaskText.value.trim()) {
      cancelComposedTask()
      return
    }
    createTask(composingTaskText.value, groupId, composingTaskAfterId.value)
    cancelComposedTask()
  }

  function cancelComposedTask() {
    composingTaskGroupId.value = ''
    composingTaskAfterId.value = null
    composingTaskText.value = ''
  }

  function toggleTask(task: TaskDoc) {
    const now = Date.now()
    const updated = { ...task, completed: !task.completed }
    if (updated.completed) {
      updated.completed_at = now
      if (!updated.first_completed_at) updated.first_completed_at = now
    } else {
      delete updated.completed_at
    }
    options.saveTask(updated)
  }

  function startEditTask(task: TaskDoc) {
    editingTaskId.value = task._id
    editingText.value = task.text
    nextTick(() => document.querySelector<HTMLTextAreaElement>('.task-edit-input')?.focus())
  }

  function saveEditTask(task: TaskDoc) {
    const text = editingText.value.trim()
    if (!text) return
    options.saveTask({ ...task, text })
    editingTaskId.value = ''
  }

  function requestDeleteTask(task: TaskDoc) {
    deleteTaskId.value = task._id
  }

  function confirmDeleteTask() {
    const task = deletingTask.value
    if (!task) {
      deleteTaskId.value = ''
      return
    }
    removeDoc(task._id)
    deleteTaskId.value = ''
    options.refreshData()
    if (options.activeTaskId.value === task._id) options.activeTaskId.value = options.visibleTasks.value[0]?._id || ''
  }

  function moveTask(task: TaskDoc, position: 'top' | 'bottom') {
    const sorted = options.allTasksForGroup(task.groupId).filter((item) => item._id !== task._id)
    if (position === 'top') sorted.unshift(task)
    else sorted.push(task)
    sorted.forEach((item, index) => options.saveTask({ ...item, sort: index + 1 }, false))
    options.refreshData()
  }

  return {
    composingTaskGroupId,
    composingTaskAfterId,
    composingTaskText,
    editingTaskId,
    editingText,
    deleteTaskId,
    deletingTask,
    createTask,
    beginCreateTask,
    saveComposedTask,
    cancelComposedTask,
    toggleTask,
    startEditTask,
    saveEditTask,
    requestDeleteTask,
    confirmDeleteTask,
    moveTask
  }
}

