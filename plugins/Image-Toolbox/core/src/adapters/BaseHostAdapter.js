/**
 * BaseHostAdapter
 * 宿主适配器基类，提取两个平台 adapter 的公共逻辑。
 *
 * 子类需要覆盖以下方法：
 * - platformId: 平台标识（如 'utools'、'ztools'）
 * - getDefaultHostName(): 默认宿主名称
 * - getHostApiPriority(): API 查找优先级数组
 * - getAppVersionPriority(): 宿主程序版本获取方法优先级数组
 * - getPluginVersion(): 本插件版本号（读 preload 透传的插件版本，来源 plugin.json）
 * - getHostDisplayName(api): 获取宿主显示名称
 * - normalizeUser(user): 用户数据标准化
 * - getRawUser(api): 获取原始用户数据
 * - getContactUrl(): 联系链接
 */

import { getBridgedApi } from '../utils/host.js';

const _isUserValid = (user) => {
  return user && (user.nickname || user.name || user.userName || user.username || user.avatar || user.avatarUrl || user.photo);
};

// ═══ 保存结果结构化契约 ═══
//
// 历史问题：saveImage 返回裸 boolean，调用方无法区分
// 「用户主动取消」「平台无此能力」「真实写入失败」三种情况，
// 导致写入失败被当成正常分支静默丢弃，用户以为已保存而关闭窗口。
//
// status 取值：
//   'saved'       — 写入成功
//   'canceled'    — 用户在保存对话框中主动取消（不应报错）
//   'unsupported' — 当前平台/环境没有保存能力（可走降级，不应直接报错）
//   'failed'      — 能力可用但写入失败（权限不足/磁盘满/路径非法等，必须提示）
const SAVE_STATUS = {
  SAVED: 'saved',
  CANCELED: 'canceled',
  UNSUPPORTED: 'unsupported',
  FAILED: 'failed',
};

/**
 * 构造保存结果对象。
 * @param {'saved'|'canceled'|'unsupported'|'failed'} status
 * @param {object} [extra] - 附加信息（filePath、reason 等）
 * @returns {{ ok: boolean, status: string, filePath: string|null, reason: string|null }}
 */
const createSaveResult = (status, extra = {}) => {
  const filePath = extra.filePath ?? null;
  return {
    ok: status === SAVE_STATUS.SAVED,
    status,
    filePath,
    reason: extra.reason ?? null,
    // valueOf 让历史调用方沿用 `if (result)` / `!!result` 判断仍得到
    // 「是否真正保存成功」的语义，不会把失败误判为成功。
    valueOf() {
      return this.ok;
    },
  };
};

/**
 * 把历史返回值（boolean / undefined / 结果对象）归一化为保存结果对象。
 * @param {*} value
 * @returns {{ ok: boolean, status: string, filePath: string|null, reason: string|null }}
 */
const normalizeSaveResult = (value) => {
  if (value && typeof value === 'object' && typeof value.status === 'string') {
    return value;
  }
  return createSaveResult(value ? SAVE_STATUS.SAVED : SAVE_STATUS.FAILED);
};

const _normalizeUser = (user) => {
  if (!user) return null;

  const rawType = user.type || '';

  return {
    nickname: user.nickname || user.name || user.userName || user.username || '',
    avatar: user.avatar || user.avatarUrl || user.photo || '',
    type: rawType,
    raw: user,
  };
};

class BaseHostAdapter {
  constructor() {
    this._api = this._getHostApi();
    this._isInitialized = false;

    // platform.appVersion 是「本插件版本」（面向用户展示的发布版本），
    // platform.version 是「宿主程序版本」（uTools / ZTools 自身版本）。
    // 两者语义不同，不能互相顶替；历史上「关于」页取的正是更新记录首条，
    // 与 plugin.json 的真实发布版本脱节。
    this.platform = {
      id: this.platformId,
      name: this.getHostDisplayName(),
      version: this.getHostAppVersion(),
      appVersion: this.getPluginVersion(),
      runtime: 'electron',
    };

    this.user = {
      getCurrentUser: () => this.getHostUser(),
      fetchServerTemporaryToken: () => this.fetchUserServerTemporaryToken(),
    };

    this.storage = {
      get: (key) => this.getStorageItem(key),
      set: (key, value) => this.setStorageItem(key, value),
      remove: (key) => this.removeStorageItem(key),
    };

    this.file = {
      pickImage: () => this.pickImage(),
      readImageFile: (filePath) => this.readImageFile(filePath),
      saveImage: (data, suggestedName) => this.saveImage(data, suggestedName),
    };

    this.clipboard = {
      writeImage: (data) => this.copyImage(data),
      readText: () => this.readClipboard(),
      writeText: (text) => this.writeClipboard(text),
    };

    this.window = {
      setHeight: (height) => this.setWindowHeight(height),
      setWidth: (width) => this.setWindowWidth(width),
      setTitle: (title) => this.setWindowTitle(title),
    };

    this.system = {
      openExternal: (url) => this.openHostExternal(url),
      getSystemFonts: () => this.getSystemFonts(),
      showNotification: (message, type) => this.showNotification(message, type),
    };

    this.lifecycle = {
      onEnter: (callback) => this.onPluginEnter(callback),
      onExit: (callback) => this.onPluginOut(callback),
    };
  }

