/**
 * FileProvider - 文件系统抽象接口
 *
 * 定义跨平台的文件操作能力。
 * 在 Web 环境中可能降级为 Blob URL 方式。
 */

class FileProvider {
  /**
   * 选择文件夹
   * @returns {Promise<string|null>} 选中的文件夹路径
   */
  async selectFolder() {
    throw new Error('FileProvider.selectFolder() 未实现');
  }

  /**
   * 保存文件到本地
   * @param {string|Buffer} fileData - base64(data URL) 或 Buffer 格式的文件数据
   * @param {string} targetPath - 目标路径
   * @returns {Promise<string>} 保存后的文件路径
   */
  async saveFile(fileData, targetPath) {
    throw new Error('FileProvider.saveFile() 未实现');
  }

  /**
   * 判断文件是否存在
   * @param {string} filePath
   * @returns {boolean}
   */
  fileExists(filePath) {
    throw new Error('FileProvider.fileExists() 未实现');
  }

  /**
   * 删除文件
   * @param {string} filePath
   * @returns {boolean} 是否删除成功
   */
  deleteFile(filePath) {
    throw new Error('FileProvider.deleteFile() 未实现');
  }

  /**
   * 读取本地文件，返回 base64 + 文件名
   * @param {string} filePath
   * @returns {Promise<{base64: string, fileName: string}|null>}
   */
  async readFile(filePath) {
    throw new Error('FileProvider.readFile() 未实现');
  }

  /**
   * 获取默认存储目录
   * @returns {string}
   */
  getDefaultDir() {
    throw new Error('FileProvider.getDefaultDir() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileProvider;
}
