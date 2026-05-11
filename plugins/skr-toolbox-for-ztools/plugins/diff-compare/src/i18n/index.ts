/**
 * 国际化配置模块
 * 支持简体中文、繁体中文、英文、日文四种语言
 */

import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import en from './locales/en'
import ja from './locales/ja'

/**
 * 消息类型定义，用于类型安全
 */
export type MessageSchema = typeof zhCN

/**
 * 创建国际化实例
 * - legacy: false 使用 Composition API 风格
 * - locale: 默认语言为简体中文
 * - fallbackLocale: 备用语言为英文
 */
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    en,
    ja
  }
})

export default i18n
