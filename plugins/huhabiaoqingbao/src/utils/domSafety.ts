// DOM安全操作工具函数

/**
 * 验证属性名是否安全
 * @param attributeName 属性名
 * @returns 是否安全
 */
export const isValidAttributeName = (attributeName: string): boolean => {
  // 属性名必须以字母开头，只能包含字母、数字、连字符、下划线
  const validPattern = /^[a-zA-Z][a-zA-Z0-9\-_]*$/
  return validPattern.test(attributeName)
}

/**
 * 安全地设置DOM属性
 * @param element DOM元素
 * @param attributeName 属性名
 * @param value 属性值
 * @returns 是否设置成功
 */
export const safeSetAttribute = (
  element: Element, 
  attributeName: string, 
  value: string
): boolean => {
  try {
    // 验证属性名
    if (!isValidAttributeName(attributeName)) {
      console.warn(`Invalid attribute name: ${attributeName}`)
      return false
    }
    
    // 设置属性
    element.setAttribute(attributeName, value)
    return true
  } catch (error) {
    console.error('Failed to set attribute:', error)
    return false
  }
}

/**
 * 生成安全的随机ID
 * @param prefix 前缀（可选）
 * @returns 安全的ID字符串
 */
export const generateSafeId = (prefix = 'id'): string => {
  // 确保前缀以字母开头
  const safePrefix = /^[a-zA-Z]/.test(prefix) ? prefix : 'id'
  
  // 生成只包含有效字符的随机字符串
  const timestamp = Date.now().toString()
  const randomPart = Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, '')
    .substring(2, 11)
  
  return `${safePrefix}${timestamp}${randomPart}`
}

/**
 * 清理字符串，移除不安全的字符
 * @param str 输入字符串
 * @returns 清理后的安全字符串
 */
export const sanitizeString = (str: string): string => {
  return str.replace(/[^a-zA-Z0-9\-_]/g, '')
}