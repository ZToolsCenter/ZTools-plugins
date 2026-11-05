'use strict';
const { clipboard } = require('electron');
const { requestText, requestAvatar, requestImage } = require('./transport.cjs');
const C = require('./reader-core.js');
const inflight = new Map();
const avatarCache = new Map();
const avatarQueue = [];
let avatarActive = 0;
const imageCache = new Map();
const imageQueue = [];
let imageActive = 0, imageCacheBytes = 0;
function pumpImages() {
  while (imageActive < 3 && imageQueue.length) {
    const job = imageQueue.shift(); imageActive++;
    requestImage(job.url).then(data => {
      const entry = imageCache.get(job.url);
      if (entry) { entry.size = data.length; imageCacheBytes += data.length; }
      while (imageCacheBytes > 32 * 1024 * 1024 || imageCache.size > 48) { const first = imageCache.keys().next().value; if (!first) break; imageCacheBytes -= imageCache.get(first).size || 0; imageCache.delete(first); }
      job.resolve(data);
    }, error => { imageCache.delete(job.url); job.reject(error); }).finally(() => { imageActive--; pumpImages(); });
  }
}
function pumpAvatars() {
  while (avatarActive < 4 && avatarQueue.length) {
    const job = avatarQueue.shift(); avatarActive++;
    requestAvatar(job.siteId, job.url).then(job.resolve, () => job.resolve('')).finally(() => { avatarActive--; pumpAvatars(); });
  }
}
function validateResponse(result, format) {
  if (!result || typeof result.body !== 'string' || result.body.length > 8 * 1024 * 1024) throw new Error('社区返回的数据无效或过大。');
  if (/^\s*</.test(result.body) && /<title>\s*(Just a moment|Attention Required)|<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform\//i.test(result.body)) throw new Error('站点要求浏览器验证，请点击“登录 / 验证”，完成后刷新。');
  if (format === 'json') { try { return JSON.parse(result.body); } catch { throw new Error('站点未返回帖子数据，可能需要登录或验证。'); } }
  return result.body;
}
async function sessionRequest(url, format) {
  const browser = window.ztools?.zbrowser || window.ztools?.ubrowser;
  if (!browser) throw new Error('当前 ZTools 不支持浏览器会话，请更新宿主后再试。');
  const values = await browser.goto(url, undefined, 25000).evaluate(mode => mode === 'json' ? document.body.innerText : document.documentElement.outerHTML, format).run({ show: false, width: 1000, height: 760 });
  const body = Array.isArray(values) ? values.findLast(value => typeof value === 'string') : values;
  return { body, url };
}
window.communityServices = Object.freeze({
  image(value) {
    const url = C.mediaUrl(value); if (!url) return Promise.reject(new Error('图片地址无效。'));
    if (imageCache.has(url)) return imageCache.get(url).promise;
    const promise = new Promise((resolve, reject) => imageQueue.push({ url, resolve, reject }));
    imageCache.set(url, { promise, size: 0 }); pumpImages(); return promise;
  },
  avatar(siteId, value) {
    const url = C.avatarUrl(siteId, value); if (!url) return Promise.resolve('');
    const key = siteId + ':' + url; const cached = avatarCache.get(key);
    if (cached && Date.now() - cached.time < 300000) return cached.promise;
    const promise = new Promise(resolve => avatarQueue.push({ siteId, url, resolve }));
    avatarCache.set(key, { promise, time: Date.now() }); if (avatarCache.size > 128) avatarCache.delete(avatarCache.keys().next().value);
    pumpAvatars(); return promise;
  },
  request(siteId, resource, options = {}) {
    const descriptor = C.resource(siteId, resource, options);
    const session = options.session === true;
    const key = descriptor.url + ':' + session;
    if (!inflight.has(key)) {
      const request = (session ? sessionRequest(descriptor.url, descriptor.format) : requestText(descriptor.url)).then(result => validateResponse(result, descriptor.format));
      inflight.set(key, request);
      request.finally(() => inflight.delete(key)).catch(() => {});
    }
    return inflight.get(key);
  },
  async verify(siteId) {
    const site = C.SITES.find(site => site.id === siteId); if (!site) throw new Error('未知社区。');
    const browser = window.ztools?.zbrowser || window.ztools?.ubrowser;
    if (!browser) throw new Error('当前 ZTools 不支持连接验证，请更新宿主。');
    await browser.goto(site.url, undefined, 25000).run({ show: true, width: 1100, height: 800 });
    return true;
  },
  copy(text) { clipboard.writeText(String(text)); }
});
