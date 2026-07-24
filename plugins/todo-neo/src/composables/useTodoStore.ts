import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { GroupDoc, Settings, StatusFilter, TaskDoc, ViewName } from '../types'
import { featureFlags } from '../featureFlags'
import {
  ACTIVE_GROUP_KEY,
  ACTIVE_TASK_KEY,
  GROUPS_PREFIX,
  SETTINGS_KEY,
  TASKS_PREFIX,
  defaultGroups,
  defaultSettings
} from './todoConstants'
import { allDocs, docValue, getStorage, groupPayload, putDoc, setStorage, taskPayload } from './todoPersistence'
import { compactDate, formatDate, formatDateInput, formatTimer, parseDateInputEndOfDay } from './todoFormatters'
import { useTodoContextMenu } from './useTodoContextMenu'
import { useTodoDrag } from './useTodoDrag'
import { useTodoGroups } from './useTodoGroups'
import { useTodoKeyboard } from './useTodoKeyboard'
import { useTodoTasks } from './useTodoTasks'
import { useTomatoTimer } from './useTomatoTimer'
import { useTodoWindows } from './useTodoWindows'
import { useTaskSearch } from './useTaskSearch'

const route = ref<ViewName>('main')
const routeQuery = ref(new URLSearchParams())
const groups = ref<GroupDoc[]>([])
const tasks = ref<TaskDoc[]>([])
const settings = reactive<Settings>({ ...defaultSettings })
const activeGroupId = ref(`${GROUPS_PREFIX}pending`)
const activeTaskId = ref('')
const detailTaskId = ref('')
const settingsOpen = ref(false)
const noteEditingTaskId = ref('')
const noteDraft = ref('')
const noteFocused = ref(true)
const tomatoTaskId = ref('')
let mounted = false
let mountConsumers = 0
let tomatoInterval: number | undefined

function saveTask(task: TaskDoc, shouldRefresh = true) {
  putDoc(task._id, taskPayload(task))
  if (shouldRefresh) refreshData()
}

function saveGroup(group: GroupDoc, shouldRefresh = true) {
  putDoc(group._id, groupPayload(group))
  if (shouldRefresh) refreshData()
}

function refreshData() {
  const loadedGroups = allDocs<Omit<GroupDoc, '_id'>>(GROUPS_PREFIX)
    .map((doc) => ({ _id: doc._id, ...docValue<Omit<GroupDoc, '_id'>>(doc) }))
    .filter((group) => group.title)
    .sort((a, b) => a.sort - b.sort)

  if (!loadedGroups.length) {
    const now = Date.now()
    defaultGroups.forEach((group, index) => {
      putDoc(group._id, { title: group.title, sort: group.sort, created_at: now + index })
    })
  }

  groups.value = allDocs<Omit<GroupDoc, '_id'>>(GROUPS_PREFIX)
    .map((doc) => ({ _id: doc._id, ...docValue<Omit<GroupDoc, '_id'>>(doc) }))
    .filter((group) => group.title)
    .sort((a, b) => a.sort - b.sort)

  tasks.value = allDocs<Omit<TaskDoc, '_id'>>(TASKS_PREFIX)
    .map((doc) => ({ _id: doc._id, ...docValue<Omit<TaskDoc, '_id'>>(doc) }))
    .filter((task) => task.text && task.groupId)
    .sort((a, b) => a.sort - b.sort)

  if (!groups.value.some((group) => group._id === activeGroupId.value)) {
    activeGroupId.value = groups.value[0]?._id || `${GROUPS_PREFIX}pending`
  }
}

function saveSettings() {
  setStorage(SETTINGS_KEY, { ...settings })
}

function loadSettings() {
  const saved = getStorage<Record<string, unknown>>(SETTINGS_KEY, {})
  const savedSettings: Partial<Settings> = {}
  ;(Object.keys(defaultSettings) as Array<keyof Settings>).forEach((key) => {
    if (saved[key] !== undefined) {
      savedSettings[key] = saved[key] as never
    }
  })
  Object.assign(settings, defaultSettings, savedSettings)
  syncTomatoSettings()
}

function groupById(id: string) {
  return groups.value.find((group) => group._id === id)
}

function taskById(id: string) {
  return tasks.value.find((task) => task._id === id)
}

function allTasksForGroup(groupId: string) {
  return tasks.value
    .filter((task) => task.groupId === groupId)
    .sort((a, b) => a.sort - b.sort)
}

