import {
  getTranslationLanguageOptions as getLanguageOptionsForProfile,
  getTranslationServiceId,
  getTranslationServiceProfile,
  mapTranslationLanguage,
  normalizeTranslationLanguage
} from './translation-languages.js';

export const PROVIDER_TYPES = {
  ocr: 'ocr',
  translation: 'translation'
};

export const BUILTIN_PROVIDERS = {
  ocr: [
    { id: 'builtin:baidu-ocr', label: '大古内置 · 百度 OCR', kind: 'builtin' },
    { id: 'builtin:ali-ocr', label: '大古内置 · 阿里 OCR', kind: 'builtin' }
  ],
  translation: [
    {
      id: 'builtin:baidu-translation',
      label: '大古内置 · 百度翻译',
      kind: 'builtin',
      serviceId: 'baidu',
      languageProfile: getTranslationServiceProfile('baidu')
    },
    {
      id: 'builtin:ali-translation',
      label: '大古内置 · 阿里翻译',
      kind: 'builtin',
      serviceId: 'alibaba',
      languageProfile: getTranslationServiceProfile('alibaba')
    },
    {
      id: 'builtin:mymemory',
      label: '大古内置 · MyMemory',
      kind: 'builtin',
      serviceId: 'mymemory',
      languageProfile: getTranslationServiceProfile('mymemory')
    }
  ]
};

function getWindow() {
  return globalThis.window || globalThis;
}

function normalizeProvider(provider, type) {
  if (!provider || typeof provider !== 'object') return null;
  const providerId = provider.id || provider.providerId || provider.key || provider.code || provider.name;
  if (!providerId) return null;
  const serviceId = type === PROVIDER_TYPES.translation
    ? getTranslationServiceId(provider)
    : null;
  return {
    id: `ztools:${providerId}`,
    providerId: String(providerId),
    label: provider.label || provider.title || provider.displayName || provider.name || String(providerId),
    kind: 'ztools',
    type,
    raw: provider,
    serviceId,
    languageProfile: serviceId ? getTranslationServiceProfile(serviceId) : null
  };
}

function normalizeTranslationInput(input, provider, mapServiceCodes = false) {
  const normalized = {
    ...input,
    from: normalizeTranslationLanguage(input.from),
    to: normalizeTranslationLanguage(input.to)
  };
  if (!mapServiceCodes) return normalized;

  const profile = provider?.languageProfile || getTranslationServiceProfile(provider);
  if (!profile) return normalized;
  return {
    ...normalized,
    from: mapTranslationLanguage(profile, 'source', normalized.from),
    to: mapTranslationLanguage(profile, 'target', normalized.to)
  };
}

function normalizeBuiltinTranslationInput(input, serviceId) {
  return normalizeTranslationInput(
    input,
    { languageProfile: getTranslationServiceProfile(serviceId) },
    true
  );
}

function unwrapResult(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result.text === 'string') return result.text;
  if (result?.data && typeof result.data.text === 'string') return result.data.text;
  if (result?.result && typeof result.result.text === 'string') return result.result.text;
  throw new Error('Provider 返回格式不包含 text');
}

async function requestJson(fetchImpl, url, options) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
  const response = await fetchImpl(url, options);
  if (response.ok === false) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

