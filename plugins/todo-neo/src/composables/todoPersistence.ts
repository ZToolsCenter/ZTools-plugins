import type { GroupDoc, TaskDoc } from '../types'
import { LOCAL_DOCS_KEY } from './todoConstants'

export function hasZtools() {
  return typeof window !== 'undefined' && Boolean((window as any).ztools)
}

export function docValue<T>(doc: any): T {
  return (doc?.value || doc) as T
}

function localDocs(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DOCS_KEY) || '{}')
  } catch {
    return {}
  }
}

function setLocalDocs(docs: Record<string, any>) {
  localStorage.setItem(LOCAL_DOCS_KEY, JSON.stringify(docs))
}

export function getStorage<T>(key: string, fallback: T): T {
  if (hasZtools()) return window.ztools.dbStorage.getItem<T>(key) ?? fallback
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function setStorage(key: string, value: unknown) {
  if (hasZtools()) window.ztools.dbStorage.setItem(key, value)
  else localStorage.setItem(key, JSON.stringify(value))
}

export function allDocs<T>(prefix: string): Array<{ _id: string; value: T }> {
  if (hasZtools()) return window.ztools.db.allDocs<{ value: T }>(prefix) as Array<{ _id: string; value: T }>
  return Object.entries(localDocs())
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, value]) => ({ _id: id, value: value as T }))
}

export function putDoc<T>(id: string, value: T) {
  if (hasZtools()) {
    window.ztools.dbStorage.setItem(id, value)
    window.ztools.db.put({ _id: id, value })
    return
  }
  const docs = localDocs()
  docs[id] = value
  setLocalDocs(docs)
}

export function removeDoc(id: string) {
  if (hasZtools()) {
    const doc = window.ztools.db.get(id)
    if (doc) window.ztools.db.remove(doc)
    window.ztools.dbStorage.removeItem(id)
    return
  }
  const docs = localDocs()
  delete docs[id]
  setLocalDocs(docs)
}

export function taskPayload(task: TaskDoc): Omit<TaskDoc, '_id'> {
  return {
    text: task.text,
    groupId: task.groupId,
    completed: task.completed,
    completed_at: task.completed_at,
    first_completed_at: task.first_completed_at,
    created_at: task.created_at,
    sort: task.sort,
    dueAt: task.dueAt
  }
}

export function groupPayload(group: GroupDoc): Omit<GroupDoc, '_id'> {
  return {
    title: group.title,
    sort: group.sort,
    created_at: group.created_at
  }
}