  // ═══ 平台特定覆盖点 ═══

  get platformId() {
    return 'unknown';
  }

  getDefaultHostName() {
    return 'Unknown';
  }

  getHostApiPriority() {
    return [];
  }

  getAppVersionPriority() {
    return [];
  }

  getHostDisplayName(api) {
    const target = api || this._api;
    if (!target) return this.getDefaultHostName();

    try {
      if (typeof target.getAppName === 'function') {
        const name = target.getAppName();
        if (name) return String(name);
      }
    } catch (e) {
      console.warn(`[${this.platformId}HostAdapter] 获取宿主名称失败:`, e);
    }

    return this.getDefaultHostName();
  }

  normalizeUser(user) {
    return _normalizeUser(user);
  }

  getRawUser(api) {
    const target = api || this._api;
    try {
      if (target && typeof target.getUser === 'function') return target.getUser();
      if (target && typeof target.getUserInfo === 'function') return target.getUserInfo();
      if (typeof window !== 'undefined' && typeof window.getHostUser === 'function') return window.getHostUser();
    } catch (e) {
      console.warn(`[${this.platformId}HostAdapter] 获取宿主用户失败:`, e);
    }
    return null;
  }

  getContactUrl() {
    return '';
  }

  // ═══ 内部方法 ═══

  _getHostApi() {
    const priorities = this.getHostApiPriority();

    if (typeof window !== 'undefined') {
      for (const key of priorities) {
        if (window[key]) return window[key];
      }
    }

    if (typeof globalThis !== 'undefined') {
      for (const key of priorities) {
        if (globalThis[key]) return globalThis[key];
      }
    }

    return null;
  }

  // ═══ 公共方法 ═══

  get isInitialized() {
    return this._isInitialized;
  }

  get name() {
    return this.platform.id;
  }

  /**
   * 设置宿主窗口高度
   */
  setWindowHeight(height) {
    if (this._api && typeof this._api.setExpendHeight === 'function') {
      this._api.setExpendHeight(height);
    }
  }

  /**
   * 设置宿主窗口宽度
   */
  setWindowWidth(width) {
    if (this._api && typeof this._api.setExpendWidth === 'function') {
      this._api.setExpendWidth(width);
    }
  }

  /**
   * 设置主窗口标题
   */
  setWindowTitle(title) {
    if (this._api && typeof this._api.setMainWindowTitle === 'function') {
      this._api.setMainWindowTitle(title);
    }
  }

  /**
   * 插件进入回调
   */
  onPluginEnter(callback) {
    if (this._api && typeof this._api.onPluginEnter === 'function') {
      this._api.onPluginEnter(callback);
    }
    return () => {};
  }

  /**
   * 插件退出回调
   */
  onPluginOut(callback) {
    if (this._api && typeof this._api.onPluginOut === 'function') {
      this._api.onPluginOut(callback);
    }
    return () => {};
  }

  /**
   * 显示文件选择对话框
   */
  showOpenDialog(options) {
    if (this._api && typeof this._api.showOpenDialog === 'function') {
      return this._api.showOpenDialog(options);
    }
    return null;
  }

  /**
   * 显示保存对话框
   */
  showSaveDialog(options) {
    if (this._api && typeof this._api.showSaveDialog === 'function') {
      return this._api.showSaveDialog(options);
    }
    return null;
  }

  /**
   * 选择图片文件并返回 dataURL
   */
  pickImage() {
    if (typeof window !== 'undefined' && typeof window.showOpenImageDialog === 'function') {
      // showOpenImageDialog 返回文件路径字符串或 null
      const filePath = window.showOpenImageDialog();
      return filePath ? this.readImageFile(filePath) : null;
    }
    return null;
  }

  /**
   * 读取图片文件为 dataURL
   */
  readImageFile(filePath) {
    if (typeof window !== 'undefined' && typeof window.readImageFile === 'function') {
      return window.readImageFile(filePath);
    }
    return null;
  }

