import type { GroupDoc } from '../types'
import { makeGroupId, newId, type ZtoolsDb } from './db'

export type GroupInput = {
  name: string
  cmds: string[]
  appIds: string[]
  order: number
}

export async function listGroups(db: ZtoolsDb): Promise<GroupDoc[]> {
  const docs = (await db.allDocs('group:')) as GroupDoc[]
  return docs.sort((a, b) => a.order - b.order)
}

export async function getGroup(db: ZtoolsDb, id: string): Promise<GroupDoc | null> {
  return (await db.get(id)) as GroupDoc | null
}

export async function deleteGroup(db: ZtoolsDb, id: string): Promise<void> {
  const existing = await db.get(id)
  if (existing) await db.remove(existing)
}

export async function saveGroup(
  db: ZtoolsDb,
  input: GroupInput,
  id?: string,
): Promise<GroupDoc> {
  const name = input.name.trim()
  if (!name) throw new Error('Group name is required')

  if (!input.appIds || input.appIds.length < 1) {
    throw new Error('Group must include at least one app')
  }

  const cmds =
    !input.cmds || input.cmds.length === 0 ? [name] : [...input.cmds]

  const existing = await listGroups(db)
  for (const group of existing) {
    if (id && group._id === id) continue
    for (const cmd of cmds) {
      if (group.cmds.includes(cmd)) {
        throw new Error(`cmd conflict: "${cmd}"`)
      }
    }
  }

  if (id) {
    const prev = (await db.get(id)) as GroupDoc | null
    if (!prev) throw new Error(`Group not found: ${id}`)
    const updated: GroupDoc = {
      ...prev,
      name,
      cmds,
      appIds: [...input.appIds],
      order: input.order,
      featureSynced: false,
    }
    await db.put(updated)
    return (await db.get(id)) as GroupDoc
  }

  const doc: GroupDoc = {
    _id: makeGroupId(newId()),
    name,
    cmds,
    appIds: [...input.appIds],
    order: input.order,
    featureSynced: false,
  }
  await db.put(doc)
  return (await db.get(doc._id)) as GroupDoc
}
