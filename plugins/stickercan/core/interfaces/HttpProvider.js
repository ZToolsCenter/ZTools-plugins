/**
 * HttpProvider - HTTP 请求抽象接口
 *
 * 定义跨平台的网络请求能力。
 * uTools/Electron/Tauri 等环境可通过 Node.js 绕过 CORS，
 * Web 环境则回退到浏览器 fetch。
 */

class HttpProvider {
  /**
   * 带超时的 fetch 请求（浏览器标准 fetch 封装）
   * @param {string} url
   * @param {object} options - fetch options
   * @param {number} timeout - 超时毫秒数
   * @returns {Promise<Response>}
   */
  async fetchWithTimeout(url, options = {}, timeout = 30000) {
    throw new Error('HttpProvider.fetchWithTimeout() 未实现');
  }

  /**
   * Node.js HTTP 请求（绕过 CORS），Web 环境返回 null
   * @param {string} url
   * @param {object} options
   * @returns {Promise<object|null>} 类似 fetch 的 response 对象
   */
  async nodeFetch(url, options = {}) {
    throw new Error('HttpProvider.nodeFetch() 未实现');
  }

  /**
   * 下载图片，优先使用 Node.js 绕过 CORS
   * @param {string} imageUrl
   * @returns {Promise<{dataUrl: string, buffer: Buffer|null, contentType: string}>}
   */
  async downloadImage(imageUrl) {
    throw new Error('HttpProvider.downloadImage() 未实现');
  }

  /**
   * 上传数据到 S3 兼容存储（Node.js 方式）
   * @param {object} s3Config - S3 配置
   * @param {string} fileName - 文件名/路径
   * @param {Buffer|Uint8Array} data - 文件数据
   * @param {string} contentType - MIME 类型
   * @returns {Promise<string>} 上传后的 URL
   */
  async uploadToS3(s3Config, fileName, data, contentType) {
    throw new Error('HttpProvider.uploadToS3() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HttpProvider;
}
