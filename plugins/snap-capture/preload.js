'use strict';

/**
 * 轻影截图 · preload
 * 职责：把「只有 Node 才能做」的事收到一处 —— 写图、剪贴板、原生 OCR、在线翻译、子窗口通信。
 * 渲染层不碰 fs / 网络细节，只调用 window.zsnap.*
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const CHILD_CHANNEL = 'zsnap:child';

// ───────────────────────────── 基础工具 ─────────────────────────────

function safeRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

const electron = safeRequire('electron') || {};

function existingDir(dir) {
  try {
    return Boolean(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function dataUrlToBuffer(dataUrl) {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) throw new Error('不是合法的 data URL');
  return Buffer.from(text.slice(comma + 1), 'base64');
}

function isDataUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ''));
}

const EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp'
};

function writeImageFile(filePath, dataUrl) {
  const dir = path.dirname(filePath);
  if (!ensureDir(dir)) throw new Error('无法创建目录：' + dir);
  fs.writeFileSync(filePath, dataUrlToBuffer(dataUrl));
  return filePath;
}

// 同名文件自动加序号，避免覆盖用户已有截图
function uniquePath(dir, baseName, ext) {
  const safeBase = String(baseName || '截图').replace(/[\\/:*?"<>|]/g, '_');
  let candidate = path.join(dir, `${safeBase}.${ext}`);
  let index = 1;
  while (true) {
    try {
      fs.accessSync(candidate);
      candidate = path.join(dir, `${safeBase}(${index}).${ext}`);
      index += 1;
      if (index > 999) return path.join(dir, `${safeBase}-${Date.now()}.${ext}`);
    } catch {
      return candidate;
    }
  }
}

function readImageAsDataUrl(filePath) {
  const ext = String(path.extname(filePath || '')).replace('.', '').toLowerCase();
  const mime = EXT_MIME[ext] || 'image/png';
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ───────────────────────────── HTTP ─────────────────────────────

function httpRequest(method, url, options = {}) {
  const { query, json, form, headers = {}, timeoutMs = 15000 } = options;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error('请求地址无效：' + url));
      return;
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        target.searchParams.set(key, String(value));
      }
    }

    const client = target.protocol === 'http:' ? http : https;
    const payload = json !== undefined
      ? Buffer.from(JSON.stringify(json), 'utf8')
      : form !== undefined
        ? Buffer.from(
          Object.entries(form)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&'),
          'utf8'
        )
        : null;

    const requestHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    };
    if (payload) {
      requestHeaders['Content-Type'] = json !== undefined
        ? 'application/json'
        : 'application/x-www-form-urlencoded';
      requestHeaders['Content-Length'] = String(payload.length);
    }
    Object.assign(requestHeaders, headers);

    const request = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method,
      headers: requestHeaders
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let body = Buffer.concat(chunks);
        const encoding = String(response.headers['content-encoding'] || '');
        try {
          if (encoding.includes('gzip')) body = zlib.gunzipSync(body);
          else if (encoding.includes('deflate')) body = zlib.inflateSync(body);
          else if (encoding.includes('br')) body = zlib.brotliDecompressSync(body);
        } catch {
          // 解压失败时按原文处理
        }
        resolve({ status: response.statusCode || 0, body: body.toString('utf8') });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('请求超时'));
    });
    request.on('error', (error) => reject(error));
    if (payload) request.write(payload);
    request.end();
  });
}

// ───────────────────────────── 翻译 ─────────────────────────────

const LANG_MICROSOFT = {
  auto: 'auto',
  zh: 'zh-Hans',
  'zh-TW': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  nl: 'nl',
  tr: 'tr'
};

const LANG_GOOGLE = {
  auto: 'auto',
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  nl: 'nl',
  tr: 'tr'
};

const LANG_BAIDU = {
  auto: 'auto',
  zh: 'zh',
  'zh-TW': 'cht',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  de: 'de',
  es: 'spa',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ara',
  th: 'th',
  vi: 'vie',
  nl: 'nl',
  tr: 'tr'
};

function normalizeLang(code, table) {
  const key = String(code || 'auto').trim() || 'auto';
  return table[key] || table[key.toLowerCase()] || null;
}

// 长文本按行切块：一次 1600 字符上下，尽量不断行
function splitChunks(text, limit = 1600) {
  const source = String(text || '');
  if (source.length <= limit) return [source];
  const chunks = [];
  let current = '';
  for (const line of source.split('\n')) {
    if ((current + '\n' + line).length > limit && current) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateMicrosoft(text, from, to) {
  const target = normalizeLang(to, LANG_MICROSOFT) || 'zh-Hans';
  const source = normalizeLang(from, LANG_MICROSOFT);
  const query = { to: target, isEnterpriseClient: 'false' };
  if (source && source !== 'auto') query.from = source;
  const response = await httpRequest('POST', 'https://edge.microsoft.com/translate/translatetext', {
    query,
    json: [text],
    headers: {
      Accept: '*/*',
      Origin: 'https://edge.microsoft.com',
      Referer: 'https://edge.microsoft.com/'
    }
  });
  if (response.status !== 200) throw new Error('微软翻译 HTTP ' + response.status);
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error('微软翻译返回异常：' + response.body.slice(0, 160));
  }
  const out = data?.[0]?.translations?.[0]?.text;
  if (!out) throw new Error('微软翻译返回空结果');
  return out;
}

async function translateGoogle(text, from, to) {
  const target = normalizeLang(to, LANG_GOOGLE) || 'zh-CN';
  const source = normalizeLang(from, LANG_GOOGLE) || 'auto';
  const response = await httpRequest('POST', 'https://translate.googleapis.com/translate_a/t', {
    query: { client: 'gtx', dt: 't', sl: source, tl: target },
    form: { q: text }
  });
  if (response.status !== 200) throw new Error('谷歌翻译 HTTP ' + response.status);
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error('谷歌翻译返回异常：' + response.body.slice(0, 160));
  }
  if (!Array.isArray(data)) throw new Error('谷歌翻译返回异常');
  return data.map((item) => (Array.isArray(item) ? item[0] || '' : item)).join('');
}

function md5(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

async function translateBaidu(text, from, to, appId, appKey) {
  if (!appId || !appKey) throw new Error('百度翻译需要先填写 AppID 与密钥');
  const target = normalizeLang(to, LANG_BAIDU) || 'zh';
  const source = normalizeLang(from, LANG_BAIDU) || 'auto';
  const salt = String(Date.now());
  const sign = md5(appId + text + salt + appKey);
  const response = await httpRequest('POST', 'https://fanyi-api.baidu.com/api/trans/vip/translate', {
    form: { q: text, from: source, to: target, appid: appId, salt, sign }
  });
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error('百度翻译返回异常：' + response.body.slice(0, 160));
  }
  if (data.error_code) throw new Error('百度翻译错误 ' + data.error_code + '：' + (data.error_msg || ''));
  const out = (data.trans_result || []).map((item) => item.dst).join('\n');
  if (!out) throw new Error('百度翻译返回空结果');
  return out;
}

async function translate(options = {}) {
  const text = String(options.text || '');
  if (!text.trim()) return { text: '' };

  // ① 优先用 ZTools 已装配的翻译提供商（f-provider 的谷歌/微软/百度/有道/AI 翻译）
  try {
    const ztools = ZT();
    if (typeof ztools.translate === 'function') {
      const settingsId = String(readSettingsRaw().translationProviderId || '').trim();
      const wanted = options.providerId !== undefined ? String(options.providerId || '').trim() : settingsId;
      const provider = wanted ? { id: wanted, label: '' } : await defaultProvider('translation');
      if (provider) {
        const res = await ztools.translate(text, {
          from: options.from,
          to: options.to,
          providerId: wanted || undefined
        });
        const out = String((res && res.text) || '');
        if (out) {
          return { text: out, engine: 'provider', provider: providerLabel(provider) || wanted };
        }
      }
    }
  } catch (error) {
    diag(`translate provider 失败，回退内置端点：${(error && error.message) || error}`);
  }

  // ② 回退：内置的免密钥端点 / 百度 API
  const translator = options.translator || 'microsoft';
  const chunks = splitChunks(text);
  const results = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      results.push(chunk);
      continue;
    }
    let translated;
    if (translator === 'google') {
      translated = await translateGoogle(chunk, options.from, options.to);
    } else if (translator === 'baidu') {
      translated = await translateBaidu(chunk, options.from, options.to, options.appId, options.appKey);
    } else {
      translated = await translateMicrosoft(chunk, options.from, options.to);
    }
    results.push(translated);
  }
  return { text: results.join('\n'), engine: translator };
}

// ───────────────────────────── 微信 OCR ─────────────────────────────

// 探测所有可能藏着微信 OCR 引擎的目录。
// f-provider 把 native 下载到 userData（~/.ztools/f-provider/native），
// 其他插件也可能自带一份，所以除了固定位置还要扫一遍插件目录。
let ocrCandidateCache = null;

function ocrCandidateDirs(refresh = false) {
  if (ocrCandidateCache && !refresh) return ocrCandidateCache;
  const out = [];
  const push = (dir) => {
    if (!dir) return;
    let abs = '';
    try {
      abs = path.resolve(dir);
    } catch {
      return;
    }
    // 只收真实存在的目录：插件目录里是 .asar 文件，拼出来的 native 路径不存在
    try {
      if (!fs.statSync(abs).isDirectory()) return;
    } catch {
      return;
    }
    if (!out.some((item) => item.toLowerCase() === abs.toLowerCase())) out.push(abs);
  };

  push(path.join(os.homedir(), '.ztools', 'f-provider', 'native'));
  push(path.join(os.homedir(), '.utools', 'f-provider', 'native'));
  if (process.env.APPDATA) push(path.join(process.env.APPDATA, 'f-provider', 'native'));

  for (const root of [
    path.join(os.homedir(), '.ztools', 'plugins'),
    path.join(os.homedir(), '.utools', 'plugins')
  ]) {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/f-provider|wechat|ocr/i.test(name)) continue;
      const base = path.join(root, name);
      push(path.join(base, 'native'));
      push(path.join(base, 'public', 'native'));
    }
  }

  // 用户也可以把 native 直接放进插件目录
  push(path.join(__dirname, 'native'));
  ocrCandidateCache = out;
  return out;
}

function ocrBinary(dir) {
  const candidates = [
    path.join(dir, 'build', 'Release', 'wechat_ocr.node'),
    path.join(dir, 'build', 'Debug', 'wechat_ocr.node')
  ];
  return candidates.find((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }) || '';
}

function ocrReady(dir) {
  if (!existingDir(dir)) return false;
  if (!ocrBinary(dir)) return false;
  if (process.platform === 'win32') {
    return fs.existsSync(path.join(dir, 'wco_data', 'WeChatOCR.exe'));
  }
  return true;
}

function findOcrDir() {
  for (const dir of ocrCandidateDirs()) {
    if (ocrReady(dir)) return dir;
  }
  return '';
}

const ocrState = {
  dir: '',
  addon: null,
  error: '',
  queue: Promise.resolve()
};

