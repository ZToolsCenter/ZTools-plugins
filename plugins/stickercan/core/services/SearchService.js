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

    // 搜索结果缓存：切换搜索源标签页时复用，避免重复请求接口
    this.cacheEnabled = deps.cacheEnabled !== false;
    this.cache = new SearchCache({
      maxEntries: deps.cacheMaxEntries,
      ttl: deps.cacheTtl,
    });
  }

  /**
   * 将搜索源的当前状态写入缓存
   * @param {SearchProvider} source
   */
  _saveToCache(source) {
    if (!this.cacheEnabled || !source) return;
    this.cache.set(source.getId(), source.currentKeyword, {
      images: source.results,
      page: source.currentPage,
      hasMore: source.hasMore,
    });
  }

  /**
   * 注册默认搜索源
   */
  _registerDefaultSources() {
    const deps = { httpProvider: this.http };
    this.registerSource(new YujianSearchSource(deps));
    this.registerSource(new QQSearchSource(deps));
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

    const kw = String(keyword || '').trim();
    if (!kw) {
      this.notification.showMessage('请输入搜索关键词', 'error');
      return { images: [], keyword: kw, isFirstPage: true, hasMore: false };
    }

    // 首页搜索优先读缓存（切换标签页回来时不再请求接口）
    if (page === 1 && this.cacheEnabled) {
      const cached = this.getCachedResult(kw);
      if (cached) return cached;
    }

    const result = await source.search(kw, page);

    // 仅缓存有结果的首页搜索，避免缓存失败请求
    if (page === 1 && result && result.images.length > 0) {
      this._saveToCache(source);
    }

    return result;
  }

  /**
   * 读取当前搜索源的缓存结果
   *
   * 命中时会把缓存状态还原到搜索源实例，
   * 使后续「加载更多」能从缓存页码继续分页。
   *
   * @param {string} keyword
   * @returns {object|null} { images, keyword, isFirstPage, hasMore, fromCache }
   */
  getCachedResult(keyword) {
    const source = this.getActiveSource();
    const kw = String(keyword || '').trim();
    if (!source || !kw || !this.cacheEnabled) return null;

    const cached = this.cache.get(source.getId(), kw);
    if (!cached || !cached.images.length) return null;

    source.restoreState({
      keyword: cached.keyword,
      images: cached.images,
      page: cached.page,
      hasMore: cached.hasMore,
    });

    return {
      images: cached.images,
      keyword: cached.keyword,
      isFirstPage: true,
      hasMore: cached.hasMore,
      fromCache: true,
    };
  }

  /**
   * 加载更多
   * @returns {Promise<object|null>}
   */
  async loadMore() {
    const source = this.getActiveSource();
    if (!source) return null;
    const result = await source.loadMore();
    if (result) this._saveToCache(source);
    return result;
  }

  /**
   * 清空搜索结果缓存
   * @param {string} [sourceId] - 指定搜索源，缺省清空全部
   */
  clearCache(sourceId) {
    this.cache.clear(sourceId);
  }

  /**
   * 重置所有搜索源状态（同时清空缓存）
   */
  resetAll() {
    for (const source of this.sources.values()) {
      source.reset();
    }
    this.cache.clearAll();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchService;
}
