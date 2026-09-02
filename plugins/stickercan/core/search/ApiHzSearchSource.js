/**
 * ApiHzSearchSource - 接口盒子搜索源
 *
 * 使用 apihz.cn 的表情包搜索 API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class ApiHzSearchSource extends SearchSourceBase {
  getId() {
    return 'apihz';
  }

  getDisplayName() {
    return '接口盒子';
  }

  async fetchImages(keyword, page) {
    const limit = 30;
    const offset = (page - 1) * limit;
    const url = `https://cn.apihz.cn/api/img/apihzbqb.php?id=10016659&key=60f12f4aec521722296bf562e45d8908&type=1&limit=${limit}&offset=${offset}&words=${encodeURIComponent(keyword)}`;

    const response = await this.httpProvider.fetchWithTimeout(url);
    const data = await response.json();

    let images = [];
    if (data.code === 200 && data.res) {
      if (Array.isArray(data.res)) {
        images = data.res;
      } else if (typeof data.res === 'string') {
        images = [data.res];
      }
    } else if (Array.isArray(data)) {
      images = data;
    } else if (data.url) {
      images = [data.url];
    }

    return { images, hasMore: images.length > 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiHzSearchSource;
}
