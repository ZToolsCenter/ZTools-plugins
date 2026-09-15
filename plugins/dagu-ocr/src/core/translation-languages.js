export const TRANSLATION_LANGUAGES = Object.freeze([
  { code: 'auto', label: '自动检测' },
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '中文（繁体）' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'pt-PT', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ru', label: '俄语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'th', label: '泰语' },
  { code: 'vi', label: '越南语' },
  { code: 'id', label: '印度尼西亚语' },
  { code: 'ms', label: '马来语' },
  { code: 'tr', label: '土耳其语' },
  { code: 'nl', label: '荷兰语' },
  { code: 'pl', label: '波兰语' },
  { code: 'uk', label: '乌克兰语' },
  { code: 'hi', label: '印地语' },
  { code: 'cs', label: '捷克语' },
  { code: 'sv', label: '瑞典语' }
]);

const LANGUAGE_ALIASES = Object.freeze({
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-chs': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-cht': 'zh-TW',
  pt: 'pt-PT',
  'pt-pt': 'pt-PT',
  jp: 'ja',
  kor: 'ko',
  fra: 'fr',
  spa: 'es',
  ara: 'ar',
  vie: 'vi',
  may: 'ms',
  swe: 'sv',
  ukr: 'uk'
});

export function normalizeTranslationLanguage(language) {
  if (typeof language !== 'string') return language;
  const value = language.trim();
  return LANGUAGE_ALIASES[value] || LANGUAGE_ALIASES[value.toLowerCase()] || value;
}

function createProfile(id, aliases, targetCodes) {
  const sourceCodes = { auto: 'auto', ...targetCodes };
  const supportedLanguages = (codes) => Object.keys(codes)
    .filter((language) => codes[language] !== null && codes[language] !== undefined);
  return Object.freeze({
    id,
    aliases: Object.freeze(aliases),
    sourceCodes: Object.freeze(sourceCodes),
    targetCodes: Object.freeze(targetCodes),
    sourceLanguages: Object.freeze(supportedLanguages(sourceCodes)),
    targetLanguages: Object.freeze(supportedLanguages(targetCodes))
  });
}

const commonCodes = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  'pt-PT': 'pt-PT',
  it: 'it',
  ru: 'ru',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  id: 'id',
  ms: 'ms',
  tr: 'tr',
  nl: 'nl',
  pl: 'pl',
  uk: 'uk',
  hi: 'hi',
  cs: 'cs',
  sv: 'sv'
};

export const TRANSLATION_SERVICE_PROFILES = Object.freeze({
  microsoft: createProfile('microsoft', ['microsoft', '微软'], {
    ...commonCodes,
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    hi: null,
    cs: null
  }),
  baidu: createProfile('baidu', ['baidu', '百度'], {
    ...commonCodes,
    'zh-CN': 'zh',
    'zh-TW': 'cht',
    ja: 'jp',
    ko: 'kor',
    fr: 'fra',
    es: 'spa',
    'pt-PT': 'pt',
    ar: 'ara',
    vi: 'vie',
    ms: 'may',
    uk: 'ukr',
    sv: 'swe',
    cs: null
  }),
  alibaba: createProfile('alibaba', ['alibaba', 'aliyun', '阿里', '阿里云'], {
    'zh-CN': 'zh',
    en: 'en',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
    'pt-PT': 'pt',
    it: 'it',
    ru: 'ru',
    ar: 'ar',
    th: 'th',
    vi: 'vi',
    id: 'id',
    ms: 'ms',
    tr: 'tr',
    nl: 'nl',
    pl: 'pl',
    uk: 'uk'
  }),
  google: createProfile('google', ['google', '谷歌'], {
    ...commonCodes,
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'pt-PT': 'pt',
    cs: null
  }),
  deepl: createProfile('deepl', ['deepl'], {
    'zh-CN': 'ZH',
    en: 'EN',
    ja: 'JA',
    ko: 'KO',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    'pt-PT': 'PT-PT',
    it: 'IT',
    ru: 'RU',
    ar: 'AR',
    id: 'ID',
    tr: 'TR',
    nl: 'NL',
    pl: 'PL',
    uk: 'UK'
  }),
  youdao: createProfile('youdao', ['youdao', '有道'], {
    'zh-CN': 'zh-CHS',
    'zh-TW': 'zh-CHT',
    en: 'en',
    ja: 'jp',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
    'pt-PT': 'pt',
    it: 'it',
    ru: 'ru',
    vi: 'vie',
    ar: 'ar',
    nl: 'nl',
    sv: 'swe'
  }),
  tencent: createProfile('tencent', ['tencent', '腾讯'], {
    ...commonCodes,
    'zh-CN': 'zh'
  }),
  mymemory: createProfile('mymemory', ['mymemory'], {
    ...commonCodes,
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'pt-PT': 'pt-PT'
  })
});

function providerMetadata(provider) {
  const raw = provider?.raw || provider || {};
  if (typeof raw === 'string') return raw;
  return [
    provider?.serviceId,
    provider?.providerId,
    raw.serviceId,
    raw.service,
    raw.providerId,
    raw.provider,
    raw.id,
    raw.key,
    raw.code,
    raw.name,
    raw.label,
    raw.title,
    raw.displayName
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getTranslationServiceId(provider) {
  const metadata = providerMetadata(provider);
  const explicitId = provider?.serviceId || provider?.raw?.serviceId || provider?.raw?.service;
  const normalizedExplicitId = typeof explicitId === 'string' ? explicitId.toLowerCase() : explicitId;
  if (normalizedExplicitId && TRANSLATION_SERVICE_PROFILES[normalizedExplicitId]) {
    return normalizedExplicitId;
  }

  return Object.values(TRANSLATION_SERVICE_PROFILES)
    .find((profile) => profile.aliases.some((alias) => metadata.includes(alias.toLowerCase())))?.id || null;
}

export function getTranslationServiceProfile(provider) {
  const serviceId = getTranslationServiceId(provider);
  return serviceId ? TRANSLATION_SERVICE_PROFILES[serviceId] : null;
}

export function mapTranslationLanguage(profile, direction, language) {
  const normalizedLanguage = normalizeTranslationLanguage(language);
  const codes = direction === 'source' ? profile?.sourceCodes : profile?.targetCodes;
  if (!codes || !Object.prototype.hasOwnProperty.call(codes, normalizedLanguage)) {
    return normalizedLanguage;
  }
  return codes[normalizedLanguage];
}

export function getTranslationLanguageOptions(profile, direction) {
  const isSource = direction === 'source';
  const supported = isSource ? profile?.sourceLanguages : profile?.targetLanguages;
  return TRANSLATION_LANGUAGES.filter((language) => (
    (isSource || language.code !== 'auto') &&
    (!supported || supported.includes(language.code))
  ));
}
