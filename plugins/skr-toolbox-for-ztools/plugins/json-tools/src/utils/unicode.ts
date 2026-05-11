// 匹配 ": "{unicode内容}" 格式的正则表达式
export const UNICODE_STRING_REGEX = /: "([^"]*?(?:\\u[0-9a-fA-F]{4})[^"]*?)"/g;
// 匹配单个
export const UNICODE_REGEX = /\\u([0-9a-fA-F]{4})/g;
/**
 * 解码Unicode字符串
 * @param text 包含Unicode编码的字符串
 * @returns 解码后的字符串，如果无法解码则返回null
 */
export const decodeUnicode = (text: string): string | null => {
  // 替换所有Unicode转义序列
  const decoded = text.replace(UNICODE_REGEX, (_, codePoint) => {
    return String.fromCodePoint(parseInt(codePoint, 16));
  });

  // 如果解码后没有变化，返回null
  if (decoded === text) {
    return null;
  }

  return decoded;
};

/**
 * 检查字符串是否包含Unicode转义序列
 * @param text 要检查的字符串
 * @returns 是否包含Unicode转义序列
 */
export const containsUnicode = (text: string): boolean => {
  UNICODE_REGEX.lastIndex = 0;

  return UNICODE_REGEX.test(text);
};
