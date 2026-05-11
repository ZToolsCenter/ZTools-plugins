import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import en from '../locales/en.json'

/**
 * 创建并配置Vue i18n实例以进行国际化。
 * 支持中文（zh）作为主要语言和英语（en）作为回退语言。
 */
export const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'en',
  messages: {
    zh,
    en
  }
})
