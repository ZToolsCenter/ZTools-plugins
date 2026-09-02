/**
 * TangdouziSearchSource - 糖豆子表情包搜索源
 *
 * 使用 tangdouz.com 的表情包搜索 API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class TangdouziSearchSource extends SearchSourceBase {
  getId() {
    return 'tangdouzi';
  }

  getDisplayName() {
    return '糖豆子';
  }

  async fetchImages(keyword, page) {
    const url = `https://api.tangdouz.com/a/biaoq.php?return=json&nr=${encodeURIComponent(keyword)}`;

    const response = await this.httpProvider.fetchWithTimeout(url);
    const data = await response.json();

    let images = [];
    if (Array.isArray(data) && data.length > 0) {
      images = data.map(item => item.thumbSrc || item.url || item);
    } else if (data.code === 200 && data.res) {
      if (Array.isArray(data.res)) {
        images = data.res.map(item => item.thumbSrc || item.url || item);
      } else if (typeof data.res === 'string') {
        images = [data.res];
      }
    }

    return { images, hasMore: images.length > 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TangdouziSearchSource;
}
