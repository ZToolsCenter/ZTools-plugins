// 错误处理和工具函数

/**
 * 从未知错误值中提取用户友好的错误消息
 * 对于 Error 实例返回错误消息，其他类型返回后备字符串
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * 检测错误是否为插件 API 的主机权限被拒绝错误
 * 检查来自仅限内置插件调用的特定错误签名
 */
export function isPluginHostPermissionDeniedError(error: unknown): boolean {
  const content =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.name} ${error.message}`
        : ''

  return content.includes('PermissionDeniedError') && content.includes('仅限内置插件调用')
}

/**
 * 将 ISO 时间戳字符串转换为用于比较的数字时间戳
 * 对于无效/空值返回 0
 */
export function toTimestamp(value?: string | null): number {
  if (!value) {
    return 0
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}
