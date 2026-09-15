export const LANGUAGES = [
  { code: 'auto', name: '自动检测', shortName: '自动检测' },
  { code: 'zh-CN', name: '中文（简体）', shortName: '中文' },
  { code: 'en', name: '英语', shortName: '英语' },
  { code: 'ja', name: '日语', shortName: '日语' },
  { code: 'ko', name: '韩语', shortName: '韩语' },
  { code: 'zh-TW', name: '中文（繁体）', shortName: '繁体中文' },
  { code: 'fr', name: '法语', shortName: '法语' },
  { code: 'de', name: '德语', shortName: '德语' },
  { code: 'es', name: '西班牙语', shortName: '西班牙语' },
  { code: 'it', name: '意大利语', shortName: '意大利语' },
  { code: 'pt', name: '葡萄牙语', shortName: '葡萄牙语' },
  { code: 'ru', name: '俄语', shortName: '俄语' },
  { code: 'ar', name: '阿拉伯语', shortName: '阿拉伯语' },
]

export const LANGUAGE_NAMES = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, language.shortName]),
)
