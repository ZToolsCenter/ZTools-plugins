const { getRedirectUrl, Video, getRandomUserAgent, convertUrl, makeRequest, VideoAuthor } = require('./base');

/**
 * 即梦解析器
 */
class JiMengParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 1、获取重定向URL
    let url;
    try {
      url = await getRedirectUrl(sharedUrl, getRandomUserAgent());
    } catch (e) {
      throw new Error(e.message);
    }

    // 2、获取页面HTML
    const html = await this.getPageHtml(url);

    // 3、提取JSON数据
    const jsonPattern = /"content":\s*"window\._ROUTER_DATA\s*=\s*(\{.*?\})"/s;
    const match = html.match(jsonPattern);
    if (!match) {
      throw new Error("未找到有效的分享链接");
    }
    let jsonStr = match[1].trim();

    // 4、处理JSON字符串
    let fixed = jsonStr.replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '')
      .replace(/\\r/g, '')
      .replace(/\\u002F/g, '/');

    // 5、解析JSON
    let root;
    try {
      root = JSON.parse(fixed);
    } catch (e) {
      throw new Error("解析失败:" + e.message);
    }

    // 6、提取数据
    const loaderData = root.loaderData;
    const workDetail = loaderData['ai-tool/work-detail/(id$)/page'].workDetail;
    if (!workDetail.ok) {
      throw new Error("解析失败，此图片/视频或许还在审核中...");
    }
    const allInfo = workDetail.value;

    const videoId = allInfo.id;
    const title = allInfo.commonAttr.title;
    let downloadUrl = '';
    const cover = convertUrl(allInfo.commonAttr.coverUrl);

    // 7、用户信息
    const authorInfo = allInfo.author;
    const author = new VideoAuthor(
      authorInfo.secUid,
      authorInfo.name,
      convertUrl(authorInfo.avatarUrl)
    );

    // 8、图片或视频信息
    const pics = [];
    if (allInfo.image && allInfo.image.largeImages) {
      const imageArr = allInfo.image.largeImages;
      for (const image of imageArr) {
        const imageInfo = { url: convertUrl(image.imageUrl), livePhotoUrl: '' };
        pics.push(imageInfo);
      }
    } else {
      // 视频信息
      const video = allInfo.video;
      downloadUrl = convertUrl(video.originVideo.videoUrl);
    }

    return new Video(videoId, title, downloadUrl, cover, pics, author);
  }

  /**
   * 获取页面HTML
   * @param {string} url URL
   * @returns {Promise<string>} HTML内容
   */
  async getPageHtml(url) {
    const { data } = await makeRequest(url, 'GET', {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://jimeng.jianying.com/'
    });
    return data;
  }
}

module.exports = JiMengParser;
