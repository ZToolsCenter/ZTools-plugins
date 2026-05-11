const { Video, makeRequest, VideoAuthor } = require('./base');

// https://www.doubao.com/thread/w93c0c24fa5eea22e 视频(暂不支持)
// https://www.doubao.com/thread/w4fd0c010d0668f1a 图片1
// https://www.doubao.com/thread/w21583b263a3723ff 图片2
// https://www.doubao.com/thread/w92d2f8434076e159
// https://www.doubao.com/thread/aac87757e1bd6 通过豆包的文本生成模式调用图片生成(需要兼容一下)

/**
 * 豆包解析器(当前只持续图片)
 */
class DouBaoParser { 
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 1、获取页面HTML
    const html = await this.getPageHtml(sharedUrl);

    // 2、提取JSON数据
    const jsonPattern = /_ROUTER_DATA\s*=\s*(\{[\s\S]*?\});/;
    const match = html.match(jsonPattern);
    if (!match) {
      throw new Error("未找到有效的分享链接");
    }

    // 3、提取根节点
    let root;
    try {
      root = JSON.parse(match[1]);
    } catch (e) {
      throw new Error("解析失败:" + e.message);
    }

    // 4、loaderData
    const loaderData = root.loaderData;

    // 5、主要数据(包含用户信息以及图片信息)
    const allInfo = loaderData['thread_(token)/page']?.data;
    console.log(loaderData);
    // 6、提取图片
    // 兼容格式
    const pics = [];
    const messageSnapshot = allInfo?.['message_snapshot'] || '';
    // 偶尔出现 message_snapshot 获取失败
    if (!messageSnapshot) {
      throw new Error("哎呀，没有找到资源呢，您要不要重新试试呢");
    }
    let img1ContentStr = messageSnapshot['message_list'][1]['content'];
    let img1Content;
    try {
      // 若是此处出现解析报错，可以尝试在同级别下的ext的creation_full_content下获取数据
      img1Content = JSON.parse(img1ContentStr);
    } catch(e) {
      img1ContentStr = messageSnapshot['message_list'][1]['ext']['creation_full_content'];
      img1Content = JSON.parse(img1ContentStr);
    }
    if (!img1Content) {
      throw new Error("未找到图片");
    }
    if (messageSnapshot['message_list'][1]['content_type'] === 9999) {
      const imgContent = JSON.parse(img1Content[1]['content']);
      const creations = imgContent['creations'];
      if (creations.length === 0) {
        throw new Error("未找到图片");
      }
      for(const pic of creations) {
        pics.push({
          url: pic['image']['image_ori_raw']['url'],
          livePhotoUrl: ''
        })
      }
      // cover = creations[0]['image']['image_thumb']['url'];
    } else {
      const taskInfo = img1Content?.['creation_info']?.['task_info'];
      if (!taskInfo) {
        throw new Error("暂不支持非图片资源");
      }
      // 取出对象的所有值
      const taskList = Object.values(taskInfo);
      for (const task of taskList) {
        pics.push({
          url: task['asset']['image_content']['image_info']['raw_image']['url'],
          livePhotoUrl: ''
        });
      }
    }
    let cover = pics[0].url || '';
    // 7、用户信息
    const authorInfo = allInfo['share_info']['user'];
    const author = new VideoAuthor(
      '',
      authorInfo['nick_name'],
      authorInfo['image']['origin_url']
    );
    return new Video(
      allInfo['share_info']['share_id'],
      allInfo['share_info']['share_name'],
      '',
      cover,
      pics,
      author
    )
  }

  /**
   * 获取页面HTML
   * @param {string} url URL
   * @returns {Promise<string>} HTML内容
   */
  async getPageHtml(url) {
    const { data } = await makeRequest(url, 'GET', {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.doubao.com'
    });
    return data;
  }
}

module.exports = DouBaoParser;