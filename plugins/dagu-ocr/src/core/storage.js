import { createKvStore } from './kv.js';
import { loadSecrets, saveSecrets } from './synced-secrets.js';
import { normalizeTranslationLanguage } from './translation-languages.js';

export const STORAGE_KEYS = {
  preferences: 'PLUGIN/dagu-ocr/preferences',
  syncedSecrets: 'PLUGIN/dagu-ocr/secrets',
  localSecrets: 'dagu-ocr.secrets',
  localPreferences: 'dagu-ocr.preferences',
  legacyConfig: 'ocr_config',
  history: 'ocr_history'
};

const SECRET_KEYS = Object.freeze({ local: STORAGE_KEYS.localSecrets, synced: STORAGE_KEYS.syncedSecrets });

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
    this.kv = createKvStore({ win, localStorage });
  }

  get dbStorage() {
    return this.kv.dbStorage;
  }

  hasDbStorage() {
    return this.kv.hasDbStorage();
  }

  readDb(key) {
    return this.kv.readDb(key);
  }

  writeDb(key, value) {
    return this.kv.writeDb(key, value);
  }

  removeDb(key) {
    return this.kv.removeDb(key);
  }

  readLocal(key) {
    return this.kv.readLocal(key);
  }

  writeLocal(key, value) {
    return this.kv.writeLocal(key, value);
  }

  removeLocal(key) {
    this.kv.removeLocal(key);
  }

  async load() {
    let preferences = this.hasDbStorage()
      ? await this.readDb(STORAGE_KEYS.preferences)
      : null;
    if (!preferences) preferences = this.readLocal(STORAGE_KEYS.localPreferences);

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
      // 旧配置里的密钥并入本机密钥副本。
      this.writeLocal(STORAGE_KEYS.localSecrets, {
        ...this.readLocal(STORAGE_KEYS.localSecrets),
        ...pick(legacy, SECRET_FIELDS)
      });
      migrated = true;
    }

    const secrets = await loadSecrets({
      kv: this.kv,
      keys: SECRET_KEYS,
      sync: normalizeConfig(preferences).syncSecrets,
      fallback: {}
    });
    const config = normalizeConfig({ ...preferences, ...pick(secrets, SECRET_FIELDS) });

    if (migrated) {
      await this.save(config);
      this.removeLocal(STORAGE_KEYS.legacyConfig);
    }

    return config;
  }

  async save(config) {
    const normalized = normalizeConfig(config);
    const preferences = pick(normalized, PREFERENCE_FIELDS);

    if (this.hasDbStorage()) {
      await this.writeDb(STORAGE_KEYS.preferences, preferences);
    } else {
      this.writeLocal(STORAGE_KEYS.localPreferences, preferences);
    }

    await saveSecrets({
      kv: this.kv,
      keys: SECRET_KEYS,
      secrets: pick(normalized, SECRET_FIELDS),
      sync: normalized.syncSecrets
    });

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
