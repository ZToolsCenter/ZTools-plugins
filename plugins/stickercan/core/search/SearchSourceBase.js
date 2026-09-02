/**
 * SearchSourceBase - 搜索源基类
 *
 * 封装搜索源的通用逻辑：分页状态管理、去重、结果缓存。
 * 具体搜索源只需实现 fetchImages(keyword, page) 方法。
 *
 * 继承自 SearchProvider 接口。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class SearchSourceBase extends SearchProvider {
  /**
   * @param {object} deps - 依赖注入
   * @param {object} deps.httpProvider - HttpProvider 实例
   */
  constructor(deps = {}) {
    super();
    this.httpProvider = deps.httpProvider;
    if (!this.httpProvider) {
      throw new Error(this.constructor.name + ': httpProvider 依赖未注入');
    }

    // 分页状态
    this.results = [];
    this.currentKeyword = '';
    this.currentPage = 1;
    this.hasMore = true;
    this.loading = false;
  }

  getId() {
    throw new Error('SearchSourceBase.getId() 未实现');
  }

  getDisplayName() {
    throw new Error('SearchSourceBase.getDisplayName() 未实现');
  }

  /**
   * 子类实现：请求 API 并返回图片 URL 列表
   * @param {string} keyword
   * @param {number} page
   * @returns {Promise<{images: string[], hasMore: boolean}>}
   */
  async fetchImages(keyword, page) {
    throw new Error('SearchSourceBase.fetchImages() 未实现');
  }

  /**
   * 执行搜索（管理分页与去重）
   * @param {string} keyword
   * @param {number} page
   * @returns {Promise<{images: string[], keyword: string, isFirstPage: boolean, hasMore: boolean}>}
   */
  async search(keyword, page = 1) {
    const isFirstPage = page === 1;

    if (isFirstPage) {
      this.results = [];
      this.currentKeyword = keyword;
      this.currentPage = 1;
      this.hasMore = true;
      this.loading = false;
    }

    this.loading = true;

    try {
      const { images, hasMore } = await this.fetchImages(keyword, page);

      if (images.length > 0) {
        // 去重：过滤掉已存在的 URL
        const newImages = images.filter(url => !this.results.includes(url));

        if (isFirstPage) {
          this.results = [...images];
        } else {
          this.results = [...this.results, ...newImages];
        }

        this.currentPage = page;
        this.hasMore = hasMore && newImages.length > 0;
        this.loading = false;

        return {
          images: isFirstPage ? this.results : newImages,
          keyword,
          isFirstPage,
          hasMore: this.hasMore,
        };
      } else {
        this.hasMore = false;
        this.loading = false;
        return { images: [], keyword, isFirstPage, hasMore: false };
      }
    } catch (error) {
      this.loading = false;
      throw error;
    }
  }

  /**
   * 加载下一页
   * @returns {Promise<object|null>} 搜索结果，null 表示无法加载
   */
  async loadMore() {
    if (!this.currentKeyword || !this.hasMore || this.loading) {
      return null;
    }
    return await this.search(this.currentKeyword, this.currentPage + 1);
  }

  /**
   * 重置状态
   */
  reset() {
    this.results = [];
    this.currentKeyword = '';
    this.currentPage = 1;
    this.hasMore = true;
    this.loading = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchSourceBase;
}
