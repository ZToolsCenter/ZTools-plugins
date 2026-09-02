/**
 * HtmlUtils - HTML 工具函数
 *
 * 提供安全的 HTML 转义等通用工具。
 */

class HtmlUtils {
  /**
   * HTML 转义，防止 XSS
   * @param {string} text
   * @returns {string}
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HtmlUtils;
}
