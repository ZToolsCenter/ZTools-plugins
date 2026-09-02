/**
 * SettingsService - 设置业务服务
 *
 * 管理设置的加载、保存、数据迁移。
 * 通过依赖注入的 StorageProvider 和 FileProvider 操作存储层。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
class SettingsService {
  /**
   * @param {object} deps
   * @param {object} deps.storageProvider - 存储适配器
   * @param {object} deps.fileProvider - 文件适配器
   */
  constructor(deps = {}) {
    this.storageProvider = deps.storageProvider;
    this.fileProvider = deps.fileProvider;
    this.settings = null;
  }

  /**
   * 加载设置
   * @returns {Promise<Settings>}
   */
  async loadSettings() {
    try {
      const doc = await this.storageProvider.getDoc('settings');
      if (doc && doc.data) {
        this.settings = Settings.fromJSON(doc.data);
      } else {
        this.settings = this._getDefaultSettings();
      }
    } catch (e) {
      this.settings = this._getDefaultSettings();
    }
    return this.settings;
  }

  /**
   * 获取默认设置
   * @returns {Settings}
   */
  _getDefaultSettings() {
    let defaultLocalPath = '';
    if (this.fileProvider && typeof this.fileProvider.getDefaultDir === 'function') {
      try {
        defaultLocalPath = this.fileProvider.getDefaultDir();
      } catch (e) {
        // 忽略错误
      }
    }

    return new Settings({
      cloudProvider: 'imgbb',
      localPath: defaultLocalPath,
      cloudConfig: {},
      syncConfig: {},
      deleteLocalFile: false,
    });
  }

  /**
   * 保存设置
   * @returns {Promise<boolean>}
   */
  async saveSettings() {
    const doc = {
      _id: 'settings',
      data: this.settings.toJSON(),
    };

    // 获取已有的 _rev 以更新
    try {
      const existing = await this.storageProvider.getDoc('settings');
      if (existing && existing._rev) {
        doc._rev = existing._rev;
      }
    } catch (e) {
      // 文档不存在，创建新文档
    }

    await this.storageProvider.putDoc(doc);
    return true;
  }

  /**
   * 更新设置对象
   * @param {object} partialSettings
   */
  updateSettings(partialSettings) {
    Object.assign(this.settings, partialSettings);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsService;
}
