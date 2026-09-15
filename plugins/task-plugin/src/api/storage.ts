/**
 * ZTools API 封装：仅对接 window.ztools 原生能力。
 * 浏览器开发预览（无 ZTools 宿主）时降级到 localStorage，数据结构不变。
 * 宿主调用抛错时同样降级到 localStorage 并输出错误日志，保证插件可用、问题可查。
 */
import type { ProjectDoc, TaskDoc } from '../types'

interface Doc {
  _id: string
  _rev?: string
  [key: string]: any
}

function zt(): any {
  return (window as any).ztools
}

let lsWarned = false

function warnHostFailure(op: string, id: string, e: unknown) {
  console.error(`[task-plugin] ztools.db.${op} failed (id=${id}), fallback to localStorage:`, e)
}

function lsRead(): Record<string, Doc> {
  try {
    return JSON.parse(localStorage.getItem('task-plugin:db') || '{}')
  } catch {
    return {}
  }
}

function lsWrite(docs: Record<string, Doc>) {
  try {
    localStorage.setItem('task-plugin:db', JSON.stringify(docs))
  } catch (e) {
    if (!lsWarned) {
      console.warn('[task-plugin] localStorage unavailable', e)
      lsWarned = true
    }
  }
}

/** 归一化 allDocs 返回：数组 / PouchDB 行包装 {rows:[{doc}]} / 对象映射 */
function normalizeDocs(res: any): Doc[] {
  if (Array.isArray(res)) {
    return res.filter(d => d && d._id)
  }
  if (res && Array.isArray(res.rows)) {
    return res.rows.map((r: any) => (r && r.doc ? r.doc : r)).filter((d: any) => d && d._id)
  }
  if (res && typeof res === 'object') {
    const vals = Object.values(res).filter((v: any) => v && v._id) as Doc[]
    if (vals.length) return vals
  }
  return []
}

async function dbPut(doc: Doc): Promise<Doc> {
  const z = zt()
  try {
    if (z?.db?.put) {
      // 深拷贝为纯对象：Vue 的 reactive Proxy（如嵌套的 subtasks/columns 数组）
      // 无法通过 Electron IPC 结构化克隆，会抛 "An object could not be cloned"
      const payload: Doc = JSON.parse(JSON.stringify(doc))
      if (!payload._rev) delete payload._rev // 首次插入不带空 rev，避免宿主校验失败
      const res = await (z.db.promises?.put ? z.db.promises.put(payload) : z.db.put(payload))
      const rev = res?._rev ?? res?.rev
      return rev ? { ...payload, _rev: rev } : payload
    }
  } catch (e) {
    warnHostFailure('put', doc._id, e)
  }
  const docs = lsRead()
  const rev = `${Number(String(docs[doc._id]?._rev || '0').split('-')[0]) + 1}-${Date.now().toString(36)}`
  const next = { ...doc, _rev: rev }
  docs[doc._id] = next
  lsWrite(docs)
  return next
}

async function dbGet(id: string): Promise<Doc | null> {
  const z = zt()
  try {
    if (z?.db?.get) {
      const res = await (z.db.promises?.get ? z.db.promises.get(id) : z.db.get(id))
      return res ?? null
    }
  } catch (e) {
    warnHostFailure('get', id, e)
  }
  return lsRead()[id] ?? null
}

async function dbRemove(id: string, rev?: string): Promise<void> {
  const z = zt()
  try {
    if (z?.db?.remove) {
      const arg: Doc = { _id: id }
      if (rev != null) arg._rev = rev
      await (z.db.promises?.remove ? z.db.promises.remove(arg) : z.db.remove(arg))
      return
    }
  } catch (e) {
    warnHostFailure('remove', id, e)
  }
  const docs = lsRead()
  delete docs[id]
  lsWrite(docs)
}

async function dbAll(prefix: string): Promise<Doc[]> {
  const z = zt()
  try {
    if (z?.db?.allDocs) {
      const res = await (z.db.promises?.allDocs ? z.db.promises.allDocs(prefix) : z.db.allDocs(prefix))
      const docs = normalizeDocs(res)
      // 前缀过滤兜底：部分宿主的 key 参数语义可能是精确匹配
      return docs.filter(d => d._id.startsWith(prefix))
    }
  } catch (e) {
    warnHostFailure('allDocs', prefix, e)
  }
  return Object.values(lsRead()).filter(d => d._id.startsWith(prefix))
}

export const storage = {
  async listProjects(): Promise<ProjectDoc[]> {
    const docs = await dbAll('project/')
    return docs.sort((a, b) => a.createdAt - b.createdAt) as ProjectDoc[]
  },
  async putProject(p: ProjectDoc): Promise<ProjectDoc> {
    return (await dbPut(p)) as unknown as ProjectDoc
  },
  async removeProject(id: string, rev?: string): Promise<void> {
    await dbRemove(id, rev)
  },

  async listTasks(projectId?: string): Promise<TaskDoc[]> {
    const docs = await dbAll('task/')
    return docs
      .filter(t => !projectId || t.projectId === projectId)
      .sort((a, b) => a.order - b.order) as TaskDoc[]
  },
  async putTask(t: TaskDoc): Promise<TaskDoc> {
    return (await dbPut(t)) as unknown as TaskDoc
  },
  async removeTask(id: string, rev?: string): Promise<void> {
    await dbRemove(id, rev)
  },

  async getSetting(key: string): Promise<any> {
    const z = zt()
    if (z?.dbStorage?.getItem) {
      try {
        return await z.dbStorage.getItem(`task-plugin:${key}`)
      } catch (e) {
        console.error('[task-plugin] dbStorage.getItem failed:', e)
      }
    }
    try {
      const raw = localStorage.getItem(`task-plugin:setting:${key}`)
      return raw == null ? null : JSON.parse(raw)
    } catch {
      return null
    }
  },
  setSetting(key: string, value: any): void {
    const z = zt()
    if (z?.dbStorage?.setItem) {
      try {
        // 防御性深拷贝，避免响应式对象跨 IPC 克隆失败
        const plain = typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value
        z.dbStorage.setItem(`task-plugin:${key}`, plain)
        return
      } catch (e) {
        console.error('[task-plugin] dbStorage.setItem failed:', e)
      }
    }
    try {
      localStorage.setItem(`task-plugin:setting:${key}`, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }
}
