/**
 * Emotion - 表情包数据模型
 *
 * 描述表情包的完整数据结构。
 * 此模型不包含任何平台 API，可被所有客户端复用。
 */

class Emotion {
  /**
   * @param {object} data
   * @param {string} data.id - 唯一标识
   * @param {string} data.url - 图片地址（本地 file:// 或云端 https://）
   * @param {'local'|'cloud'} data.storageType - 存储类型
   * @param {string[]} data.tags - 标签列表
   * @param {string} data.createdAt - 创建时间 ISO 字符串
   * @param {string} data.updatedAt - 更新时间 ISO 字符串
   * @param {object} [data.metadata] - 额外元数据
   */
  constructor(data = {}) {
    this.id = data.id || '';
    this.url = data.url || '';
    this.storageType = data.storageType || 'local';
    this.tags = Array.isArray(data.tags) ? data.tags : [];
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.metadata = data.metadata || null;
  }

  /**
   * 序列化为纯对象（用于存储）
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      url: this.url,
      storageType: this.storageType,
      tags: this.tags,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
    };
  }

  /**
   * 从纯对象创建 Emotion 实例
   * @param {object} data
   * @returns {Emotion}
   */
  static fromJSON(data) {
    return new Emotion(data);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Emotion;
}