function loadOcrAddon(dir) {
  if (ocrState.addon && ocrState.dir === dir) return ocrState.addon;
  if (ocrState.addon && ocrState.dir !== dir) {
    try {
      ocrState.addon.dispose?.();
    } catch {
      // 换引擎时尽力释放旧进程
    }
    ocrState.addon = null;
  }
  const entry = path.join(dir, 'index.js');
  const addon = require(entry);
  if (process.platform === 'win32') {
    addon.init(path.join(dir, 'wco_data'));
  }
  ocrState.dir = dir;
  ocrState.addon = addon;
  ocrState.error = '';
  return addon;
}

function materializeImage(image) {
  const value = String(image || '');
  if (!value) throw new Error('缺少图片');
  if (!isDataUrl(value)) {
    if (fs.existsSync(value)) return { filePath: value, temp: false };
    throw new Error('图片文件不存在');
  }
  const ext = (/^data:image\/([a-z0-9.+-]+);base64,/i.exec(value)?.[1] || 'png').replace('jpeg', 'jpg');
  const filePath = path.join(os.tmpdir(), `zsnap-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  fs.writeFileSync(filePath, dataUrlToBuffer(value));
  return { filePath, temp: true };
}

// ───────────────────────────── OCR / 翻译：优先用 ZTools 提供商 ─────────────────────────────
// ZTools 有官方的 providers 机制（f-provider 就是用它封装了微信 OCR / 谷歌 / 百度 / 有道 / 微软）。
// 装了就直接调，不重复带一份引擎、也不用去猜微信装在哪；没装才回退到本机微信引擎。

async function defaultProvider(type) {
  const ztools = ZT();
  if (!ztools.providers || typeof ztools.providers.getDefaultProvider !== 'function') return undefined;
  try {
    return await ztools.providers.getDefaultProvider(type);
  } catch {
    return undefined;
  }
}

function providerLabel(provider) {
  if (!provider) return '';
  return String(provider.label || provider.title || provider.name || provider.id || provider.key || '');
}

// 契约：{ text, blocks?: [{ text, left, top, right, bottom } | string], confidence? }
function linesFromProvider(res) {
  const blocks = Array.isArray(res && res.blocks) ? res.blocks : [];
  const out = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      if (block.trim()) out.push({ text: block, rate: 0, noBox: true });
      continue;
    }
    const text = String((block && block.text) || '');
    if (!text) continue;
    const has = ['left', 'top', 'right', 'bottom'].every((k) => Number.isFinite(Number(block[k])));
    if (has) {
      out.push({
        text,
        rate: Number(block.rate) || 0,
        left: Number(block.left),
        top: Number(block.top),
        right: Number(block.right),
        bottom: Number(block.bottom)
      });
    } else {
      out.push({ text, rate: 0, noBox: true });
    }
  }
  if (!out.length && res && res.text) {
    for (const line of String(res.text).split('\n')) {
      if (line.trim()) out.push({ text: line, rate: 0, noBox: true });
    }
  }
  return out;
}

async function ocrViaProvider(image) {
  const ztools = ZT();
  if (typeof ztools.ocr !== 'function') return null;
  const settings = readSettingsRaw();
  const wanted = String(settings.ocrProviderId || '').trim();
  const provider = wanted ? { id: wanted, label: '' } : await defaultProvider('ocr');
  if (!provider) return null;
  const res = await ztools.ocr(image, wanted ? { providerId: wanted } : undefined);
  const lines = linesFromProvider(res);
  return {
    text: String((res && res.text) || lines.map((line) => line.text).join('\n')),
    lines,
    engine: 'provider',
    provider: providerLabel(provider) || wanted
  };
}

async function runOcr(image, options = {}) {
  const dir = options.dir || findOcrDir();
  if (!dir) throw new Error('没找到微信 OCR 引擎，请在设置里指定 native 目录');
  if (!ocrReady(dir)) throw new Error('OCR 引擎文件不完整：' + dir);
  const addon = loadOcrAddon(dir);
  const { filePath, temp } = materializeImage(image);
  try {
    const result = process.platform === 'darwin' && typeof addon.ocrMacWevisionJson === 'function'
      ? JSON.parse(addon.ocrMacWevisionJson({
        imagePath: filePath,
        wxocrLib: path.join(dir, 'wechat-ocr-mac', 'lib', 'libwxocr.dylib'),
        resourcesDir: path.join(dir, 'wechat-ocr-mac', 'models')
      }))
      : await addon.ocr(filePath);
    if (result && result.ok === false) throw new Error(result.error || '微信 OCR 识别失败');
    const lines = (result?.lines || []).map((line) => ({
      text: String(line.text || ''),
      rate: Number(line.rate) || 0,
      left: Number(line.left) || 0,
      top: Number(line.top) || 0,
      right: Number(line.right) || 0,
      bottom: Number(line.bottom) || 0
    })).filter((line) => line.text);
    return {
      text: lines.map((line) => line.text).join('\n'),
      lines,
      engine: 'wechat'
    };
  } finally {
    if (temp) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // 临时文件清理失败不影响结果
      }
    }
  }
}

// 原生 OCR 是单进程回调，串行化避免并发调用互相打断
function ocr(image, options = {}) {
  const task = ocrState.queue.then(async () => {
    try {
      const viaProvider = await ocrViaProvider(image);
      if (viaProvider && viaProvider.lines.length) return viaProvider;
    } catch (error) {
      diag(`ocr provider 失败，回退本机微信引擎：${(error && error.message) || error}`);
    }
    return runOcr(image, options);
  });
  ocrState.queue = task.catch(() => {});
  return task;
}

// ───────────────────────────── 子窗口通信 ─────────────────────────────

function relayToRenderer(payload) {
  try {
    window.postMessage({ type: 'zsnap:child', payload }, '*');
  } catch {
    // 页面还未就绪时丢弃
  }
}

try {
  if (electron.ipcRenderer) {
    electron.ipcRenderer.on(CHILD_CHANNEL, (_event, payload) => relayToRenderer(payload));
  }
} catch {
  // 浏览器开发环境没有 IPC
}

// ───────────────────────────── 对外 API ─────────────────────────────

const bridge = {
  platform: process.platform,

  // 从 plugin.json 读版本，避免界面与清单写两处
  version: (() => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'plugin.json'), 'utf8'));
      return { name: meta.name || 'snap', title: meta.title || '轻影截图', version: meta.version || '', author: meta.author || '' };
    } catch {
      return { name: 'snap', title: '轻影截图', version: '', author: '' };
    }
  })(),

  paths() {
    let pictures = '';
    let desktop = '';
    try {
      pictures = (electron.app && electron.app.getPath('pictures')) || '';
      desktop = (electron.app && electron.app.getPath('desktop')) || '';
    } catch {
      // 部分宿主不暴露 app 模块
    }
    if (!pictures) pictures = path.join(os.homedir(), 'Pictures');
    if (!desktop) desktop = path.join(os.homedir(), 'Desktop');
    return {
      home: os.homedir(),
      pictures,
      desktop,
      temp: os.tmpdir()
    };
  },

  // 列出 ZTools 已装配的识别 / 翻译渠道（f-provider 装了就都在这里）
  async providerList() {
    const ztools = ZT();
    const supported = Boolean(ztools.providers && typeof ztools.providers.getProviders === 'function');
    const pick = (list) => (Array.isArray(list) ? list : []).map((item) => ({
      id: String(item.id || ''),
      label: String(item.label || item.id || ''),
      description: String(item.description || ''),
      isDefault: Boolean(item.isDefault)
    }));
    if (!supported) return { ok: true, supported: false, ocr: [], translation: [] };
    try {
      const [ocrList, transList] = await Promise.all([
        ztools.providers.getProviders('ocr'),
        ztools.providers.getProviders('translation')
      ]);
      return { ok: true, supported: true, ocr: pick(ocrList), translation: pick(transList) };
    } catch (error) {
      return { ok: false, supported: true, ocr: [], translation: [], error: String((error && error.message) || error) };
    }
  },

  ocrStatus(dir, refresh) {
    const dirs = ocrCandidateDirs(refresh === true);
    const candidates = dirs.map((item) => {
      const binary = ocrBinary(item);
      return {
        dir: item,
        ready: ocrReady(item),
        binary: binary || '',
        hasData: process.platform === 'win32' ? fs.existsSync(path.join(item, 'wco_data', 'WeChatOCR.exe')) : true
      };
    });
    const target = dir || findOcrDir();
    return {
      dir: target,
      ready: Boolean(target) && ocrReady(target),
      engine: target ? path.basename(path.dirname(target)) || 'wechat' : '',
      candidates
    };
  },

  findOcrDir,

  ocr,

  translate,

  // 实打实翻一句，用来在设置页验证通道是否连得通
  async testTranslate(options = {}) {
    const started = Date.now();
    try {
      const result = await translate({
        text: options.sample || '把截图这件小事做顺手',
        translator: options.translator,
        from: options.from || 'zh',
        to: options.to || 'en',
        appId: options.appId,
        appKey: options.appKey
      });
      return { ok: true, text: result.text, engine: result.engine, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error.message || String(error), ms: Date.now() - started };
    }
  },

  // 向 createBrowserWindow 创建的子窗口投递消息。
  // ZTools 的 WindowInstance 在渲染进程侧只是代理对象，webContents.send 未必真的
  // 能跨进程送达到子窗口渲染层；ipcRenderer.sendTo(webContentsId, ...) 才是
  // Electron 官方给 preload 用的定向投递方式（floating 插件即如此）。
  sendToChild(webContentsId, payload, channel) {
    const ch = channel || CHILD_CHANNEL;
    if (!electron.ipcRenderer || !webContentsId) return { ok: false, error: '缺少 id 或 ipcRenderer' };
    try {
      if (typeof electron.ipcRenderer.sendTo === 'function') {
        electron.ipcRenderer.sendTo(webContentsId, ch, payload);
        return { ok: true, via: 'sendTo' };
      }
    } catch (error) {
      return { ok: false, error: error.message || String(error), via: 'sendTo' };
    }
    return { ok: false, error: '当前 Electron 不支持 ipcRenderer.sendTo' };
  },

  writeImage(filePath, dataUrl) {
    try {
      writeImageFile(filePath, dataUrl);
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  saveImage(dir, baseName, dataUrl, ext = 'png') {
    try {
      if (!dir) throw new Error('未设置保存目录');
      if (!ensureDir(dir)) throw new Error('无法创建保存目录');
      const filePath = uniquePath(dir, baseName, ext);
      writeImageFile(filePath, dataUrl);
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  readImage(filePath) {
    try {
      return { ok: true, dataUrl: readImageAsDataUrl(filePath) };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  copyImage(dataUrl) {
    try {
      const { clipboard, nativeImage } = electron;
      if (!clipboard || !nativeImage) return { ok: false };
      const image = nativeImage.createFromDataURL(dataUrl);
      if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) return { ok: false };
      clipboard.writeImage(image);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  copyText(text) {
    try {
      const { clipboard } = electron;
      if (!clipboard) return { ok: false };
      clipboard.writeText(String(text || ''));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  dirname(filePath) {
    try {
      return path.dirname(String(filePath || ''));
    } catch {
      return '';
    }
  },

  join(...parts) {
    try {
      return path.join(...parts.map((part) => String(part || '')));
    } catch {
      return parts.join('/');
    }
  },

  exists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  },

  fileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// 截图与子窗口流程
// 协议参照 shortcut-capture / screenshot-annotate（两者在 ZTools 3.x 上实测可用）：
//   · 入口写在 window.exports，mode:'none' 时不渲染 main 页面
//   · 先 hideMainWindow(false) 再 screenCapture()，否则主窗口会被拍进画面
//   · 每次运行结束必须 outPlugin()，否则插件停在「前台隐藏运行」态，
//     第二次触发将彻底无效 —— 大谷截图"某天突然用不了"就是这么来的
// ═══════════════════════════════════════════════════════════════════

const ZT = () => window.ztools || {};
const SHOT_DIR = path.join(os.tmpdir(), 'snap-capture');

// ⚠ 子窗口的硬限制（已核对宿主源码 PluginLifecycleAPI.createBrowserWindow）：
// 宿主用 getPluginInfoByWebContents(event.sender) 鉴权，它只认「插件主视图」和
// 「分离窗口」，用 createBrowserWindow 建出来的子窗口不在名单里 → 一律返回
// "plugin not found"。同理 outPlugin / hideMainWindow 也拿不到插件身份。
// 所以 overlay / pin / result / board 想开新窗、想收尾，只能请父窗口代做。
function isChildWindow() {
  try {
    return /(?:overlay|pin|result|board)\.html$/i.test(String(window.location.pathname || ''));
  } catch {
    return false;
  }
}

function askParent(payload) {
  try {
    const ztools = ZT();
    if (typeof ztools.sendToParent === 'function') {
      ztools.sendToParent(PARENT_CHANNEL, payload);
      return true;
    }
  } catch {
    // 忽略
  }
  return false;
}

function endRun() {
  setTimeout(() => {
    try {
      const ztools = ZT();
      if (typeof ztools.outPlugin === 'function') ztools.outPlugin();
    } catch {
      // 忽略
    }
  }, 60);
}

function writeTempShot(dataUrl) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`);
    fs.writeFileSync(file, dataUrlToBuffer(dataUrl));
    return file;
  } catch (error) {
    console.warn('[snap] 写临时截图失败', error);
    return '';
  }
}

