/**
 * 文档级组件/符号（Symbol）系统：可复用定义 + 联动实例 + 解除关联。
 *
 * 数据归属与持久化：符号定义挂工程顶层 symbols 字段（与 guides 同一扩展层级），
 * 随工程 JSON / 自动草稿 round-trip；同时以 editorSymbols 字段进入撤销快照，
 * 定义的新建 / 更新 / 删除与画布对象一样可撤销（见 useHomeDocument.buildSnapshotPayload）。
 *
 * 实例语义（关键决策）：
 * - 一个实例 = 一个 fabric Group：插入时把定义对象 enliven 后编组，元数据
 *   { symbolId, symbolInstanceId } 挂在 Group 上，整体移动 / 缩放 / 旋转。
 * - 创建符号不转换原对象：定义入库后画布上的原对象保持普通对象不变，
 *   不会自动变成实例，避免破坏既有编辑状态。
 * - 恢复不同步：loadFromJSON（撤销/重做/工程加载）后实例保持序列化时的外观，
 *   绝不自动按定义重建；内容联动只在显式「更新符号」（update_symbol）时发生。
 *   因此撤销/重做语义自然正确——撤销一次更新定义，定义与实例外观一起回到更新前。
 * - 定义坐标归一化：定义 objects 为 fabric toObject 数组，写入前把每个对象的
 *   left/top 平移，使定义包围盒左上角位于 (0,0)；插入 / 重建实例时以定义包围盒
 *   尺寸为基准做几何映射。
 *
 * 未来方向（本期不做）：跨文档符号库、嵌套符号（定义内引用其他符号）、
 * 实例级局部覆盖（override）。
 *
 * 本模块只做纯数据归一化与几何计算，不依赖 fabric / DOM，供工程解析、运行时与 MCP 复用。
 */

/** 单个符号定义：id 文档内唯一，objects 为包围盒归一化后的 fabric toObject 数组。 */
export type ProjectSymbol = {
  id: string
  name: string
  /** 创建时间（毫秒时间戳），仅用于展示与排序。 */
  createdAt: number
  objects: Record<string, unknown>[]
}

/** 实例元数据的对外形态：挂在实例 Group 上的两个字段（已列入 SERIALIZED_OBJECT_PROPS 白名单）。 */
export type SymbolInstanceMetadata = {
  symbolId: string
  symbolInstanceId: string
}

/** 符号定义数量上限：防止误操作或 AI 调用写入超大列表拖慢保存与恢复。 */
export const MAX_PROJECT_SYMBOLS = 100

/** 符号定义内允许的最大对象数量，超出时截断（与 MAX_DOCUMENT_GUIDES 同策略）。 */
export const MAX_SYMBOL_OBJECTS = 200

/** 实例元数据键名：同步维护在 fabric/objectMetadata.ts 的 SERIALIZED_OBJECT_PROPS 白名单中。 */
export const SYMBOL_INSTANCE_METADATA_KEYS = ['symbolId', 'symbolInstanceId'] as const

let symbolIdSeed = 0
let symbolInstanceIdSeed = 0

/** 生成文档内唯一的符号定义 id（自增种子保证单次会话内不重复）。 */
export function createSymbolId(): string {
  symbolIdSeed += 1
  return `symbol-${Date.now().toString(36)}-${symbolIdSeed.toString(36)}`
}

/** 生成全局唯一的实例 id（跨定义不重复，便于 MCP 与日志精确定位单个实例）。 */
export function createSymbolInstanceId(): string {
  symbolInstanceIdSeed += 1
  return `symbol-instance-${Date.now().toString(36)}-${symbolInstanceIdSeed.toString(36)}`
}

/** 规范符号名称：去除首尾空白，空名称回退到可读默认名。 */
export function normalizeSymbolName(value: unknown, fallback = '符号'): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

/**
 * 归一化符号定义内的对象序列化数组（创建 / 更新定义与工程读取共用）：
 * 仅保留普通对象条目并逐项深拷贝，超出上限时截断；任何非法输入都降级为空数组。
 */
export function normalizeSymbolObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  const result: Record<string, unknown>[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    result.push(JSON.parse(JSON.stringify(item)) as Record<string, unknown>)
    if (result.length >= MAX_SYMBOL_OBJECTS) break
  }
  return result
}

/**
 * 按定义包围盒归一化序列化对象坐标：把每个对象的 left/top 平移 delta，
 * 使定义包围盒左上角落在 (0,0)。left/top 为平移不变量（无论 origin 约定如何），
 * 返回新数组且不改动传入对象。
 */
export function normalizeSymbolObjectsToBounds(
  objects: Record<string, unknown>[],
  origin: { left: number; top: number }
): Record<string, unknown>[] {
  return objects.map((item) => {
    const next = { ...item }
    next.left = Number(item.left ?? 0) - origin.left
    next.top = Number(item.top ?? 0) - origin.top
    return next
  })
}

