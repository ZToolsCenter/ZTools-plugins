const TASKS_PREFIX = 'todo-tasks/'
const GROUPS_PREFIX = 'todo-group/'
const NEXT_TASK_SORT_KEY = 'mcp-next-task-sort'
const NEXT_GROUP_SORT_KEY = 'mcp-next-group-sort'

const FEATURE_FLAGS = {
  noteWindow: false,
  tomatoWindow: false
}

const ztools = window.ztools
const windows = new Map()
let ipcRenderer

try {
  ;({ ipcRenderer } = require('electron'))
} catch {
  ipcRenderer = null
}

function getDbDocValue(doc) {
  return doc && (doc.value || doc)
}

function getAllTasks() {
  const docs = ztools?.db?.allDocs?.(TASKS_PREFIX) || []
  return docs
    .filter((doc) => doc._id?.startsWith(TASKS_PREFIX) && !doc.$deprecated)
    .map((doc) => ({ _id: doc._id, ...getDbDocValue(doc) }))
}

function getAllGroups() {
  const docs = ztools?.db?.allDocs?.(GROUPS_PREFIX) || []
  return docs
    .filter((doc) => doc._id?.startsWith(GROUPS_PREFIX) && !doc.$deprecated)
    .map((doc) => ({ _id: doc._id, ...getDbDocValue(doc) }))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
}

function getTaskById(id) {
  const fullId = id.startsWith(TASKS_PREFIX) ? id : `${TASKS_PREFIX}${id}`
  const doc = ztools?.db?.get?.(fullId)
  if (!doc || doc.$deprecated) return null
  return { _id: doc._id, ...getDbDocValue(doc) }
}

function putDoc(id, value) {
  ztools?.dbStorage?.setItem?.(id, value)
  return ztools?.db?.put?.({ _id: id, value })
}

function nextSort(key) {
  const current = ztools?.dbStorage?.getItem?.(key) || 0
  const next = Number(current) + 1
  ztools?.dbStorage?.setItem?.(key, next)
  return next
}

function getGroupNameById(id) {
  return getAllGroups().find((group) => group._id === id)?.title || ''
}

function getGroupIdByName(name) {
  return getAllGroups().find((group) => group.title === name)?._id || null
}

function getOrCreateGroup(name) {
  const existing = getGroupIdByName(name)
  if (existing) return existing
  const now = Date.now()
  const id = `${GROUPS_PREFIX}${now}`
  putDoc(id, {
    title: name,
    sort: nextSort(NEXT_GROUP_SORT_KEY),
    created_at: now
  })
  return id
}

function formatDateTime(timestamp) {
  if (!timestamp) return undefined
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function parseDueAt(value) {
  if (!value) return undefined
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return undefined
  const date = new Date(year, month - 1, day, 23, 59, 59, 999)
  if (Number.isNaN(date.getTime())) return undefined
  return date.getTime()
}

async function todoGroupList() {
  return {
    groups: getAllGroups().map((group) => ({ name: group.title }))
  }
}

async function todoSearch({ query, group, status, dueAt } = {}) {
  let tasks = getAllTasks()
  if (query) {
    const keyword = query.toLowerCase()
    tasks = tasks.filter((task) => task.text?.toLowerCase().includes(keyword))
  }
  if (group) {
    const groupId = getGroupIdByName(group)
    tasks = groupId ? tasks.filter((task) => task.groupId === groupId) : []
  }
  if (status === 'done') tasks = tasks.filter((task) => task.completed)
  if (status === 'pending') tasks = tasks.filter((task) => !task.completed)
  if (dueAt) {
    const due = parseDueAt(dueAt)
    tasks = tasks.filter((task) => task.dueAt && task.dueAt <= due)
  }

  return {
    tasks: tasks
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map((task) => ({
        id: task._id,
        text: task.text,
        group: getGroupNameById(task.groupId),
        completed: Boolean(task.completed),
        dueAt: formatDateTime(task.dueAt),
        completed_at: formatDateTime(task.completed_at),
        created_at: formatDateTime(task.created_at)
      }))
  }
}

async function todoCreate({ content, dueAt, group }) {
  const now = Date.now()
  const id = `${TASKS_PREFIX}${now}`
  const groupId = group ? getOrCreateGroup(group) : `${GROUPS_PREFIX}pending`
  const task = {
    text: content,
    groupId,
    completed: false,
    created_at: now,
    sort: nextSort(NEXT_TASK_SORT_KEY),
    dueAt: parseDueAt(dueAt)
  }
  putDoc(id, task)
  return {
    id,
    text: task.text,
    group: group || '待处理',
    dueAt: formatDateTime(task.dueAt),
    created_at: formatDateTime(task.created_at)
  }
}

async function todoUpdate({ id, patch }) {
  const task = getTaskById(id)
  if (!task) throw new Error(`待办事项不存在: ${id}`)
  const updated = { ...task }
  delete updated._id

  if (patch.content !== undefined) updated.text = patch.content
  if (patch.status === 'done') {
    updated.completed = true
    updated.completed_at = Date.now()
    if (!updated.first_completed_at) updated.first_completed_at = updated.completed_at
  }
  if (patch.status === 'pending') {
    updated.completed = false
    delete updated.completed_at
  }
  if (patch.dueAt !== undefined) {
    const due = parseDueAt(patch.dueAt)
    if (due) updated.dueAt = due
    else delete updated.dueAt
  }
  if (patch.group !== undefined) updated.groupId = getOrCreateGroup(patch.group)

  putDoc(task._id, updated)
  return {
    id: task._id,
    text: updated.text,
    group: getGroupNameById(updated.groupId),
    completed: Boolean(updated.completed),
    dueAt: formatDateTime(updated.dueAt),
    updated: true
  }
}

function appUrl(hash) {
  if (ztools?.isDev?.()) return `http://localhost:5173/#/${hash}`
  return `index.html#/${hash}`
}

function isBrowserWindow() {
  return ztools?.getWindowType?.() === 'browser'
}

function sendWindowRequest(channel, payload) {
  if (!isBrowserWindow()) return false
  ztools?.sendToParent?.(channel, payload)
  return true
}

function openWindow(key, hash, options) {
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed?.()) {
    existing.show?.()
    existing.moveTop?.()
    return existing
  }
  const win = ztools?.createBrowserWindow?.(appUrl(hash), options)
  if (win) {
    windows.set(key, win)
    win.setAlwaysOnTop?.(true)
  }
  return win
}

