'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const dns = require('node:dns').promises;
const net = require('node:net');
const run = promisify(execFile);
const ALLOWED = new Set(['www.v2ex.com', 'v2ex.com', 'linux.do', 'linux.sb', 'www.linux.sb']);
const LIMIT = 8 * 1024 * 1024;
let proxyCache;
function validateTarget(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('不支持的社区数据地址。');
  return url;
}
function parseProxy(value) {
  if (!value) return null;
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : 'http://' + value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP / HTTPS 代理。');
  return url;
}
async function systemProxy() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return parseProxy(process.env.HTTPS_PROXY || process.env.https_proxy);
  if (proxyCache && Date.now() - proxyCache.time < 30000) return proxyCache.value;
  let value = null;
  if (process.platform === 'win32') {
    const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { windowsHide: true, timeout: 4000 }).catch(() => ({ stdout: '' }));
    if (/AutoConfigURL\s+REG_\w+\s+\S+/i.test(stdout)) throw new Error('当前使用自动代理（PAC）。请点击“登录 / 验证”后使用宿主浏览器会话读取。');
    if (/ProxyEnable\s+REG_DWORD\s+0x0*1(?:\s|$)/i.test(stdout)) {
      const server = /ProxyServer\s+REG_\w+\s+([^\r\n]+)/i.exec(stdout)?.[1]?.trim() || '';
      const address = /(?:^|;)https=([^;]+)/i.exec(server)?.[1] || (!server.includes('=') ? server : '');
      if (address) value = parseProxy(address);
    }
  } else if (process.platform === 'darwin') {
    const { stdout } = await run('scutil', ['--proxy'], { timeout: 4000 }).catch(() => ({ stdout: '' }));
    if (/ProxyAutoConfigEnable\s*:\s*1/.test(stdout)) throw new Error('当前使用自动代理（PAC），请使用“登录 / 验证”的浏览器会话读取。');
    if (/HTTPSEnable\s*:\s*1/.test(stdout)) {
      const host = /HTTPSProxy\s*:\s*(\S+)/.exec(stdout)?.[1]; const port = /HTTPSPort\s*:\s*(\d+)/.exec(stdout)?.[1];
      if (host && port) value = parseProxy(host + ':' + port);
    }
  }
  proxyCache = { time: Date.now(), value }; return value;
}
class TunnelAgent extends https.Agent {
  constructor(proxy) { super({ keepAlive: false }); this.proxy = proxy; }
  createConnection(options, callback) {
    let done = false;
    const finish = (error, socket) => { if (!done) { done = true; callback(error, socket); } };
    const headers = { Host: `${options.host}:${options.port || 443}` };
    if (this.proxy.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(decodeURIComponent(this.proxy.username) + ':' + decodeURIComponent(this.proxy.password)).toString('base64');
    const connect = (this.proxy.protocol === 'https:' ? https : http).request(this.proxy, { method: 'CONNECT', path: headers.Host, headers });
    connect.setTimeout(12000, () => connect.destroy(new Error('代理连接超时。')));
    connect.once('error', error => finish(error));
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); finish(new Error(`代理连接失败（HTTP ${response.statusCode}）。`)); return; }
      if (head.length) socket.unshift(head);
      const secure = tls.connect({ socket, servername: options.host, ALPNProtocols: ['http/1.1'] });
      secure.setTimeout(15000, () => secure.destroy(new Error('社区连接超时。')));
      secure.once('error', error => finish(error)); secure.once('secureConnect', () => finish(null, secure));
    });
    connect.end();
  }
}
function decode(buffer, encoding, limit = LIMIT) {
  const options = { maxOutputLength: limit };
  if (encoding === 'gzip') return zlib.gunzipSync(buffer, options);
  if (encoding === 'br') return zlib.brotliDecompressSync(buffer, options);
  if (encoding === 'deflate') return zlib.inflateSync(buffer, options);
  return buffer;
}
async function requestData(input, redirects = 0, options = {}) {
  const url = await (options.validate || validateTarget)(input); const proxy = await systemProxy(); const agent = proxy ? new TunnelAgent(proxy) : undefined;
  return new Promise((resolve, reject) => {
    let timer;
    const request = https.get(url, { agent, headers: { Accept: options.accept || 'application/json,text/html;q=0.9', 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': 'CommunityHub/1.0.0 (+ZTools; community reader)' } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > (options.limit || LIMIT)) { request.destroy(new Error('返回内容过大，请在原站查看。')); return; } chunks.push(chunk); });
      response.once('error', reject);
      response.once('end', () => {
        clearTimeout(timer); agent?.destroy();
        try {
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            if (redirects >= 4 || !response.headers.location) throw new Error('站点跳转次数过多。');
            resolve(requestData(new URL(response.headers.location, url).href, redirects + 1, options)); return;
          }
          const body = decode(Buffer.concat(chunks), response.headers['content-encoding'], options.limit || LIMIT);
          if (body.length > (options.limit || LIMIT)) throw new Error('返回内容过大。');
          if (response.statusCode === 401 || response.statusCode === 403) throw new Error('站点要求登录或浏览器验证。请点击“登录 / 验证”，手动完成后重新刷新。');
          if (response.statusCode === 429) throw new Error('请求过于频繁，请稍后再刷新。');
          if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`社区暂时不可用（HTTP ${response.statusCode}）。`);
          resolve({ body, contentType: String(response.headers['content-type'] || ''), url: url.href });
        } catch (error) { reject(error); }
      });
    });
    timer = setTimeout(() => request.destroy(new Error('请求超时，请检查网络与系统代理后重试。')), 20000);
    request.once('error', error => { clearTimeout(timer); agent?.destroy(); reject(error); });
  });
}
async function requestText(input) { const result = await requestData(input); return { ...result, body: result.body.toString('utf8') }; }
async function requestAvatar(siteId, input) {
  const C = require('./reader-core.js');
  const validate = value => { const url = C.avatarUrl(siteId, value); if (!url) throw new Error('不支持的头像地址。'); return new URL(url); };
  const result = await requestData(input, 0, { validate, limit: 256 * 1024, accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif' });
  const mime = result.contentType.split(';')[0].toLowerCase();
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(mime)) throw new Error('头像不是支持的图片格式。');
  return `data:${mime};base64,${result.body.toString('base64')}`;
}
function publicAddress(address) {
  address = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (address.startsWith('::ffff:')) return publicAddress(address.slice(7));
  if (net.isIPv4(address)) { const [a,b] = address.split('.').map(Number); return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0,168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19].includes(b)); }
  if (net.isIPv6(address)) return !/^(?:::$|::1$|f[cd]|fe[89ab]|ff)/.test(address);
  return false;
}
function validateImageTarget(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('图片地址无效。');
  if (/^(?:localhost|.*\.(?:local|internal|localhost))$/i.test(url.hostname) || net.isIP(url.hostname.replace(/^\[|\]$/g,'')) && !publicAddress(url.hostname)) throw new Error('不加载本机或内网图片。');
  if (url.protocol === 'http:') { url.protocol = 'https:'; if (url.port === '80') url.port = ''; }
  return url;
}
async function requestImage(value) {
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 12 * 1024 * 1024) return value;
  const validate = async input => {
    const url = validateImageTarget(input); const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g,''), { all: true });
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('不加载内网图片。');
    return url;
  };
  const result = await requestData(value, 0, { validate, limit: 12 * 1024 * 1024, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' });
  const mime = result.contentType.split(';')[0].toLowerCase();
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(mime)) throw new Error('当前图片格式不支持，可查看原图。');
  return `data:${mime};base64,${result.body.toString('base64')}`;
}
module.exports = { requestText, requestAvatar, requestImage, validateTarget, validateImageTarget, publicAddress, parseProxy };
