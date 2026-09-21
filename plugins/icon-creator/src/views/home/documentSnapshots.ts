/**
 * 文档级命名快照：把当前画布的完整序列化 JSON 存成命名副本，供 MCP 快照操作读写。
 *
 * 与 documentStyleMeta 的双通道持久化不同：快照数据量大且只描述画布视觉状态，
 * 因此只随工程 JSON 的 meta.snapshots 字段保存，不进入撤销快照（editorMeta），
 * 撤销/重做不会回滚快照列表本身，新建文档时清空。
 * 本模块只做纯数据归一化与校验，不依赖 fabric，供工程解析、运行时与 MCP 网关共同复用。
 */

import type { DocumentStyleMeta } from './documentStyleMeta'

/** 单个命名快照：name 在文档内唯一，createdAt 为毫秒时间戳，canvasJson 为画布序列化结果。 */
export type DocumentCanvasSnapshot = {
  name: string
  createdAt: number
  canvasJson: Record<string, unknown>
}

/** 文档级元数据整体结构（工程 JSON 的 meta 字段）：样式元数据 + 可选命名快照。 */
export type DocumentProjectMeta = DocumentStyleMeta & {
  snapshots?: DocumentCanvasSnapshot[]
}

/** 快照数量上限：超出后保存操作报错提示先删除。 */
export const MAX_DOCUMENT_CANVAS_SNAPSHOTS = 20

/** 恢复快照前自动备份当前画布所用的名称前缀（拼接毫秒时间戳）。 */
export const SNAPSHOT_BACKUP_NAME_PREFIX = '__backup__'

/**
 * 生成恢复前的自动备份快照名：前缀 + 当前毫秒时间戳。
 * 同名快照按 upsert 语义覆盖，因此时间戳即天然去重。
 */
export function createDocumentSnapshotBackupName(now = Date.now()): string {
  return `${SNAPSHOT_BACKUP_NAME_PREFIX}${now}`
}

/** 读取快照画布 JSON 中的顶层对象数量，供 objectCount 汇总使用；结构异常时返回 0。 */
export function getDocumentCanvasSnapshotObjectCount(snapshot: DocumentCanvasSnapshot): number {
  const objects = (snapshot.canvasJson as { objects?: unknown } | undefined)?.objects
  return Array.isArray(objects) ? objects.length : 0
}

/**
 * 按名称把快照合并进列表（不改变传入数组）：同名覆盖，否则追加。
 * createdAt 缺省取当前时间（工程读取场景会显式传入原时间戳以保留创建时间）。
 * 返回新数组，供响应式状态整体替换触发更新。
 */
export function upsertDocumentCanvasSnapshot(
  list: DocumentCanvasSnapshot[],
  name: string,
  canvasJson: Record<string, unknown>,
  createdAt = Date.now()
): DocumentCanvasSnapshot[] {
  const trimmedName = name.trim()
  const entry: DocumentCanvasSnapshot = {
    name: trimmedName,
    createdAt,
    canvasJson
  }
  const existingIndex = list.findIndex((item) => item.name === trimmedName)
  if (existingIndex < 0) return [...list, entry]
  const next = [...list]
  next[existingIndex] = entry
  return next
}

/** 按名称移除快照，不存在时原样返回浅拷贝。 */
export function removeDocumentCanvasSnapshotByName(list: DocumentCanvasSnapshot[], name: string): DocumentCanvasSnapshot[] {
  const trimmedName = name.trim()
  return list.filter((item) => item.name !== trimmedName)
}

/**
 * 归一化快照数组（工程文件读取用）：丢弃缺 name / canvasJson 不是普通对象的条目，
 * 重复名以后写入者为准，超出上限时保留先写入的条目，任何非法输入都降级为空数组。
 */
export function normalizeDocumentCanvasSnapshots(value: unknown): DocumentCanvasSnapshot[] {
  if (!Array.isArray(value)) return []
  let result: DocumentCanvasSnapshot[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const canvasJson = source.canvasJson
    if (!name || !canvasJson || typeof canvasJson !== 'object' || Array.isArray(canvasJson)) continue
    const parsedCreatedAt = Number(source.createdAt)
    result = upsertDocumentCanvasSnapshot(
      result,
      name,
      canvasJson as Record<string, unknown>,
      Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now()
    )
    if (result.length >= MAX_DOCUMENT_CANVAS_SNAPSHOTS) break
  }
  return result
}
