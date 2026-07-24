/**
 * BaseHostAdapter
 * 宿主适配器基类，提取两个平台 adapter 的公共逻辑。
 *
 * 子类需要覆盖以下方法：
 * - platformId: 平台标识（如 'utools'、'ztools'）
 * - getDefaultHostName(): 默认宿主名称
 * - getHostApiPriority(): API 查找优先级数组
 * - getAppVersionPriority(): 版本获取方法优先级数组
 * - getHostDisplayName(api): 获取宿主显示名称
 * - normalizeUser(user): 用户数据标准化
 * - getRawUser(api): 获取原始用户数据
 * - getContactUrl(): 联系链接
 */

const _isUserValid = (user) => {
  return user && (user.nickname || user.name || user.userName || user.username || user.avatar || user.avatarUrl || user.photo);
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

    this.platform = {
      id: this.platformId,
      name: this.getHostDisplayName(),
      version: this.getHostAppVersion(),
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
      const result = window.showOpenImageDialog();
      const filePath = Array.isArray(result) ? result[0] : result?.filePaths?.[0];
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
   */
  saveImage(data, suggestedName = 'edited.png') {
    if (typeof window === 'undefined') return false;
    if (typeof window.showSaveImageDialog !== 'function' || typeof window.writeImageFile !== 'function') return false;

    const filePath = window.showSaveImageDialog(suggestedName);
    if (!filePath) return false;

    return !!window.writeImageFile(filePath, data);
  }

  /**
   * 显示保存对话框（仅返回路径）
   */
  showSaveImageDialog(suggestedName = 'edited.png') {
    if (typeof window !== 'undefined' && typeof window.showSaveImageDialog === 'function') {
      return window.showSaveImageDialog(suggestedName);
    }
    return null;
  }

  /**
   * 写入图片文件
   */
  writeImageFile(filePath, data) {
    if (typeof window !== 'undefined' && typeof window.writeImageFile === 'function') {
      return !!window.writeImageFile(filePath, data);
    }
    return false;
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
   * 获取宿主应用版本
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
    return 'unknown';
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