function tasksForGroup(groupId: string, status?: StatusFilter) {
  let result = allTasksForGroup(groupId)
  if (status === 'done') result = result.filter((task) => task.completed)
  if (status === 'pending') result = result.filter((task) => !task.completed)
  if (settings.hideCompleted && !status) result = result.filter((task) => !task.completed)
  return [...result].sort((a, b) => {
    if (settings.bottomCompleted && a.completed !== b.completed) return a.completed ? 1 : -1
    return a.sort - b.sort
  })
}

const activeGroup = computed(() => groupById(activeGroupId.value) || groups.value[0])
const visibleTasks = computed(() => tasksForGroup(activeGroupId.value))
const detailTask = computed(() => taskById(detailTaskId.value))
const currentTomatoTask = computed(() => taskById(tomatoTaskId.value))
const noteGroupName = computed(() => routeQuery.value.get('group') || '待处理')
const noteStatus = computed(() => {
  const status = routeQuery.value.get('status')
  return status === 'done' || status === 'pending' ? status : undefined
})
const noteGroup = computed(() => groups.value.find((group) => group.title === noteGroupName.value) || groups.value[0])
const noteTasks = computed(() => (noteGroup.value ? tasksForGroup(noteGroup.value._id, noteStatus.value) : []))
const pendingCount = computed(() => tasks.value.filter((task) => !task.completed).length)
const {
  tomatoRemaining,
  tomatoRunning,
  tomatoProgress,
  tomatoSegments,
  syncTomatoSettings,
  resetTomato,
  toggleTomato,
  updateTomatoMinutes,
  tickTomato
} = useTomatoTimer({
  settings,
  currentTomatoTask,
  saveSettings
})

function selectGroup(id: string) {
  activeGroupId.value = id
  setStorage(ACTIVE_GROUP_KEY, id)
  const firstTask = tasksForGroup(id)[0]
  selectTask(firstTask?._id || '')
}

function selectTask(id: string) {
  activeTaskId.value = id
  setStorage(ACTIVE_TASK_KEY, id)
}

function selectTaskAndReveal(id: string) {
  selectTask(id)
  nextTick(() => document.querySelector<HTMLElement>('.task-card.active')?.scrollIntoView({ block: 'nearest' }))
}

const {
  groupComposerOpen,
  newGroupTitle,
  editingGroupId,
  editingGroupTitle,
  deleteGroupId,
  showGroupComposer,
  createGroup,
  startGroupEdit,
  renameGroup,
  deleteGroup
} = useTodoGroups({
  groups,
  tasks,
  saveGroup,
  refreshData,
  selectGroup
})

const {
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
} = useTodoTasks({
  activeGroupId,
  activeTaskId,
  visibleTasks,
  taskById,
  allTasksForGroup,
  saveTask,
  refreshData,
  selectGroup,
  selectTask
})

const {
  contextMenu,
  contextTask,
  contextGroup,
  openTaskContextMenu,
  openGroupContextMenu,
  closeContextMenu
} = useTodoContextMenu({
  taskById,
  groupById,
  selectTask
})

const {
  taskSearchOpen,
  taskSearchQuery,
  taskSearchIndex,
  taskSearchResults,
  openTaskSearch,
  closeTaskSearch,
  updateTaskSearchQuery,
  moveTaskSearchSelection,
  confirmTaskSearchSelection
} = useTaskSearch({
  tasks,
  groupById,
  selectGroup,
  selectTask,
  closeContextMenu
})

const {
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
} = useTodoDrag({
  groups,
  tasks,
  activeGroupId,
  activeTaskId,
  editingGroupId,
  editingTaskId,
  visibleTasks,
  taskById,
  allTasksForGroup,
  saveTask,
  saveGroup,
  refreshData,
  selectTask
})

const { openNote, openTomato, createNoteTask, closeCurrentWindow } = useTodoWindows({
  activeGroup,
  activeTaskId,
  noteGroup,
  noteDraft,
  taskById,
  createTask
})

function setDueAt(task: TaskDoc, value: string) {
  const updated = { ...task }
  if (value) {
    const dueAt = parseDateInputEndOfDay(value)
    if (!dueAt) return
    updated.dueAt = dueAt
  } else {
    delete updated.dueAt
  }
  saveTask(updated)
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '')
  const [name, query = ''] = raw.split('?')
  if (name === 'note' && featureFlags.noteWindow) route.value = name
  else if (name === 'tomato' && featureFlags.tomatoWindow) route.value = name
  else route.value = 'main'
  routeQuery.value = new URLSearchParams(query)
  tomatoTaskId.value = routeQuery.value.get('taskId') || activeTaskId.value
}

