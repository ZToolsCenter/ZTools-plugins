// 通知树构建逻辑

import type { NotificationRecord, NotificationTreeNode } from '../../../types/notification'

/**
 * 从通知记录中提取父 ID
 * 检查直接的 parentId 属性和 metadata.parentId 字段
 */
export function resolveNotificationParentId(item: NotificationRecord): string | null {
  if (typeof item.parentId === 'string' && item.parentId.trim()) {
    return item.parentId.trim()
  }

  if (item.metadata && typeof item.metadata === 'object') {
    const parentId = (item.metadata as Record<string, unknown>).parentId
    if (typeof parentId === 'string' && parentId.trim()) {
      return parentId.trim()
    }
  }

  return null
}

/**
 * 查找给定通知的根通知 ID
 * 向上遍历父链，检测循环以防止无限循环
 */
export function findNotificationRootId(
  itemId: string,
  parentMap: Map<string, string | null>,
  nodeMap: Map<string, NotificationTreeNode>,
): string | null {
  let currentId = itemId
  const visited = new Set<string>([itemId])

  while (true) {
    const parentId = parentMap.get(currentId)
    if (!parentId) {
      return currentId
    }

    // 检测循环
    if (visited.has(parentId)) {
      return itemId
    }

    // 父节点不存在则停止
    if (!nodeMap.has(parentId)) {
      return currentId
    }

    visited.add(parentId)
    currentId = parentId
  }
}

/**
 * 将 ISO 时间戳字符串转换为用于排序的数字时间戳
 */
export function toTimestamp(value?: string | null): number {
  if (!value) {
    return 0
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

/**
 * 构建通知树，其中回复嵌套在其根评论下
 * 将 COMMENT_REPLY 通知分组到父 COMMENT 通知下
 * 根节点按最新优先排序，回复按最旧优先排序
 */
export function buildNotificationTree(items: NotificationRecord[]): NotificationTreeNode[] {
  const nodeMap = new Map<string, NotificationTreeNode>()
  const parentMap = new Map<string, string | null>()
  const roots: NotificationTreeNode[] = []

  // 初始化节点和父映射
  items.forEach((item) => {
    nodeMap.set(item.id, {
      ...item,
      replies: [],
      depth: 0,
    })
    parentMap.set(item.id, resolveNotificationParentId(item))
  })

  // 构建树结构
  items.forEach((item) => {
    const node = nodeMap.get(item.id)
    if (!node) {
      return
    }

    const rootId = findNotificationRootId(item.id, parentMap, nodeMap)
    if (!rootId || rootId === item.id) {
      roots.push(node)
      return
    }

    const rootNode = nodeMap.get(rootId)
    if (!rootNode) {
      roots.push(node)
      return
    }

    node.depth = 1
    rootNode.replies.push(node)
  })

  // 根节点按最新优先排序
  roots.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))
  // 回复按最旧优先排序（时间顺序）
  roots.forEach((root) => {
    root.replies.sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt))
  })

  return roots
}
