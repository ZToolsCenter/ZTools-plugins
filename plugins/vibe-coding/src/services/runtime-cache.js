export const DEFAULT_RESIDENT_RUNTIME_LIMIT = 6

/**
 * 选择可从内存回收的非活动会话运行时，运行中、含草稿或未读完成状态的会话不参与回收。
 * @param {Iterable<Record<string, unknown>>} runtimes 当前驻留的会话运行时。
 * @param {{activeId?: string, limit?: number, pendingIds?: Set<string>}} options 活动会话、容量和持久化中的会话集合。
 * @returns {string[]} 按最久未访问顺序排列的待回收会话标识。
 */
export function selectRuntimeEvictions(runtimes, options = {}) {
  const entries = [...(runtimes || [])]
  const limit = Math.max(1, Math.floor(Number(options.limit) || DEFAULT_RESIDENT_RUNTIME_LIMIT))
  const excess = Math.max(0, entries.length - limit)
  if (!excess) return []
  const activeId = String(options.activeId || '')
  const pendingIds = options.pendingIds instanceof Set ? options.pendingIds : new Set()
  return entries
    .filter((runtime) => runtimeCanBeEvicted(runtime, activeId, pendingIds))
    .sort((left, right) => Number(left.lastAccessedAt || 0) - Number(right.lastAccessedAt || 0))
    .slice(0, excess)
    .map((runtime) => String(runtime.id || ''))
    .filter(Boolean)
}

/**
 * 判断运行时是否已经完全静止且没有只能保存在内存中的用户状态。
 * @param {Record<string, unknown>} runtime 候选会话运行时。
 * @param {string} activeId 当前活动会话标识。
 * @param {Set<string>} pendingIds 正在持久化的会话标识集合。
 * @returns {boolean} 是否允许从运行时缓存移除。
 */
function runtimeCanBeEvicted(runtime, activeId, pendingIds) {
  const id = String(runtime?.id || '')
  if (!id || id === activeId || pendingIds.has(id)) return false
  if (runtime.busy || runtime.compacting || runtime.operationPromise || runtime.requestId) return false
  if (runtime.completedUnread || String(runtime.input || '').trim()) return false
  if (Array.isArray(runtime.inputAttachments) && runtime.inputAttachments.length) return false
  return true
}
