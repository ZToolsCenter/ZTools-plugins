/**
 * SearchProvider - 搜索源抽象接口
 *
 * 每个第三方表情包搜索源实现此接口。
 * 搜索源只需关注 API 调用与响应解析，分页/去重/UI 渲染由 SearchService 统一管理。
 */

class SearchProvider {
  /**
   * 获取搜索源标识
   * @returns {string}
   */
  getId() {
    throw new Error('SearchProvider.getId() 未实现');
  }

  /**
   * 获取搜索源显示名称
   * @returns {string}
   */
  getDisplayName() {
    throw new Error('SearchProvider.getDisplayName() 未实现');
  }

  /**
   * 执行搜索，返回图片 URL 列表
   * @param {string} keyword - 搜索关键词
   * @param {number} page - 页码（从 1 开始）
   * @returns {Promise<{images: string[], hasMore: boolean}>}
   */
  async search(keyword, page) {
    throw new Error('SearchProvider.search() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchProvider;
}
