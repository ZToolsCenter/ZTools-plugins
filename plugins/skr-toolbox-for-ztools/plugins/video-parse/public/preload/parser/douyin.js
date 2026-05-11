const { getRedirectUrl, Video, makeRequest, VideoAuthor } = require('./base');

/**
 * 抖音解析器
 */
class DouYinParser {
  static USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 " +
    "Version/17.0 Mobile/15E148 Safari/604.1";

  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Object>} 视频信息
   */
  async parse(sharedUrl) {
    const pattern = /http[s]?:\/\/[^\s]+/;
    const match = sharedUrl.match(pattern);
    if (!match) {
      throw new Error("未找到有效的分享链接");
    }

    // 1、获取响应的重定向链接
    let finalUrl;
    try {
      finalUrl = await this.getNewUrl(sharedUrl);
    } catch (e) {
      throw new Error("未找到有效的分享链接");
    }

    // 2、提取视频ID
    const parts = finalUrl.split('?')[0].split('/').filter(s => s && s.trim());
    const videoId = parts[parts.length - 1];
    if (!videoId) {
      throw new Error("未找到有效的分享链接");
    }

    // 3、获取视频页面内容
    const html = await this.getVideoPage(videoId);

    // 4、提取JSON数据
    const jsonPattern = /window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s;
    const jsonMatch = html.match(jsonPattern);
    if (!jsonMatch) {
      throw new Error("从HTML中解析视频信息失败");
    }

    const jsonStr = jsonMatch[1].trim();
    let root;
    try {
      root = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error("节点解析失败");
    }
    const loaderData = root.loaderData;

    // 5、解析视频信息
    return await this.parseVideoInfo(loaderData, videoId);
  }

  /**
   * 获取视频页面
   * @param {string} videoId 视频ID
   * @returns {Promise<string>} HTML内容
   */
  async getVideoPage(videoId) {
    const videoPageUrl = `https://www.iesdouyin.com/share/video/${videoId}`;
    const { data } = await makeRequest(videoPageUrl, 'GET', { 'User-Agent': DouYinParser.USER_AGENT });
    return data;
  }

  /**
   * 解析视频信息
   * @param {Object} loaderData 加载器数据
   * @param {string} videoId 视频ID
   * @returns {Promise<Object>} 视频对象
   */
  async parseVideoInfo(loaderData, videoId) {
    const VIDEO_ID_PAGE_KEY = "video_(id)/page";
    const NOTE_ID_PAGE_KEY = "note_(id)/page";
    let videoInfo = null;
    if (loaderData[VIDEO_ID_PAGE_KEY]) { // 视频
      videoInfo = loaderData[VIDEO_ID_PAGE_KEY].videoInfoRes;
    } else if (loaderData[NOTE_ID_PAGE_KEY]) { // 图集
      videoInfo = loaderData[NOTE_ID_PAGE_KEY].videoInfoRes;
    }
    if (!videoInfo) {
      throw new Error("无法从JSON中解析视频或图集信息");
    }

    const data = videoInfo.item_list[0];
    if (!data) {
      throw new Error("无法解析信息，请检查链接是否正确");
    }
    const title = data.desc || `douyin_${videoId}`;
    let downloadUrl = data.video?.play_addr?.url_list?.[0]?.replace("playwm", "play") || "";

    const pics = [];
    const cover = data.video?.cover?.url_list?.[0] || "";
    const images = data.images;
    if (Array.isArray(images)) {
      downloadUrl = ""; // 图集删除视频链接
      for (const img of images) {
        pics.push({ url: img.url_list[0], livePhotoUrl: "" });
      }
    } else {
      try {
        downloadUrl = await this.getNewUrl(downloadUrl);
      } catch (e) {
        throw new Error("视频链接获取失败");
      }
    }

    const authorNode = data.author;
    const author = new VideoAuthor(
      authorNode.sec_uid,
      authorNode.nickname,
      authorNode.avatar_thumb.url_list[0]
    );

    console.log("解析成功");
    return new Video(videoId, title, downloadUrl, cover, pics, author);
  }

  /**
   * 获取重定向链接
   * @param {string} url 原始URL
   * @returns {Promise<string>} 重定向URL
   */
  async getNewUrl(url) {
    return getRedirectUrl(url, DouYinParser.USER_AGENT);
  }
}

module.exports = DouYinParser;