const { getRedirectUrl, Video, makeRequest, VideoAuthor, getRandomUserAgent } = require('./base');

class PipixiaParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 1、获取跳转链接
    const url = await getRedirectUrl(sharedUrl, getRandomUserAgent());
    if (!url) {
      throw new Error('无效的分享链接');
    }
    // 2.获取视频id
    const tempUrl = url.split('?')[0].split('/');
    const videoId = tempUrl[tempUrl.length - 1];
    // 3.获取视频信息
    const requestUrl = `https://h5.pipix.com/bds/cell/cell_h5_comment/?count=5&aid=1319&app_name=super&cell_id=${videoId}`;
    const headers = {
      'User-Agent': getRandomUserAgent()
    };
    const { data: json } = await makeRequest(requestUrl, 'GET', headers);
    console.log(json);
    const root = JSON.parse(json);
    if (root.status_code !== 0) {
      throw new Error(`获取作品信息失败: ${root.prompt}`);
    }
    const data = root.data.cell_comments[0].comment_info.item;
    const title = data.content;
    let downloadUrl = '';
    // 视频
    if (data.video) {
      downloadUrl = data.video.video_high.url_list[0].url;
    }
    // 图集
    const pics = [];
    if (data.note && data.note.multi_image) {
      for (const pic of data.note.multi_image) {
        pics.push({
          url: pic.download_list[0].url,
          livePhotoUrl: ''
        });
      }
    }
    // 封面
    const cover = data.cover.url_list[0].url;
    // 用户信息
    const author = new VideoAuthor(
      data.author.id,
      data.author.name,
      data.author.avatar.download_list[0].url
    );
    return new Video(videoId, title, downloadUrl, cover, pics, author);
  }
}

module.exports = PipixiaParser;