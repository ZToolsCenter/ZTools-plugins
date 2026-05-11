const { getRedirectUrl, convertUrl, Video, makeRequest, VideoAuthor } = require('./base');

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";

/**
 * 哔哩哔哩解析器
 */
class BiliBiliParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    const videoId = this.getVideoId(sharedUrl);
    if (!videoId) {
      throw new Error("未找到有效的分享链接");
    }
    console.log("视频id：" + videoId);

    // 1、获取视频信息
    const viewApiUrl = "https://api.bilibili.com/x/web-interface/view?bvid=" + videoId;
    const viewData = await this.sendBiliBiliRequest(viewApiUrl);
    if (viewData.code !== 0 || !viewData.data.pages) {
      throw new Error("获取视频信息失败: " + viewData.message);
    }
    const data = viewData.data;
    const firstPagesCid = data.pages[0].cid;

    // 2、获取播放链接
    const playApiUrl = "https://api.bilibili.com/x/player/playurl?" +
        "otype=json&fnver=0&fnval=0&qn=80&bvid=" + videoId +
        "&cid=" + firstPagesCid + "&platform=html5";
    const playApiData = await this.sendBiliBiliRequest(playApiUrl);
    console.log(playApiData);
    if (playApiData.code !== 0) {
      throw new Error("获取播放链接失败: " + playApiData.message);
    }
    const playData = playApiData.data;
    const downloadUrl = convertUrl(playData.durl[0].url);

    // 3、构造信息
    const title = data.title;
    const cover = convertUrl(data.pic);
    const owner = data.owner;
    const author = new VideoAuthor(
      owner.mid,
      owner.name,
      convertUrl(owner.face)
    );
    return new Video(videoId, title, downloadUrl, cover, [], author)
  }

  getVideoId(url) {
    const split = url.split("/");
    // 1、获取域名
    const domain = split[2];
    if (domain === "b23.tv") {
      try {
        const redirectedUrl = getRedirectUrl(url, USER_AGENT);
        return this.getVideoId(redirectedUrl);
      } catch (e) {
        throw new Error(e.message);
      }
    }
    // 2、video标识
    const videoSign = split[3];
    // 3、视频id
    let videoId = split[4];
    if (videoSign === "video") {
      if (videoId.includes("?")) {
        videoId = videoId.split("?")[0];
      }
      return videoId;
    }
    return "";
  }

  async sendBiliBiliRequest(url) {
    const { data } = await makeRequest(url, 'GET', { 'User-Agent': USER_AGENT });
    return JSON.parse(data);
  }
}

module.exports = BiliBiliParser;