function handlePluginEnter(action: { code: string; type: string; payload: any }) {
  if (action.code === 'new-note') {
    if (featureFlags.noteWindow) window.services?.openNote()
    window.ztools?.outPlugin?.()
    return
  }
  route.value = 'main'
  if (action.code === 'add') {
    const text = Array.isArray(action.payload) ? action.payload.join('\n') : String(action.payload || '')
    createTask(text, activeGroupId.value, activeTaskId.value || null)
    window.ztools?.showNotification?.('已添加到待办')
    return
  }
  refreshData()
}

const { handleKeyboard, handleSettingsEscape } = useTodoKeyboard({
  route,
  settingsOpen,
  groups,
  activeGroupId,
  activeTaskId,
  visibleTasks,
  taskById,
  selectTaskAndReveal,
  selectGroup,
  toggleTask,
  startEditTask,
  requestDeleteTask,
  beginCreateTask,
  openTaskSearch
})

function mountStore() {
  if (mounted) return
  mounted = true
  loadSettings()
  activeGroupId.value = getStorage(ACTIVE_GROUP_KEY, activeGroupId.value)
  activeTaskId.value = getStorage(ACTIVE_TASK_KEY, '')
  refreshData()
  parseRoute()
  window.addEventListener('hashchange', parseRoute)
  window.addEventListener('keydown', handleSettingsEscape, { capture: true })
  window.addEventListener('keydown', handleKeyboard)
  window.ztools?.onPluginEnter?.(handlePluginEnter)
  window.ztools?.onDbPull?.(() => refreshData())
  tomatoInterval = window.setInterval(() => {
    tickTomato()
  }, 1000)
}

function unmountStore() {
  window.removeEventListener('hashchange', parseRoute)
  window.removeEventListener('keydown', handleSettingsEscape, { capture: true })
  window.removeEventListener('keydown', handleKeyboard)
  if (tomatoInterval) {
    window.clearInterval(tomatoInterval)
    tomatoInterval = undefined
  }
  mounted = false
}

export function useTodoStore() {
  onMounted(() => {
    mountConsumers += 1
    mountStore()
  })
  onBeforeUnmount(() => {
    mountConsumers = Math.max(0, mountConsumers - 1)
    if (mountConsumers === 0) {
      unmountStore()
    }
  })

  return {
    route,
    groups,
    tasks,
    settings,
    activeGroupId,
    activeTaskId,
    groupComposerOpen,
    newGroupTitle,
    composingTaskGroupId,
    composingTaskAfterId,
    composingTaskText,
    editingTaskId,
    editingText,
    editingGroupId,
    editingGroupTitle,
    detailTaskId,
    deletingTask,
    settingsOpen,
    taskSearchOpen,
    taskSearchQuery,
    taskSearchIndex,
    deleteGroupId,
    deleteTaskId,
    contextMenu,
    dragTaskId,
    dragOverTaskId,
    dragOverTaskGroupId,
    dragInsertPosition,
    dragGroupId,
    dragOverGroupId,
    groupInsertPosition,
    noteEditingTaskId,
    noteDraft,
    noteFocused,
    tomatoTaskId,
    tomatoRemaining,
    tomatoRunning,
    activeGroup,
    visibleTasks,
    detailTask,
    currentTomatoTask,
    contextTask,
    contextGroup,
    noteGroupName,
    noteTasks,
    pendingCount,
    taskSearchResults,
    tomatoProgress,
    tomatoSegments,
    saveSettings,
    refreshData,
    groupById,
    taskById,
    tasksForGroup,
    selectGroup,
    selectTask,
    openTaskContextMenu,
    openGroupContextMenu,
    closeContextMenu,
    openTaskSearch,
    closeTaskSearch,
    updateTaskSearchQuery,
    moveTaskSearchSelection,
    confirmTaskSearchSelection,
    beginCreateTask,
    saveComposedTask,
    cancelComposedTask,
    showGroupComposer,
    createGroup,
    startGroupEdit,
    renameGroup,
    deleteGroup,
    toggleTask,
    startEditTask,
    saveEditTask,
    requestDeleteTask,
    confirmDeleteTask,
    moveTask,
    startGroupDrag,
    updateGroupDropTarget,
    clearGroupDropTarget,
    startTaskDrag,
    updateTaskDropTarget,
    clearTaskDropTarget,
    finishTaskDrag,
    onGroupDragDrop,
    onTaskDragDrop,
    openNote,
    openTomato,
    createNoteTask,
    formatDateInput,
    setDueAt,
    formatDate,
    compactDate,
    resetTomato,
    toggleTomato,
    updateTomatoMinutes,
    formatTimer,
    closeCurrentWindow
  }
}