// 临时截图清理：写临时图是为了绕开大 dataUrl 走 IPC，但没人删就会一直堆
// （实测几天能堆到上百个、十几 MB）。只清 2 小时前的 —— 还在用的窗口
// 引用到的底图都是刚写的，不会被误删。
function cleanupTempShots() {
  try {
    if (!fs.existsSync(SHOT_DIR)) return 0;
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;
    let removed = 0;
    for (const name of fs.readdirSync(SHOT_DIR)) {
      if (!name.startsWith('shot-') || !name.endsWith('.png')) continue;
      const file = path.join(SHOT_DIR, name);
      try {
        if (now - fs.statSync(file).mtimeMs > maxAge) {
          fs.unlinkSync(file);
          removed += 1;
        }
      } catch {
        // 忽略
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

function primaryDisplay() {
  const ztools = ZT();
  try {
    const point = typeof ztools.getCursorScreenPoint === 'function'
      ? ztools.getCursorScreenPoint()
      : { x: 0, y: 0 };
    const display = typeof ztools.getDisplayNearestPoint === 'function'
      ? ztools.getDisplayNearestPoint(point)
      : (typeof ztools.getPrimaryDisplay === 'function' ? ztools.getPrimaryDisplay() : null);
    if (display && display.bounds) return display;
  } catch {
    // 忽略
  }
  return { id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
}

function imageSizeOf(dataUrl) {
  try {
    const image = electron.nativeImage.createFromDataURL(dataUrl);
    const size = image.getSize();
    if (size && size.width && size.height) return size;
  } catch {
    // 忽略
  }
  return { width: 360, height: 240 };
}

const CHILD_WEB_PREFERENCES = {
  nodeIntegration: true,
  webSecurity: false,
  backgroundThrottling: false,
  preload: path.join(__dirname, 'preload.js')
};

// 全屏框选层：铺满当前显示器
function openOverlay(shotPath, action) {
  const display = primaryDisplay();
  const b = display.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  const query = [
    'mode=screen',
    `shot=${encodeURIComponent(shotPath)}`,
    `action=${encodeURIComponent(action || 'edit')}`,
    `displayWidth=${b.width}`,
    `displayHeight=${b.height}`,
    `displayX=${b.x}`,
    `displayY=${b.y}`,
    `scaleFactor=${display.scaleFactor || 1}`
  ].join('&');

  let win = null;
  try {
    win = ZT().createBrowserWindow(`overlay.html?${query}`, {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      useContentSize: true,
      frame: false,
      transparent: false,
      backgroundColor: '#0b0d11',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: '轻影截图',
      webPreferences: CHILD_WEB_PREFERENCES
    }, () => {
      try {
        if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'screen-saver');
        if (typeof win.focus === 'function') win.focus();
        if (typeof win.moveTop === 'function') win.moveTop();
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.warn('[snap] 创建覆盖层失败', error);
  }
  return win;
}

// ─────────────────────────────────────────────────────────────────
// 选区编辑器：微信式「框完就出小窗」
//
// 宿主的 ztools.screenCapture(cb) 自带原生全屏框选 UI（Win 侧由
// ztools_native 的 startRegionCaptureWithPrimedFrame 实现，预抓帧后
// 在缓存帧上框选），回调第二参 bounds 就是用户框出的屏幕区域。
// 所以在它外面再套一层全屏覆盖层＝让用户框两次，纯属自找麻烦。
// 正确做法：拿 bounds 直接开一个和选区一样大的窗口，贴回原位。
// ─────────────────────────────────────────────────────────────────

const TOOLBAR_H = 54;
// 工具条实际宽度（7 个标注工具 + 5 个动作 + 收尾按钮），窄选区时窗口至少撑这么宽
// 工具条（10 个工具 + 颜色 + 撤销/复制/保存/贴图/OCR/翻译/关闭）在紧凑模式下宽约 644px，
// 窗口最小宽度必须装得下，否则工具条会被窗口边缘裁掉
const TOOLBAR_MIN_W = 710;
// 抄仓库一：窗口内容宽度额外用「高度 × 5」封顶，超宽条截图不会开出横跨整屏的窗口
const EDITOR_MAX_VISIBLE_ASPECT = 5;
// 图片之外留给工具条（54）与底部阴影的垂直空间，抄仓库一的 140
const EDITOR_CHROME_H = 140;

function sanitizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < 6 || height < 6) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

// 只读 PNG 头拿尺寸，避免为了量尺寸把整张图读进内存
function pngSizeOfFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    fs.closeSync(fd);
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }
  } catch {
    // 忽略
  }
  return { width: 0, height: 0 };
}

function openEditorWindow(shotPath, bounds, action, expectPx, targetWin) {
  const display = displayFor(bounds);
  const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1920, height: 1040 };
  const sf = scaleFactorOf(display);

  // 只有一条铁律：画布 = 图像像素 1:1，图片绝不被放大插值。
  // 所以窗口内容尺寸 = 图像像素 ÷ 这块屏的缩放比（向上取整，宁大不小）。
  // 这样 1 图像像素 正好落在 1 物理像素上，不管 100% 还是 125%、150%，都不会发虚。
  //
  // expectPx 是「马上要补进来的那张物理像素底图」的尺寸。窗口先开出来、图后到，
  // 尺寸必须按最终那张算，否则高清图一到窗口就得改大小 —— 那一下会闪。
  const want = expectPx && expectPx.width && expectPx.height ? expectPx : pngSizeOfFile(shotPath);
  let baseW = Math.max(1, want.width ? Math.ceil(want.width / sf) : Math.round(bounds.width));
  let baseH = Math.max(1, want.height ? Math.ceil(want.height / sf) : Math.round(bounds.height));

  // 抄仓库一：内容放不下就等比缩小（viewScale 永远 ≤ 1，绝不放大）。
  // 不这么做的话，选区比屏幕还高时窗口会顶出屏幕，底部被裁掉、工具条也点不到。
  // 余量按整块屏（含任务栏那条）算，跟仓库一一致；窗口位置再按工作区收，不压任务栏。
  // 宽度还额外用「高度 × 5」封顶：超宽条的截图不该开出一个横跨整屏的窗口。
  const screenBox = display.bounds || area;
  const availW = Math.max(240, Math.min(screenBox.width - 80, Math.max(TOOLBAR_MIN_W, baseH * EDITOR_MAX_VISIBLE_ASPECT)));
  const availH = Math.max(160, screenBox.height - EDITOR_CHROME_H);
  const viewScale = Math.min(1, availW / baseW, availH / baseH);
  if (viewScale < 1) {
    baseW = Math.max(1, Math.floor(baseW * viewScale));
    baseH = Math.max(1, Math.floor(baseH * viewScale));
  }

  // 宽度至少撑到工具条那么宽，否则工具条会被裁掉。
  // 多出来的部分做成透明，图片按 padLeft 偏移，图仍然盖在用户框出来的位置上。
  const winW = Math.max(baseW, TOOLBAR_MIN_W);
  const extra = winW - baseW;

  let x = viewScale < 1
    ? Math.round(bounds.x + (bounds.width - winW) / 2)
    : bounds.x - Math.round(extra / 2);
  if (x + winW > area.x + area.width) x = area.x + area.width - winW;
  if (x < area.x) x = area.x;
  const padLeft = Math.max(0, Math.min(extra, viewScale < 1
    ? Math.round(extra / 2)
    : bounds.x - x));

  let winH = baseH + TOOLBAR_H;
  let side = 'bottom';
  let y = viewScale < 1
    ? Math.round(bounds.y + (bounds.height - winH) / 2)
    : bounds.y;

  // 选区贴近屏幕底部时，工具条改到上方，整个窗口上移
  if (y + winH > area.y + area.height) {
    if (viewScale >= 1 && bounds.y - TOOLBAR_H >= area.y) {
      side = 'top';
      y = bounds.y - TOOLBAR_H;
    } else {
      y = Math.max(area.y, area.y + area.height - winH);
    }
  }
  if (y < area.y) y = area.y;

  const query = [
    'mode=window',
    `shot=${encodeURIComponent(shotPath)}`,
    `action=${encodeURIComponent(action || 'edit')}`,
    `toolbarSide=${side}`,
    `padLeft=${Math.round(padLeft)}`,
    `areaWidth=${baseW}`,
    `areaHeight=${baseH}`,
    `scaleFactor=${sf}`
  ].join('&');

  const editorUrl = `overlay.html?${query}`;
  // 原地变身：把传进来的浮窗直接导航成编辑器，全程只有一扇窗（无双窗口）
  if (targetWin && typeof targetWin.loadURL === 'function') {
    editor.win = targetWin;
    editor.bounds = { x, y, width: winW, height: winH };
    try {
      targetWin.loadURL(editorUrl);
      diag('编辑器原地挂载到已有浮窗窗口（来自浮窗内编辑）');
    } catch (error) {
      console.warn('[snap] 原地导航编辑器失败', error);
    }
    return targetWin;
  }

  let win = null;
  try {
    win = ZT().createBrowserWindow(editorUrl, {
      x,
      y,
      width: winW,
      height: winH,
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: true,
      title: '轻影截图',
      webPreferences: CHILD_WEB_PREFERENCES
    }, () => {
      try {
        if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'screen-saver');
        if (typeof win.focus === 'function') win.focus();
        if (typeof win.moveTop === 'function') win.moveTop();
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.warn('[snap] 创建选区编辑器失败', error);
  }
  editor.win = win;
  editor.bounds = { x, y, width: winW, height: winH };
  return win;
}

// 选区编辑器（微信式小窗）也归父窗口管：拖动它需要 setBounds，
// 而子窗口自己拿不到窗口身份，只能发消息回来。
const editor = { win: null, wc: 0, bounds: null, pendingShot: '' };

// 把更清晰的那张底图递给编辑器：窗口早就在屏幕上了，这里只换图，尺寸不动。
// 子窗口可能还没报到，先存着，等它 ready 再补发。
function pushEditorShot(dataUrl) {
  if (!dataUrl) return false;
  if (!editor.wc) {
    editor.pendingShot = dataUrl;
    return false;
  }
  try {
    electron.ipcRenderer.sendTo(editor.wc, CHILD_CHANNEL, { event: 'shotUpgrade', dataUrl });
    return true;
  } catch (error) {
    console.warn('[snap] 递送高清底图失败', error);
    return false;
  }
}

function flushEditorShot() {
  const shot = editor.pendingShot;
  if (!shot) return;
  editor.pendingShot = '';
  pushEditorShot(shot);
}

// 子窗 wcId → 我们创建过的窗口实例
function windowOfWc(wcId) {
  const all = [editor.win, board.win, resultWindow].concat(Array.from(PINS.values()).map((entry) => entry.win));
  for (const win of all) {
    if (!win) continue;
    try {
      const id = win.webContents && win.webContents.id;
      if (Number(id) === Number(wcId)) return win;
    } catch {
      // 窗口已销毁
    }
  }
  return null;
}

function moveWindowTo(wcId, x, y) {
  const win = windowOfWc(wcId);
  if (!win) return;
  try {
    const now = win.getBounds();
    const next = {
      x: Math.round(Number(x)),
      y: Math.round(Number(y)),
      width: now.width,
      height: now.height
    };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return;
    win.setBounds(next);
    if (editor.win === win) editor.bounds = next;
    for (const entry of PINS.values()) {
      if (entry.win === win) entry.bounds = { ...entry.bounds, x: next.x, y: next.y };
    }
  } catch (error) {
    console.warn('[snap] 移动窗口失败', error);
  }
}

// 悬浮图钉窗
function openPinWindow(dataUrl, bounds) {
  if (!dataUrl) return null;
  const shotPath = writeTempShot(dataUrl);
  const display = bounds ? displayFor(bounds) : primaryDisplay();
  const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1920, height: 1040 };
  const size = imageSizeOf(dataUrl);

  let width = Math.max(40, Math.round(bounds?.width || size.width || 360));
  let height = Math.max(40, Math.round(bounds?.height || size.height || 240));
  const maxW = area.width * 0.8;
  const maxH = area.height * 0.8;
  if (width > maxW) {
    height = Math.round(height * (maxW / width));
    width = Math.round(maxW);
  }
  if (height > maxH) {
    width = Math.round(width * (maxH / height));
    height = Math.round(maxH);
  }

  const x = Math.round(
    Math.min(
      Math.max(bounds?.x ?? area.x + area.width - width - 48, area.x),
      area.x + area.width - width
    )
  );
  const y = Math.round(
    Math.min(Math.max(bounds?.y ?? area.y + 72, area.y), area.y + area.height - height)
  );

  const pinId = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const url = `pin.html?pinId=${pinId}&shot=${encodeURIComponent(shotPath)}`;

  let win = null;
  try {
    win = ZT().createBrowserWindow(url, {
      x,
      y,
      width,
      height,
      useContentSize: true,
      frame: false,
      transparent: false,
      backgroundColor: '#0b0d11',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: true,
      title: '悬浮图片',
      webPreferences: CHILD_WEB_PREFERENCES
    }, () => {
      try {
        if (typeof win.show === 'function') win.show();
        if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'floating');
        if (typeof win.focus === 'function') win.focus();
        if (typeof win.moveTop === 'function') win.moveTop();
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.warn('[snap] 创建悬浮窗失败', error);
  }

  if (win) {
    registerPin({
      id: pinId,
      win,
      wc: 0,
      path: shotPath,
      dataUrl,
      bounds: { x, y, width, height },
      base: { width: size.width || width, height: size.height || height },
      zoom: width / Math.max(1, size.width || width),
      opacity: 1,
      hidden: false,
      othersHidden: false,
      cropped: false,
      createdAt: Date.now()
    });
  }
  return win;
}

// ───────────────────────────── 贴图管家 ─────────────────────────────
// 前提（已核对宿主源码）：outPlugin() 只做「收起视图 + 回到搜索框」，
// 只有 outPlugin(true) 才会 killPlugin。所以贴图存在期间这个 preload 一直活着，
// 可以当所有悬浮窗的中枢 —— 拖动、缩放、裁剪、摇一摇、批量收放都由它分发。
//
// 通道走向（宿主实现）：
//   子窗 ztools.sendToParent('zsnap:parent', msg)
//     → 主进程 pluginWindowManager.sendToParent 转发给父 webContents
//     → 宿主 preload 收到 __ipc_sendto_relay__ 后 ipcRenderer.emit('zsnap:parent', {senderId}, msg)
//   所以这里 on('zsnap:parent') 的第二参带的就是子窗 webContents id，回信直接 sendTo。
//   之前的版本没人监听这个频道，pin 窗的拖动/关闭全是石沉大海。

const PINS = new Map();
const PARENT_CHANNEL = 'zsnap:parent';
const board = { win: null, wc: 0 };
let resultWindow = null;

function registerPin(entry) {
  PINS.set(entry.id, entry);
  syncBoard();
}

function pinList() {
  return Array.from(PINS.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry, index) => ({
      id: entry.id,
      index,
      path: entry.path,
      width: entry.base.width,
      height: entry.base.height,
      x: entry.bounds.x,
      y: entry.bounds.y,
      w: entry.bounds.width,
      h: entry.bounds.height,
      opacity: entry.opacity,
      hidden: entry.hidden,
      cropped: entry.cropped
    }));
}

function sendToPin(entry, payload) {
  if (!entry || !entry.wc || !electron.ipcRenderer) return false;
  try {
    electron.ipcRenderer.sendTo(entry.wc, CHILD_CHANNEL, payload);
    return true;
  } catch (error) {
    console.warn('[snap] 向悬浮窗发送失败', error);
    return false;
  }
}

function applyPinBounds(entry, bounds) {
  const next = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(24, Math.round(bounds.width)),
    height: Math.max(24, Math.round(bounds.height))
  };
  entry.bounds = next;
  try {
    const win = entry.win;
    if (typeof win.setBounds === 'function') win.setBounds(next);
    else {
      win.setPosition?.(next.x, next.y);
      win.setContentSize?.(next.width, next.height);
    }
  } catch (error) {
    console.warn('[snap] 调整悬浮窗失败', error);
  }
  syncBoard();
}

function closePin(entry) {
  if (!entry || !PINS.has(entry.id)) return;
  PINS.delete(entry.id);
  try {
    entry.win?.close?.();
  } catch {
    // 忽略
  }
  // 它曾把别的贴图藏起来 → 关闭时得还回去，不然那些图就"消失"了
  const wasHiding = entry.othersHidden;
  if (wasHiding) showAllPins();
  syncBoard();
  diag(`pin close ${entry.id} hiddenOthers=${wasHiding} left=${PINS.size}`);
}

function closeAllPins() {
  for (const entry of Array.from(PINS.values())) closePin(entry);
}

function hideOtherPins(exceptId) {
  let count = 0;
  for (const entry of PINS.values()) {
    if (entry.id === exceptId || entry.hidden) continue;
    try {
      entry.win?.hide?.();
      entry.hidden = true;
      count += 1;
    } catch {
      // 忽略
    }
  }
  syncBoard();
  return count;
}

function showAllPins() {
  let count = 0;
  for (const entry of PINS.values()) {
    try {
      entry.win?.show?.();
      entry.hidden = false;
      count += 1;
    } catch {
      // 忽略
    }
    entry.othersHidden = false;
  }
  syncBoard();
  return count;
}

function toggleOtherPins(entry) {
  if (!entry) return { hidden: false, count: 0 };
  if (entry.othersHidden) {
    showAllPins();
    return { hidden: false, count: Math.max(0, PINS.size - 1) };
  }
  const count = hideOtherPins(entry.id);
  entry.othersHidden = count > 0;
  return { hidden: entry.othersHidden, count };
}

// 贴图板 / 历史面板（同一个窗口，两个标签页）
function openBoard(tab) {
  const want = tab === 'history' ? 'history' : 'pins';
  if (board.win) {
    let alive = true;
    try {
      if (typeof board.win.isDestroyed === 'function') alive = !board.win.isDestroyed();
    } catch {
      alive = false;
    }
    if (alive) {
      try {
        board.win.show?.();
        board.win.focus?.();
        board.win.moveTop?.();
        if (board.wc) electron.ipcRenderer.sendTo(board.wc, CHILD_CHANNEL, { event: 'boardTab', tab: want });
      } catch {
        // 忽略
      }
      return board.win;
    }
    board.win = null;
    board.wc = 0;
  }

  const display = primaryDisplay();
  const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1920, height: 1040 };
  const width = Math.min(1000, Math.round(area.width * 0.68));
  const height = Math.min(740, Math.round(area.height * 0.82));
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);

  let win = null;
  try {
    win = ZT().createBrowserWindow(`board.html?tab=${want}`, {
      x,
      y,
      width,
      height,
      frame: false,
      transparent: false,
      backgroundColor: '#14161a',
      resizable: true,
      minimizable: true,
      maximizable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      hasShadow: true,
      title: '轻影 · 贴图板',
      webPreferences: CHILD_WEB_PREFERENCES
    }, () => {
      try {
        win.show?.();
        win.focus?.();
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.warn('[snap] 创建贴图板失败', error);
  }
  board.win = win;
  board.wc = 0;
  return win;
}

function syncBoard() {
  if (!board.wc || !electron.ipcRenderer) return;
  try {
    electron.ipcRenderer.sendTo(board.wc, CHILD_CHANNEL, { event: 'pinsChanged', pins: pinList() });
  } catch {
    // 忽略
  }
}

// 宿主 forward 过来的子窗消息都从这里进
function handleChildMessage(wcId, payload) {
  if (!payload || typeof payload !== 'object') return;
  const kind = payload.event;

  // 子窗口上报的诊断信息（实机上排查问题时唯一能看到的东西）
  if (kind === 'diag') {
    diag(String(payload.message || ''));
    return;
  }

  // ── 子窗口代办的请求（子窗口自己没有插件身份）──
  if (kind === 'openPin') {
    if (payload.dataUrl) openPinWindow(payload.dataUrl, payload.bounds);
    return;
  }
  if (kind === 'openResult') {
    if (!payload.dataUrl) return;
    // 原地接管：把这扇窗直接导航成结果窗，省掉一个渲染进程。
    // Electron 每个插件窗口都是一个独立渲染进程（基线 130~200MB），
    // 「开新窗 + 关旧窗」那一瞬间会同时占两个，峰值直接翻倍。
    const win = windowOfWc(wcId);
    const shotPath = writeTempShot(payload.dataUrl);
    if (win && shotPath && typeof win.loadURL === 'function') {
      if (resultWindow && resultWindow !== win) {
        try { resultWindow.close?.(); } catch { /* ignore */ }
      }
      resultWindow = win;
      const display = primaryDisplay();
      const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1920, height: 1040 };
      const width = Math.min(1080, Math.round(area.width * 0.66));
      const height = Math.min(800, Math.round(area.height * 0.8));
      const rk = payload.mode === 'translate' ? 'translate' : 'ocr';
      try {
        win.setBounds({
          x: Math.round(area.x + (area.width - width) / 2),
          y: Math.round(area.y + (area.height - height) / 2),
          width,
          height
        });
      } catch { /* ignore */ }
      // 编辑器窗口是「置顶 + 不上任务栏」，结果窗应该像普通面板那样能切到
      try {
        win.setAlwaysOnTop?.(false);
        win.setSkipTaskbar?.(false);
      } catch { /* ignore */ }
      win.loadURL(`result.html?mode=${rk}&shot=${encodeURIComponent(shotPath)}`);
      diag('结果窗原地接管当前窗口（省一个渲染进程）');
      return;
    }
    openResultWindow(payload.dataUrl, payload.mode);
    return;
  }
  if (kind === 'openBoard') {
    openBoard(payload.tab);
    return;
  }
  if (kind === 'openEditor') {
    if (payload.dataUrl) openOverlay(writeTempShot(payload.dataUrl), 'edit');
    return;
  }
  if (kind === 'moveWindow') {
    moveWindowTo(wcId, payload.x, payload.y);
    return;
  }
  // 渲染层报上来的 dpr 和宿主给的 scaleFactor 对不上时，按实际 dpr 重设窗口，
  // 保证「1 图像像素 = 1 物理像素」，从根上消掉 DPI 放大导致的模糊
  if (kind === 'resizeEditor') {
    const win = windowOfWc(wcId);
    const width = Math.round(Number(payload.width) || 0);
    const height = Math.round(Number(payload.height) || 0);
    if (!win || width < 120 || height < 120) return;
    try {
      const now = win.getBounds();
      win.setBounds({ x: now.x, y: now.y, width, height });
      diag(`resizeEditor → ${width}x${height} (dpr=${payload.dpr})`);
    } catch (error) {
      diag(`resizeEditor 失败 ${(error && error.message) || error}`);
    }
    return;
  }
  if (kind === 'ready') {
    const win = windowOfWc(wcId);
    if (win && win === editor.win && Number(editor.wc) !== Number(wcId)) {
      editor.wc = wcId;
      flushEditorShot();
    }
    return;
  }

  if (kind === 'editorReady') {
    editor.wc = wcId;
    flushEditorShot();
    return;
  }
  if (kind === 'finish') {
    try {
      ZT().outPlugin?.(Boolean(payload.force));
    } catch {
      // 忽略
    }
    return;
  }

  if (kind === 'boardReady') {
    board.wc = wcId;
    syncBoard();
    return;
  }

  if (kind === 'resultReady' || kind === 'resultClosed') {
    if (kind === 'resultClosed') {
      try {
        resultWindow?.close?.();
      } catch {
        // 忽略
      }
      resultWindow = null;
    }
    return;
  }

  const entry = PINS.get(payload.pinId);
  if (!entry) return;

  if (kind === 'pinReady') {
    entry.wc = wcId;
    sendToPin(entry, { event: 'pinInfo', index: pinList().find((item) => item.id === entry.id)?.index ?? 0, count: PINS.size });
    syncBoard();
    return;
  }

  if (kind === 'pinMove') {
    applyPinBounds(entry, { ...entry.bounds, x: Number(payload.x), y: Number(payload.y) });
    return;
  }

  if (kind === 'pinZoom') {
    const factor = Number(payload.factor) || 1;
    const zoom = Math.min(4, Math.max(0.08, entry.zoom * factor));
    const width = Math.max(40, Math.round(entry.base.width * zoom));
    const height = Math.max(40, Math.round(entry.base.height * zoom));
    const cx = entry.bounds.x + entry.bounds.width / 2;
    const cy = entry.bounds.y + entry.bounds.height / 2;
    entry.zoom = zoom;
    applyPinBounds(entry, { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height });
    return;
  }

  if (kind === 'pinOpacity') {
    const next = Math.min(1, Math.max(0.15, entry.opacity + (Number(payload.delta) || 0)));
    entry.opacity = next;
    try {
      entry.win?.setOpacity?.(next);
    } catch {
      // 忽略
    }
    syncBoard();
    return;
  }

  if (kind === 'pinCrop') {
    const rect = payload.rect || {};
    const size = imageSizeOf(payload.dataUrl || '');
    if (!size.width || !size.height) return;
    const nextPath = writeTempShot(payload.dataUrl);
    if (nextPath) {
      // 旧临时图留着只会在 %TEMP% 里堆垃圾，顺手删掉
      try {
        if (entry.path && entry.path !== nextPath && String(entry.path).startsWith(SHOT_DIR)) fs.unlinkSync(entry.path);
      } catch {
        // 忽略
      }
      entry.path = nextPath;
    }
    entry.dataUrl = payload.dataUrl;
    entry.base = { width: size.width, height: size.height };
    entry.cropped = true;
    const width = Math.max(16, Math.round(Number(rect.width) || size.width));
    const height = Math.max(16, Math.round(Number(rect.height) || size.height));
    applyPinBounds(entry, {
      x: entry.bounds.x + (Number(rect.x) || 0),
      y: entry.bounds.y + (Number(rect.y) || 0),
      width,
      height
    });
    entry.zoom = width / entry.base.width;
    sendToPin(entry, { event: 'cropped', ok: true });
    rememberShot(payload.dataUrl, 'crop');
    diag(`pin crop ${entry.id} → ${size.width}x${size.height}`);
    return;
  }

  if (kind === 'pinShake') {
    const result = toggleOtherPins(entry);
    sendToPin(entry, { event: 'othersToggled', hidden: result.hidden, count: result.count });
    return;
  }

  // 贴图上接着做事：编辑标注 / 抠字 / 翻译。子窗口没有开窗权限，一律由父窗口代开。
  if (kind === 'pinEdit' || kind === 'pinOcr' || kind === 'pinTranslate') {
    const url = payload.dataUrl || entry.dataUrl || '';
    if (!url) return;
    if (kind === 'pinEdit') {
      // 直接在原来的浮窗上编辑：原地把它导航成编辑器，全程只有一扇窗，绝不双开。
      // 编辑完点「悬浮到屏幕」时，编辑器会开新浮窗并关掉自己 —— 依旧只有一个窗口。
      const path = writeTempShot(url);
      if (path) {
        const b = entry.bounds || null;
        const win = entry.win;
        PINS.delete(entry.id); // 先注销，不再被当成「浮窗」
        if (win && typeof win.loadURL === 'function') {
          openEditorWindow(path, b || undefined, 'edit', null, win);
          diag(`pin ${entry.id} 原地进入编辑`);
        } else {
          // 兜底：关掉浮窗再开编辑器，保证不会出现两扇窗
          try { win?.hide?.(); } catch { /* ignore */ }
          try { win?.close?.(); } catch { /* ignore */ }
          openEditorWindow(path, b || undefined, 'edit');
        }
      }
    } else {
      openResultWindow(url, kind === 'pinOcr' ? 'ocr' : 'translate');
    }
    return;
  }

  // 旋转 / 翻转：图换了，窗口按新比例跟着变，保持中心不动
  if (kind === 'pinReplace') {
    const size = imageSizeOf(payload.dataUrl || '');
    if (!size.width || !size.height) return;
    const nextPath = writeTempShot(payload.dataUrl);
    if (nextPath) {
      try {
        if (entry.path && entry.path !== nextPath && String(entry.path).startsWith(SHOT_DIR)) fs.unlinkSync(entry.path);
      } catch {
        // 忽略
      }
      entry.path = nextPath;
    }
    entry.dataUrl = payload.dataUrl;
    entry.base = { width: size.width, height: size.height };
    const zoom = entry.zoom || 1;
    const width = Math.max(40, Math.round(size.width * zoom));
    const height = Math.max(40, Math.round(size.height * zoom));
    const cx = entry.bounds.x + entry.bounds.width / 2;
    const cy = entry.bounds.y + entry.bounds.height / 2;
    applyPinBounds(entry, {
      x: Math.round(cx - width / 2),
      y: Math.round(cy - height / 2),
      width,
      height
    });
    sendToPin(entry, { event: 'replaced', ok: true });
    diag(`pin replace ${entry.id} → ${size.width}x${size.height}`);
    return;
  }

  if (kind === 'pinClose') {
    closePin(entry);
    return;
  }

  if (kind === 'pinCloseAll') {
    closeAllPins();
    return;
  }

  if (kind === 'pinShowAll') {
    showAllPins();
    return;
  }

  if (kind === 'pinBoard') {
    openBoard(payload.tab);
    return;
  }

  if (kind === 'pinHistory') {
    openBoard('history');
  }
}

try {
  if (electron.ipcRenderer) {
    electron.ipcRenderer.on(PARENT_CHANNEL, (event, payload) => {
      try {
        handleChildMessage(event && event.senderId, payload);
      } catch (error) {
        console.warn('[snap] 处理子窗消息失败', error);
      }
    });
  }
} catch {
  // 浏览器开发环境没有 IPC
}

// ───────────────────────────── 截图历史 ─────────────────────────────
// 只在本机落盘：%LOCALAPPDATA%/snap-capture/history。索引是 index.json，
// 超出上限自动删老文件；索引之外的孤儿文件在下次写入时清掉。

// 上限由用户在设置里自己定，这里只兜底与夹紧
const HISTORY_LIMIT_FALLBACK = 100;
const HISTORY_LIMIT_MIN = 10;
const HISTORY_LIMIT_MAX = 2000;

function normalizeLimit(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return HISTORY_LIMIT_FALLBACK;
  return Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(raw)));
}

function historyLimit() {
  return normalizeLimit(readSettingsRaw().historyLimit);
}

function writeSettingsRaw(patch) {
  const next = { ...readSettingsRaw(), ...patch };
  try {
    const ztools = ZT();
    if (ztools.dbStorage && typeof ztools.dbStorage.setItem === 'function') {
      ztools.dbStorage.setItem('snap.settings', next);
    }
  } catch {
    // 忽略
  }
  return next;
}

function historyDir() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), '.local');
  return path.join(base, 'snap-capture', 'history');
}

