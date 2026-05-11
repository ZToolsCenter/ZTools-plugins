const https = require('https');
const { getRedirectUrl, Video, getRandomUserAgent, convertUrl, makeRequest, VideoAuthor } = require('./base');

/**
 * 小红书解析器
 */
class RedBookParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 1、获取重定向URL
    let url = convertUrl(sharedUrl);
    try {
      url = await getRedirectUrl(url, getRandomUserAgent());
    } catch (e) {
      throw new Error(e.message);
    }

    // 2、获取页面HTML
    const html = await this.getPageHtml(url);

    // 3、提取JSON数据
    const pattern = /window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s;
    const match = html.match(pattern);
    if (!match) {
      throw new Error("未找到有效的分享链接");
    }
    const res = match[1].trim();

    // 4、解析数据
    let root;
    try {
      // 预处理替换undefined为null
      const cleanedData = res.replace(/:\s*undefined/g, ':null');
      root = JSON.parse(cleanedData);
    } catch (e) {
      throw new Error(e.message);
    }

    // 链接有效性，过期返回null
    const noteId = root.note?.currentNoteId;
    if (!noteId || noteId === 'null') {
      throw new Error("未找到有效的分享链接");
    }

    const data = root.note.noteDetailMap[noteId].note;

    // 5、视频地址
    let videoUrl = '';
    const h264Data = data.video?.media?.stream?.h264;
    if (h264Data && h264Data.length > 0) {
      videoUrl = h264Data[0].masterUrl;
    }

    // 6、图集
    const images = [];
    if (!videoUrl) {
      data.imageList.forEach(item => {
        let newUrl = item.urlDefault;
        const split = newUrl.split('/');
        const imageId = split[split.length - 1].split('!')[0];
        const spectrumStr = newUrl.includes('spectrum/') ? 'spectrum/' : '';
        newUrl = `https://ci.xiaohongshu.com/notes_pre_post/${spectrumStr}${imageId}?imageView2/format/jpg`;

        // 如果原图片网址中没有 notes_pre_post 关键字，不支持替换域名，使用原域名
        if (!item.urlDefault.includes('notes_pre_post')) {
          newUrl = convertUrl(item.urlDefault);
        }

        const imageInfo = { url: newUrl };

        // 是否有 livePhoto 视频地址
        if (item.livePhoto && item.stream) {
          const liveH264 = item.stream.h264;
          if (liveH264 && liveH264.length > 0) {
            imageInfo.livePhotoUrl = convertUrl(liveH264[0].masterUrl);
          }
        }

        images.push(imageInfo);
      });
    }

    // 7、作者信息
    const user = data.user;
    const author = new VideoAuthor(
      user.userId,
      user.nickname,
      user.avatar
    );

    // 8、封面
    let cover = '';
    if (data.imageList && data.imageList.length > 0) {
      cover = convertUrl(data.imageList[0].urlDefault);
    }

    return new Video(
      noteId,
      data.title,
      convertUrl(videoUrl),
      cover,
      images,
      author,
      'xiaohongshu'
    );
  }

  /**
   * 获取页面HTML
   * @param {string} url URL
   * @returns {Promise<string>} HTML内容
   */
  async getPageHtml(url) {
    return new Promise(async (resolve, reject) => {
      try {
        const { data } = await makeRequest(url, 'GET', {
          'User-Agent': getRandomUserAgent()
        });
        resolve(data);
      } catch (e) {
        reject(e);
      }
    });
  }
}

module.exports = RedBookParser;

