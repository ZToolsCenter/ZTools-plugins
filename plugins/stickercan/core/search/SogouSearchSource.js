/**
 * SogouSearchSource - 搜狗表情包搜索源
 *
 * 使用 apihz.cn 的搜狗表情包搜索 API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class SogouSearchSource extends SearchSourceBase {
  getId() {
    return 'sogou';
  }

  getDisplayName() {
    return '搜狗';
  }

  async fetchImages(keyword, page) {
    const url = `https://cn.apihz.cn/api/img/apihzbqbsougou.php?id=10016659&key=60f12f4aec521722296bf562e45d8908&page=${page}&words=${encodeURIComponent(keyword)}`;

    const response = await this.httpProvider.fetchWithTimeout(url);
    const data = await response.json();

    let images = [];
    if (data.code === 200 && data.res && data.res.length > 0) {
      images = data.res;
    }

    return { images, hasMore: images.length > 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SogouSearchSource;
}
