const { convertUrl, Video, makeRequest, VideoAuthor } = require('./base');

/**
 * 最右解析器
 */
class ZuiYouParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 正则匹配 pid
    const pattern = /pid=(\d+)/;
    const match = sharedUrl.match(pattern);
    if (!match) {
      throw new Error("未找到有效的分享链接");
    }
    const videoId = match[1];
    const requestUrl = "https://share.xiaochuankeji.cn/planck/share/post/detail_h5";

    // 参数
    const params = {
      h_av: "5.2.13.011",
      pid: parseInt(videoId)
    };

    // 发送 POST 请求
    const body = await this.postRequest(requestUrl, params);

    // 解析 JSON
    let jsonNode;
    try {
      jsonNode = JSON.parse(body);
    } catch (e) {
      throw new Error("解析失败:" + e.message);
    }

    if (jsonNode.ret !== 1) {
      throw new Error("解析失败: " + jsonNode.msg);
    }

    const data = jsonNode.data.post;
    const videoKey = data.imgs[0].id;
    const member = data.member;
    const author = new VideoAuthor(
      member.id,
      member.name,
      convertUrl(member.avatar_urls.origin.urls[0])
    );

    // 图集或视频
    let downloadUrl = '';
    const cover = convertUrl(data.topic.cover_urls.origin.urls[0]);
    const pics = [];

    if (data.videos) {
      downloadUrl = convertUrl(data.videos[videoKey].url);
    } else {
      data.imgs.forEach(img => {
        pics.push({
          url: convertUrl(img.urls.origin.urls[0]),
          livePhotoUrl: ''
        });
      });
    }
    return new Video(data.id, data.content, downloadUrl, cover, pics, author);
  }

  /**
   * 发送 POST 请求
   * @param {string} url URL
   * @param {object} data 数据
   * @returns {Promise<string>} 响应体
   */
  async postRequest(url, data) {
    return new Promise(async (resolve, reject) => {
      const postData = JSON.stringify(data);
      try {
        const { data } = await makeRequest(url, 'POST', {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }, postData);
        resolve(data);
      } catch (e) {
        reject(e);
      }
    });
  }
}

module.exports = ZuiYouParser;