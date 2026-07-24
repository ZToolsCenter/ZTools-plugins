/**
 * 生成UUID
 * @returns {string} 唯一的UUID字符串
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 生成带前缀的UUID
 * @param {string} prefix - 前缀字符串
 * @returns {string} 带前缀的UUID
 */
export function generatePrefixedUUID(prefix) {
  return `${prefix}-${generateUUID()}`;
}
