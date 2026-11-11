import type { ZtoolsDb } from '../../src/services/db'

export function createMemoryDb(): ZtoolsDb {
  const map = new Map<string, any>()
  const putOne = async (doc: any) => {
    const prev = map.get(doc._id)
    const revNum = prev?._rev ? Number(String(prev._rev).split('-')[1]) + 1 : 1
    const next = { ...doc, _rev: `rev-${revNum}` }
    map.set(doc._id, next)
    return next
  }
  return {
    async put(doc: any) {
      return putOne(doc)
    },
    async get(id: string) {
      return map.get(id) ?? null
    },
    async remove(docOrId: any) {
      const id = typeof docOrId === 'string' ? docOrId : docOrId._id
      map.delete(id)
      return { ok: true, id }
    },
    async allDocs(key?: string) {
      const all = [...map.values()]
      if (!key) return all
      return all.filter((d) => String(d._id).startsWith(key))
    },
    async bulkDocs(docs: object[]) {
      const out: object[] = []
      for (const doc of docs) {
        out.push(await putOne(doc))
      }
      return out
    },
  }
}
