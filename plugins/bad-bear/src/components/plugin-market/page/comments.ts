// 评论树构建逻辑

import type { PluginCommentRecord, PluginCommentTreeNode } from '../../../types/pluginMarket'

/**
 * 将嵌套的评论记录展平为单个列表
 * 处理扁平的 API 响应和带有嵌套回复的响应
 * 使用 Set 对评论 ID 去重
 */
export function flattenCommentRecords(
  items: PluginCommentRecord[],
  parentId: string | null = null,
): PluginCommentRecord[] {
  return items.flatMap((item) => {
    const { replies = [], ...comment } = item
    return [
      {
        ...comment,
        parentId: comment.parentId ?? parentId,
      },
      // 递归展平子回复
      ...flattenCommentRecords(replies, item.id),
    ]
  })
}

/**
 * 从扁平或嵌套的评论记录构建嵌套的评论树
 * 返回根评论及其嵌套的回复
 */
export function buildCommentTree(items: PluginCommentRecord[]): PluginCommentTreeNode[] {
  const flattenedItems: PluginCommentRecord[] = []
  const seen = new Set<string>()

  // 展平并去重评论
  flattenCommentRecords(items).forEach((item) => {
    if (seen.has(item.id)) {
      return
    }

    seen.add(item.id)
    flattenedItems.push(item)
  })

  const nodeMap = new Map<string, PluginCommentTreeNode>()
  const roots: PluginCommentTreeNode[] = []

  // 创建所有评论节点
  flattenedItems.forEach((item) => {
    nodeMap.set(item.id, {
      ...item,
      replies: [],
    })
  })

  // 构建树结构
  flattenedItems.forEach((item) => {
    const node = nodeMap.get(item.id)
    if (!node) {
      return
    }

    if (item.parentId) {
      const parent = nodeMap.get(item.parentId)
      if (parent) {
        parent.replies.push(node)
        return
      }
    }

    // 没有父节点的作为根节点
    roots.push(node)
  })

  return roots
}