function historyIndexPath() {
  return path.join(historyDir(), 'index.json');
}

function readSettingsRaw() {
  try {
    const ztools = ZT();
    if (ztools.dbStorage && typeof ztools.dbStorage.getItem === 'function') {
      const value = ztools.dbStorage.getItem('snap.settings');
      if (value && typeof value === 'object') return value;
      if (typeof value === 'string') return JSON.parse(value);
    }
  } catch {
    // 忽略
  }
  return {};
}

function readHistoryIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(historyIndexPath(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistoryIndex(list, limit) {
  try {
    ensureDir(historyDir());
    const cap = normalizeLimit(limit || historyLimit());
    fs.writeFileSync(historyIndexPath(), JSON.stringify(list.slice(0, cap)));
  } catch (error) {
    console.warn('[snap] 写历史索引失败', error);
  }
}

function stampName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const clock = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${day}-${clock}-${Math.random().toString(36).slice(2, 6)}`;
}

function pruneOrphans(keepFiles) {
  try {
    const keep = new Set(keepFiles);
    for (const name of fs.readdirSync(historyDir())) {
      if (name === 'index.json' || keep.has(name)) continue;
      try {
        fs.unlinkSync(path.join(historyDir(), name));
      } catch {
        // 被占用就下次再说
      }
    }
  } catch {
    // 目录还不存在
  }
}

function rememberShot(dataUrl, source) {
  try {
    if (!isDataUrl(dataUrl)) return '';
    const settings = readSettingsRaw();
    if (settings.historyEnabled === false) return '';
    const limit = normalizeLimit(settings.historyLimit);
    const size = imageSizeOf(dataUrl);
    const file = path.join(historyDir(), `${stampName()}.png`);
    writeImageFile(file, dataUrl);
    const list = readHistoryIndex();
    list.unshift({
      file: path.basename(file),
      ts: Date.now(),
      w: size.width,
      h: size.height,
      source: String(source || 'capture')
    });
    writeHistoryIndex(list, limit);
    (list.slice(limit) || []).forEach((item) => {
      try {
        fs.unlinkSync(path.join(historyDir(), item.file));
      } catch {
        // 忽略
      }
    });
    pruneOrphans(list.slice(0, limit).map((item) => item.file));
    return file;
  } catch (error) {
    console.warn('[snap] 记录历史失败', error);
    return '';
  }
}

// OCR / 翻译结果窗
function openResultWindow(dataUrl, mode) {
  if (!dataUrl) return null;
  if (resultWindow) {
    try {
      resultWindow.close?.();
    } catch {
      // 忽略
    }
    resultWindow = null;
  }
  const shotPath = writeTempShot(dataUrl);
  const display = primaryDisplay();
  const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1920, height: 1040 };
  const width = Math.min(1080, Math.round(area.width * 0.66));
  const height = Math.min(800, Math.round(area.height * 0.8));
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  const kind = mode === 'translate' ? 'translate' : 'ocr';
  const url = `result.html?mode=${kind}&shot=${encodeURIComponent(shotPath)}`;

  let win = null;
  try {
    win = ZT().createBrowserWindow(url, {
      x,
      y,
      width,
      height,
      frame: false,
      transparent: false,
      backgroundColor: '#14161a',
      resizable: true,
      minimizable: false,
      maximizable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      hasShadow: true,
      title: kind === 'translate' ? '图片翻译' : '文字识别',
      webPreferences: CHILD_WEB_PREFERENCES
    }, () => {
      try {
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();
      } catch {
        // 忽略
      }
    });
  } catch (error) {
    console.warn('[snap] 创建结果窗失败', error);
  }
  resultWindow = win;
  return win;
}

// 从 action（img / files / 字符串）里取出图片并转成 dataUrl
function firstImageFrom(action) {
  const extMime = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp',
    gif: 'image/gif'
  };

  function fileToDataUrl(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return '';
      const ext = String(path.extname(filePath)).replace('.', '').toLowerCase();
      const mime = extMime[ext] || 'image/png';
      return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    } catch {
      return '';
    }
  }

  function pick(value, depth = 0) {
    if (depth > 4 || value == null) return '';
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) return value;
      return fileToDataUrl(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = pick(item, depth + 1);
        if (hit) return hit;
      }
      return '';
    }
    if (typeof value === 'object') {
      const candidates = [value.payload, value.path, value.filePath, value.img, value.image, value.src, value.url, value.data];
      for (const item of candidates) {
        const hit = pick(item, depth + 1);
        if (hit) return hit;
      }
    }
    return '';
  }

  return pick(action);
}

function diag(line) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.appendFileSync(path.join(SHOT_DIR, 'diag.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // 忽略
  }
}

// 宿主原生框选同一时刻只允许一个会话，重复触发会抛
// "Screenshot already in progress"，这里先自己挡一道
let capturing = false;

// 多显示器：按「选区矩形落在哪块屏上」来挑，而不是只看光标/主屏。
// 之前只问光标最近的屏，选区在副屏时会拿错屏整屏图，裁出来要么错位要么被截断。
function displayFor(rect) {
  const ztools = ZT();
  let all = null;
  try {
    if (typeof ztools.getAllDisplays === 'function') all = ztools.getAllDisplays();
  } catch {
    all = null;
  }
  if (Array.isArray(all) && all.length && rect) {
    let best = null;
    let bestHit = 0;
    for (const d of all) {
      const b = d && d.bounds;
      if (!b || !b.width || !b.height) continue;
      const ox = Math.min(rect.x + rect.width, b.x + b.width) - Math.max(rect.x, b.x);
      const oy = Math.min(rect.y + rect.height, b.y + b.height) - Math.max(rect.y, b.y);
      if (ox <= 0 || oy <= 0) continue;
      const hit = ox * oy;
      if (hit > bestHit) {
        bestHit = hit;
        best = d;
      }
    }
    if (best) return best;
  }
  return primaryDisplay();
}

// 缩放比兜底链，照抄 shortcut-capture（它实践过，够稳）：
// 宿主报的 scaleFactor 有时就是 1，那就拿「物理尺寸 ÷ 逻辑尺寸」反推，再不行用 dpr。
function scaleFactorOf(display) {
  const explicit = Number(display && display.scaleFactor);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;

  const bounds = display && display.bounds;
  const size = display && display.size;
  if (bounds && size && bounds.width > 0 && bounds.height > 0) {
    const inferred = Math.max(Number(size.width) / Number(bounds.width), Number(size.height) / Number(bounds.height));
    if (Number.isFinite(inferred) && inferred > 1) return inferred;
  }

  const device = Number(typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  if (Number.isFinite(device) && device > 1) return device;

  return Number.isFinite(explicit) && explicit > 0 ? explicit : 1;
}

function displayMeta(rect) {
  const d = displayFor(rect);
  const bounds = d.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  const sf = scaleFactorOf(d);
  return { display: d, bounds, sf };
}

// host 的 screenCapture 返回的是它自己框选会话里的图，DPI 缩放下会按逻辑像素
// 落盘（1282×794 这种），放到物理像素的屏幕上看就是糊的。这里用 desktopCapturer
// 按「屏幕物理分辨率」重新抓一张整屏，再把用户框出来的那块裁下来——
// 拿到的是真正的 1:1 物理像素。
// 高清抓取（多屏物理像素拼接版）
//
// 设计要点：
// 1. 不依赖「单屏整屏缩略图」crop 那套易错坐标换算——DIP 选区坐标和物理像素缩略图
//    坐标系不一致，125% 缩放下必然越界、整段失败，退回宿主 DIP 低清图 → 糊。
// 2. 改为「逐屏求交集 + 物理像素裁切 + 主进程 Bitmap 拼接」：
//    · 对每块屏，把选区落在该屏内的那部分按物理像素裁出来（坐标全部换算到物理像素）；
//    · 目标画布按「覆盖面积最大的屏的缩放比」统一密度，把各碎片缩放拼成一张图；
//    · 跨屏/超出屏的部分自动留黑边，绝不残缺、绝不糊。
// 3. 单屏 100% / 125% / 150% 都得到 1 物理像素 = 1 显示像素的清晰图。
async function grabHiRes(bounds) {
  const ztools = ZT();
  if (!bounds || typeof ztools.desktopCaptureSources !== 'function' || !electron || !electron.nativeImage) return null;

  let displays = [];
  try { if (typeof ztools.getAllDisplays === 'function') displays = ztools.getAllDisplays() || []; } catch { displays = []; }
  if (!Array.isArray(displays) || !displays.length) { diag('hi-res: 取不到显示器列表'); return null; }

  // 目标密度：取覆盖选区面积最大的屏的缩放比（不同屏 DPI 可能不同）
  let bestArea = 0;
  let SF = 1;
  for (const d of displays) {
    const b = d && d.bounds; if (!b || !b.width || !b.height) continue;
    const ix0 = Math.max(bounds.x, b.x), iy0 = Math.max(bounds.y, b.y);
    const ix1 = Math.min(bounds.x + bounds.width, b.x + b.width);
    const iy1 = Math.min(bounds.y + bounds.height, b.y + b.height);
    const a = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
    if (a > bestArea) { bestArea = a; SF = scaleFactorOf(d); }
  }
  if (!(SF >= 1)) SF = 1;

  const W = Math.max(1, Math.round(bounds.width * SF));
  const H = Math.max(1, Math.round(bounds.height * SF));
  // 不透明黑底：超出屏幕的部分留黑边，避免编辑器背景透出桌面
  const canvas = Buffer.alloc(W * H * 4, 0);
  for (let i = 3; i < canvas.length; i += 4) canvas[i] = 255;

  // 请求所有屏的整屏物理缩略图：目标取最大屏物理尺寸，各屏都不会被缩小
  let maxPhysW = 1, maxPhysH = 1;
  for (const d of displays) {
    const b = d && d.bounds; if (!b) continue;
    maxPhysW = Math.max(maxPhysW, Math.ceil((b.width || 1) * (scaleFactorOf(d) || 1)));
    maxPhysH = Math.max(maxPhysH, Math.ceil((b.height || 1) * (scaleFactorOf(d) || 1)));
  }

  let sources = null;
  try {
    sources = await ztools.desktopCaptureSources({
      types: ['screen'],
      thumbnailSize: { width: maxPhysW, height: maxPhysH },
      fetchWindowIcons: false
    });
  } catch (error) { diag(`hi-res: 取捕获源失败 ${(error && error.message) || error}`); }
  if (!Array.isArray(sources) || !sources.length) { diag('hi-res: 没有可用的捕获源'); return null; }

  // 给某块屏挑一个最匹配的捕获源：display_id 命中优先，否则缩略图物理尺寸最接近
  function findSource(d) {
    for (const s of sources) if (String(s.display_id || '') === String(d.id)) return s;
    let best = null, bestDiff = Infinity;
    const pw = (d.bounds.width || 1) * (scaleFactorOf(d) || 1);
    const ph = (d.bounds.height || 1) * (scaleFactorOf(d) || 1);
    for (const s of sources) {
      const sz = s.thumbnail && typeof s.thumbnail.getSize === 'function' ? s.thumbnail.getSize() : null;
      if (!sz || !sz.width || !sz.height) continue;
      const diff = Math.abs(sz.width - pw) + Math.abs(sz.height - ph);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    return best;
  }

  let anyPlaced = false;
  for (const d of displays) {
    const b = d && d.bounds; if (!b || !b.width || !b.height) continue;
    // 选区与该屏的 DIP 交集
    const ix0 = Math.max(bounds.x, b.x), iy0 = Math.max(bounds.y, b.y);
    const ix1 = Math.min(bounds.x + bounds.width, b.x + b.width);
    const iy1 = Math.min(bounds.y + bounds.height, b.y + b.height);
    const iw = ix1 - ix0, ih = iy1 - iy0;
    if (iw <= 0 || ih <= 0) continue;

    const src = findSource(d);
    if (!src || !src.thumbnail || typeof src.thumbnail.getSize !== 'function') continue;
    const size = src.thumbnail.getSize();
    if (!size.width || !size.height) continue;

    const sf = scaleFactorOf(d);
    const screenPhysW = b.width * sf, screenPhysH = b.height * sf;
    const kx = size.width / screenPhysW, ky = size.height / screenPhysH;
    // 物理像素起点与尺寸（相对该屏缩略图）
    let cx = Math.round((ix0 - b.x) * sf * kx);
    let cy = Math.round((iy0 - b.y) * sf * ky);
    let cw = Math.round(iw * sf * kx);
    let ch = Math.round(ih * sf * ky);
    if (cx < 0) { cw += cx; cx = 0; }
    if (cy < 0) { ch += cy; cy = 0; }
    if (cx + cw > size.width) cw = size.width - cx;
    if (cy + ch > size.height) ch = size.height - cy;
    if (cw <= 0 || ch <= 0) continue;

    let frag;
    try { frag = src.thumbnail.crop({ x: cx, y: cy, width: cw, height: ch }); }
    catch (error) { diag(`hi-res: 裁剪失败 ${(error && error.message) || error}`); continue; }
    if (!frag) continue;

    // 把这块物理交集映射到目标画布（统一 SF 密度）
    const tx0 = Math.round((ix0 - bounds.x) * SF);
    const ty0 = Math.round((iy0 - bounds.y) * SF);
    const tw = Math.max(1, Math.round(iw * SF));
    const th = Math.max(1, Math.round(ih * SF));

    let bmp;
    try {
      if (frag.getSize().width !== tw || frag.getSize().height !== th) frag = frag.resize({ width: tw, height: th });
      bmp = frag.toBitmap();
    } catch (error) { diag(`hi-res: 取位图失败 ${(error && error.message) || error}`); continue; }
    if (!bmp || bmp.length < tw * th * 4) { diag('hi-res: 位图尺寸不符，跳过'); continue; }

    const dx = Math.max(0, tx0), dy = Math.max(0, ty0);
    const cw2 = Math.min(tw, W - dx), ch2 = Math.min(th, H - dy);
    if (cw2 <= 0 || ch2 <= 0) continue;
    const rowBytes = tw * 4;
    for (let y = 0; y < ch2; y++) {
      const s = y * rowBytes;
      const dst = (dy + y) * W * 4 + dx * 4;
      bmp.copy(canvas, dst, s, s + cw2 * 4);
    }
    anyPlaced = true;
    diag(`hi-res: 屏${d.id} 物理 ${cw}x${ch}@${cx},${cy} → 目标 ${tw}x${th}@${tx0},${ty0} sf=${sf}`);
  }

  if (!anyPlaced) { diag('hi-res: 没有可用的高清碎片，退回原图'); return null; }
  try {
    const out = electron.nativeImage.createFromBitmap(canvas, { width: W, height: H }).toDataURL();
    diag(`hi-res: 拼接完成 ${W}x${H}（目标密度 SF=${SF}）`);
    return out;
  } catch (error) { diag(`hi-res: 合成失败 ${(error && error.message) || error}`); return null; }
}

// 捕获源的候选顺序：display_id 命中 → 分辨率最接近「这块屏的物理像素」→ 长宽比 → 其余
function orderSources(sources, display, area) {
  const wantW = area.width * scaleFactorOf(display);
  const want = area.width / area.height;
  const scored = [];
  for (const source of sources) {
    if (!source) continue;
    const thumb = source.thumbnail;
    const size = thumb && typeof thumb.getSize === 'function' ? thumb.getSize() : null;
    const sw = size && size.width ? size.width : 0;
    const sh = size && size.height ? size.height : 0;
    let score = 0;
    // display_id 在多屏下是唯一可靠的判据，命中就直接排最前
    if (String(source.display_id || '') === String(display.id)) score -= 1000;
    // 这块屏的缩略图宽度应该接近 area.width×dpr；拿别的屏（分辨率不同）分值立刻变差
    if (sw && wantW) score += Math.abs(sw / wantW - 1) * 200;
    // 同样的分辨率比值下再用长宽比区分数值不同的屏
    if (sw && sh) score += Math.abs(sw / sh - want) * 10;
    scored.push({ source, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((item) => item.source);
}

// 抓物理像素底图，最多等 budget 毫秒。超时就当没拿到，绝不拖住开窗。
async function grabHiResWithin(area, budget) {
  const t0 = Date.now();
  try {
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), budget));
    const hi = await Promise.race([grabHiRes(area), slow]);
    diag(`hi-res 耗时 ${Date.now() - t0}ms，${hi ? '拿到' : '没拿到'}`);
    return hi;
  } catch (error) {
    diag(`hi-res 异常 ${(error && error.message) || error}`);
    return null;
  }
}

// 只有真的更清晰才换：一样大或者更小的，换了纯属白折腾
function pickSharper(base, maybe) {
  if (!maybe) return base;
  const a = imageSizeOf(base);
  const b = imageSizeOf(maybe);
  if (b.width > a.width + 1 || b.height > a.height + 1) {
    diag(`hi-res 采用 ${b.width}x${b.height}（原 ${a.width}x${a.height}）`);
    return maybe;
  }
  diag(`hi-res 不比原图大（${b.width}x${b.height}），保留原图`);
  return base;
}

// 窗口已经在屏幕上了，这里只把更清晰的底图递进去。用户已经开始标注就放弃替换，
// 因为标注坐标是按旧图像像素记的，换图会整体错位（子窗口那边也有一道同样的判断）。
async function upgradeShotLater(area, baseShot, sf, action) {
  const hi = await grabHiResWithin(area, 1500);
  const finalShot = pickSharper(baseShot, hi);
  // 历史只记一次，记最清晰那份
  rememberShot(finalShot, action);
  if (finalShot === baseShot) return;
  const sent = pushEditorShot(finalShot);
  diag(`hi-res 投递=${sent ? '直发' : '暂存待发'} sf=${sf}`);
}

function startCapture(action) {
  const ztools = ZT();
  const startedAt = Date.now();

  if (capturing) {
    diag(`ignore: 已有截图会话在进行中（${action}）`);
    return;
  }
  capturing = true;

  // 收起搜索主窗口，否则它会被拍进截图里
  try {
    // 传 false：true 会让宿主在退出时「还原上一个窗口」，主窗口被顶回来压掉覆盖层
    if (typeof ztools.hideMainWindow === 'function') ztools.hideMainWindow(false);
  } catch {
    // 忽略
  }
  diag(`enter ${action} 准备 ${Date.now() - startedAt}ms`);

  const finish = async (image, bounds) => {
    capturing = false;
    const area = sanitizeBounds(bounds);
    let shot = image || '';
    const size = shot ? imageSizeOf(shot) : { width: 0, height: 0 };
    const meta = displayMeta(area);
    diag(
      `capture action=${action} image=${size.width}x${size.height} `
      + `bounds=${area ? `${area.width}x${area.height}@${area.x},${area.y}` : 'none'} `
      + `screen=${meta.bounds.width}x${meta.bounds.height} sf=${meta.sf}`
    );

    if (!shot) {
      // 用户取消：恢复主窗口，然后结束本次运行（否则第二次触发会失效）
      try {
        if (typeof ztools.showMainWindow === 'function') ztools.showMainWindow();
      } catch {
        // 忽略
      }
      endRun();
      return;
    }

    // ── 顺序是这里唯一重要的东西 ──
    // 「清楚」只有一条铁律：画布 = 图像像素 1:1，图片绝不被放大插值。
    // 宿主 screenCapture 给的是逻辑像素（125% 缩放下每边少 20% 的细节），所以还得自己
    // 从捕获源再抠一张物理像素的。
    //
    // 但抓那张要 300ms~1.3s（desktopCapturer 的真实开销）。把它放在「开窗」前面等，
    // 就是用户说的「按了快捷键得缓一秒才出来」。抄仓库一：先把窗口亮出来，图用先到的那张；
    // 更清晰的那张稍后原地换底，窗口尺寸按最终图算好、一秒不用改。
    const openWith = (image) => {
      if (action === 'pin') openPinWindow(image, area || undefined);
      else if (action === 'ocr') openResultWindow(image, 'ocr');
      else if (action === 'translate') openResultWindow(image, 'translate');
      else if (area) openEditorWindow(writeTempShot(image), area, action, area ? {
        width: Math.round(area.width * meta.sf),
        height: Math.round(area.height * meta.sf)
      } : null);
      else openOverlay(writeTempShot(image), action);
    };

    // 没有选区就没有重新抠图的机会，直接开
    if (!area) {
      rememberShot(shot, action);
      openWith(shot);
      endRun();
      return;
    }

    // 贴图/OCR/翻译的窗口尺寸本身跟着图走，等清晰图再开更划算（这三个是低频动作）
    if (action === 'pin' || action === 'ocr' || action === 'translate') {
      const hi = await grabHiResWithin(area, 1200);
      const finalShot = pickSharper(shot, hi);
      rememberShot(finalShot, action);
      openWith(finalShot);
      endRun();
      return;
    }

    // 编辑路径：先开窗（几十毫秒），再后台补清晰底图。
    // 历史记录放在补底那一步写，只记最清晰的一份。
    openWith(shot);
    endRun();
    upgradeShotLater(area, shot, meta.sf, action).catch((error) => {
      diag(`补底异常 ${(error && error.message) || error}`);
    });
  };

  try {
    if (typeof ztools.screenCapture !== 'function') {
      capturing = false;
      diag('screenCapture 不可用');
      console.warn('[snap] 当前 ZTools 不支持 screenCapture');
      endRun();
      return;
    }
    // 回调签名是 (image, bounds)，bounds 是用户框出的屏幕逻辑区域
    ztools.screenCapture(finish);
  } catch (error) {
    capturing = false;
    diag(`screenCapture 异常: ${(error && error.message) || error}`);
    console.warn('[snap] 截图失败', error);
    endRun();
  }

  // 兜底：万一宿主没回调（会话被系统吃掉），别把后续触发永久锁死
  setTimeout(() => {
    if (capturing) {
      capturing = false;
      diag('capture 超时解锁');
    }
  }, 180000);
}

function runWithImage(action, handler) {
  const dataUrl = firstImageFrom(action);
  if (!dataUrl) {
    endRun();
    return;
  }
  try {
    handler(dataUrl);
  } catch (error) {
    console.warn('[snap] 处理图片失败', error);
  }
  endRun();
}

// 供 overlay / pin / result 页面调用
// 子窗口没资格直接开窗（宿主鉴权只认插件主视图），统一由父窗口代劳
bridge.openPin = (dataUrl, bounds) => {
  if (!dataUrl) return { ok: false, error: '没有图片' };
  if (isChildWindow()) return { ok: askParent({ event: 'openPin', dataUrl, bounds }), via: 'parent' };
  return { ok: Boolean(openPinWindow(dataUrl, bounds)) };
};
bridge.openResult = (dataUrl, mode) => {
  if (!dataUrl) return { ok: false, error: '没有图片' };
  if (isChildWindow()) return { ok: askParent({ event: 'openResult', dataUrl, mode }), via: 'parent' };
  return { ok: Boolean(openResultWindow(dataUrl, mode)) };
};
bridge.openEditor = (dataUrl) => {
  if (!dataUrl) return { ok: false, error: '没有图片' };
  if (isChildWindow()) return { ok: askParent({ event: 'openEditor', dataUrl }), via: 'parent' };
  return { ok: Boolean(openOverlay(writeTempShot(dataUrl), 'edit')) };
};

// 选区小窗拖动：子窗口无 setBounds 权限，转给父窗口做
bridge.moveWindow = (x, y) => {
  const ok = isChildWindow()
    ? askParent({ event: 'moveWindow', x, y })
    : (function () {
      const win = editor.win;
      if (!win) return false;
      try {
        const now = win.getBounds();
        win.setBounds({ x: Math.round(x), y: Math.round(y), width: now.width, height: now.height });
        return true;
      } catch {
        return false;
      }
    })();
  return { ok };
};
bridge.editorReady = () => ({ ok: askParent({ event: 'editorReady' }) });
bridge.readShot = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '截图文件已失效' };
    return { ok: true, dataUrl: readImageAsDataUrl(filePath) };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};
bridge.finish = (force) => {
  if (isChildWindow()) return { ok: askParent({ event: 'finish', force: Boolean(force) }), via: 'parent' };
  try {
    const ztools = ZT();
    if (typeof ztools.outPlugin === 'function') ztools.outPlugin(Boolean(force));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};
// 设置页里的「立即截图」按钮用
bridge.captureNow = (action) => {
  startCapture(action || 'edit');
  return { ok: true };
};

// ── 贴图板 / 历史 ──
bridge.openBoard = (tab) => {
  if (isChildWindow()) return { ok: askParent({ event: 'openBoard', tab }), via: 'parent' };
  return { ok: Boolean(openBoard(tab)) };
};
bridge.pinList = () => pinList();
bridge.closeAllPins = () => {
  closeAllPins();
  return { ok: true };
};
bridge.showAllPins = () => ({ ok: true, count: showAllPins() });
bridge.hideOtherPins = (exceptId) => ({ ok: true, count: hideOtherPins(exceptId) });
bridge.closePinById = (id) => {
  const entry = PINS.get(id);
  if (!entry) return { ok: false };
  closePin(entry);
  return { ok: true };
};
bridge.setPinVisible = (id, visible) => {
  const entry = PINS.get(id);
  if (!entry) return { ok: false };
  try {
    if (visible) {
      entry.win?.show?.();
      entry.win?.moveTop?.();
      entry.hidden = false;
      entry.othersHidden = false;
    } else {
      entry.win?.hide?.();
      entry.hidden = true;
    }
    syncBoard();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};
bridge.focusPin = (id) => {
  const entry = PINS.get(id);
  if (!entry) return { ok: false };
  try {
    entry.win?.show?.();
    entry.hidden = false;
    entry.win?.focus?.();
    entry.win?.moveTop?.();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

// 当前占了多少张、占多大地方（设置页用来给用户判断该留几张）
bridge.historyStats = () => {
  const list = readHistoryIndex();
  let bytes = 0;
  for (const item of list) {
    try {
      bytes += fs.statSync(path.join(historyDir(), item.file)).size;
    } catch {
      // 文件被手动删了
    }
  }
  return { count: list.length, bytes, limit: historyLimit() };
};

// 用户把上限调小后，按新上限立刻清掉多出来的旧图
bridge.trimHistory = (limit) => {
  try {
    const cap = normalizeLimit(limit);
    writeSettingsRaw({ historyLimit: cap });
    const list = readHistoryIndex();
    const keep = list.slice(0, cap);
    const drop = list.slice(cap);
    writeHistoryIndex(keep, cap);
    drop.forEach((item) => {
      try {
        fs.unlinkSync(path.join(historyDir(), item.file));
      } catch {
        // 忽略
      }
    });
    pruneOrphans(keep.map((item) => item.file));
    syncBoard();
    let bytes = 0;
    for (const item of keep) {
      try {
        bytes += fs.statSync(path.join(historyDir(), item.file)).size;
      } catch {
        // 忽略
      }
    }
    return { ok: true, removed: drop.length, count: keep.length, bytes, limit: cap };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

bridge.historyList = (query) => {
  const keyword = String(query || '').trim().toLowerCase();
  const list = readHistoryIndex().map((item) => ({
    ...item,
    path: path.join(historyDir(), item.file)
  }));
  if (!keyword) return list;
  return list.filter((item) => {
    const when = new Date(Number(item.ts) || 0);
    const text = `${item.file} ${item.source || ''} ${when.toLocaleString('zh-CN')} ${item.w || ''}x${item.h || ''}`;
    return text.toLowerCase().includes(keyword) || String(item.w) === keyword;
  });
};

// 缩略图走 nativeImage 缩放，别把几百张原图 base64 全塞进渲染层
bridge.historyThumb = (filePath, maxEdge) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '文件已不存在' };
    const image = electron.nativeImage.createFromPath(filePath);
    if (!image || image.isEmpty()) return { ok: false, error: '无法读取图片' };
    const size = image.getSize();
    const edge = Math.max(48, Number(maxEdge) || 260);
    const scale = Math.min(1, edge / Math.max(size.width, size.height));
    const small = scale < 1
      ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'good' })
      : image;
    return { ok: true, dataUrl: small.toDataURL(), width: size.width, height: size.height };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

bridge.historyDir = () => historyDir();
bridge.historyOpenDir = () => {
  try {
    ensureDir(historyDir());
  } catch {
    // 忽略
  }
  try {
    const ztools = ZT();
    if (typeof ztools.shellOpenPath === 'function') ztools.shellOpenPath(historyDir());
    else if (typeof ztools.shellShowItemInFolder === 'function') ztools.shellShowItemInFolder(historyDir());
    return { ok: true, dir: historyDir() };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

bridge.historyReveal = (filePath) => {
  try {
    const ztools = ZT();
    if (typeof ztools.shellShowItemInFolder === 'function') ztools.shellShowItemInFolder(filePath);
    else ztools.shellOpenPath?.(path.dirname(filePath));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

bridge.historyRemove = (filePath) => {
  try {
    const name = path.basename(filePath);
    const list = readHistoryIndex().filter((item) => item.file !== name);
    writeHistoryIndex(list);
    try {
      fs.unlinkSync(path.join(historyDir(), name));
    } catch {
      // 忽略
    }
    syncBoard();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

bridge.historyClear = () => {
  try {
    const list = readHistoryIndex();
    list.forEach((item) => {
      try {
        fs.unlinkSync(path.join(historyDir(), item.file));
      } catch {
        // 忽略
      }
    });
    writeHistoryIndex([]);
    pruneOrphans([]);
    syncBoard();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

// 覆盖层保存/复制时把成品也记一笔
bridge.remember = (dataUrl, source) => ({ ok: Boolean(rememberShot(dataUrl, source || 'edit')) });

try {
  window.zsnap = bridge;
} catch {
  // contextIsolation 开启时无法直接挂载，下面走 contextBridge
}
try {
  if (electron.contextBridge) electron.contextBridge.exposeInMainWorld('zsnap', bridge);
} catch {
  // 已有 window.zsnap 或宿主不提供 contextBridge
}

// ═══════════════════════════════════════════════════════════════════
// 功能入口
// 与 plugin.json 的 feature code 一一对应；未在此列出的（ui.settings）
// 由 ZTools 按常规渲染 main 页面，即设置界面。
// ═══════════════════════════════════════════════════════════════════

// 每次插件被唤醒都探一次渠道：把 ZTools 到底给了哪些 OCR / 翻译渠道写进 diag，
// 真机排查「设置页里是空的」时不用猜。
function probeProviders() {
  const ztools = ZT();
  const has = Boolean(ztools.providers && typeof ztools.providers.getProviders === 'function');
  diag(`providers 支持=${has} ztools.ocr=${typeof ztools.ocr} ztools.translate=${typeof ztools.translate}`);
  if (!has) return;
  Promise.all([
    ztools.providers.getProviders('ocr').catch((error) => ({ error })),
    ztools.providers.getProviders('translation').catch((error) => ({ error }))
  ]).then(([ocrList, transList]) => {
    const show = (list) => (Array.isArray(list)
      ? list.map((item) => `${item.id}${item.isDefault ? '*' : ''}(${item.label || ''}${item.source ? '/' + item.source : ''})`).join(',')
      : `err:${(list && list.error && list.error.message) || 'none'}`);
    diag(`providers ocr=[${show(ocrList)}] translation=[${show(transList)}]`);
  }).catch(() => {});
}

setTimeout(probeProviders, 1200);

// 启动时清掉两天前遗留的临时截图，避免 %TEMP% 越堆越多
setTimeout(() => {
  const removed = cleanupTempShots();
  if (removed) diag(`清理旧临时截图 ${removed} 个`);
}, 1500);

window.exports = {
  'ui.capture': {
    mode: 'none',
    args: { enter: () => startCapture('edit') }
  },
  'function.capture-copy': {
    mode: 'none',
    args: { enter: () => startCapture('copy') }
  },
  'function.capture-save': {
    mode: 'none',
    args: { enter: () => startCapture('save') }
  },
  'function.capture-pin': {
    mode: 'none',
    args: { enter: () => startCapture('pin') }
  },
  'function.pin-image': {
    mode: 'none',
    args: {
      enter: (action) => runWithImage(action, (dataUrl) => openPinWindow(dataUrl))
    }
  },
  'function.edit-image': {
    mode: 'none',
    args: {
      enter: (action) => runWithImage(action, (dataUrl) => openOverlay(writeTempShot(dataUrl), 'edit'))
    }
  },
  'function.ocr-image': {
    mode: 'none',
    args: {
      enter: (action) => runWithImage(action, (dataUrl) => openResultWindow(dataUrl, 'ocr'))
    }
  },
  'ui.board': {
    mode: 'none',
    args: {
      enter: (arg) => {
        const tab = String(arg && arg.tab ? arg.tab : '');
        openBoard(tab);
        endRun();
      }
    }
  }
};
