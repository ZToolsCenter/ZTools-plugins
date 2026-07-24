import type { PluginCommentTreeNode } from '../../../types/pluginMarket'

export function formatSize(size: unknown): string {
  const numericSize = typeof size === 'string' ? Number(size) : size
  if (typeof numericSize !== 'number' || Number.isNaN(numericSize) || numericSize <= 0) {
    return '-'
  }

  if (numericSize >= 1024 * 1024) {
    return `${(numericSize / (1024 * 1024)).toFixed(2)} MB`
  }

  if (numericSize >= 1024) {
    return `${(numericSize / 1024).toFixed(2)} KB`
  }

  return `${numericSize} B`
}

export function formatRating(value: number): string {
  if (!value) {
    return '暂无评分'
  }

  return value.toFixed(1)
}

export function formatDownloads(value: unknown): string {
  const numericValue = typeof value === 'string' ? Number(value) : value
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || numericValue < 0) {
    return '-'
  }

  return numericValue.toLocaleString('zh-CN')
}

export function getCommentAuthorName(comment: PluginCommentTreeNode): string {
  return comment.user.username || comment.user.account
}

export function getCommentAuthorInitial(comment: PluginCommentTreeNode): string {
  return getCommentAuthorName(comment).slice(0, 1).toUpperCase() || '?'
}
