/**
 * YujianSearchSource - 遇见表情包搜索源
 *
 * 使用 yujn.cn 的表情包搜索 API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class YujianSearchSource extends SearchSourceBase {
  getId() {
    return 'yujian';
  }

  getDisplayName() {
    return '遇见';
  }

  async fetchImages(keyword, page) {
    const count = 40;
    const url = `https://api.yujn.cn/api/bbq_ss.php?count=${count}&msg=${encodeURIComponent(keyword)}`;

    const response = await this.httpProvider.fetchWithTimeout(url);
    const data = await response.json();

    let images = [];
    if (data.code === 200 && Array.isArray(data.data) && data.data.length > 0) {
      images = data.data.map(url => {
        if (typeof url === 'string') {
          return url.replace(/`/g, '').trim();
        }
        return url;
      }).filter(url => url && typeof url === 'string');
    } else if (Array.isArray(data) && data.length > 0) {
      images = data.filter(url => url && typeof url === 'string');
    } else if (data.code === 200 && data.res) {
      if (Array.isArray(data.res)) {
        images = data.res.filter(url => url && typeof url === 'string');
      } else if (typeof data.res === 'string') {
        images = [data.res];
      }
    } else if (typeof data === 'object' && data.url) {
      images = [data.url];
    }

    return { images, hasMore: images.length > 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = YujianSearchSource;
}
