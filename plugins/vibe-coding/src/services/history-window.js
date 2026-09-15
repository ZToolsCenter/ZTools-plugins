export const DEFAULT_HISTORY_PAGE_SIZE = 50

/**
 * 将历史窗口起点限制在当前消息数组的有效范围内。
 * @param {Array<Record<string, unknown>>} messages 完整会话消息。
 * @param {number} startIndex 候选窗口起点。
 * @returns {number} 可安全用于 `slice` 的窗口起点。
 */
export function normalizeHistoryStart(messages, startIndex) {
  const length = Array.isArray(messages) ? messages.length : 0
  const normalized = Number.isFinite(startIndex) ? Math.floor(startIndex) : length
  return Math.max(0, Math.min(length, normalized))
}

/**
 * 计算首次打开会话时的尾部窗口，并避免从一个 Turn 中间截断。
 * @param {Array<Record<string, unknown>>} messages 完整会话消息。
 * @param {number} pageSize 每页目标消息数量。
 * @returns {number} 首次显示窗口的起始下标。
 */
export function createInitialHistoryStart(messages, pageSize = DEFAULT_HISTORY_PAGE_SIZE) {
  const history = Array.isArray(messages) ? messages : []
  return alignStartToTurn(history, Math.max(0, history.length - normalizePageSize(pageSize)))
}

/**
 * 计算向前加载一页后的窗口起点，并保持最早可见 Turn 完整。
 * @param {Array<Record<string, unknown>>} messages 完整会话消息。
 * @param {number} currentStart 当前窗口起点。
 * @param {number} pageSize 每页目标消息数量。
 * @returns {number} 扩展后的窗口起点。
 */
export function findPreviousHistoryStart(messages, currentStart, pageSize = DEFAULT_HISTORY_PAGE_SIZE) {
  const history = Array.isArray(messages) ? messages : []
  const start = normalizeHistoryStart(history, currentStart)
  return alignStartToTurn(history, Math.max(0, start - normalizePageSize(pageSize)))
}

/**
 * 将候选起点向前移动到所属 Turn 的第一条消息。
 * @param {Array<Record<string, unknown>>} messages 完整会话消息。
 * @param {number} candidate 候选起点。
 * @returns {number} 不拆分 Turn 的起始下标。
 */
function alignStartToTurn(messages, candidate) {
  let start = normalizeHistoryStart(messages, candidate)
  const turnId = typeof messages[start]?.turnId === 'string' ? messages[start].turnId : ''
  if (!turnId) return start
  // 工具调用、工具结果和最终回答共享 Turn，必须作为一个连续窗口恢复。
  while (start > 0 && messages[start - 1]?.turnId === turnId) start -= 1
  return start
}

/**
 * 规范化历史分页大小，避免异常配置造成空页或无限窗口。
 * @param {number} pageSize 候选分页大小。
 * @returns {number} 1 到 500 之间的整数分页大小。
 */
function normalizePageSize(pageSize) {
  const normalized = Number.isFinite(pageSize) ? Math.floor(pageSize) : DEFAULT_HISTORY_PAGE_SIZE
  return Math.max(1, Math.min(500, normalized))
}