function base64ToBytes(imageUrl) {
  const base64 = imageUrl.split(',')[1] || imageUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeAliyun(value) {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function aliyunSignature(params, secret) {
  const query = Object.keys(params).sort()
    .map((key) => `${encodeAliyun(key)}=${encodeAliyun(params[key])}`)
    .join('&');
  const stringToSign = `POST&%2F&${encodeAliyun(query)}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${secret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export function md5(value) {
  const bytes = new TextEncoder().encode(value);
  const totalLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const message = new Uint8Array(totalLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(totalLength - 8, bitLength >>> 0, true);
  view.setUint32(totalLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  ));
  const rotateLeft = (number, amount) => (number << amount) | (number >>> (32 - amount));

  for (let offset = 0; offset < totalLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let functionValue;
      let wordIndex;
      if (index < 16) {
        functionValue = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        functionValue = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        functionValue = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        functionValue = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const sum = (a + functionValue + constants[index] + words[wordIndex]) | 0;
      const next = (b + rotateLeft(sum, shifts[index])) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0].map((number) => {
    const unsigned = number >>> 0;
    return [0, 8, 16, 24]
      .map((shift) => ((unsigned >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join('');
  }).join('');
}

export class BuiltinProviderService {
  constructor({ config, fetchImpl } = {}) {
    this.config = config || {};
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.baiduAccessToken = null;
    this.baiduTokenExpireTime = 0;
  }

  async sendPost(url, body) {
    return requestJson(this.fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  }

  async getBaiduAccessToken() {
    if (!this.config.baiduAk || !this.config.baiduSk) {
      throw new Error('请先配置百度 OCR 密钥');
    }
    if (this.baiduAccessToken && Date.now() < this.baiduTokenExpireTime) {
      return this.baiduAccessToken;
    }
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.config.baiduAk)}&client_secret=${encodeURIComponent(this.config.baiduSk)}`;
    const data = await this.sendPost('https://aip.baidubce.com/oauth/2.0/token', body);
    if (data.error) throw new Error(`百度 Token 获取失败: ${data.error_description || data.error}`);
    this.baiduAccessToken = data.access_token;
    this.baiduTokenExpireTime = Date.now() + Math.max((data.expires_in || 3600) - 60, 1) * 1000;
    return this.baiduAccessToken;
  }

  async recognizeByBaidu(image) {
    const token = await this.getBaiduAccessToken();
    const base64 = image.split(',')[1] || image;
    const data = await this.sendPost(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${encodeURIComponent(token)}`,
      `image=${encodeURIComponent(base64)}&language_type=CHN_ENG`
    );
    if (data.error_code) throw new Error(`百度识别失败: ${data.error_msg}`);
    return Array.isArray(data.words_result)
      ? data.words_result.map((item) => item.words).join('\n').trim()
      : '';
  }

  async recognizeByAli(image) {
    if (!this.config.aliAk || !this.config.aliSk) {
      throw new Error('请先配置阿里云 OCR AccessKey');
    }
    const params = {
      AccessKeyId: this.config.aliAk,
      Action: 'RecognizeGeneral',
      Format: 'JSON',
      RegionId: 'cn-hangzhou',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      Version: '2021-07-07'
    };
    params.Signature = await aliyunSignature(params, this.config.aliSk);
    const query = Object.keys(params).sort()
      .map((key) => `${encodeAliyun(key)}=${encodeAliyun(params[key])}`)
      .join('&');
    const response = await requestJson(this.fetchImpl, `https://ocr-api.cn-hangzhou.aliyuncs.com/?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: base64ToBytes(image)
    });
    if (response.Code && response.Code !== 'Success') {
      throw new Error(`阿里云识别失败: ${response.Message || response.Code}`);
    }
    if (!response.Data) return '';
    try {
      const result = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data;
      if (Array.isArray(result.prism_wordsInfo)) {
        return result.prism_wordsInfo.map((item) => item.word).join('\n').trim();
      }
      return result.content || '';
    } catch {
      return String(response.Data);
    }
  }

  async translateByBaidu(text, from, to) {
    if (!this.config.baiduTranslateAppId || !this.config.baiduTranslateSecretKey) {
      throw new Error('请先配置百度翻译密钥');
    }
    ({ text, from, to } = normalizeBuiltinTranslationInput({ text, from, to }, 'baidu'));
    const salt = Date.now().toString();
    const sign = md5(`${this.config.baiduTranslateAppId}${text}${salt}${this.config.baiduTranslateSecretKey}`);
    const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(text)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&appid=${encodeURIComponent(this.config.baiduTranslateAppId)}&salt=${salt}&sign=${sign}`;
    const result = await requestJson(this.fetchImpl, url);
    if (result.error_code) throw new Error(result.error_msg || '百度翻译失败');
    if (!Array.isArray(result.trans_result)) throw new Error('百度翻译返回格式异常');
    return result.trans_result.map((item) => item.dst).join('\n');
  }

  async translateByAli(text, from, to) {
    if (!this.config.aliAk || !this.config.aliSk) {
      throw new Error('请先配置阿里云翻译 AccessKey');
    }
    ({ text, from, to } = normalizeBuiltinTranslationInput({ text, from, to }, 'alibaba'));
    const params = {
      AccessKeyId: this.config.aliAk,
      Action: 'TranslateGeneral',
      Format: 'JSON',
      RegionId: 'cn-hangzhou',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
      SignatureVersion: '1.0',
      SourceLanguage: from === 'auto' ? 'en' : from,
      SourceText: text,
      TargetLanguage: to,
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      Version: '2018-10-12'
    };
    params.Signature = await aliyunSignature(params, this.config.aliSk);
    const query = Object.keys(params).sort()
      .map((key) => `${encodeAliyun(key)}=${encodeAliyun(params[key])}`)
      .join('&');
    const result = await requestJson(this.fetchImpl, `https://mt.cn-hangzhou.aliyuncs.com/?${query}`, { method: 'POST' });
    if (result.Code && result.Code !== '200') throw new Error(result.Message || '阿里云翻译失败');
    return result.Data?.Translated || '';
  }

  async translateByMyMemory(text, from, to) {
    if (!this.config.myMemoryKey) throw new Error('请先配置 MyMemory key');
    ({ text, from, to } = normalizeBuiltinTranslationInput({ text, from, to }, 'mymemory'));
    const langPair = `${from === 'auto' ? 'zh' : from}|${to}`;
    const chunks = [];
    let current = '';
    for (const line of text.split('\n')) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > 480 && current) {
        chunks.push(current);
        current = line;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    const results = [];
    for (const chunk of chunks) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(langPair)}&key=${encodeURIComponent(this.config.myMemoryKey)}`;
      const result = await requestJson(this.fetchImpl, url);
      if (result.responseStatus !== 200 || !result.responseData) {
        throw new Error(result.responseDetails || 'MyMemory 翻译失败');
      }
      results.push(result.responseData.translatedText);
    }
    return results.join('\n');
  }

  async invoke(providerId, input) {
    if (providerId === 'builtin:baidu-ocr') return this.recognizeByBaidu(input.image);
    if (providerId === 'builtin:ali-ocr') return this.recognizeByAli(input.image);
    if (providerId === 'builtin:baidu-translation') return this.translateByBaidu(input.text, input.from, input.to);
    if (providerId === 'builtin:ali-translation') return this.translateByAli(input.text, input.from, input.to);
    if (providerId === 'builtin:mymemory') return this.translateByMyMemory(input.text, input.from, input.to);
    throw new Error(`未知的内置 Provider: ${providerId}`);
  }
}

export class ProviderService {
  constructor({ win, config, fetchImpl } = {}) {
    this.win = win || getWindow();
    this.config = config || {};
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.builtin = new BuiltinProviderService({ config: this.config, fetchImpl: this.fetchImpl });
    this.external = { ocr: [], translation: [] };
    this.hasZToolsProviderApi = false;
  }

  get api() {
    return this.win?.ztools?.providers || this.win?.utools?.providers || null;
  }

  async refresh() {
    const api = this.api;
    this.hasZToolsProviderApi = Boolean(
      api && (
        typeof api.getProviders === 'function' ||
        typeof api.getDefaultProvider === 'function' ||
        typeof api.invokeProvider === 'function'
      )
    );

    for (const type of Object.values(PROVIDER_TYPES)) {
      if (!this.hasZToolsProviderApi || typeof api.getProviders !== 'function') {
        this.external[type] = [];
        continue;
      }
      try {
        const raw = await api.getProviders(type);
        const list = Array.isArray(raw) ? raw : raw?.providers || [];
        this.external[type] = list.map((item) => normalizeProvider(item, type)).filter(Boolean);
      } catch (error) {
        console.warn(`读取 ZTools ${type} Provider 失败:`, error);
        this.external[type] = [];
      }
    }
    return this.getAllOptions();
  }

  getAllOptions() {
    return {
      ocr: this.getOptions('ocr'),
      translation: this.getOptions('translation')
    };
  }

  getOptions(type) {
    const options = [];
    if (this.hasZToolsProviderApi) {
      options.push({ id: 'ztools:default', label: 'ZTools 默认', kind: 'ztools-default', type });
      options.push(...this.external[type]);
    }
    options.push(...BUILTIN_PROVIDERS[type]);
    return options;
  }

  findProvider(type, providerId) {
    if (providerId === 'ztools:default') {
      return { id: providerId, kind: 'ztools-default', type };
    }
    if (providerId?.startsWith('builtin:')) {
      return BUILTIN_PROVIDERS[type].find((provider) => provider.id === providerId) || null;
    }
    return this.findExternal(type, providerId);
  }

  getTranslationLanguageOptions(providerId, direction) {
    const provider = this.findProvider(PROVIDER_TYPES.translation, providerId);
    const profile = provider?.languageProfile || getTranslationServiceProfile(provider);
    return getLanguageOptionsForProfile(profile, direction);
  }

  findExternal(type, id) {
    return this.external[type].find((provider) => provider.id === id) || null;
  }

  async invokeZTools(type, input, selected) {
    const api = this.api;
    const raw = selected?.raw;
    const providerInput = type === PROVIDER_TYPES.translation
      ? normalizeTranslationInput(input, selected)
      : input;
    for (const method of ['invoke', 'run', 'execute']) {
      if (typeof raw?.[method] === 'function') {
        return unwrapResult(await raw[method](providerInput));
      }
    }

    if (typeof api?.invokeProvider === 'function') {
      const result = selected?.kind === 'ztools'
        ? await api.invokeProvider(type, providerInput, selected.providerId)
        : await api.invokeProvider(type, providerInput);
      return unwrapResult(result);
    }

    const shortcut = type === 'ocr' ? this.win?.ztools?.ocr : this.win?.ztools?.translate;
    if (typeof shortcut === 'function') return unwrapResult(await shortcut(providerInput));
    throw new Error('当前 ZTools 未提供可用的 Provider 调用接口');
  }

  async invoke(type, input, providerId) {
    if (!providerId) {
      throw new Error(type === 'ocr' ? '请先选择 OCR Provider' : '请先选择翻译 Provider');
    }
    const selected = this.findProvider(type, providerId);
    if (providerId.startsWith('builtin:')) {
      const providerInput = type === PROVIDER_TYPES.translation
        ? normalizeTranslationInput(input, selected, true)
        : input;
      return this.builtin.invoke(providerId, providerInput);
    }
    if (providerId === 'ztools:default') {
      return this.invokeZTools(type, input, selected);
    }
    if (!selected) throw new Error('所选 ZTools Provider 当前不可用');
    return this.invokeZTools(type, input, selected);
  }
}