  /**
   * 读取文件（别名）
   */
  readFile(filePath) {
    return this.readImageFile(filePath);
  }

  /**
   * 保存图片到文件
   *
   * 返回结构化结果（见 SAVE_STATUS），调用方据此区分：
   * - status === 'canceled'  → 用户取消，静默即可；
   * - status === 'unsupported' → 本平台无保存能力，应走降级方案；
   * - status === 'failed'    → 真实写入失败，必须提示用户。
   *
   * @param {string} data - 图片 dataURL
   * @param {string} [suggestedName]
   * @returns {{ ok: boolean, status: string, filePath: string|null, reason: string|null }}
   */
  saveImage(data, suggestedName = 'edited.png') {
    if (typeof window === 'undefined') {
      return createSaveResult(SAVE_STATUS.UNSUPPORTED, { reason: 'no-window' });
    }
    if (typeof window.showSaveImageDialog !== 'function' || typeof window.writeImageFile !== 'function') {
      return createSaveResult(SAVE_STATUS.UNSUPPORTED, { reason: 'no-native-save-api' });
    }

    // 对话框返回 null 表示用户取消，或对话框本身抛错被宿主吞掉；
    // 二者都无法与「写入失败」区分，按用户取消处理避免误报错误。
    const filePath = window.showSaveImageDialog(suggestedName);
    if (!filePath) {
      return createSaveResult(SAVE_STATUS.CANCELED);
    }

    return this.writeImageFile(filePath, data);
  }

  /**
   * 显示保存对话框（仅返回路径）
   */
  showSaveImageDialog(suggestedName = 'edited.png', format = null) {
    if (typeof window !== 'undefined' && typeof window.showSaveImageDialog === 'function') {
      return window.showSaveImageDialog(suggestedName, format);
    }
    return null;
  }

  /**
   * 写入图片文件
   *
   * @param {string} filePath
   * @param {string} data - 图片 dataURL
   * @returns {{ ok: boolean, status: string, filePath: string|null, reason: string|null }}
   */
  writeImageFile(filePath, data) {
    if (typeof window === 'undefined' || typeof window.writeImageFile !== 'function') {
      return createSaveResult(SAVE_STATUS.UNSUPPORTED, { filePath, reason: 'no-native-write-api' });
    }

    try {
      // preload 的 writeImageFile 写入失败时返回 false（异常已被其内部吞掉），
      // 这里必须显式转成 failed，不能再让调用方拿到无法区分的裸 false。
      const result = normalizeSaveResult(window.writeImageFile(filePath, data));
      if (result.status === SAVE_STATUS.FAILED) {
        return createSaveResult(SAVE_STATUS.FAILED, { filePath, reason: 'write-rejected' });
      }
      return createSaveResult(SAVE_STATUS.SAVED, { filePath: result.filePath || filePath });
    } catch (err) {
      console.error('[BaseHostAdapter] 写入图片文件失败:', err);
      return createSaveResult(SAVE_STATUS.FAILED, { filePath, reason: err?.message || 'write-threw' });
    }
  }

  /**
   * 复制图片到剪贴板
   */
  copyImage(data) {
    if (typeof window !== 'undefined' && typeof window.copyImageToClipboard === 'function') {
      window.copyImageToClipboard(data);
      return true;
    }
    return false;
  }

