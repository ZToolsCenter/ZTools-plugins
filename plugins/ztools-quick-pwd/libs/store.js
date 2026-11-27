const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let vaultFilePath = '';

/**
 * 初始化存储路径
 * @param {string} userDataPath ZTools 用户数据目录
 */
function init(userDataPath) {
  const dir = path.join(userDataPath, 'ztools-quick-pwd');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  vaultFilePath = path.join(dir, 'vault.json');
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * 默认空的 vault 结构
 */
function getDefaultVault() {
  return {
    version: 1,
    salt: null,
    verifyToken: null,
    autoUnlockKey: null,
    entries: [],
    config: {
      middleClickTrigger: false,
      autoClearClipboardSeconds: 10,
      holdDurationMs: 500,
      fillMode: 'paste',
      fillDelayMs: 450,
      tabDelayMs: 180,
      fillStrategy: 'both',
      openStandaloneByDefault: false,
      autoLockMinutes: 0,
      requireMasterPin: true
    }
  };
}

/**
 * 读取 vault.json
 * @returns {object}
 */
function load() {
  if (!vaultFilePath) {
    throw new Error('Store 尚未初始化，请先调用 init(userDataPath)');
  }
  const defaults = getDefaultVault();
  if (!fs.existsSync(vaultFilePath)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(vaultFilePath, 'utf8');
    const data = JSON.parse(raw);
    const rawConfig = data.config || {};
    const parsedTabDelay = parseInt(rawConfig.tabDelayMs, 10);
    const parsedAutoLock = parseInt(rawConfig.autoLockMinutes, 10);

    return {
      version: data.version || 1,
      salt: data.salt || null,
      verifyToken: data.verifyToken || null,
      autoUnlockKey: (typeof data.autoUnlockKey === 'string' && data.autoUnlockKey.length > 0) ? data.autoUnlockKey : null,
      entries: Array.isArray(data.entries) ? data.entries : [],
      config: Object.assign({}, defaults.config, rawConfig, {
        middleClickTrigger: false,
        tabDelayMs: Number.isFinite(parsedTabDelay) && parsedTabDelay > 0 ? parsedTabDelay : defaults.config.tabDelayMs,
        autoLockMinutes: Number.isFinite(parsedAutoLock) && parsedAutoLock >= 0 ? parsedAutoLock : defaults.config.autoLockMinutes,
        fillStrategy: rawConfig.fillStrategy || defaults.config.fillStrategy,
        openStandaloneByDefault: rawConfig.openStandaloneByDefault === true,
        requireMasterPin: rawConfig.requireMasterPin !== false
      })
    };
  } catch (err) {
    console.error('读取 vault.json 失败:', err);
    return defaults;
  }
}

/**
 * 原子化保存 vault.json
 * 先写入临时文件，再原子替换原文件
 * @param {object} vault
 */
function save(vault) {
  if (!vaultFilePath) {
    throw new Error('Store 尚未初始化，请先调用 init(userDataPath)');
  }
  const dir = path.dirname(vaultFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = path.join(dir, `vault.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`);
  const jsonStr = JSON.stringify(vault, null, 2);

  fs.writeFileSync(tmpPath, jsonStr, 'utf8');
  try {
    fs.renameSync(tmpPath, vaultFilePath);
  } catch (err) {
    // 兼容 Windows 下同名覆盖异常，先尝试删除目标文件
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      try {
        fs.unlinkSync(vaultFilePath);
        fs.renameSync(tmpPath, vaultFilePath);
      } catch (innerErr) {
        fs.unlinkSync(tmpPath);
        throw innerErr;
      }
    } else {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
      throw err;
    }
  }
}

module.exports = {
  init,
  load,
  save,
  newId,
  getDefaultVault
};
