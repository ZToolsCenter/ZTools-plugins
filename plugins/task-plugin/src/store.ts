/**
 * 全局响应式 store：项目 / 列 / 任务的内存状态与持久化同步。
 */
import { computed, ref } from 'vue'
import { storage } from './api/storage'
import {
  END_NAME,
  START_NAME,
  type Column,
  type ProjectDoc,
  type SubTask,
  type TaskDoc
} from './types'

export const projects = ref<ProjectDoc[]>([])
export const currentProjectId = ref<string | null>(null)
export const tasks = ref<TaskDoc[]>([])
export const loaded = ref(false)
export const filterText = ref('')
export const sidebarHidden = ref(false)

const CURRENT_KEY = 'currentProjectId'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newId(): string {
  return uid()
}

export const currentProject = computed<ProjectDoc | null>(
  () => projects.value.find(p => p._id === currentProjectId.value) ?? null
)

export const columns = computed<Column[]>(() => currentProject.value?.columns ?? [])
export const startColumn = computed<Column | null>(() => columns.value[0] ?? null)
export const endColumn = computed<Column | null>(() => columns.value[columns.value.length - 1] ?? null)

export function columnTasks(columnId: string): TaskDoc[] {
  const kw = filterText.value.trim().toLowerCase()
  return tasks.value
    .filter(t => t.columnId === columnId && (!kw || t.title.toLowerCase().includes(kw)))
    .sort((a, b) => a.order - b.order)
}

export function isDone(task: TaskDoc): boolean {
  return endColumn.value != null && task.columnId === endColumn.value.id
}

export const stats = computed(() => {
  const total = tasks.value.length
  const done = endColumn.value ? tasks.value.filter(t => t.columnId === endColumn.value!.id).length : 0
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 }
})

export async function init(): Promise<void> {
  projects.value = await storage.listProjects()
  const saved = await storage.getSetting(CURRENT_KEY)
  currentProjectId.value = saved && projects.value.some(p => p._id === saved)
    ? saved
    : (projects.value[0]?._id ?? null)
  sidebarHidden.value = !!(await storage.getSetting('sidebarHidden'))
  await reloadTasks()
  loaded.value = true
}

export async function reloadTasks(): Promise<void> {
  tasks.value = await storage.listTasks(currentProjectId.value ?? undefined)
}

export async function selectProject(id: string): Promise<void> {
  currentProjectId.value = id
  storage.setSetting(CURRENT_KEY, id)
  filterText.value = ''
  await reloadTasks()
}

export async function createProject(name: string): Promise<ProjectDoc> {
  const startId = uid()
  const midId = uid()
  const endId = uid()
  const doc: ProjectDoc = {
    _id: `project/${uid()}`,
    name: name.trim() || '未命名项目',
    columns: [
      { id: startId, name: START_NAME },
      { id: midId, name: '进行中' },
      { id: endId, name: END_NAME }
    ],
    createdAt: Date.now()
  }
  const saved = await storage.putProject(doc)
  projects.value.push(saved)
  await selectProject(saved._id)
  return saved
}

export async function renameProject(project: ProjectDoc, name: string): Promise<void> {
  const next = { ...project, name: name.trim() || project.name }
  const saved = await storage.putProject(next)
  const idx = projects.value.findIndex(p => p._id === project._id)
  if (idx >= 0) projects.value[idx] = saved
}

export async function deleteProject(project: ProjectDoc): Promise<void> {
  const own = await storage.listTasks(project._id)
  for (const t of own) {
    try {
      await enqueue(() => storage.removeTask(t._id, t._rev))
    } catch {
      // 单个任务删除失败不阻断项目删除
    }
  }
  await storage.removeProject(project._id, project._rev)
  projects.value = projects.value.filter(p => p._id !== project._id)
  if (currentProjectId.value === project._id) {
    currentProjectId.value = projects.value[0]?._id ?? null
    storage.setSetting(CURRENT_KEY, currentProjectId.value)
    await reloadTasks()
  }
}

export async function saveColumns(next: Column[]): Promise<void> {
  const p = currentProject.value
  if (!p) return
  const saved = await storage.putProject({ ...p, columns: next })
  const idx = projects.value.findIndex(x => x._id === p._id)
  if (idx >= 0) projects.value[idx] = saved
}

/** 收起/展开左侧项目列，状态持久化 */
export function toggleSidebar(): void {
  sidebarHidden.value = !sidebarHidden.value
  storage.setSetting('sidebarHidden', sidebarHidden.value)
}

export async function addColumn(name: string): Promise<void> {
  const cols = columns.value
  if (cols.length < 2) return
  const next = [...cols]
  next.splice(cols.length - 1, 0, { id: uid(), name: name.trim() || '新列' })
  await saveColumns(next)
}

export async function renameColumn(col: Column, name: string): Promise<void> {
  const next = columns.value.map(c => (c.id === col.id ? { ...c, name: name.trim() || c.name } : c))
  await saveColumns(next)
}

