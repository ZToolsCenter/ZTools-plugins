const https = require('https');
const { getRedirectUrl, Video, VideoAuthor } = require('./base');

/**
 * 快手解析器
 */
class KuaishouParser {
  static USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) " +
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 " +
                    "Version/17.0 Mobile/15E148 Safari/604.1";

  async parse(sharedUrl) {
    const headers = {
      'User-Agent': KuaishouParser.USER_AGENT,
      'Referer': 'https://v.kuaishou.com/'
    };

    const redirectResponse = await this.makeRequest(sharedUrl, { headers });
    const cookies = redirectResponse.headers['set-cookie'] || [];
    // 获取跳转前的信息, 从中获取跳转url, cookie
    let url = await getRedirectUrl(sharedUrl, KuaishouParser.USER_AGENT);
    if (!url) {
      throw new Error('无效的分享链接');
    }
    // /fw/long-video/ 返回结果不一样, 统一替换为 /fw/photo/ 请求
    url = url.replace('/fw/long-video/', '/fw/photo/');    

    headers.Cookie = cookies.join('; ');

    const response = await this.makeRequest(url, { headers });
    let html = response.body;
    // 匹配a标签中的href属性的值、
    const shareUrlMatcher = html.match(/<a href="([^"]+)">/);
    // 处理莫名返回a标签
    if (shareUrlMatcher) {
      url = shareUrlMatcher[1];
      const resp = await this.makeRequest(url, { headers });
      html = resp.body;
    }

    const matcher = html.match(/window\.INIT_STATE\s*=\s*(.*?)<\/script>/s);
    if (!matcher) throw new Error('从HTML中解析视频信息失败');

    const jsonStr = matcher[1].trim();

    const root = JSON.parse(jsonStr);

    let photoData = null;
    for (const [key, value] of Object.entries(root)) {
      if (value.photo) {
        photoData = value;
        break;
      }
    }

    if (!photoData) {
      throw new Error('没能从INIT_STATE中解析照片信息');
    }

    if (photoData.result !== 1) {
      throw new Error(`获取作品信息失败:result=${photoData.result}`);
    }

    const data = photoData.photo;

    // 视频
    let downloadUrl = '';
    if (Array.isArray(data.mainMvUrls) && data.mainMvUrls.length > 0) {
      downloadUrl = data.mainMvUrls[0].url;
    }

    const author = new VideoAuthor(
      data.userId,
      data.userName,
      data.headUrl
    );

    // 图集
    const extParamsAtlas = data.ext_params?.atlas;
    const atlas_cdn = extParamsAtlas?.cdn?.[0];
    const atlasList = extParamsAtlas?.list;
    const pics = [];

    if (atlas_cdn && Array.isArray(atlasList)) {
      for (const pic of atlasList) {
        pics.push({
          url: `https://${atlas_cdn}${pic}`,
          livePhotoUrl: ''
        });
      }
    }

    return new Video(
      data.photoId,
      data.caption,
      downloadUrl,
      data.coverUrls?.[0]?.url,
      pics,
      author
    );
  }

  makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = KuaishouParser;