function openNote(params = {}) {
  if (!FEATURE_FLAGS.noteWindow) return null
  if (sendWindowRequest('todo-open-note', params)) return
  const search = new URLSearchParams()
  if (params.group) search.set('group', params.group)
  if (params.status) search.set('status', params.status)
  const groupKey = params.group || '待处理'
  return openWindow(`note:${groupKey}:${params.status || ''}`, `note?${search.toString()}`, {
    width: 330,
    height: 460,
    minWidth: 260,
    minHeight: 260,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    webPreferences: { preload: 'preload/services.js' }
  })
}

function openTomato(taskId) {
  if (!FEATURE_FLAGS.tomatoWindow) return null
  if (sendWindowRequest('todo-open-tomato', taskId)) return
  const search = new URLSearchParams()
  if (taskId) search.set('taskId', taskId)
  return openWindow(`tomato:${taskId || 'empty'}`, `tomato?${search.toString()}`, {
    width: 360,
    height: 440,
    minWidth: 280,
    minHeight: 340,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    webPreferences: { preload: 'preload/services.js' }
  })
}

async function todoPinToScreen(args = {}) {
  if (!FEATURE_FLAGS.noteWindow) return { pinned: false }
  const filter = args.filter || {}
  const names = Array.isArray(filter.group) && filter.group.length ? filter.group : ['待处理']
  names.forEach((group) => openNote({ group, status: filter.status }))
  return { pinned: true }
}

const handlers = {
  todo_group_list: todoGroupList,
  todo_search: todoSearch,
  todo_create: todoCreate,
  todo_update: todoUpdate,
  ...(FEATURE_FLAGS.noteWindow ? { todo_pin_to_screen: todoPinToScreen } : {})
}

function registerTools() {
  const registerTool = ztools?.registerTool
  if (!registerTool || window.__todoToolsRegistered) return
  Object.entries(handlers).forEach(([name, handler]) => registerTool.call(ztools, name, handler))
  window.__todoToolsRegistered = true
}

function registerWindowRequestForwarding() {
  if (!ipcRenderer || window.__todoWindowRequestsRegistered) return
  if (FEATURE_FLAGS.noteWindow) ipcRenderer.on('todo-open-note', (_event, params) => openNote(params || {}))
  if (FEATURE_FLAGS.tomatoWindow) ipcRenderer.on('todo-open-tomato', (_event, taskId) => openTomato(taskId))
  window.__todoWindowRequestsRegistered = true
}

registerTools()
registerWindowRequestForwarding()

window.services = {
  featureFlags: FEATURE_FLAGS,
  openNote,
  openTomato,
  pinToScreen: todoPinToScreen,
  closeWindow() {
    window.close()
  }
}