/** 生成实例元数据：symbolId 指向定义，symbolInstanceId 为本次插入的唯一标识。 */
export function createSymbolInstanceMetadata(symbolId: string): SymbolInstanceMetadata {
  return {
    symbolId,
    symbolInstanceId: createSymbolInstanceId()
  }
}

/**
 * 从对象上读取合法的实例元数据：symbolId / symbolInstanceId 均为非空字符串时返回，
 * 否则返回 null（普通对象 / 数据损坏统一按非实例处理）。
 * 入参为带自定义元数据的 fabric 对象（或任意 Record），保持本模块不依赖 fabric 类型。
 */
export function readSymbolInstanceMetadata(
  target: unknown
): SymbolInstanceMetadata | null {
  if (!target || typeof target !== 'object') return null
  const source = target as Record<string, unknown>
  const symbolId = typeof source.symbolId === 'string' ? source.symbolId.trim() : ''
  const symbolInstanceId = typeof source.symbolInstanceId === 'string' ? source.symbolInstanceId.trim() : ''
  if (!symbolId || !symbolInstanceId) return null
  return { symbolId, symbolInstanceId }
}

/**
 * 解除关联的纯计算：返回去掉 symbolId / symbolInstanceId 键的浅拷贝记录。
 * 运行时把返回对象上不存在的键视为需要 delete 的键（见 detach 的应用逻辑），
 * 定义数据本身不受影响。
 */
export function stripSymbolInstanceMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record }
  for (const key of SYMBOL_INSTANCE_METADATA_KEYS) {
    delete next[key]
  }
  return next
}

/**
 * 实例几何映射策略的纯计算（更新定义时重建实例用）：
 * 输入旧实例的显示宽高与新定义的自然宽高，输出新实例 Group 应设置的 scaleX/scaleY，
 * 使重建后的实例显示尺寸与旧实例完全一致（定义内容映射进旧实例包围盒，
 * 新旧定义宽高比不同时内容按各自方向拉伸）。任一尺寸非有限或 ≤0 时回退 1，
 * 保证异常数据不会把实例缩成不可见。
 */
export function computeSymbolInstanceScale(
  instanceSize: { width: number; height: number },
  definitionSize: { width: number; height: number }
): { scaleX: number; scaleY: number } {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)
  const instanceWidth = safe(instanceSize.width)
  const instanceHeight = safe(instanceSize.height)
  const definitionWidth = safe(definitionSize.width)
  const definitionHeight = safe(definitionSize.height)
  return {
    scaleX: instanceWidth > 0 && definitionWidth > 0 ? instanceWidth / definitionWidth : 1,
    scaleY: instanceHeight > 0 && definitionHeight > 0 ? instanceHeight / definitionHeight : 1
  }
}

/**
 * 把符号定义合并进列表（不改变传入数组）：同 id 覆盖（更新定义语义），否则追加；
 * 追加超出上限时返回原列表由调用方报错，返回新数组供响应式状态整体替换。
 */
export function upsertProjectSymbol(list: ProjectSymbol[], symbol: ProjectSymbol): ProjectSymbol[] {
  const existingIndex = list.findIndex((item) => item.id === symbol.id)
  if (existingIndex < 0) return [...list, symbol]
  const next = [...list]
  next[existingIndex] = symbol
  return next
}

/** 按 id 删除符号定义，不存在时原样返回浅拷贝。 */
export function removeProjectSymbolById(list: ProjectSymbol[], id: string): ProjectSymbol[] {
  return list.some((item) => item.id === id) ? list.filter((item) => item.id !== id) : [...list]
}

/** 按 id 查找符号定义，未找到返回 null。 */
export function findProjectSymbolById(list: ProjectSymbol[], id: string): ProjectSymbol | null {
  return list.find((item) => item.id === id) ?? null
}

/**
 * 归一化符号定义数组（工程文件读取 / 撤销快照还原的兜底校验）：
 * 丢弃缺 id / 缺 name / objects 非法的条目；缺 id 补生成、重复 id 保留先出现者、
 * 缺 createdAt 回退当前时间；超出上限时保留先出现的条目。任何非法输入都降级为空数组。
 */
export function normalizeProjectSymbols(value: unknown): ProjectSymbol[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  const result: ProjectSymbol[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : ''
    const objects = normalizeSymbolObjects(source.objects)
    if (!name || !objects.length) continue
    const rawId = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : ''
    // 实例通过 id 引用定义：重复 id 直接丢弃（保留先出现者），避免静默改 id 破坏引用关系。
    if (rawId && seenIds.has(rawId)) continue
    const id = rawId || createSymbolId()
    seenIds.add(id)
    const createdAt = Number(source.createdAt)
    result.push({
      id,
      name,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      objects
    })
    if (result.length >= MAX_PROJECT_SYMBOLS) break
  }
  return result
}
