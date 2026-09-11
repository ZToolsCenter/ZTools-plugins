// 宿主 API 适配：ztools 与 uTools 共用同一套 API 面，运行时哪个先注入就用哪个
// 参考：ztools-api-types 明确声明 "直接 Copy uTools 的" API 表面
export function getHost () {
  if (typeof window === 'undefined') return null
  return window.ztools || window.utools || null
}

// 便捷别名：允许在 UI 直接读 host（可能为 null，需自行判空）
export const host = getHost()
