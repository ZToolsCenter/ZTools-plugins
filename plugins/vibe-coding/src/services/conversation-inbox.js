export const QUEUED_PLACEMENT = 'queued'
export const STEERING_PLACEMENT = 'steering'

const VALID_PLACEMENTS = new Set([QUEUED_PLACEMENT, STEERING_PLACEMENT])

/**
 * 规范化一条尚未进入正式消息历史的待处理消息。
 * @param {unknown} value 原始待处理消息。
 * @returns {Record<string, unknown>|null} 可安全持久化的消息；无效输入返回 null。
 */
export function normalizePendingMessage(value) {
  if (!value || typeof value !== 'object') return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.filter((attachment) => attachment && typeof attachment === 'object')
    : []
  if (!id || (!text && !attachments.length)) return null
  return {
    id,
    placement: VALID_PLACEMENTS.has(value.placement) ? value.placement : QUEUED_PLACEMENT,
    text,
    attachments,
    createdAt: Number(value.createdAt) || Date.now(),
  }
}

/**
 * 规范化会话 Inbox，并按首次出现顺序去除重复标识。
 * @param {unknown} value 原始 Inbox 数组。
 * @returns {Array<Record<string, unknown>>} 已规范化的待处理消息。
 */
export function normalizeConversationInbox(value) {
  const seen = new Set()
  const normalized = []
  for (const item of Array.isArray(value) ? value : []) {
    const message = normalizePendingMessage(item)
    if (!message || seen.has(message.id)) continue
    seen.add(message.id)
    normalized.push(message)
  }
  return normalized
}

/**
 * 创建一条待处理消息，固定提交时的文本、附件和时间。
 * @param {{id: string, text?: string, attachments?: Array<Record<string, unknown>>, placement?: 'queued'|'steering', createdAt?: number}} input 待处理消息输入。
 * @returns {Record<string, unknown>} 已规范化的待处理消息。
 * @throws {Error} 输入缺少标识或有效内容时抛出。
 */
export function createPendingMessage(input) {
  const message = normalizePendingMessage(input)
  if (!message) throw new Error('待处理消息缺少有效内容')
  return message
}

/**
 * 将一条消息追加到 Inbox，保持已有数组不被原地修改。
 * @param {Array<Record<string, unknown>>} inbox 当前 Inbox。
 * @param {Record<string, unknown>} message 待追加消息。
 * @returns {Array<Record<string, unknown>>} 追加后的新 Inbox。
 * @throws {Error} 消息无效或标识已存在时抛出。
 */
export function appendPendingMessage(inbox, message) {
  const current = normalizeConversationInbox(inbox)
  const normalized = normalizePendingMessage(message)
  if (!normalized) throw new Error('待处理消息无效')
  if (current.some((item) => item.id === normalized.id)) throw new Error('待处理消息已存在')
  return [...current, normalized]
}

/**
 * 编辑一条排队消息的文本，同时保留其附件、顺序和提交时间。
 * @param {Array<Record<string, unknown>>} inbox 当前 Inbox。
 * @param {string} id 目标消息标识。
 * @param {string} text 新文本。
 * @returns {Array<Record<string, unknown>>} 编辑后的新 Inbox；目标不存在时返回原规范化结果。
 * @throws {Error} 文本和附件同时为空时抛出。
 */
export function editPendingMessage(inbox, id, text) {
  const current = normalizeConversationInbox(inbox)
  const index = current.findIndex((item) => item.id === id)
  if (index < 0) return current
  const nextText = String(text || '').trim()
  if (!nextText && !current[index].attachments.length) throw new Error('排队消息不能为空')
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, text: nextText } : item)
}

/**
 * 从 Inbox 中删除指定消息。
 * @param {Array<Record<string, unknown>>} inbox 当前 Inbox。
 * @param {string} id 目标消息标识。
 * @returns {Array<Record<string, unknown>>} 删除后的新 Inbox。
 */
export function removePendingMessage(inbox, id) {
  return normalizeConversationInbox(inbox).filter((item) => item.id !== id)
}

/**
 * 把一条普通排队消息提升为当前 Turn 的安全插话。
 * @param {Array<Record<string, unknown>>} inbox 当前 Inbox。
 * @param {string} id 目标消息标识。
 * @returns {Array<Record<string, unknown>>} 更新投递位置后的新 Inbox。
 */
export function steerPendingMessage(inbox, id) {
  return normalizeConversationInbox(inbox).map((item) => (
    item.id === id ? { ...item, placement: STEERING_PLACEMENT } : item
  ))
}

/**
 * 原子领取指定位置的待处理消息，并从 Inbox 中移除。
 * @param {Array<Record<string, unknown>>} inbox 当前 Inbox。
 * @param {'queued'|'steering'} placement 待领取的位置。
 * @param {number} limit 最大领取数量。
 * @returns {{inbox: Array<Record<string, unknown>>, claimed: Array<Record<string, unknown>>}} 剩余 Inbox 和已领取消息。
 */
export function claimPendingMessages(inbox, placement, limit = Number.POSITIVE_INFINITY) {
  const current = normalizeConversationInbox(inbox)
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY
  const claimed = []
  const remaining = []
  for (const item of current) {
    if (item.placement === placement && claimed.length < maximum) claimed.push(item)
    else remaining.push(item)
  }
  return { inbox: remaining, claimed }
}

/**
 * 恢复进程中断前未消费的 Inbox，并把失去活动 Turn 的插话降级为普通排队。
 * @param {unknown} inbox 已持久化的 Inbox。
 * @returns {Array<Record<string, unknown>>} 可在新进程中继续调度的 Inbox。
 */
export function recoverConversationInbox(inbox) {
  const current = normalizeConversationInbox(inbox)
  // 失去原 Turn 后优先处理原插话，再继续原有的下一轮队列。
  return [
    ...current.filter((item) => item.placement === STEERING_PLACEMENT),
    ...current.filter((item) => item.placement === QUEUED_PLACEMENT),
  ].map((item) => ({ ...item, placement: QUEUED_PLACEMENT }))
}
