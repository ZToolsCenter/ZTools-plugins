import { createI18n } from 'vue-i18n';
import zh from './locales/zh';
import en from './locales/en';

const i18n = createI18n({
  legacy: false, // Use Composition API
  locale: 'zh', // Default locale
  fallbackLocale: 'en',
  messages: {
    zh,
    en
  }
});

export default i18n;
