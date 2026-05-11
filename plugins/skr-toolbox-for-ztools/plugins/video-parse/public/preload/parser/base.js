const https = require('https');
const urlModule = require('url');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:89.0) Gecko/20100101 Firefox/89.0'
]

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 通用HTTP请求函数
 * @param {string} url 请求URL
 * @param {string} method 请求方法，默认GET
 * @param {Object} headers 请求头
 * @param {string|null} postData POST数据，默认null
 * @returns {Promise<Object>} { data, statusCode, headers }
 */
function makeRequest(url, method = 'GET', headers = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'User-Agent': getRandomUserAgent(),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ data, statusCode: res.statusCode, headers: res.headers });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

/**
 * 获取重定向URL
 * @param {string} originalUrl 原始URL
 * @param {string} userAgent User-Agent 
 * @returns {Promise<string>} 重定向URL
 */
function getRedirectUrl(originalUrl, userAgent) {
  return makeRequest(originalUrl, 'GET', { 'User-Agent': userAgent }).then(({ statusCode, headers }) => {
    if (statusCode >= 300 && statusCode < 400 && headers.location) {
      return urlModule.resolve(originalUrl, headers.location);
    } else {
      return originalUrl;
    }
  }).catch((error) => {
    console.error('获取重定向链接失败:', error);
    throw error;
  });
}

/**
 * 链接转换
 * @param {string} url 链接
 * @return 转换后的链接(http => https，若是https则返回原链接)
 */
function convertUrl(url) {
  return url.replace('http:', 'https:');
}

/**
 * 视频类
 * @param {string} videoId 视频ID
 * @param {string} title 标题
 * @param {string} downloadUrl 下载链接
 * @param {string} cover 封面链接
 * @param {Array} pics 图片列表
 * @param {VideoAuthor} author 作者信息
 * @param {string} platform 平台标识
 */
class Video {
  constructor(videoId, title, downloadUrl, cover, pics, author, platform = 'default') {
    this.videoId = videoId;
    this.title = title;
    this.downloadUrl = downloadUrl;
    this.cover = cover;
    this.pics = pics;
    this.author = author;
    this.platform = platform;
  }
}

/**
 * 视频作者类
 * @param {string} id 作者ID
 * @param {string} name 作者名称
 * @param {string} avatar 作者头像链接
 */
class VideoAuthor {
  constructor(id, name, avatar) {
    this.id = id;
    this.name = name;
    this.avatar = avatar;
  }
}

module.exports = { getRedirectUrl, Video, VideoAuthor, convertUrl, getRandomUserAgent, makeRequest };