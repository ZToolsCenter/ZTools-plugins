export type InsertDragPayload =
  | { kind: 'shape'; itemId: string }
  | { kind: 'text'; itemId: string }
  | { kind: 'template'; itemId: string }
  | { kind: 'user-asset'; itemId: string }
  | { kind: 'symbol'; itemId: string }
  | { kind: 'iconify'; iconName: string }

export const INSERT_DRAG_MIME = 'application/x-icon-creator-insert'

/**
 * 将左侧插入项编码到浏览器拖拽上下文，供画布 drop 时识别具体要插入的资源类型与标识。
 */
export function writeInsertDragPayload(dataTransfer: DataTransfer | null | undefined, payload: InsertDragPayload) {
  if (!dataTransfer) return
  const serialized = JSON.stringify(payload)
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(INSERT_DRAG_MIME, serialized)
  dataTransfer.setData('text/plain', serialized)
}

/**
 * 从拖拽上下文解析插入负载；只接受编辑器定义的几类资源，异常或未知数据一律忽略。
 */
export function readInsertDragPayload(dataTransfer: DataTransfer | null | undefined): InsertDragPayload | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(INSERT_DRAG_MIME) || dataTransfer.getData('text/plain')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<InsertDragPayload> | null
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
    if (parsed.kind === 'iconify' && typeof parsed.iconName === 'string' && parsed.iconName.trim()) {
      return { kind: 'iconify', iconName: parsed.iconName }
    }
    if (
      (parsed.kind === 'shape' || parsed.kind === 'text' || parsed.kind === 'template' || parsed.kind === 'user-asset' || parsed.kind === 'symbol')
      && typeof parsed.itemId === 'string'
      && parsed.itemId.trim()
    ) {
      return { kind: parsed.kind, itemId: parsed.itemId }
    }
    return null
  } catch {
    return null
  }
}
