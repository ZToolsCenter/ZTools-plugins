import { ref, type ComputedRef, type Ref } from 'vue'
import type { GroupDoc, TaskDoc } from '../types'

type ReadableRef<T> = Ref<T> | ComputedRef<T>

interface TodoDragOptions {
  groups: ReadableRef<GroupDoc[]>
  tasks: ReadableRef<TaskDoc[]>
  activeGroupId: Ref<string>
  activeTaskId: Ref<string>
  editingGroupId: Ref<string>
  editingTaskId: Ref<string>
  visibleTasks: ReadableRef<TaskDoc[]>
  taskById: (id: string) => TaskDoc | undefined
  allTasksForGroup: (groupId: string) => TaskDoc[]
  saveTask: (task: TaskDoc, shouldRefresh?: boolean) => void
  saveGroup: (group: GroupDoc, shouldRefresh?: boolean) => void
  refreshData: () => void
  selectTask: (id: string) => void
}

export function useTodoDrag(options: TodoDragOptions) {
  const dragTaskId = ref('')
  const dragOverTaskId = ref('')
  const dragOverTaskGroupId = ref('')
  const dragInsertPosition = ref<'before' | 'after' | ''>('')
  const dragGroupId = ref('')
  const dragOverGroupId = ref('')
  const groupInsertPosition = ref<'before' | 'after' | ''>('')

  function startGroupDrag(group: GroupDoc) {
    if (options.editingGroupId.value === group._id) {
      clearGroupDropTarget()
      return
    }
    dragGroupId.value = group._id
  }

  function updateGroupDropTarget(event: DragEvent, group: GroupDoc) {
    if (dragTaskId.value) {
      const task = options.taskById(dragTaskId.value)
      if (!task || task.groupId === group._id) {
        clearGroupDropTarget()
        return
      }
      event.dataTransfer!.dropEffect = 'move'
      clearGroupDropTarget()
      clearTaskDropTarget()
      dragOverTaskGroupId.value = group._id
      return
    }
    if (!dragGroupId.value || dragGroupId.value === group._id) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dragOverGroupId.value = group._id
    groupInsertPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  function clearGroupDropTarget() {
    dragOverGroupId.value = ''
    groupInsertPosition.value = ''
    dragOverTaskGroupId.value = ''
  }

  function onGroupDragDrop(target: GroupDoc, position = groupInsertPosition.value) {
    if (dragTaskId.value) {
      onTaskGroupDrop(target)
      return
    }
    const sourceId = dragGroupId.value
    dragGroupId.value = ''
    const resolvedPosition = position || 'before'
    clearGroupDropTarget()
    if (!sourceId || sourceId === target._id) return
    const ordered = [...options.groups.value]
    const sourceIndex = ordered.findIndex((group) => group._id === sourceId)
    if (sourceIndex < 0) return
    const [source] = ordered.splice(sourceIndex, 1)
    const targetIndex = ordered.findIndex((group) => group._id === target._id)
    if (targetIndex < 0) return
    const insertIndex = resolvedPosition === 'after' ? targetIndex + 1 : targetIndex
    ordered.splice(insertIndex, 0, source)
    ordered.forEach((group, index) => options.saveGroup({ ...group, sort: index + 1 }, false))
    options.refreshData()
  }

  function startTaskDrag(task: TaskDoc) {
    if (options.editingTaskId.value === task._id) {
      clearTaskDropTarget()
      return
    }
    dragTaskId.value = task._id
  }

  function updateTaskDropTarget(event: DragEvent, task: TaskDoc) {
    if (!dragTaskId.value || dragTaskId.value === task._id) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dragOverTaskGroupId.value = ''
    dragOverTaskId.value = task._id
    dragInsertPosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  function clearTaskDropTarget() {
    dragOverTaskId.value = ''
    dragOverTaskGroupId.value = ''
    dragInsertPosition.value = ''
  }

  function finishTaskDrag() {
    dragTaskId.value = ''
    clearTaskDropTarget()
  }

  function onTaskDragDrop(targetTask?: TaskDoc, position = dragInsertPosition.value) {
    const sourceId = dragTaskId.value
    dragTaskId.value = ''
    const resolvedPosition = position || 'before'
    clearTaskDropTarget()
    const source = options.taskById(sourceId)
    if (!source) return
    const ordered = options.allTasksForGroup(options.activeGroupId.value).filter((task) => task._id !== source._id)
    const targetIndex = targetTask ? ordered.findIndex((task) => task._id === targetTask._id) : ordered.length
    const insertIndex = targetTask && targetIndex >= 0 && resolvedPosition === 'after' ? targetIndex + 1 : targetIndex
    ordered.splice(insertIndex < 0 ? ordered.length : insertIndex, 0, { ...source, groupId: options.activeGroupId.value })
    ordered.forEach((task, index) => options.saveTask({ ...task, sort: index + 1, groupId: options.activeGroupId.value }, false))
    options.refreshData()
    options.selectTask(sourceId)
  }

  function onTaskGroupDrop(targetGroup: GroupDoc) {
    const sourceId = dragTaskId.value
    dragTaskId.value = ''
    clearTaskDropTarget()
    clearGroupDropTarget()
    const source = options.taskById(sourceId)
    if (!source || source.groupId === targetGroup._id) return

    const ordered = options.tasks.value
      .filter((task) => task.groupId === targetGroup._id && task._id !== source._id)
      .sort((a, b) => a.sort - b.sort)
    ordered.push({ ...source, groupId: targetGroup._id })
    ordered.forEach((task, index) => options.saveTask({ ...task, groupId: targetGroup._id, sort: index + 1 }, false))
    options.refreshData()
    if (options.activeTaskId.value === sourceId) options.activeTaskId.value = options.visibleTasks.value[0]?._id || ''
  }

  return {
    dragTaskId,
    dragOverTaskId,
    dragOverTaskGroupId,
    dragInsertPosition,
    dragGroupId,
    dragOverGroupId,
    groupInsertPosition,
    startGroupDrag,
    updateGroupDropTarget,
    clearGroupDropTarget,
    startTaskDrag,
    updateTaskDropTarget,
    clearTaskDropTarget,
    finishTaskDrag,
    onGroupDragDrop,
    onTaskDragDrop
  }
}

