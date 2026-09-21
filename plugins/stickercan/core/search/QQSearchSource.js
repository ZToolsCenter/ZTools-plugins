/**
 * QQSearchSource - QQ 表情包搜索源
 *
 * 使用 api.xcvts.cn 的 QQ 表情包搜索 API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class QQSearchSource extends SearchSourceBase {
  getId() {
    return 'qq';
  }

  getDisplayName() {
    return 'QQ';
  }

  async fetchImages(keyword, page) {
    const url = `https://api.xcvts.cn/api/img/qqbqbss?msg=${encodeURIComponent(keyword)}&page=${page}`;

    const response = await this.httpProvider.fetchWithTimeout(url);
    const data = await response.json();

    let images = [];
    if (data.code === 0 && Array.isArray(data.data)) {
      images = data.data
        .map(item => (typeof item === 'string' ? item : item && item.sticker_url))
        .filter(url => typeof url === 'string' && url.trim().length > 0);
    }

    return { images, hasMore: data.hasMorePage === true && images.length > 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QQSearchSource;
}
