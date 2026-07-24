// 比较两个版本号的大小
// 返回值: 1 表示 left > right, -1 表示 left < right, 0 表示相等
export function compareVersions(left?: string | null, right?: string | null): number {
  // 将版本号字符串拆分为数字数组，空值默认为 '0'
  const leftParts = (left || '0').split('.').map((part) => Number(part) || 0)
  const rightParts = (right || '0').split('.').map((part) => Number(part) || 0)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  // 逐位比较版本号
  for (let index = 0; index < maxLength; index++) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}

// 根据查询字符串和字段权重对数组进行加权搜索
// 返回按得分降序排列的匹配项
export function weightedSearch<T>(
  items: T[],
  query: string,
  fields: Array<{ value: (item: T) => string; weight: number }>,
): T[] {
  // 标准化查询字符串：去除首尾空格并转为小写
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return items
  }

  return items
    .map((item) => {
      let score = 0

      // 遍历所有字段，累加匹配得分
      for (const field of fields) {
        if (field.value(item).toLowerCase().includes(normalizedQuery)) {
          score += field.weight
        }
      }

      return { item, score }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item)
}

// Fisher-Yates 洗牌算法：随机打乱数组
export function shuffleArray<T>(items: T[]): T[] {
  const next = [...items]

  // 从数组末尾开始，随机交换元素
  for (let index = next.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

// 格式化日期时间为中文本地化字符串
export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  // 无效日期返回原始值
  if (Number.isNaN(date.getTime())) {
    return value
  }

  // 返回中文格式化日期时间
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
