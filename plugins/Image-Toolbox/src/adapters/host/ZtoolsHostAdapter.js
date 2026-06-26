/**
 * ZtoolsHostAdapter
 * ZTools 平台宿主适配器。
 *
 * 对外提供分组能力，同时保留旧方法，便于逐步迁移现有 UI/模块。
 */

const DEFAULT_HOST_NAME = 'ZTools';

function getHostApi() {
  if (typeof window !== 'undefined') {
    return window.hostTools
      || window.ztools
      || window.utools
      || null;
  }

  if (typeof globalThis !== 'undefined') {
    return globalThis.ztools || globalThis.utools || null;
  }

  return null;
}

function getHostDisplayName(api = getHostApi()) {
  try {
    if (api && typeof api.getAppName === 'function') {
      const name = api.getAppName();
      if (name) return String(name);
    }
  } catch (e) {
    console.warn('[ZtoolsHostAdapter] 获取宿主名称失败:', e);
  }

  if (typeof window !== 'undefined') {
    if (window.ztools) return 'ZTools';
    if (window.utools) return 'uTools';
  }

  return DEFAULT_HOST_NAME;
}

function normalizeZtoolsUser(user) {
  if (!user) return null;

  return {
    nickname: user.nickname || user.name || user.userName || user.username || '',
    avatar: user.avatar || user.avatarUrl || user.photo || '',
    type: user.type || '',
    raw: user,
  };
}

function getRawUser(api = getHostApi()) {
  try {
    if (api && typeof api.getUser === 'function') return api.getUser();
    if (api && typeof api.getUserInfo === 'function') return api.getUserInfo();
    if (typeof window !== 'undefined' && typeof window.getHostUser === 'function') return window.getHostUser();
  } catch (e) {
    console.warn('[ZtoolsHostAdapter] 获取宿主用户失败:', e);
  }

  return null;
}

function openExternal(url, api = getHostApi()) {
  if (!url) return false;

  try {
    if (api && typeof api.shellOpenExternal === 'function') {
      api.shellOpenExternal(url);
      return true;
    }
  } catch (e) {
    console.warn('[ZtoolsHostAdapter] 使用宿主打开外部链接失败:', e);
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }

  return false;
}

class ZtoolsHostAdapter {
  constructor() {
    this._api = getHostApi();
    this._isZTools = !!this._api;

    this.platform = {
      id: 'ztools',
      name: getHostDisplayName(this._api),
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

  get isZTools() {
    return this._isZTools;
  }

  get name() {
    return this.platform.id;
  }

  setWindowHeight(height) {
    if (this._api && typeof this._api.setExpendHeight === 'function') {
      this._api.setExpendHeight(height);
    }
  }

  setWindowWidth(width) {
    if (this._api && typeof this._api.setExpendWidth === 'function') {
      this._api.setExpendWidth(width);
    }
  }

  setWindowTitle(title) {
    if (this._api && typeof this._api.setMainWindowTitle === 'function') {
      this._api.setMainWindowTitle(title);
    }
  }

  onPluginEnter(callback) {
    if (this._api && typeof this._api.onPluginEnter === 'function') {
      this._api.onPluginEnter(callback);
    }
    return () => {};
  }

  onPluginOut(callback) {
    if (this._api && typeof this._api.onPluginOut === 'function') {
      this._api.onPluginOut(callback);
    }
    return () => {};
  }

  showOpenDialog(options) {
    if (this._api && typeof this._api.showOpenDialog === 'function') {
      return this._api.showOpenDialog(options);
    }
    return null;
  }

  showSaveDialog(options) {
    if (this._api && typeof this._api.showSaveDialog === 'function') {
      return this._api.showSaveDialog(options);
    }
    return null;
  }

  pickImage() {
    if (typeof window !== 'undefined' && typeof window.showOpenImageDialog === 'function') {
      const result = window.showOpenImageDialog();
      const filePath = Array.isArray(result) ? result[0] : result?.filePaths?.[0];
      return filePath ? this.readImageFile(filePath) : null;
    }
    return null;
  }

  readImageFile(filePath) {
    if (typeof window !== 'undefined' && typeof window.readImageFile === 'function') {
      return window.readImageFile(filePath);
    }
    return null;
  }

  readFile(filePath) {
    return this.readImageFile(filePath);
  }

  saveImage(data, suggestedName = 'edited.png') {
    if (typeof window === 'undefined') return false;
    if (typeof window.showSaveImageDialog !== 'function' || typeof window.writeImageFile !== 'function') return false;

    const filePath = window.showSaveImageDialog(suggestedName);
    if (!filePath) return false;

    return !!window.writeImageFile(filePath, data);
  }

  copyImage(data) {
    if (typeof window !== 'undefined' && typeof window.copyImageToClipboard === 'function') {
      window.copyImageToClipboard(data);
      return true;
    }
    return false;
  }

  writeClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true);
    }
    return Promise.resolve(false);
  }

  readClipboard() {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return navigator.clipboard.readText();
    }
    return Promise.resolve(null);
  }

  showNotification(message, type) {
    if (this._api && typeof this._api.showNotification === 'function') {
      this._api.showNotification(message, type);
    }
  }

  fetchLocalFile(filePath) {
    if (this._api && typeof this._api.fetchLocalFile === 'function') {
      return this._api.fetchLocalFile(filePath);
    }
    return null;
  }

  getHostAppVersion() {
    if (this._api && typeof this._api.getAppVersion === 'function') {
      return this._api.getAppVersion();
    }
    if (this._api && typeof this._api.getVersion === 'function') {
      return this._api.getVersion();
    }
    return 'unknown';
  }

  getHostName() {
    return this.platform?.name || getHostDisplayName(this._api);
  }

  getHostUser() {
    return normalizeZtoolsUser(getRawUser(this._api));
  }

  fetchUserServerTemporaryToken() {
    if (this._api && typeof this._api.fetchUserServerTemporaryToken === 'function') {
      return this._api.fetchUserServerTemporaryToken();
    }
    return Promise.resolve(null);
  }

  getStorageItem(key) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.getItem === 'function') return storage.getItem(key);
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    return null;
  }

  setStorageItem(key, value) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(key, value);
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  }

  removeStorageItem(key) {
    const storage = this._api?.dbStorage;
    if (storage && typeof storage.removeItem === 'function') {
      storage.removeItem(key);
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  }

  getSystemFonts() {
    if (typeof window !== 'undefined' && typeof window.getSystemFonts === 'function') {
      return window.getSystemFonts();
    }
    return [];
  }

  getSystemFontsAsync() {
    if (typeof window !== 'undefined' && typeof window.getSystemFontsAsync === 'function') {
      return window.getSystemFontsAsync();
    }
    return Promise.resolve([]);
  }

  openHostExternal(url) {
    return openExternal(url, this._api);
  }
}

const defaultAdapter = new ZtoolsHostAdapter();

export default ZtoolsHostAdapter;

// 便捷导出函数（旧 UI 兼容；新代码优先注入 host adapter）
export function getHostAppVersion() {
  return defaultAdapter.getHostAppVersion();
}

export function getHostName() {
  return defaultAdapter.getHostName();
}

export function getHostUser() {
  return defaultAdapter.getHostUser();
}

export function openHostExternal(url) {
  return defaultAdapter.openHostExternal(url);
}
