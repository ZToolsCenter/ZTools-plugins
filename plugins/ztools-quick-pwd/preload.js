const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./libs/store');
const cryptoLib = require('./libs/crypto');
const mouseHook = require('./libs/mouse-hook');

let nativeAddon = null;
function getNativeAddon() {
  if (nativeAddon) return nativeAddon;
  const platform = os.platform();
  const sub = platform === 'darwin' ? 'mac' : 'win';
  const fileName = 'ztools_native.node';

  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'lib', sub, fileName) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'lib', sub, fileName) : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'ZTools', 'resources', 'app.asar.unpacked', 'resources', 'lib', sub, fileName) : null,
    platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'ZTools', 'resources', 'app.asar.unpacked', 'resources', 'lib', sub, fileName) : null,
    path.join(__dirname, '..', '..', 'resources', 'lib', sub, fileName),
    path.join(__dirname, '..', '..', '..', 'ZTools', 'resources', 'lib', sub, fileName)
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        nativeAddon = require(p);
        break;
      }
    } catch (e) {}
  }
  return nativeAddon;
}

// 获取当前运行的 ZTools / uTools API 对象
function getZTools() {
  if (typeof window !== 'undefined') {
    if (window.ztools) return window.ztools;
    if (window.utools) return window.utools;
  }
  if (typeof globalThis !== 'undefined') {
    if (globalThis.ztools) return globalThis.ztools;
    if (globalThis.utools) return globalThis.utools;
  }
  if (typeof ztools !== 'undefined') return ztools;
  if (typeof utools !== 'undefined') return utools;
  return null;
}

let electron = null;
try {
  electron = require('electron');
} catch (e) {}

// 内存中缓存的主密钥 Buffer（插件锁定时置 null）
let cachedMasterKey = null;

// 全局独立窗口引用（单例持久化）
let standaloneWindow = null;

// 模块级状态与防重入锁
let isAutoFilling = false;
let clearClipboardTimer = null;
let lastSensitiveClipboard = null;
let lastActivityAt = Date.now();
let autoLockCheckInterval = null;

// 延时工具
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 安全读取当前系统剪贴板文本（失败或不支持时返回 null）
function readClipboardSafe() {
  if (electron && electron.clipboard && typeof electron.clipboard.readText === 'function') {
    try {
      return electron.clipboard.readText();
    } catch (e) {}
  }
  return null;
}

/**
 * 单一通道、带回读校验的可靠剪贴板写入
 * 严禁并发调用多个写剪贴板接口，杜绝异步竞态导致内容覆盖或乱序
 */
async function writeClipboardReliable(text) {
  const targetText = String(text ?? '');
  const z = getZTools();

  // 通道 1（首选）：使用 Electron 原生剪贴板，写入后立即回读校验是否真正落盘
  if (electron && electron.clipboard && typeof electron.clipboard.writeText === 'function') {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        electron.clipboard.writeText(targetText);
        if (typeof electron.clipboard.readText === 'function') {
          if (electron.clipboard.readText() === targetText) {
            return true;
          }
        } else {
          await sleep(30);
          return true;
        }
      } catch (e) {}
      await sleep(15);
    }
  }

  // 通道 2（降级）：ZTools 官方 copyText
  if (z && typeof z.copyText === 'function') {
    try {
      z.copyText(targetText);
      await sleep(50);
      return true;
    } catch (e) {}
  }

  // 通道 3（纯浏览器兜底）：必须 await 异步落盘
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(targetText);
      return true;
    } catch (e) {}
  }

  return false;
}

// 取消待执行的敏感剪贴板清理定时器
function cancelClipboardClear() {
  if (clearClipboardTimer) {
    clearTimeout(clearClipboardTimer);
    clearClipboardTimer = null;
  }
  lastSensitiveClipboard = null;
}

// 执行一次智能剪贴板清理（仅当剪贴板内容未变化或无法回读时才清空）
async function performSmartClipboardClear(expectedSecret) {
  const current = readClipboardSafe();
  if (current !== null && current !== expectedSecret) {
    return false;
  }
  await writeClipboardReliable('');
  return true;
}

// 计划在指定秒数后安全清理剪贴板中的敏感密码
function scheduleClipboardClear(secretText, seconds) {
  cancelClipboardClear();
  if (!secretText) return;
  const safeSeconds = Math.max(3, parseInt(seconds, 10) || 10);
  lastSensitiveClipboard = secretText;
  clearClipboardTimer = setTimeout(() => {
    const expected = lastSensitiveClipboard;
    clearClipboardTimer = null;
    lastSensitiveClipboard = null;
    if (expected) {
      performSmartClipboardClear(expected).catch(() => {});
    }
  }, safeSeconds * 1000);
}

// 启动空闲自动锁定检查定时器
function ensureAutoLockMonitor() {
  if (autoLockCheckInterval) return;
  autoLockCheckInterval = setInterval(() => {
    try {
      if (!cachedMasterKey) return;
      const vault = store.load();
      if (vault?.config?.requireMasterPin === false) return;
      const autoLockMinutes = parseInt(vault?.config?.autoLockMinutes, 10) || 0;
      if (autoLockMinutes > 0) {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= autoLockMinutes * 60 * 1000) {
          pwdApi.lock();
        }
      }
    } catch (e) {}
  }, 30 * 1000);
  if (typeof autoLockCheckInterval.unref === 'function') {
    autoLockCheckInterval.unref();
  }
}