/** 删除中间列：其中任务移回开始列 */
export async function deleteColumn(colId: string): Promise<void> {
  const cols = columns.value
  if (cols.length <= 2 || colId === cols[0].id || colId === cols[cols.length - 1].id) return
  const fallback = cols[0].id
  for (const t of tasks.value) {
    if (t.columnId === colId) {
      await persistTask({ ...t, columnId: fallback })
    }
  }
  await saveColumns(cols.filter(c => c.id !== colId))
  await reloadTasks()
}

/** 全局写队列：所有持久化串行执行，避免并发写导致 _rev 冲突 */
let writeChain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn)
  writeChain = next.catch(() => undefined)
  return next
}

async function persistTask(task: TaskDoc): Promise<TaskDoc> {
  return enqueue(async () => {
    // 以内存中的最新 _rev 为准，避免过期版本号
    const latest = tasks.value.find(t => t._id === task._id)
    const doc: TaskDoc = { ...task, _rev: latest?._rev ?? task._rev }
    const saved = await storage.putTask(doc)
    const idx = tasks.value.findIndex(t => t._id === task._id)
    if (idx >= 0) tasks.value[idx] = saved
    else tasks.value.push(saved)
    return saved
  })
}

export async function saveTask(input: Partial<TaskDoc> & { projectId: string; title: string }): Promise<TaskDoc> {
  // 编辑已有任务时，未显式提供的字段沿用现值（order/createdAt 不被重置）
  const existing = input._id ? tasks.value.find(t => t._id === input._id) : undefined
  const order = input.order ?? existing?.order ?? tasks.value.filter(t => t.columnId === input.columnId).length
  const doc: TaskDoc = {
    _id: input._id ?? `task/${uid()}`,
    _rev: input._rev ?? existing?._rev,
    projectId: input.projectId,
    title: input.title.trim() || '未命名任务',
    desc: input.desc ?? '',
    columnId: input.columnId ?? existing?.columnId ?? columns.value[0]?.id ?? '',
    priority: input.priority ?? existing?.priority ?? 'mid',
    dueDate: input.dueDate ?? existing?.dueDate ?? null,
    order,
    createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
    subtasks: input.subtasks ?? existing?.subtasks ?? []
  }
  const saved = await persistTask(doc)
  await renumberColumn(saved.columnId)
  return saved
}

function updateTaskLocal(taskId: string, mutate: (t: TaskDoc) => TaskDoc): Promise<void> {
  const task = tasks.value.find(t => t._id === taskId)
  if (!task) return Promise.resolve()
  return persistTask(mutate(task)).then(() => undefined)
}

export async function addSubtask(taskId: string, title: string): Promise<void> {
  const name = title.trim()
  if (!name) return
  await updateTaskLocal(taskId, t => ({
    ...t,
    subtasks: [...(t.subtasks ?? []), { id: uid(), title: name, done: false }]
  }))
}

export async function toggleSubtask(taskId: string, subId: string): Promise<void> {
  await updateTaskLocal(taskId, t => ({
    ...t,
    subtasks: (t.subtasks ?? []).map(s => (s.id === subId ? { ...s, done: !s.done } : s))
  }))
}

export async function renameSubtask(taskId: string, subId: string, title: string): Promise<void> {
  const name = title.trim()
  if (!name) return
  await updateTaskLocal(taskId, t => ({
    ...t,
    subtasks: (t.subtasks ?? []).map(s => (s.id === subId ? { ...s, title: name } : s))
  }))
}

export async function removeSubtask(taskId: string, subId: string): Promise<void> {
  await updateTaskLocal(taskId, t => ({
    ...t,
    subtasks: (t.subtasks ?? []).filter(s => s.id !== subId)
  }))
}

export async function removeTask(task: TaskDoc): Promise<void> {
  // 以内存中的最新 _rev 为准
  const latest = tasks.value.find(t => t._id === task._id)
  await enqueue(() => storage.removeTask(task._id, latest?._rev ?? task._rev))
  tasks.value = tasks.value.filter(t => t._id !== task._id)
}

/** 拖拽落位：将任务移动到目标列的指定下标，并重排两列顺序 */
export async function moveTask(taskId: string, toColumnId: string, index: number): Promise<void> {
  const task = tasks.value.find(t => t._id === taskId)
  if (!task) return
  const fromColumnId = task.columnId

  // 从源列取出
  const source = tasks.value.filter(t => t.columnId === fromColumnId && t._id !== taskId)
    .sort((a, b) => a.order - b.order)
  let target: TaskDoc[]
  if (fromColumnId === toColumnId) {
    target = [...source]
  } else {
    target = tasks.value.filter(t => t.columnId === toColumnId).sort((a, b) => a.order - b.order)
  }
  const i = Math.max(0, Math.min(index, target.length))
  target.splice(i, 0, task)

  const updates: TaskDoc[] = []
  target.forEach((t, idx) => updates.push({ ...t, columnId: toColumnId, order: idx }))
  source.forEach((t, idx) => {
    if (fromColumnId !== toColumnId || !target.includes(t)) updates.push({ ...t, order: idx })
  })

  for (const u of updates) await persistTask(u)
}

async function renumberColumn(columnId: string): Promise<void> {
  const list = tasks.value.filter(t => t.columnId === columnId).sort((a, b) => a.order - b.order)
  for (let i = 0; i < list.length; i++) {
    if (list[i].order !== i) await persistTask({ ...list[i], order: i })
  }
}
