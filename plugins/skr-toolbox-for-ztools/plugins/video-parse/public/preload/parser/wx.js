const { Video, VideoAuthor, makeRequest } = require('./base');

class WxParser {
  /**
   * 解析信息
   * @param {string} sharedUrl 分享链接
   * @returns {Promise<Video>} 视频信息
   */
  async parse(sharedUrl) {
    // 匹配url中的 id /s/elDBUQoLue-SvTqL1KDPVg
    const pattern = /https:\/\/mp\.weixin\.qq\.com\/s\/(.*?)$/;
    const matcher = sharedUrl.match(pattern);
    if (!matcher) {
      throw new Error('未找到有效的分享链接');
    }
    const videoId = matcher[1];
    console.log(videoId);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    const { data: html } = await makeRequest(sharedUrl, 'GET', headers);

    // 开始解析
    // 图集 cdn_url: 'https://...'
    const imgPattern = /cdn_url\s*:\s*'(https:\/\/[^']*)'/g;
    let imgMatch;
    const pics = [];
    while ((imgMatch = imgPattern.exec(html)) !== null) {
      let imgUrl = imgMatch[1].replace(/\\x26amp;/g, '&');
      pics.push({ url: imgUrl, livePhotoUrl: '' });
    }

    const author = new VideoAuthor('', '', '');

    // 匹配头像 round_head_img: JsDecode('http://xxx')
    const avatarPattern = /round_head_img: JsDecode\('(.*?)'\)/;
    const avatarMatch = html.match(avatarPattern);
    if (avatarMatch) {
      author.avatar = avatarMatch[1];
    }

    // 昵称 nick_name: JsDecode('xxx')
    const nicknamePattern = /nick_name: JsDecode\('(.*?)'\)/;
    const nicknameMatch = html.match(nicknamePattern);
    if (nicknameMatch) {
      author.name = nicknameMatch[1];
    }

    // 标题 <meta property="og:title" content="xxx">
    const titlePattern = /<meta property="og:title" content="(.*?)"/;
    const titleMatch = html.match(titlePattern);
    let title = '';
    if (titleMatch) {
      title = titleMatch[1];
    }

    // 封面 <meta property="og:image" content="https://...">
    const coverPattern = /<meta property="og:image" content="(https:\/\/[^"]*)"/;
    const coverMatch = html.match(coverPattern);
    let coverUrl = '';
    if (coverMatch) {
      coverUrl = coverMatch[1];
    }

    return new Video(
      videoId,
      title,
      '',
      coverUrl,
      pics,
      author
    );
  }
}

module.exports = WxParser;