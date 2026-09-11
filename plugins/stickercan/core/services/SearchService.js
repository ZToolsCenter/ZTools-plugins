/**
 * SearchService - 搜索服务
 *
 * 统一管理搜索源的注册、调度、结果查询。
 * 通过注入的 HttpProvider 构造搜索源实例。
 * 客户端 UI 层通过此服务发起搜索、加载更多。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
class SearchService {
  /**
   * @param {object} deps
   * @param {object} deps.httpProvider - HTTP 适配器
   * @param {object} deps.emotionService - EmotionService 实例
   * @param {object} deps.notificationProvider - 通知适配器
   */
  constructor(deps = {}) {
    this.http = deps.httpProvider;
    this.emotionService = deps.emotionService;
    this.notification = deps.notificationProvider;

    // 注册搜索源
    this.sources = new Map();
    this._registerDefaultSources();

    this.activeSourceId = null;
  }

  /**
   * 注册默认搜索源
   */
  _registerDefaultSources() {
    const deps = { httpProvider: this.http };
    this.registerSource(new YujianSearchSource(deps));
    this.registerSource(new TangdouziSearchSource(deps));
    this.registerSource(new BaiduSearchSource(deps));
    this.registerSource(new SogouSearchSource(deps));
    this.registerSource(new ApiHzSearchSource(deps));
  }

  /**
   * 注册搜索源
   * @param {SearchProvider} source
   */
  registerSource(source) {
    this.sources.set(source.getId(), source);
  }

  /**
   * 获取所有已注册的搜索源
   * @returns {SearchProvider[]}
   */
  getSources() {
    return Array.from(this.sources.values());
  }

  /**
   * 获取搜索源
   * @param {string} id
   * @returns {SearchProvider|null}
   */
  getSource(id) {
    return this.sources.get(id) || null;
  }

  /**
   * 设置当前活跃的搜索源
   * @param {string} id
   */
  setActiveSource(id) {
    this.activeSourceId = id;
  }

  /**
   * 获取当前活跃的搜索源
   * @returns {SearchProvider|null}
   */
  getActiveSource() {
    if (!this.activeSourceId) return null;
    return this.getSource(this.activeSourceId);
  }

  /**
   * 执行本地搜索
   * @param {string} keyword
   * @returns {Array}
   */
  searchLocal(keyword) {
    return this.emotionService.searchLocal(keyword);
  }

  /**
   * 执行外部搜索
   * @param {string} keyword
   * @param {number} page
   * @returns {Promise<object>} 搜索结果
   */
  async search(keyword, page = 1) {
    const source = this.getActiveSource();
    if (!source) {
      throw new Error('未选择搜索源');
    }

    if (!keyword) {
      this.notification.showMessage('请输入搜索关键词', 'error');
      return { images: [], keyword, isFirstPage: true, hasMore: false };
    }

    return await source.search(keyword, page);
  }

  /**
   * 加载更多
   * @returns {Promise<object|null>}
   */
  async loadMore() {
    const source = this.getActiveSource();
    if (!source) return null;
    return await source.loadMore();
  }

  /**
   * 重置所有搜索源状态
   */
  resetAll() {
    for (const source of this.sources.values()) {
      source.reset();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchService;
}
