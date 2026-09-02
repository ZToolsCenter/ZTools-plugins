/**
 * Settings - 设置数据模型
 *
 * 管理用户配置的完整结构。
 * 包含存储路径、图床配置、同步配置、主题等。
 */

class Settings {
  constructor(data = {}) {
    this.cloudProvider = data.cloudProvider || 'imgbb';
    this.localPath = data.localPath || '';
    this.cloudConfig = data.cloudConfig || {};
    this.syncConfig = data.syncConfig || {};
    this.deleteLocalFile = data.deleteLocalFile || false;
    this.theme = data.theme !== undefined ? data.theme : false; // false = 暗色, true = 亮色
    this.themePreference = data.themePreference || 'system';
  }

  /**
   * 检查本地存储配置是否完整
   * @returns {boolean}
   */
  isLocalConfigured() {
    return !!this.localPath && this.localPath.trim() !== '';
  }

  /**
   * 检查云端存储配置是否完整
   * @returns {boolean}
   */
  isCloudConfigured() {
    const provider = this.cloudProvider;
    if (!provider) return false;

    if (provider === 'imgbb') {
      return !!(this.cloudConfig.imgbbApiKey && this.cloudConfig.imgbbApiKey.trim());
    }
    if (provider === 's3') {
      return !!(this.cloudConfig.s3Endpoint &&
        this.cloudConfig.s3AccessKey &&
        this.cloudConfig.s3SecretKey &&
        this.cloudConfig.s3Bucket);
    }
    if (provider === 'tucang') {
      return !!(this.cloudConfig.tucangToken && this.cloudConfig.tucangToken.trim());
    }
    return false;
  }

  /**
   * 获取本地存储的配置提示
   * @returns {string|null} 提示信息，null 表示配置正常
   */
  getLocalConfigHint() {
    if (!this.isLocalConfigured()) {
      return '请先在设置中配置本地存储路径';
    }
    return null;
  }

  /**
   * 获取云端存储的配置提示
   * @returns {string|null}
   */
  getCloudConfigHint() {
    if (!this.isCloudConfigured()) {
      return '请先在设置中配置云存储';
    }
    return null;
  }

  /**
   * 根据当前选中的存储类型获取配置提示
   * @param {'local'|'cloud'} storageType
   * @returns {string|null}
   */
  getConfigHint(storageType) {
    if (storageType === 'local') {
      return this.getLocalConfigHint();
    }
    return this.getCloudConfigHint();
  }

  /**
   * 序列化为纯对象
   * @returns {object}
   */
  toJSON() {
    return {
      cloudProvider: this.cloudProvider,
      localPath: this.localPath,
      cloudConfig: this.cloudConfig,
      syncConfig: this.syncConfig,
      deleteLocalFile: this.deleteLocalFile,
      theme: this.theme,
      themePreference: this.themePreference,
    };
  }

  /**
   * 从纯对象创建 Settings 实例
   * @param {object} data
   * @returns {Settings}
   */
  static fromJSON(data) {
    return new Settings(data || {});
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settings;
}
