import { normalizeTranslationLanguage } from './translation-languages.js';

export const STORAGE_KEYS = {
  preferences: 'PLUGIN/dagu-ocr/preferences',
  syncedSecrets: 'PLUGIN/dagu-ocr/secrets',
  localSecrets: 'dagu-ocr.secrets',
  localPreferences: 'dagu-ocr.preferences',
  legacyConfig: 'ocr_config',
  history: 'ocr_history'
};

export const DEFAULT_CONFIG = {
  ocrProviderId: '',
  translationProviderId: '',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  syncSecrets: false,
  baiduAk: '',
  baiduSk: '',
  aliAk: '',
  aliSk: '',
  baiduTranslateAppId: '',
  baiduTranslateSecretKey: '',
  myMemoryKey: ''
};

const PREFERENCE_FIELDS = [
  'ocrProviderId',
  'translationProviderId',
  'sourceLang',
  'targetLang',
  'syncSecrets'
];

const SECRET_FIELDS = [
  'baiduAk',
  'baiduSk',
  'aliAk',
  'aliSk',
  'baiduTranslateAppId',
  'baiduTranslateSecretKey',
  'myMemoryKey'
];

function parseStoredValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function getGlobalWindow() {
  return globalThis.window || globalThis;
}

function getLocalStorage() {
  try {
    return getGlobalWindow().localStorage || globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (source && source[field] !== undefined) result[field] = source[field];
    return result;
  }, {});
}

function normalizeConfig(value) {
  const config = {
    ...DEFAULT_CONFIG,
    ...pick(value || {}, PREFERENCE_FIELDS),
    ...pick(value || {}, SECRET_FIELDS)
  };
  config.sourceLang = normalizeTranslationLanguage(config.sourceLang);
  config.targetLang = normalizeTranslationLanguage(config.targetLang);
  return config;
}

function legacyProviderChoices(legacy) {
  const hasBaiduOcr = Boolean(legacy.baiduAk && legacy.baiduSk);
  const hasAli = Boolean(legacy.aliAk && legacy.aliSk);
  const hasBaiduTranslation = Boolean(
    legacy.baiduTranslateAppId && legacy.baiduTranslateSecretKey
  );

  return {
    ocrProviderId: hasBaiduOcr
      ? 'builtin:baidu-ocr'
      : hasAli
        ? 'builtin:ali-ocr'
        : '',
    translationProviderId: hasBaiduTranslation
      ? 'builtin:baidu-translation'
      : hasAli
        ? 'builtin:ali-translation'
        : ''
  };
}

export class SettingsStore {
  constructor({ win, localStorage } = {}) {
    this.win = win || getGlobalWindow();
    this.localStorage = localStorage || getLocalStorage();
  }

  get dbStorage() {
    return this.win?.ztools?.dbStorage || this.win?.utools?.dbStorage || null;
  }

  hasDbStorage() {
    const storage = this.dbStorage;
    return Boolean(
      storage && (
        typeof storage.getItem === 'function' ||
        typeof storage.get === 'function' ||
        typeof storage.setItem === 'function' ||
        typeof storage.set === 'function'
      )
    );
  }

  async readDb(key) {
    const storage = this.dbStorage;
    if (!storage) return null;
    if (typeof storage.getItem === 'function') return parseStoredValue(await storage.getItem(key));
    if (typeof storage.get === 'function') return parseStoredValue(await storage.get(key));
    return null;
  }

  async writeDb(key, value) {
    const storage = this.dbStorage;
    if (!storage) return false;
    if (typeof storage.setItem === 'function') {
      await storage.setItem(key, value);
      return true;
    }
    if (typeof storage.set === 'function') {
      await storage.set(key, value);
      return true;
    }
    return false;
  }

  async removeDb(key) {
    const storage = this.dbStorage;
    if (!storage) return false;
    if (typeof storage.removeItem === 'function') {
      await storage.removeItem(key);
      return true;
    }
    if (typeof storage.delete === 'function') {
      await storage.delete(key);
      return true;
    }
    return false;
  }

  readLocal(key) {
    try {
      return parseStoredValue(this.localStorage?.getItem(key));
    } catch {
      return null;
    }
  }

  writeLocal(key, value) {
    try {
      this.localStorage?.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  removeLocal(key) {
    try {
      this.localStorage?.removeItem?.(key);
    } catch {
      // Storage can be unavailable in private browser contexts.
    }
  }

  async load() {
    let preferences = this.hasDbStorage()
      ? await this.readDb(STORAGE_KEYS.preferences)
      : null;
    if (!preferences) preferences = this.readLocal(STORAGE_KEYS.localPreferences);

    let localSecrets = this.readLocal(STORAGE_KEYS.localSecrets) || {};
    const legacy = this.readLocal(STORAGE_KEYS.legacyConfig);
    let migrated = false;

    if (!preferences && legacy) {
      const choices = legacyProviderChoices(legacy);
      preferences = {
        ...choices,
        sourceLang: legacy.sourceLang || 'auto',
        targetLang: legacy.targetLang || 'zh-CN',
        syncSecrets: false
      };
      localSecrets = { ...localSecrets, ...pick(legacy, SECRET_FIELDS) };
      migrated = true;
    }

    const config = normalizeConfig({ ...preferences, ...localSecrets });

    if (config.syncSecrets && this.hasDbStorage()) {
      const syncedSecrets = await this.readDb(STORAGE_KEYS.syncedSecrets);
      if (syncedSecrets) Object.assign(config, pick(syncedSecrets, SECRET_FIELDS));
    }

    if (migrated) {
      await this.save(config);
      this.removeLocal(STORAGE_KEYS.legacyConfig);
    }

    return config;
  }

  async save(config) {
    const normalized = normalizeConfig(config);
    const preferences = pick(normalized, PREFERENCE_FIELDS);
    const secrets = pick(normalized, SECRET_FIELDS);

    if (this.hasDbStorage()) {
      await this.writeDb(STORAGE_KEYS.preferences, preferences);
    } else {
      this.writeLocal(STORAGE_KEYS.localPreferences, preferences);
    }

    this.writeLocal(STORAGE_KEYS.localSecrets, secrets);
    if (normalized.syncSecrets && this.hasDbStorage()) {
      await this.writeDb(STORAGE_KEYS.syncedSecrets, secrets);
    } else if (this.hasDbStorage()) {
      await this.removeDb(STORAGE_KEYS.syncedSecrets);
    }

    return normalized;
  }

  loadHistory() {
    const parsed = this.readLocal(STORAGE_KEYS.history);
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => item && typeof item.text === 'string')
        .slice(0, 50)
      : [];
  }

  saveHistory(history) {
    this.writeLocal(STORAGE_KEYS.history, history.slice(0, 50));
  }

  clearHistory() {
    this.removeLocal(STORAGE_KEYS.history);
  }
}

export function createSettingsStore(options = {}) {
  return new SettingsStore(options);
}
