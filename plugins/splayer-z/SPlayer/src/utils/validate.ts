/**
 * @file validate.ts
 * @description 常用验证函数
 * @author imsyy
 */

/**
 * 验证字符串是否为有效的 URL
 * 此函数能正确处理包含 localhost、IP 地址和端口号的 URL
 * @param urlString 要验证的字符串
 * @returns 如果是有效 URL，则返回 true；否则返回 false
 */
export const isValidURL = (urlString: string): boolean => {
  const urlValue = urlString.trim();
  if (!urlValue) {
    return false;
  }

  try {
    // 尝试直接解析
    const url = new URL(urlValue);
    // 校验协议是否为 http 或 https
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    // 解析失败，尝试添加 http:// 头再解析
    try {
      const url = new URL(`http://${urlValue}`);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }
};
