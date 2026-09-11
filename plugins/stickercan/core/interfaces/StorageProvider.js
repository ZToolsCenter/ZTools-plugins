/**
 * StorageProvider - 存储抽象接口
 *
 * 定义跨平台的存储能力，由各客户端实现具体逻辑。
 *
 * 区分两种存储：
 *  - 本地存储（local）：不同步到其他设备，与当前设备绑定
 *  - 云端存储（cloud）：跨设备同步
 */

class StorageProvider {
  /**
   * 获取设备唯一标识
   * @returns {string}
   */
  getNativeId() {
    throw new Error('StorageProvider.getNativeId() 未实现');
  }

  /**
   * 读取本地存储项（不同步）
   * @param {string} key
   * @returns {any} 已存储的值，不存在时返回 null
   */
  getItem(key) {
    throw new Error('StorageProvider.getItem() 未实现');
  }

  /**
   * 写入本地存储项（不同步）
   * @param {string} key
   * @param {any} value
   */
  setItem(key, value) {
    throw new Error('StorageProvider.setItem() 未实现');
  }

  /**
   * 移除本地存储项
   * @param {string} key
   */
  removeItem(key) {
    throw new Error('StorageProvider.removeItem() 未实现');
  }

  /**
   * 读取同步文档
   * @param {string} id - 文档 ID
   * @returns {Promise<object|null>} 文档对象，不存在时返回 null
   */
  async getDoc(id) {
    throw new Error('StorageProvider.getDoc() 未实现');
  }

  /**
   * 写入/更新同步文档
   * @param {object} doc - 文档对象，至少包含 { _id, data }
   * @returns {Promise<boolean>} 是否成功
   */
  async putDoc(doc) {
    throw new Error('StorageProvider.putDoc() 未实现');
  }

  /**
   * 删除同步文档
   * @param {string} id - 文档 ID
   */
  async removeDoc(id) {
    throw new Error('StorageProvider.removeDoc() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageProvider;
}