  /**
   * 写入文本到剪贴板
   */
  writeClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true);
    }
    return Promise.resolve(false);
  }

  /**
   * 从剪贴板读取文本
   */
  readClipboard() {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return navigator.clipboard.readText();
    }
    return Promise.resolve(null);
  }

  /**
   * 显示通知
   */
  showNotification(message, type) {
    if (this._api && typeof this._api.showNotification === 'function') {
      this._api.showNotification(message, type);
    }
  }

  /**
   * 获取本地文件
   */
  fetchLocalFile(filePath) {
    if (this._api && typeof this._api.fetchLocalFile === 'function') {
      return this._api.fetchLocalFile(filePath);
    }
    return null;
  }

  /**
   * 获取宿主程序版本（uTools / ZTools 自身版本）。
   */
  getHostAppVersion() {
    const priorities = this.getAppVersionPriority();
    for (const methodName of priorities) {
      if (this._api && typeof this._api[methodName] === 'function') {
        try {
          const version = this._api[methodName]();
          if (version) return version;
        } catch (e) {
          console.warn(`[${this.platformId}HostAdapter] 获取版本失败 (${methodName}):`, e);
        }
      }
    }

    // contextIsolation 开启后宿主原始对象不再进入页面世界，this._api 为 null，
    // 此时改走 preload 用 contextBridge 暴露的窄接口读取宿主版本。
    const bridged = getBridgedApi();
    if (bridged && typeof bridged.getHostAppVersion === 'function') {
      try {
        const version = bridged.getHostAppVersion();
        if (version) return version;
      } catch (e) {
        console.warn(`[${this.platformId}HostAdapter] 从桥接接口获取宿主版本失败:`, e);
      }
    }

    return 'unknown';
  }

  /**
   * 获取本插件版本号（面向用户展示的发布版本）。
   *
   * 取值顺序：
   *   1. preload 桥接的 getPluginVersion()（contextIsolation 开启时页面唯一可读的入口）；
   *   2. preload 直接挂在 window 上的 getPluginVersion()（未启用隔离的宿主）；
   *   3. 宿主 API 自身的 getPluginVersion()（ZTools 支持）。
   *
   * 三者最终都指向插件根目录的 plugin.json，也就是应用市场读取的发布版本。
   *
   * 取不到时返回 ''，由调用方决定回退策略；绝不会回退成宿主程序版本，
   * 否则「关于」页会把 uTools 的版本号当成插件版本号展示。
   * @returns {string} 版本号，取不到时为空字符串
   */
  getPluginVersion() {
    // 开启 contextIsolation 后 preload 与页面处在两个 JS 世界，
    // preload 内部的 window.getPluginVersion 赋值页面侧读不到，
    // 只能取 contextBridge 暴露的窄接口；漏掉这一步会让「关于」页
    // 静默退回 core 常量，插件内版本又与市场发布版本脱节。
    const bridged = getBridgedApi();
    if (bridged && typeof bridged.getPluginVersion === 'function') {
      try {
        const version = bridged.getPluginVersion();
        if (version && String(version).trim()) return String(version).trim();
      } catch (e) {
        console.warn(`[${this.platformId}HostAdapter] 从桥接接口获取插件版本失败:`, e);
      }
    }

    if (typeof window !== 'undefined' && typeof window.getPluginVersion === 'function') {
      try {
        const version = window.getPluginVersion();
        if (version && String(version).trim()) return String(version).trim();
      } catch (e) {
        console.warn(`[${this.platformId}HostAdapter] 获取插件版本失败:`, e);
      }
    }

    try {
      if (this._api && typeof this._api.getPluginVersion === 'function') {
        const version = this._api.getPluginVersion();
        if (version && String(version).trim()) return String(version).trim();
      }
    } catch (e) {
      console.warn(`[${this.platformId}HostAdapter] 从宿主获取插件版本失败:`, e);
    }

    return '';
  }

  /**
   * 获取宿主名称
   */
  getHostName() {
    return this.platform?.name || this.getHostDisplayName(this._api);
  }

  /**
   * 获取宿主用户信息
   */
  getHostUser() {
    const rawUser = this.getRawUser(this._api);
    return this.normalizeUser(rawUser);
  }

  /**
   * 获取用户服务器临时 token
   */
  fetchUserServerTemporaryToken() {
    if (this._api && typeof this._api.fetchUserServerTemporaryToken === 'function') {
      return this._api.fetchUserServerTemporaryToken();
    }
    return Promise.resolve(null);
  }

  /**
   * 获取存储项
   */
  getStorageItem(key) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.getItem === 'function') return storage.getItem(key);
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    return null;
  }

  /**
   * 设置存储项
   */
  setStorageItem(key, value) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(key, value);
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  }

  /**
   * 删除存储项
   */
  removeStorageItem(key) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.removeItem === 'function') {
      storage.removeItem(key);
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  }

  /**
   * 获取系统字体
   */
  getSystemFonts() {
    if (typeof window !== 'undefined' && typeof window.getSystemFonts === 'function') {
      return window.getSystemFonts();
    }
    return [];
  }

  /**
   * 异步获取系统字体
   */
  getSystemFontsAsync() {
    if (typeof window !== 'undefined' && typeof window.getSystemFontsAsync === 'function') {
      return window.getSystemFontsAsync();
    }
    return Promise.resolve([]);
  }

  /**
   * 打开外部链接
   */
  openHostExternal(url) {
    if (!url) return false;

    try {
      if (this._api && typeof this._api.shellOpenExternal === 'function') {
        this._api.shellOpenExternal(url);
        return true;
      }
    } catch (e) {
      console.warn(`[${this.platformId}HostAdapter] 使用宿主打开外部链接失败:`, e);
    }

    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }

    return false;
  }
}

export default BaseHostAdapter;
export { BaseHostAdapter, SAVE_STATUS, createSaveResult, normalizeSaveResult };
