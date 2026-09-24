/**
 * MimeUtils - MIME 类型工具
 *
 * 处理 MIME 类型与文件扩展名的双向转换。
 */

class MimeUtils {
  static get extensionMap() {
    return {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
    };
  }

  static get mimeToExtMap() {
    return {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg',
    };
  }

  /**
   * 根据文件名获取 MIME 类型
   * @param {string} fileName
   * @returns {string}
   */
  static getMimeTypeFromFileName(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    return MimeUtils.extensionMap[ext] || 'image/png';
  }

  /**
   * 根据 MIME 类型获取文件扩展名
   * @param {string} mimeType
   * @returns {string}
   */
  static getExtensionFromMimeType(mimeType) {
    return MimeUtils.mimeToExtMap[mimeType] || 'png';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MimeUtils;
}