// 免密模式下自动恢复内存主密钥
function tryAutoUnlock() {
  if (cachedMasterKey) return true;
  try {
    const vault = store.load();
    if (
      vault &&
      vault.config &&
      vault.config.requireMasterPin === false &&
      typeof vault.autoUnlockKey === 'string' &&
      /^[0-9a-fA-F]{64}$/.test(vault.autoUnlockKey) &&
      isValidCipherObj(vault.verifyToken)
    ) {
      const autoKey = Buffer.from(vault.autoUnlockKey, 'hex');
      const plain = cryptoLib.decrypt(autoKey, vault.verifyToken);
      if (plain === 'VALID_MASTER_TOKEN') {
        cachedMasterKey = autoKey;
        lastActivityAt = Date.now();
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// 脱敏转换与智能排序（置顶优先 -> 最近使用 -> 最近更新 -> 最近创建）
function toSafeEntry(item) {
  return {
    id: item.id,
    label: item.label,
    username: item.username || '',
    note: item.note || '',
    pinned: !!item.pinned,
    lastUsedAt: item.lastUsedAt || 0,
    useCount: item.useCount || 0,
    createdAt: item.createdAt || 0,
    updatedAt: item.updatedAt || 0
  };
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    const usedDiff = (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    if (usedDiff !== 0) return usedDiff;
    const updDiff = (b.updatedAt || 0) - (a.updatedAt || 0);
    if (updDiff !== 0) return updDiff;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// 初始化存储
const zObj = getZTools();
if (zObj && typeof zObj.getPath === 'function') {
  try {
    store.init(zObj.getPath('userData'));
  } catch (e) {
    store.init(path.join(os.homedir(), '.ztools'));
  }
} else {
  store.init(path.join(os.homedir(), '.ztools'));
}

// 彻底停用并清理插件内置的冗余鼠标监听，完全交由 ZTools 超级面板接管
function checkAutoStartMouseHook() {
  try {
    stopMouseHook();
  } catch (e) {}
}

// 启动鼠标中键监听
function startMouseHook() {
  const vault = store.load();
  const holdMs = (vault.config && vault.config.holdDurationMs) || 500;

  return mouseHook.start({
    holdDurationMs: holdMs,
    onTrigger: () => {
      if (typeof ztools !== 'undefined') {
        try {
          if (typeof ztools.showMainWindow === 'function') {
            ztools.showMainWindow();
          }
          if (typeof ztools.redirect === 'function') {
            ztools.redirect('pwd-quick-fill', '');
          }
        } catch (e) {
          console.error('[preload] 触发快速选密界面异常:', e);
        }
      }
    }
  });
}

// 停止鼠标中键监听
function stopMouseHook() {
  mouseHook.stop();
  return true;
}

// 校验密文对象结构
function isValidCipherObj(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.data === 'string'
  );
}

// 密码管理器核心 API
const pwdApi = {
  /**
   * 仅测试/工具用途：外部刷新存储路径
   */
  initStorePath(userDataPath) {
    store.init(userDataPath);
  },

  /**
   * 刷新最近活动时间（用于空闲自动锁定计时）
   */
  touchActivity() {
    lastActivityAt = Date.now();
  },

  /**
   * 判断是否首次运行（未设置主密码）
   */
  isFirstRun() {
    const vault = store.load();
    return !vault.salt || !vault.verifyToken;
  },

  /**
   * 首次设置主密码 PIN
   * @param {string} pin
   */
  setupMasterPin(pin) {
    if (!pin || pin.length < 4) {
      throw new Error('主密码长度不能少于 4 位');
    }
    const salt = cryptoLib.generateSalt();
    const masterKey = cryptoLib.deriveMasterKey(pin, salt);
    // 加密一个固定的校验串，用于后续校验解锁 PIN 是否正确
    const verifyToken = cryptoLib.encrypt(masterKey, 'VALID_MASTER_TOKEN');

    const vault = store.load();
    vault.salt = salt;
    vault.verifyToken = verifyToken;
    vault.autoUnlockKey = null;
    vault.config = Object.assign(vault.config || {}, { requireMasterPin: true });
    store.save(vault);

    cachedMasterKey = masterKey;
    lastActivityAt = Date.now();
    pwdApi.broadcastMessage('sync-auth', { masterKeyHex: masterKey.toString('hex') });
    pwdApi.broadcastMessage('config-updated');
    return true;
  },

  /**
   * 首次免密初始化（生成一个随机设备密钥以保持密码库仍为 AES-256-GCM 加密）
   */
  setupWithoutMasterPin() {
    const vault = store.load();
    if (vault.salt && vault.verifyToken) {
      throw new Error('保险库已初始化，请在设置中管理主密码开关');
    }

    const salt = cryptoLib.generateSalt();
    const autoKey = crypto.randomBytes(32);
    const verifyToken = cryptoLib.encrypt(autoKey, 'VALID_MASTER_TOKEN');

    vault.salt = salt;
    vault.verifyToken = verifyToken;
    vault.autoUnlockKey = autoKey.toString('hex');
    vault.config = Object.assign(vault.config || {}, { requireMasterPin: false });
    store.save(vault);

    cachedMasterKey = autoKey;
    lastActivityAt = Date.now();
    pwdApi.broadcastMessage('sync-auth', { masterKeyHex: autoKey.toString('hex') });
    pwdApi.broadcastMessage('config-updated');
    return true;
  },

  /**
   * 解锁主密码
   * @param {string} pin
   */
  unlock(pin) {
    const vault = store.load();
    if (!vault.salt || !vault.verifyToken) {
      throw new Error('尚未设置主密码，请先完成初始设置');
    }
    try {
      const masterKey = cryptoLib.deriveMasterKey(pin, vault.salt);
      const plain = cryptoLib.decrypt(masterKey, vault.verifyToken);
      if (plain === 'VALID_MASTER_TOKEN') {
        cachedMasterKey = masterKey;
        lastActivityAt = Date.now();
        pwdApi.broadcastMessage('sync-auth', { masterKeyHex: masterKey.toString('hex') });
        return true;
      }
    } catch (e) {
      // 解密失败说明 PIN 错误
    }
    return false;
  },

  /**
   * 修改主密码（验证原密码并使用新盐值重新加密全部密码条目）
   * @param {string} oldPin
   * @param {string} newPin
   */
  changeMasterPin(oldPin, newPin) {
    if (!newPin || newPin.length < 4) {
      throw new Error('新主密码长度不能少于 4 位');
    }
    const vault = store.load();
    if (vault?.config?.requireMasterPin === false) {
      throw new Error('当前处于免密模式，请先开启主密码解锁保护');
    }
    if (!vault.salt || !vault.verifyToken) {
      throw new Error('尚未设置主密码');
    }

    let oldKey;
    try {
      oldKey = cryptoLib.deriveMasterKey(oldPin, vault.salt);
      const plain = cryptoLib.decrypt(oldKey, vault.verifyToken);
      if (plain !== 'VALID_MASTER_TOKEN') {
        throw new Error('原主密码校验失败');
      }
    } catch (e) {
      throw new Error('原主密码不正确');
    }

    // 先全部解密，防止中途出错导致数据不一致
    const plainPasswords = vault.entries.map((item) => ({
      id: item.id,
      plainPwd: cryptoLib.decrypt(oldKey, item.encryptedPwd)
    }));

    const newSalt = cryptoLib.generateSalt();
    const newKey = cryptoLib.deriveMasterKey(newPin, newSalt);
    const newVerifyToken = cryptoLib.encrypt(newKey, 'VALID_MASTER_TOKEN');

    const pwdMap = new Map(plainPasswords.map((x) => [x.id, x.plainPwd]));
    vault.salt = newSalt;
    vault.verifyToken = newVerifyToken;
    vault.autoUnlockKey = null;
    vault.entries = vault.entries.map((item) => {
      const plain = pwdMap.get(item.id);
      return Object.assign({}, item, {
        encryptedPwd: cryptoLib.encrypt(newKey, plain)
      });
    });

    store.save(vault);
    cachedMasterKey = newKey;
    lastActivityAt = Date.now();
    pwdApi.broadcastMessage('sync-auth', { masterKeyHex: newKey.toString('hex') });
    return true;
  },

  /**
   * 关闭主密码解锁保护（必须已在内存解锁，使用全新随机设备密钥重新加密全库）
   */
  disableMasterPin() {
    if (!cachedMasterKey) {
      throw new Error('保险库已锁定，请先解锁后再关闭主密码保护');
    }
    const vault = store.load();
    if (vault?.config?.requireMasterPin === false && vault.autoUnlockKey) {
      return true;
    }

    // 先用当前内存主密钥解密所有条目，避免与原主密码产生任何耦合
    const plainPasswords = vault.entries.map((item) => ({
      id: item.id,
      plainPwd: cryptoLib.decrypt(cachedMasterKey, item.encryptedPwd)
    }));

    const newSalt = cryptoLib.generateSalt();
    const autoKey = crypto.randomBytes(32);
    const newVerifyToken = cryptoLib.encrypt(autoKey, 'VALID_MASTER_TOKEN');
    const pwdMap = new Map(plainPasswords.map((x) => [x.id, x.plainPwd]));

    vault.salt = newSalt;
    vault.verifyToken = newVerifyToken;
    vault.autoUnlockKey = autoKey.toString('hex');
    vault.config = Object.assign(vault.config || {}, { requireMasterPin: false });
    vault.entries = vault.entries.map((item) => {
      const plain = pwdMap.get(item.id);
      return Object.assign({}, item, {
        encryptedPwd: cryptoLib.encrypt(autoKey, plain)
      });
    });

    store.save(vault);
    cachedMasterKey = autoKey;
    lastActivityAt = Date.now();
    pwdApi.broadcastMessage('sync-auth', { masterKeyHex: autoKey.toString('hex') });
    pwdApi.broadcastMessage('config-updated');
    return true;
  },

  /**
   * 重新开启主密码解锁保护（设置新主密码并重新加密全库，彻底清除自动密钥）
   * @param {string} newPin
   */
  enableMasterPin(newPin) {
    if (!newPin || newPin.length < 4) {
      throw new Error('新主密码长度不能少于 4 位');
    }
    tryAutoUnlock();
    if (!cachedMasterKey) {
      throw new Error('保险库未解锁，无法开启主密码保护');
    }

    const vault = store.load();
    const plainPasswords = vault.entries.map((item) => ({
      id: item.id,
      plainPwd: cryptoLib.decrypt(cachedMasterKey, item.encryptedPwd)
    }));

    const newSalt = cryptoLib.generateSalt();
    const newKey = cryptoLib.deriveMasterKey(newPin, newSalt);
    const newVerifyToken = cryptoLib.encrypt(newKey, 'VALID_MASTER_TOKEN');
    const pwdMap = new Map(plainPasswords.map((x) => [x.id, x.plainPwd]));

    vault.salt = newSalt;
    vault.verifyToken = newVerifyToken;
    vault.autoUnlockKey = null;
    vault.config = Object.assign(vault.config || {}, { requireMasterPin: true });
    vault.entries = vault.entries.map((item) => {
      const plain = pwdMap.get(item.id);
      return Object.assign({}, item, {
        encryptedPwd: cryptoLib.encrypt(newKey, plain)
      });
    });

    store.save(vault);
    cachedMasterKey = newKey;
    lastActivityAt = Date.now();
    pwdApi.broadcastMessage('sync-auth', { masterKeyHex: newKey.toString('hex') });
    pwdApi.broadcastMessage('config-updated');
    return true;
  },

  /**
   * 检查是否启用了主密码解锁保护
   */
  isMasterPinRequired() {
    const vault = store.load();
    return vault?.config?.requireMasterPin !== false;
  },

  /**
   * 锁定（清空内存主密钥；免密模式下不执行锁定）
   */
  lock() {
    if (!this.isMasterPinRequired()) {
      return false;
    }
    cachedMasterKey = null;
    pwdApi.broadcastMessage('sync-lock');
    return true;
  },

  /**
   * 检查是否已解锁（免密模式下自动恢复内存密钥）
   */
  isUnlocked() {
    if (!cachedMasterKey) {
      tryAutoUnlock();
    }
    return !!cachedMasterKey;
  },

  getMasterKeyHex() {
    return cachedMasterKey ? cachedMasterKey.toString('hex') : null;
  },

  setMasterKeyHex(hex) {
    if (hex && typeof hex === 'string') {
      try {
        cachedMasterKey = Buffer.from(hex, 'hex');
        lastActivityAt = Date.now();
        return true;
      } catch (e) {}
    }
    return false;
  },

  /**
   * 获取脱敏密码列表（不返回加密数据），按置顶与最近使用排序
   */
  listEntries() {
    const vault = store.load();
    return sortEntries(vault.entries.map(toSafeEntry));
  },

  /**
   * 获取单条条目元信息
   * @param {string} id
   */
  getEntry(id) {
    const vault = store.load();
    const item = vault.entries.find((e) => e.id === id);
    if (!item) return null;
    return toSafeEntry(item);
  },

  /**
   * 添加密码条目
   * @param {string} label 标签/网站名称
   * @param {string} username 用户名/账号
   * @param {string} plainPwd 密码明文
   * @param {object} [extra] 可选扩展字段 { note, pinned }
   */
  addEntry(label, username, plainPwd, extra = {}) {
    if (!cachedMasterKey) {
      tryAutoUnlock();
    }
    if (!cachedMasterKey) {
      throw new Error('保险库已锁定，请先解锁');
    }
    if (!label || !plainPwd) {
      throw new Error('名称与密码不能为空');
    }

    lastActivityAt = Date.now();
    const encryptedPwd = cryptoLib.encrypt(cachedMasterKey, plainPwd);
    const vault = store.load();
    const now = Date.now();
    const newEntry = {
      id: store.newId(),
      label: label.trim(),
      username: (username || '').trim(),
      note: (extra && typeof extra.note === 'string' ? extra.note : '').trim(),
      pinned: !!(extra && extra.pinned),
      lastUsedAt: 0,
      useCount: 0,
      encryptedPwd,
      createdAt: now,
      updatedAt: now
    };
    vault.entries.unshift(newEntry);
    store.save(vault);
    pwdApi.broadcastMessage('data-updated');
    return newEntry.id;
  },

  /**
   * 获取指定条目的明文密码
   * @param {string} id
   */
  getPlainPwd(id) {
    if (!cachedMasterKey) {
      tryAutoUnlock();
    }
    if (!cachedMasterKey) {
      throw new Error('保险库已锁定，请先解锁');
    }
    lastActivityAt = Date.now();
    const vault = store.load();
    const item = vault.entries.find((e) => e.id === id);
    if (!item) {
      throw new Error('条目不存在');
    }
    return cryptoLib.decrypt(cachedMasterKey, item.encryptedPwd);
  },

  /**
   * 更新条目
   * @param {string} id
   * @param {string} label
   * @param {string} username
   * @param {string} [plainPwd] 可选，为空时不修改原密码
   * @param {object} [extra] 可选扩展字段 { note, pinned }
   */
  updateEntry(id, label, username, plainPwd, extra = {}) {
    if (!cachedMasterKey) {
      tryAutoUnlock();
    }
    if (!cachedMasterKey) {
      throw new Error('保险库已锁定，请先解锁');
    }
    lastActivityAt = Date.now();
    const vault = store.load();
    const item = vault.entries.find((e) => e.id === id);
    if (!item) {
      throw new Error('条目不存在');
    }
    item.label = label.trim();
    item.username = (username || '').trim();
    if (extra && extra.note !== undefined) {
      item.note = String(extra.note || '').trim();
    }
    if (extra && extra.pinned !== undefined) {
      item.pinned = !!extra.pinned;
    }
    if (plainPwd && plainPwd.length > 0) {
      item.encryptedPwd = cryptoLib.encrypt(cachedMasterKey, plainPwd);
    }
    item.updatedAt = Date.now();
    store.save(vault);
    pwdApi.broadcastMessage('data-updated');
    return true;
  },

  /**
   * 切换置顶状态
   * @param {string} id
   */
  togglePin(id) {
    lastActivityAt = Date.now();
    const vault = store.load();
    const item = vault.entries.find((e) => e.id === id);
    if (!item) {
      throw new Error('条目不存在');
    }
    item.pinned = !item.pinned;
    store.save(vault);
    pwdApi.broadcastMessage('data-updated');
    return item.pinned;
  },

  /**
   * 记录条目最近使用时间与使用次数
   * @param {string} id
   */
  recordUsage(id) {
    if (!id) return false;
    try {
      const vault = store.load();
      const item = vault.entries.find((e) => e.id === id);
      if (!item) return false;
      item.lastUsedAt = Date.now();
      item.useCount = (item.useCount || 0) + 1;
      store.save(vault);
      pwdApi.broadcastMessage('data-updated');
      return true;
    } catch (e) {
      return false;
    }
  },

  /**
   * 删除条目
   * @param {string} id
   */
  deleteEntry(id) {
    lastActivityAt = Date.now();
    const vault = store.load();
    const index = vault.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error('条目不存在');
    }
    vault.entries.splice(index, 1);
    store.save(vault);
    pwdApi.broadcastMessage('data-updated');
    return true;
  },

  /**
   * 导出加密备份 JSON 字符串（免密模式包含 autoUnlockKey；主密码模式严禁包含 autoUnlockKey）
   */
  exportVaultJson() {
    const vault = store.load();
    const isPinDisabled = vault?.config?.requireMasterPin === false && !!vault.autoUnlockKey;
    const payload = {
      version: vault.version || 1,
      exportedAt: new Date().toISOString(),
      requireMasterPin: !isPinDisabled,
      salt: vault.salt,
      verifyToken: vault.verifyToken,
      entries: vault.entries
    };
    if (isPinDisabled) {
      payload.autoUnlockKey = vault.autoUnlockKey;
    }
    return JSON.stringify(payload, null, 2);
  },

  /**
   * 导入加密备份 JSON 字符串
   * @param {string} jsonStr
   * @returns {{ unlocked: boolean, count: number, requireMasterPin: boolean }}
   */
  importVaultJson(jsonStr) {
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('备份文件不是有效的 JSON 格式');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('备份文件格式错误');
    }
    if (!parsed.salt || typeof parsed.salt !== 'string') {
      throw new Error('备份缺少有效的加密盐值 (salt)');
    }
    if (!isValidCipherObj(parsed.verifyToken)) {
      throw new Error('备份缺少有效的校验令牌 (verifyToken)');
    }
    if (!Array.isArray(parsed.entries)) {
      throw new Error('备份缺少条目列表 (entries)');
    }
    for (let i = 0; i < parsed.entries.length; i++) {
      const entry = parsed.entries[i];
      if (!entry || !entry.id || !entry.label || !isValidCipherObj(entry.encryptedPwd)) {
        throw new Error(`备份第 ${i + 1} 条记录结构不完整`);
      }
    }

    const currentVault = store.load();
    const isPinDisabledBackup =
      parsed.requireMasterPin === false &&
      typeof parsed.autoUnlockKey === 'string' &&
      /^[0-9a-fA-F]{64}$/.test(parsed.autoUnlockKey);

    if (isPinDisabledBackup) {
      let autoKey = null;
      let validAutoBackup = false;
      try {
        autoKey = Buffer.from(parsed.autoUnlockKey, 'hex');
        const plain = cryptoLib.decrypt(autoKey, parsed.verifyToken);
        validAutoBackup = plain === 'VALID_MASTER_TOKEN';
      } catch (e) {}

      if (!validAutoBackup) {
        throw new Error('免密备份校验失败，自动密钥与校验令牌不匹配');
      }

      const nextVault = {
        version: parsed.version || 1,
        salt: parsed.salt,
        verifyToken: parsed.verifyToken,
        autoUnlockKey: parsed.autoUnlockKey,
        entries: parsed.entries,
        config: Object.assign({}, currentVault.config, { requireMasterPin: false })
      };
      store.save(nextVault);
      cachedMasterKey = autoKey;
      lastActivityAt = Date.now();
      pwdApi.broadcastMessage('sync-auth', { masterKeyHex: autoKey.toString('hex') });
      pwdApi.broadcastMessage('data-updated');
      pwdApi.broadcastMessage('config-updated');

      return {
        unlocked: true,
        count: nextVault.entries.length,
        requireMasterPin: false
      };
    }

    const nextVault = {
      version: parsed.version || 1,
      salt: parsed.salt,
      verifyToken: parsed.verifyToken,
      autoUnlockKey: null,
      entries: parsed.entries,
      config: Object.assign({}, currentVault.config, { requireMasterPin: true })
    };
    store.save(nextVault);

    let stillUnlocked = false;
    if (cachedMasterKey) {
      try {
        const plain = cryptoLib.decrypt(cachedMasterKey, nextVault.verifyToken);
        if (plain === 'VALID_MASTER_TOKEN') {
          stillUnlocked = true;
        }
      } catch (e) {}
    }

    if (stillUnlocked) {
      lastActivityAt = Date.now();
      pwdApi.broadcastMessage('data-updated');
    } else {
      cachedMasterKey = null;
      pwdApi.broadcastMessage('sync-lock');
    }
    pwdApi.broadcastMessage('config-updated');

    return {
      unlocked: stillUnlocked,
      count: nextVault.entries.length,
      requireMasterPin: true
    };
  },

  /**
   * 安全复制敏感明文密码到剪贴板，并按配置计划自动清空
   * @param {string} plainText
   */
  async copySecret(plainText) {
    lastActivityAt = Date.now();
    const ok = await writeClipboardReliable(plainText);
    if (ok) {
      const config = this.getConfig();
      const seconds = config.autoClearClipboardSeconds || 10;
      scheduleClipboardClear(plainText, seconds);
    }
    return ok;
  },

  /**
   * 复制普通非敏感文本（如用户名），并取消旧敏感清理定时器防误清
   * @param {string} text
   */
  async copyPlainText(text) {
    lastActivityAt = Date.now();
    cancelClipboardClear();
    return writeClipboardReliable(text);
  },

  /**
   * 获取配置
   */
  getConfig() {
    const vault = store.load();
    return Object.assign({}, vault.config, {
      mouseHookRunning: mouseHook.isRunning()
    });
  },

  /**
   * 更新配置（不允许通过普通配置接口直接绕过加密流程篡改 requireMasterPin）
   * @param {object} patch
   */
  setConfig(patch) {
    const vault = store.load();
    const safePatch = Object.assign({}, patch);
    delete safePatch.requireMasterPin;
    vault.config = Object.assign(vault.config || {}, safePatch);
    store.save(vault);

    vault.config.middleClickTrigger = false;
    stopMouseHook();
    return vault.config;
  },

  /**
   * 获取当前运行平台 ('win32' | 'darwin' | 'linux')
   */
  getPlatform() {
    return process.platform;
  },

  /**
   * 自动将密码安全填入目标前台窗口
   * @param {string} plainPwd 密码明文
   * @param {string} [mode='paste'] 'paste' | 'type'
   * @param {boolean} [isDetachedMode=false] 是否处于独立窗口中
   */
  async autoFill(plainPwd, mode = 'paste', isDetachedMode = false) {
    return this.autoFillCredentials({
      password: plainPwd,
      mode,
      fillBoth: false,
      isDetachedMode
    });
  },

  /**
   * 自动将账号与密码填入前台窗口对应输入框中（支持 账号 ➔ Tab ➔ 密码 双框严格保序联动）
   * @param {object} options
   * @param {string} [options.entryId] 条目 ID（用于填充后静默记录使用统计）
   * @param {string} [options.username] 账号/用户名
   * @param {string} [options.password] 密码明文（仅填账号时可为空）
   * @param {string} [options.mode='paste'] 'paste' | 'type'
   * @param {boolean} [options.fillBoth=true] 是否自动联动填充账号与密码（fillTarget 未指定时生效）
   * @param {string} [options.fillTarget] 填充目标：'both' | 'username' | 'password'
   * @param {boolean} [options.isDetachedMode=false] 是否处于独立窗口中
   * @param {number} [options.tabDelayMs] Tab 切换键后等待时长（未传入时读取配置）
   */
  async autoFillCredentials({ entryId, username, password, mode = 'paste', fillBoth = true, fillTarget, isDetachedMode = false, tabDelayMs }) {
    if (isAutoFilling) {
      return false;
    }

    const z = getZTools();
    const addon = getNativeAddon();
    const isMac = process.platform === 'darwin';

    const cleanUsername = (username || '').trim();
    const plainPassword = password || '';

    // 解析最终填充目标，兼容旧的 fillBoth 布尔参数
    let target = fillTarget;
    if (!target) {
      target = fillBoth && cleanUsername ? 'both' : 'password';
    }
    if (target === 'both' && !cleanUsername) target = 'password';
    if (target === 'username' && !cleanUsername) return false;
    if (target !== 'username' && !plainPassword) return false;

    const shouldFillBoth = target === 'both';

    isAutoFilling = true;
    lastActivityAt = Date.now();

    try {
      // 第一步立刻取消上一次剪贴板清理计划，杜绝旧定时器在本次填充中途误清空剪贴板
      cancelClipboardClear();

      // 统一读取配置与默认值
      const defaultCfg = typeof store.getDefaultVault === 'function' ? store.getDefaultVault().config : { fillDelayMs: 450, tabDelayMs: 180, autoClearClipboardSeconds: 10 };
      let fillDelayMs = defaultCfg.fillDelayMs || 450;
      let resolvedTabDelayMs = parseInt(tabDelayMs, 10) || defaultCfg.tabDelayMs || 180;
      let clearSeconds = defaultCfg.autoClearClipboardSeconds || 10;

      try {
        const vault = store.load();
        const cfg = vault?.config || {};
        if (cfg.fillDelayMs) {
          fillDelayMs = parseInt(cfg.fillDelayMs, 10) || fillDelayMs;
        }
        if (!tabDelayMs && cfg.tabDelayMs) {
          resolvedTabDelayMs = parseInt(cfg.tabDelayMs, 10) || resolvedTabDelayMs;
        }
        if (cfg.autoClearClipboardSeconds) {
          clearSeconds = parseInt(cfg.autoClearClipboardSeconds, 10) || clearSeconds;
        }
      } catch (e) {}

      // 1. 隐藏窗口让出前台焦点给目标应用
      if (isDetachedMode) {
        pwdApi.minimizeSelf();
      } else if (z && typeof z.hideMainWindow === 'function') {
        try { await z.hideMainWindow(true); } catch (e) {}
      }

      await sleep(fillDelayMs);

      let usedClipboardForPassword = false;

      // 单个字段填充工具（确保严格串行且剪贴板落盘后再粘贴）
      const fillSingleValue = async (val, isSecretField) => {
        if (!val) return;
        if (mode === 'type' && addon && typeof addon.unicodeType === 'function') {
          try {
            const segments = [...new Intl.Segmenter().segment(val)];
            for (const seg of segments) {
              if (seg.segment === '\n') {
                if (addon.simulateKeyboardTap) addon.simulateKeyboardTap('enter', 'shift');
              } else {
                addon.unicodeType(seg.segment);
              }
              await sleep(8);
            }
            return;
          } catch (e) {}
        }

        // 可靠单通道写剪贴板 + 回读验证 + 等待系统剪贴板通知释放后再粘贴
        await writeClipboardReliable(val);
        await sleep(45);
        if (isSecretField) {
          usedClipboardForPassword = true;
        }

        if (addon && typeof addon.simulatePaste === 'function') {
          try {
            addon.simulatePaste();
          } catch (e) {}
        } else if (z && typeof z.simulateKeyboardTap === 'function') {
          try {
            const mod = isMac ? 'command' : 'control';
            z.simulateKeyboardTap('v', mod);
          } catch (e) {}
        }
      };

      // 2. 执行填充流程（严格串行保序）
      if (shouldFillBoth) {
        // 2.1 填入用户名（不计为敏感清理）
        await fillSingleValue(cleanUsername, false);

        // 2.2 充分等待目标窗口（尤其是浏览器网页）彻底消费完第一个粘贴事件，再发送 Tab 切换焦点
        await sleep(mode === 'type' ? 120 : 200);

        if (addon && typeof addon.simulateKeyboardTap === 'function') {
          try {
            addon.simulateKeyboardTap('tab');
          } catch (e) {}
        } else if (z && typeof z.simulateKeyboardTap === 'function') {
          try {
            z.simulateKeyboardTap('tab');
          } catch (e) {}
        }

        // 2.3 等待输入框焦点切换与网页事件完成
        await sleep(resolvedTabDelayMs);

        // 2.4 写入并填入密码
        await fillSingleValue(plainPassword, true);
      } else if (target === 'username') {
        await fillSingleValue(cleanUsername, false);
      } else {
        await fillSingleValue(plainPassword, true);
      }

      // 3. 记录条目使用统计
      if (entryId) {
        this.recordUsage(entryId);
      }

      // 4. 仅当密码确实通过剪贴板粘贴时，安排智能清空剪贴板
      if (target !== 'username' && usedClipboardForPassword) {
        scheduleClipboardClear(plainPassword, clearSeconds);
      }

      return true;
    } finally {
      isAutoFilling = false;
    }
  },

  bringToFront() {
    if (typeof window !== 'undefined') {
      try {
        window.focus();
      } catch (e) {}
    }
    const addon = getNativeAddon();
    if (addon && typeof addon.activateWindow === 'function') {
      try {
        if (typeof process !== 'undefined') {
          // 优先激活父进程（Electron 主进程 PID，负责持有原生 HWND）
          if (process.ppid) addon.activateWindow(process.ppid);
          if (process.pid) addon.activateWindow(process.pid);
        }
      } catch (e) {}
    }
  },

  minimizeSelf() {
    // 1. 如果当前主进程持有该独立子窗口引用，直接原生调用 minimize() 瞬间最小化
    if (standaloneWindow && !standaloneWindow.isDestroyed()) {
      try {
        if (typeof standaloneWindow.minimize === 'function') {
          standaloneWindow.minimize();
          return true;
        }
      } catch (e) {}
    }
    // 2. 如果自己是子窗口，向父进程发送极速最小化通知
    const z = getZTools();
    if (z && typeof z.sendToParent === 'function') {
      try {
        z.sendToParent('minimize-standalone-window');
      } catch (e) {}
    }
    // 3. 页面级释放焦点兜底
    if (typeof window !== 'undefined' && typeof window.blur === 'function') {
      try {
        window.blur();
      } catch (e) {}
    }
    return false;
  },

  startMouseHook,
  stopMouseHook,

  /**
   * 打开或唤起独立的密码管理器窗口 (BrowserWindow)
   * @param {object} [action] 可选启动参数（携带 payload）
   */
  openManagerWindow(action) {
    const z = getZTools();
    if (!z || typeof z.createBrowserWindow !== 'function') {
      console.warn('[pwdApi] ztools.createBrowserWindow 不可用');
      return false;
    }

    // 1. 若窗口已存在且未销毁，直接恢复展示、聚焦置顶
    if (standaloneWindow && !standaloneWindow.isDestroyed()) {
      try {
        if (typeof standaloneWindow.isMinimized === 'function' && standaloneWindow.isMinimized()) {
          standaloneWindow.restore();
        }
        if (typeof standaloneWindow.setAlwaysOnTop === 'function') {
          standaloneWindow.setAlwaysOnTop(true);
        }
        standaloneWindow.show();
        standaloneWindow.focus();
        if (typeof standaloneWindow.setAlwaysOnTop === 'function') {
          standaloneWindow.setAlwaysOnTop(false);
        }
        if (action) {
          try {
            standaloneWindow.webContents.send('plugin-action', action);
          } catch (e) {}
        }
        if (cachedMasterKey) {
          try {
            standaloneWindow.webContents.send('sync-auth', {
              masterKeyHex: cachedMasterKey.toString('hex')
            });
          } catch (e) {}
        }
        return true;
      } catch (e) {
        console.error('[pwdApi] 唤起已有窗口失败:', e);
      }
    }

    // 2. 窗口未创建或已关闭，初始化独立窗口配置
    const isDark = typeof z.isDarkColors === 'function' && z.isDarkColors();
    const winOptions = {
      title: '快速密码填充 - 密码管理器',
      width: 880,
      height: 620,
      minWidth: 640,
      minHeight: 450,
      center: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      frame: true,
      autoHideMenuBar: true,
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      webPreferences: {
        preload: 'preload.js'
      }
    };

    try {
      const iconPath = path.join(__dirname, 'logo.png');
      if (fs.existsSync(iconPath)) {
        winOptions.icon = iconPath;
      }
    } catch (e) {}

    try {
      standaloneWindow = z.createBrowserWindow('index.html', winOptions, () => {
        if (standaloneWindow && !standaloneWindow.isDestroyed()) {
          try {
            if (action) {
              standaloneWindow.webContents.send('plugin-action', action);
            }
            if (cachedMasterKey) {
              standaloneWindow.webContents.send('sync-auth', {
                masterKeyHex: cachedMasterKey.toString('hex')
              });
            }
          } catch (e) {}
        }
      });
      return true;
    } catch (err) {
      console.error('[pwdApi] 创建独立窗口异常:', err);
      return false;
    }
  },

  activateStandaloneWindow(action) {
    if (standaloneWindow && !standaloneWindow.isDestroyed()) {
      try {
        if (typeof standaloneWindow.isMinimized === 'function' && standaloneWindow.isMinimized()) {
          standaloneWindow.restore();
        }
        if (typeof standaloneWindow.setAlwaysOnTop === 'function') {
          standaloneWindow.setAlwaysOnTop(true);
        }
        standaloneWindow.show();
        standaloneWindow.focus();
        if (typeof standaloneWindow.setAlwaysOnTop === 'function') {
          standaloneWindow.setAlwaysOnTop(false);
        }
        if (action) {
          try { standaloneWindow.webContents.send('plugin-action', action); } catch (e) {}
        }
        return true;
      } catch (e) {}
    }
    return false;
  },

  getStandaloneWindow() {
    return (standaloneWindow && !standaloneWindow.isDestroyed()) ? standaloneWindow : null;
  },

  /**
   * 监听来自其他窗口的消息（基于 electron.ipcRenderer）
   */
  onWindowMessage(channel, callback) {
    if (electron && electron.ipcRenderer) {
      const handler = (_event, ...args) => callback(...args);
      electron.ipcRenderer.on(channel, handler);
      return () => {
        try {
          electron.ipcRenderer.removeListener(channel, handler);
        } catch (e) {}
      };
    }
    return () => {};
  },

  /**
   * 跨窗口消息广播（同时向子窗口与父窗口发送）
   */
  broadcastMessage(channel, ...args) {
    // 1. 向子窗口发送
    if (standaloneWindow && !standaloneWindow.isDestroyed()) {
      try {
        standaloneWindow.webContents.send(channel, ...args);
      } catch (e) {}
    }
    // 2. 向父窗口发送 (如果自己是子窗口)
    const z = getZTools();
    if (z && typeof z.sendToParent === 'function') {
      try {
        z.sendToParent(channel, ...args);
      } catch (e) {}
    }
  }
};

// 监听 IPC 同步消息
if (electron && electron.ipcRenderer) {
  electron.ipcRenderer.on('sync-auth', (_event, data) => {
    if (data && data.masterKeyHex) {
      try {
        cachedMasterKey = Buffer.from(data.masterKeyHex, 'hex');
        lastActivityAt = Date.now();
      } catch (e) {}
    }
  });

  electron.ipcRenderer.on('sync-lock', () => {
    cachedMasterKey = null;
  });

  electron.ipcRenderer.on('minimize-standalone-window', () => {
    if (standaloneWindow && !standaloneWindow.isDestroyed()) {
      try {
        standaloneWindow.minimize();
      } catch (e) {}
    }
  });
}

// 挂载到 window 对象供渲染层直接使用
if (typeof window !== 'undefined') {
  window.pwdApi = pwdApi;
}

// 导出 API 供测试脚本直接引用（不影响 Electron preload 行为）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pwdApi };
}

// 监听 ZTools 插件生命周期退出事件
if (typeof ztools !== 'undefined' && typeof ztools.onPluginOut === 'function') {
  ztools.onPluginOut(() => {
    // 退出时清理自动锁定检查及后台监听
    if (autoLockCheckInterval) {
      clearInterval(autoLockCheckInterval);
      autoLockCheckInterval = null;
    }
    if (clearClipboardTimer && lastSensitiveClipboard) {
      const pendingSecret = lastSensitiveClipboard;
      cancelClipboardClear();
      performSmartClipboardClear(pendingSecret).catch(() => {});
    }
    mouseHook.stop();
    cachedMasterKey = null;
  });
}

// 初始化时清理冗余鼠标监听、检查免密自动恢复并启动空闲锁定检查
checkAutoStartMouseHook();
tryAutoUnlock();
ensureAutoLockMonitor();
