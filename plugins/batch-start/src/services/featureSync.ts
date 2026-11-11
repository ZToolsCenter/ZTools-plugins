import type { GroupDoc } from '../types'
import type { ZtoolsDb } from './db'
import { getGroup, listGroups } from './launchGroup'

export type FeatureApi = {
  setFeature: (feature: {
    code: string
    explain: string
    cmds: string[]
  }) => boolean | Promise<boolean>
  removeFeature: (code: string) => boolean | Promise<boolean>
  getFeatures?: () => Array<{ code: string }> | Promise<Array<{ code: string }>>
}

export async function syncGroupFeature(
  group: GroupDoc,
  api: FeatureApi,
  db: ZtoolsDb,
): Promise<GroupDoc> {
  let ok = false
  try {
    ok = !!(await api.setFeature({
      code: group._id,
      explain: `启动组：${group.name}`,
      cmds: group.cmds,
    }))
  } catch {
    ok = false
  }

  const updated: GroupDoc = { ...group, featureSynced: ok }
  await db.put(updated)
  return (await getGroup(db, group._id)) as GroupDoc
}

export async function removeGroupFeature(
  groupId: string,
  api: FeatureApi,
): Promise<void> {
  await api.removeFeature(groupId)
}

export async function reconcileFeatures(
  db: ZtoolsDb,
  api: FeatureApi,
): Promise<void> {
  const groups = await listGroups(db)
  const groupIds = new Set(groups.map((g) => g._id))

  const features = api.getFeatures ? await api.getFeatures() : []
  const groupFeatures = features.filter((f) => String(f.code).startsWith('group:'))

  for (const feature of groupFeatures) {
    if (!groupIds.has(feature.code)) {
      await api.removeFeature(feature.code)
    }
  }

  const featureCodes = new Set(groupFeatures.map((f) => f.code))
  for (const group of groups) {
    if (!featureCodes.has(group._id) || !group.featureSynced) {
      await syncGroupFeature(group, api, db)
    }
  }
}
