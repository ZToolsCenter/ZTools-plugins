/**
 * 校验 Markdown 链接协议，阻止脚本、文件路径和相对路径进入聊天 DOM。
 * @param {string} value Markdown 链接地址。
 * @returns {string} 允许的绝对地址；不允许时返回空字符串。
 */
export function sanitizeLinkUrl(value) {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? String(value) : ''
  } catch {
    return ''
  }
}

/**
 * 校验 Markdown 图片地址，只允许可远程加载的 HTTP(S) 资源。
 * @param {string} value Markdown 图片地址。
 * @returns {string} 允许的绝对地址；不允许时返回空字符串。
 */
export function sanitizeImageUrl(value) {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? String(value) : ''
  } catch {
    return ''
  }
}
