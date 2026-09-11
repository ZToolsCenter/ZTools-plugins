// ZTools ccToggle - crypto.ts
// API Key 加密模块：Node 内置 crypto，AES-256-GCM
// 主密钥由 safeStorage 托管（不可用时退化为 dbCryptoStorage，二者均为 OS 级加密）

const crypto = require('crypto');

const MASTER_KEY_STORAGE = 'cctoggle_master_key';

let _cachedMasterKey: Buffer | null = null;

/** 尝试获取 Electron safeStorage（渲染进程通常不可用） */
function getSafeStorage(): any {
  try {
    const electron = require('electron');
    if (electron && electron.safeStorage) {
      return electron.safeStorage;
    }
  } catch (e) {}
  return null;
}

/** 将主密钥持久化：优先 safeStorage 加密存 dbStorage，否则存 dbCryptoStorage */
function persistMasterKey(key: Buffer): void {
  const safe = getSafeStorage();
  try {
    if (safe) {
      const blob = safe.encryptString(key.toString('base64')).toString('base64');
      ztools.dbStorage.setItem(MASTER_KEY_STORAGE, 'enc:' + blob);
      return;
    }
  } catch (e) {
    // safeStorage 失败则退化为 dbCryptoStorage
  }
  try {
    ztools.dbStorage.setItem(MASTER_KEY_STORAGE, key.toString('base64'));
  } catch (e) {
    console.error('[Crypto] Failed to persist master key:', e);
  }
}

/** 读取持久化的主密钥，读取失败返回 null */
function loadMasterKey(): Buffer | null {
  // 1. safeStorage 路径（enc: 前缀，存于 dbStorage）
  try {
    const raw = ztools.dbStorage.getItem(MASTER_KEY_STORAGE);
    if (raw) {
      const str = typeof raw === 'object' ? raw.value || '' : String(raw);
      if (str.indexOf('enc:') === 0) {
        const safe = getSafeStorage();
        if (safe) {
          const plain = safe.decryptString(Buffer.from(str.slice(4), 'base64'));
          const key = Buffer.from(plain, 'base64');
          if (key.length === 32) return key;
        }
      }
    }
  } catch (e) {}

  // 2. dbCryptoStorage 路径（OS 级加密）
  try {
    const raw = ztools.dbStorage.getItem(MASTER_KEY_STORAGE);
    if (raw) {
      const key = Buffer.from(String(raw), 'base64');
      if (key.length === 32) return key;
    }
  } catch (e) {}

  return null;
}

/**
 * 获取主密钥（32 字节）
 * 首次调用时生成随机密钥并持久化，此后返回内存缓存
 */
export function getMasterKey(): Buffer {
  if (_cachedMasterKey) return _cachedMasterKey;

  const existing = loadMasterKey();
  if (existing) {
    _cachedMasterKey = existing;
    return existing;
  }

  const key = crypto.randomBytes(32);
  persistMasterKey(key);
  _cachedMasterKey = key;
  return key;
}

/** 加密：明文 → `v1:{iv_hex}:{tag_hex}:{ciphertext_hex}` */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + ciphertext.toString('hex');
}

/** 解密：`v1:{iv_hex}:{tag_hex}:{ciphertext_hex}` → 明文，失败抛错 */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('invalid encrypted payload');
  }
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString(
    'utf8'
  );
}

/** 旧 dbCryptoStorage Key 是否存在（供迁移/兜底识别） */
export function isCryptoStorageKey(appType: string, providerId: string): boolean {
  try {
    const raw = ztools.dbStorage.getItem('apikey_' + appType + '_' + providerId);
    return !!raw;
  } catch (e) {
    return false;
  }
}

/** 回读旧 dbCryptoStorage Key（兼容期兜底） */
export function getCryptoStorageKey(appType: string, providerId: string): string {
  try {
    return ztools.dbStorage.getItem('apikey_' + appType + '_' + providerId) || '';
  } catch (e) {
    return '';
  }
}
