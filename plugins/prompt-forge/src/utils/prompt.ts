import type { PromptItem, PromptType, Snapshot, Variable } from '../types'

const promptTypes: PromptType[] = ['prompt', 'snippet', 'template', 'constraint']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeVariables(value: unknown): Variable[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((variable): Variable[] => {
    if (!isRecord(variable) || typeof variable.name !== 'string' || !variable.name.trim()) return []
    return [{
      name: variable.name.trim(),
      required: Boolean(variable.required),
      ...(typeof variable.defaultValue === 'string' ? { defaultValue: variable.defaultValue } : {}),
    }]
  })
}

function normalizeSnapshots(value: unknown): Snapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((snapshot): Snapshot[] => {
    if (!isRecord(snapshot) || typeof snapshot.body !== 'string') return []
    return [{
      version: typeof snapshot.version === 'number' && Number.isFinite(snapshot.version) ? snapshot.version : 1,
      body: snapshot.body,
      note: typeof snapshot.note === 'string' ? snapshot.note : '',
      createdAt: toTimestamp(snapshot.createdAt, Date.now()),
    }]
  })
}

export function normalizePromptItem(value: unknown): PromptItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.content !== 'string') {
    return null
  }

  const id = value.id.trim()
  const title = value.title.trim()
  if (!id || !title) return null

  const now = Date.now()
  const createdAt = toTimestamp(value.createdAt, now)
  const type = promptTypes.includes(value.type as PromptType) ? value.type as PromptType : 'prompt'

  return {
    id,
    title,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    content: value.content,
    type,
    tags: Array.isArray(value.tags)
      ? [...new Set(value.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))]
      : [],
    variables: normalizeVariables(value.variables),
    favorite: Boolean(value.favorite),
    usageCount: typeof value.usageCount === 'number' && Number.isFinite(value.usageCount) && value.usageCount >= 0 ? value.usageCount : 0,
    ...(typeof value.projectId === 'string' && value.projectId.trim() ? { projectId: value.projectId.trim() } : {}),
    deleted: Boolean(value.deleted),
    version: typeof value.version === 'number' && Number.isFinite(value.version) && value.version >= 1 ? value.version : 1,
    snapshots: normalizeSnapshots(value.snapshots),
    createdAt,
    updatedAt: toTimestamp(value.updatedAt, createdAt),
    ...(typeof value.lastUsedAt === 'number' && Number.isFinite(value.lastUsedAt) ? { lastUsedAt: value.lastUsedAt } : {}),
  }
}
