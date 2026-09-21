import type { UserAssetItem } from './types'

// 格式化素材更新时间，列表空间有限时仅展示本地日期，异常日期回退为“未知时间”。
export function formatUserAssetDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleDateString()
}

// 展示素材包含的对象数量，帮助用户区分单个图形、组合和多对象素材。
export function getUserAssetObjectCountLabel(asset: UserAssetItem) {
  const count = asset.objects.length
  return count > 1 ? `${count} 个对象` : '1 个对象'
}
