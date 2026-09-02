/**
 * EmotionService - 表情包业务服务
 *
 * 管理表情包的 CRUD、标签管理、存储转换、复制到剪贴板等核心业务逻辑。
 * 通过依赖注入的平台适配器操作存储、文件、HTTP、剪贴板。
 *
 * 不包含任何 DOM 操作，UI 由客户端的 UIManager 处理。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
class EmotionService {
  /**
   * @param {object} deps
   * @param {object} deps.storageProvider - 存储适配器
   * @param {object} deps.httpProvider - HTTP 适配器
   * @param {object} deps.fileProvider - 文件适配器
   * @param {object} deps.clipboardProvider - 剪贴板适配器
   * @param {object} deps.notificationProvider - 通知适配器
   * @param {object} deps.settingsService - SettingsService 实例
   */
  constructor(deps = {}) {
    this.storage = deps.storageProvider;
    this.http = deps.httpProvider;
    this.file = deps.fileProvider;
    this.clipboard = deps.clipboardProvider;
    this.notification = deps.notificationProvider;
    this.settingsService = deps.settingsService;

    this.emotions = {
      local: [],
      cloud: [],
    };
  }

  /**
   * 加载所有表情包数据
   */
  async loadData() {
    const nativeId = this.storage.getNativeId();

    // 加载本地表情包（不同步）
    const localKey = nativeId + '/emotions_local';
    const localData = this.storage.getItem(localKey);
    if (localData && Array.isArray(localData)) {
      this.emotions.local = localData;
    } else {
      // 尝试从旧的 key 迁移
      const oldLocal = this.storage.getItem('emotions_local');
      if (oldLocal && Array.isArray(oldLocal)) {
        this.emotions.local = oldLocal;
        this.storage.setItem(localKey, this.emotions.local);
      }
    }

    // 加载云端表情包（同步）
    try {
      const cloudDoc = await this.storage.getDoc('emotions_cloud');
      if (cloudDoc && cloudDoc.data && Array.isArray(cloudDoc.data)) {
        this.emotions.cloud = cloudDoc.data;
      }
    } catch (e) {
      // 云端数据不存在
    }

    // 检查旧数据迁移
    try {
      const hasOldData = await this._checkOldData();
      if (hasOldData) {
        const oldDoc = await this.storage.getDoc('emotions');
        if (oldDoc && oldDoc.data && Array.isArray(oldDoc.data)) {
          await this._migrateOldData(oldDoc.data);
        }
      }
    } catch (e) {
      // 忽略迁移错误
    }
  }

  /**
   * 检查是否存在旧的单一结构数据
   * @returns {Promise<boolean>}
   */
  async _checkOldData() {
    try {
      const oldDoc = await this.storage.getDoc('emotions');
      const nativeId = this.storage.getNativeId();
      const localKey = nativeId + '/emotions_local';
      const localData = this.storage.getItem(localKey);

      return oldDoc && oldDoc.data && Array.isArray(oldDoc.data) &&
        (!localData || !Array.isArray(localData) || localData.length === 0);
    } catch (e) {
      return false;
    }
  }

  /**
   * 迁移旧数据到新结构
   * @param {Array} oldEmotions
   */
  async _migrateOldData(oldEmotions) {
    this.emotions.local = oldEmotions.filter(e => e.storageType === 'local' || !e.storageType);
    this.emotions.cloud = oldEmotions.filter(e => e.storageType === 'cloud');

    this.emotions.local.forEach(e => {
      if (!e.storageType) e.storageType = 'local';
    });

    await this.saveData();
  }

  /**
   * 保存表情包数据
   */
  async saveData() {
    const nativeId = this.storage.getNativeId();
    const localKey = nativeId + '/emotions_local';
    this.storage.setItem(localKey, this.emotions.local);

    const cloudDoc = {
      _id: 'emotions_cloud',
      data: this.emotions.cloud,
    };

    try {
      const existing = await this.storage.getDoc('emotions_cloud');
      if (existing && existing._rev) {
        cloudDoc._rev = existing._rev;
      }
    } catch (e) {
      // 文档不存在
    }

    await this.storage.putDoc(cloudDoc);
  }

  /**
   * 获取所有表情包（去重：同一表情包同时存在于本地和云端时只展示一次）
   * 优先保留本地版本（本地访问更快），过滤掉已在本地有配对的云端表情包。
   * @returns {Array}
   */
  getAllEmotions() {
    const cloudDeduped = this.emotions.cloud.filter(cloudEmotion => {
      return !this.findPairedEmotion(cloudEmotion, 'local');
    });
    return [...this.emotions.local, ...cloudDeduped];
  }

  /**
   * 按 ID 查找表情包
   * @param {string} id
   * @returns {object|null}
   */
  findById(id) {
    return this.getAllEmotions().find(e => e.id === id) || null;
  }

  /**
   * 按 URL 查找表情包
   * @param {string} url
   * @returns {object|null}
   */
  findByUrl(url) {
    return this.getAllEmotions().find(e => e.url === url) || null;
  }

  /**
   * 添加表情包
   * @param {object} emotion - 表情包数据
   * @param {'local'|'cloud'} storageType
   */
  addEmotion(emotion, storageType) {
    if (storageType === 'local') {
      this.emotions.local.push(emotion);
    } else {
      this.emotions.cloud.push(emotion);
    }
  }

  /**
   * 删除表情包
   * @param {object} emotion
   */
  removeEmotion(emotion) {
    const target = emotion.storageType === 'local' ? this.emotions.local : this.emotions.cloud;
    const index = target.findIndex(e => e.id === emotion.id);
    if (index !== -1) {
      target.splice(index, 1);
    }
  }

  /**
   * 更新表情包
   * @param {object} emotion
   */
  updateEmotion(emotion) {
    const target = emotion.storageType === 'local' ? this.emotions.local : this.emotions.cloud;
    const index = target.findIndex(e => e.id === emotion.id);
    if (index !== -1) {
      target[index] = emotion;
    }
  }

  /**
   * 查找配对表情包（本地↔云端）
   * @param {object} emotion
   * @param {'local'|'cloud'} targetType
   * @returns {object|null}
   */
  findPairedEmotion(emotion, targetType) {
    const target = targetType === 'local' ? this.emotions.local : this.emotions.cloud;

    return target.find(e => {
      const hasOriginalUrl = e.metadata &&
        ((targetType === 'local' && e.metadata.originalCloudUrl === emotion.url) ||
         (targetType === 'cloud' && e.metadata.originalLocalPath === emotion.url));

      const hasMatchingTags = e.tags.length > 0 &&
        e.tags.every(tag => emotion.tags.includes(tag));

      return hasOriginalUrl || hasMatchingTags;
    });
  }

  /**
   * 从 URL 添加表情包（自动下载/上传到目标存储）
   * @param {string} url - 原始图片 URL
   * @param {string} keyword - 搜索关键词，作为标签
   * @param {'local'|'cloud'} storageType
   * @param {function} onProgress - 进度回调 (message) => void
   * @returns {Promise<object>} 创建的表情包
   */
  async addFromUrl(url, keyword, storageType, onProgress) {
    const settings = this.settingsService.settings;

    // 检查配置
    const hint = settings.getConfigHint(storageType);
    if (hint) {
      throw new Error(hint);
    }

    // 检查重复
    if (this.getAllEmotions().some(e => e.url === url)) {
      throw new Error('该表情包已存在');
    }

    if (onProgress) onProgress(storageType === 'local' ? '正在下载图片到本地...' : '正在上传图片到云端...');

    let finalUrl;
    if (storageType === 'local') {
      finalUrl = await this._downloadAndSaveToLocal(url);
    } else {
      finalUrl = await this._uploadUrlToCloud(url);
    }

    const emotion = {
      id: CryptoUtils.generateUUID(),
      url: finalUrl,
      storageType,
      tags: [keyword],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.addEmotion(emotion, storageType);
    await this.saveData();
    return emotion;
  }

  /**
   * 从文件添加表情包
   * @param {File} file
   * @param {string[]} tags
   * @param {'local'|'cloud'} storageType
   * @param {function} onProgress
   * @returns {Promise<object>}
   */
  async addFromFile(file, tags, storageType, onProgress) {
    const settings = this.settingsService.settings;

    const hint = settings.getConfigHint(storageType);
    if (hint) {
      throw new Error(hint);
    }

    if (onProgress) onProgress('正在处理...');

    let finalUrl;
    if (storageType === 'local') {
      finalUrl = await this._saveToLocal(file);
    } else {
      finalUrl = await this._uploadToCloud(file);
    }

    const emotion = {
      id: CryptoUtils.generateUUID(),
      url: finalUrl,
      storageType,
      tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        originalName: file.name,
        size: file.size,
      },
    };

    this.addEmotion(emotion, storageType);
    await this.saveData();
    return emotion;
  }

  /**
   * 保存文件到本地
   * @param {File} file
   * @returns {Promise<string>}
   */
  async _saveToLocal(file) {
    const settings = this.settingsService.settings;
    if (!settings.isLocalConfigured()) {
      throw new Error('请先在设置中配置本地存储路径');
    }

    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const fullPath = `${settings.localPath}/${fileName}`;

    if (this.file) {
      const base64 = await this._fileToBase64(file);
      const savedPath = await this.file.saveFile(base64, fullPath);
      return `file://${savedPath.replace(/\\/g, '/')}`;
    } else {
      return URL.createObjectURL(file);
    }
  }

  /**
   * 下载 URL 图片并保存到本地
   * @param {string} imageUrl
   * @returns {Promise<string>}
   */
  async _downloadAndSaveToLocal(imageUrl) {
    const settings = this.settingsService.settings;
    if (!settings.isLocalConfigured()) {
      throw new Error('请先在设置中配置本地存储路径');
    }

    const imageData = await this.http.downloadImage(imageUrl);

    const mimeType = imageData.contentType || 'image/png';
    const extension = MimeUtils.getExtensionFromMimeType(mimeType);
    const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
    const fullPath = `${settings.localPath}/${fileName}`;

    if (this.file) {
      const savedPath = await this.file.saveFile(imageData.dataUrl, fullPath);
      return `file://${savedPath.replace(/\\/g, '/')}`;
    } else {
      // 回退：创建 Blob URL
      const response = await this.http.fetchWithTimeout(imageUrl);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  }

  /**
   * 上传 URL 图片到云端
   * @param {string} imageUrl
   * @returns {Promise<string>}
   */
  async _uploadUrlToCloud(imageUrl) {
    const settings = this.settingsService.settings;
    const imageData = await this.http.downloadImage(imageUrl);

    const mimeType = imageData.contentType || 'image/png';
    const extension = MimeUtils.getExtensionFromMimeType(mimeType);
    const fileName = `emotion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;

    let file;
    if (imageData.buffer) {
      file = new File([imageData.buffer], fileName, { type: mimeType });
    } else {
      const response = await this.http.fetchWithTimeout(imageUrl);
      const blob = await response.blob();
      file = new File([blob], fileName, { type: mimeType });
    }

    return await this._uploadToCloud(file);
  }

  /**
   * 上传文件到云端
   * @param {File} file
   * @returns {Promise<string>}
   */
  async _uploadToCloud(file) {
    const settings = this.settingsService.settings;
    const provider = settings.cloudProvider;

    if (provider === 'imgbb') {
      return await this._uploadToImgbb(file);
    } else if (provider === 's3') {
      return await this._uploadToS3(file);
    } else if (provider === 'tucang') {
      return await this._uploadToTucang(file);
    } else {
      throw new Error('请先配置云存储');
    }
  }

  /**
   * 上传到 ImgBB
   * @param {File} file
   * @returns {Promise<string>}
   */
  async _uploadToImgbb(file) {
    const settings = this.settingsService.settings;
    const apiKey = settings.cloudConfig.imgbbApiKey;
    if (!apiKey) {
      throw new Error('请先配置 ImgBB API Key');
    }

    const formData = new FormData();
    formData.append('image', file);

    const response = await this.http.fetchWithTimeout(
      `https://api.imgbb.com/1/upload?key=${apiKey}`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();
    if (data.success) {
      return data.data.url;
    }
    throw new Error(data.error?.message || '上传失败');
  }

  /**
   * 上传到图仓
   * @param {File} file
   * @returns {Promise<string>}
   */
  async _uploadToTucang(file) {
    const settings = this.settingsService.settings;
    const token = settings.cloudConfig.tucangToken;
    if (!token) {
      throw new Error('请先配置图仓 Token');
    }

    const formData = new FormData();
    formData.append('token', token);
    formData.append('file', file);

    const folderId = settings.cloudConfig.tucangFolderId;
    if (folderId && folderId > 0) {
      formData.append('folderId', folderId);
    }

    const response = await this.http.fetchWithTimeout(
      'https://api.tucang.cc/api/v1/upload',
      { method: 'POST', body: formData }
    );

    const data = await response.json();
    if (data.success && data.code === '200') {
      return data.data.url;
    }
    throw new Error(data.msg || '图仓上传失败');
  }

  /**
   * 上传到 S3 兼容存储
   * @param {File} file
   * @returns {Promise<string>}
   */
  async _uploadToS3(file) {
    const settings = this.settingsService.settings;
    const config = settings.cloudConfig;
    if (!config.s3Endpoint || !config.s3AccessKey || !config.s3SecretKey || !config.s3Bucket) {
      throw new Error('请先完整配置 S3 存储信息');
    }

    const fileName = `emotions/${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
    let fileData;

    if (file instanceof ArrayBuffer || file instanceof Uint8Array) {
      fileData = new Uint8Array(file);
    } else {
      const base64Data = await this._fileToBase64(file);
      const binaryData = atob(base64Data.split(',')[1]);
      fileData = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        fileData[i] = binaryData.charCodeAt(i);
      }
    }

    const contentType = file.type || 'image/png';
    const amzDate = CryptoUtils.formatAmzDate(new Date());

    const s3Config = {
      s3Endpoint: config.s3Endpoint,
      customHeaders: {
        'Authorization': await CryptoUtils.generateS3AuthHeader(config, fileName, fileData, contentType),
        'Content-Type': contentType,
        'x-amz-content-sha256': await CryptoUtils.hash256(fileData),
        'x-amz-date': amzDate,
      },
    };

    return await this.http.uploadToS3(s3Config, fileName, fileData, contentType);
  }

  /**
   * 转换存储类型（云端→本地 或 本地→云端）
   * @param {object} emotion
   * @param {function} onProgress
   * @returns {Promise<object>} 新的表情包
   */
  async convertStorage(emotion, onProgress) {
    if (emotion.storageType === 'cloud') {
      return await this._convertCloudToLocal(emotion, onProgress);
    } else {
      return await this._convertLocalToCloud(emotion, onProgress);
    }
  }

  /**
   * 云端→本地
   * @param {object} emotion
   * @param {function} onProgress
   * @returns {Promise<object>}
   */
  async _convertCloudToLocal(emotion, onProgress) {
    const settings = this.settingsService.settings;
    const hint = settings.getLocalConfigHint();
    if (hint) {
      throw new Error(hint);
    }

    if (onProgress) onProgress('正在保存到本地...');

    const finalUrl = await this._downloadAndSaveToLocal(emotion.url);

    const newEmotion = {
      id: CryptoUtils.generateUUID(),
      url: finalUrl,
      storageType: 'local',
      tags: [...emotion.tags],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { originalCloudUrl: emotion.url },
    };

    this.addEmotion(newEmotion, 'local');
    await this.saveData();
    return newEmotion;
  }

  /**
   * 本地→云端
   * @param {object} emotion
   * @param {function} onProgress
   * @returns {Promise<object>}
   */
  async _convertLocalToCloud(emotion, onProgress) {
    const settings = this.settingsService.settings;
    const hint = settings.getCloudConfigHint();
    if (hint) {
      throw new Error(hint);
    }

    if (onProgress) onProgress('正在上传到云端...');

    const file = await this._getFileFromLocal(emotion);
    const finalUrl = await this._uploadToCloud(file);

    const newEmotion = {
      id: CryptoUtils.generateUUID(),
      url: finalUrl,
      storageType: 'cloud',
      tags: [...emotion.tags],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { originalLocalPath: emotion.url },
    };

    this.addEmotion(newEmotion, 'cloud');
    await this.saveData();
    return newEmotion;
  }

  /**
   * 从本地表情包获取 File 对象
   * @param {object} emotion
   * @returns {Promise<File>}
   */
  async _getFileFromLocal(emotion) {
    if (this.file && typeof this.file.readFile === 'function') {
      const filePath = emotion.url.replace('file://', '').replace(/\//g, '\\');
      const result = await this.file.readFile(filePath);
      if (result && result.base64 && result.fileName) {
        const mimeType = MimeUtils.getMimeTypeFromFileName(result.fileName);
        const binaryString = atob(result.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        return new File([blob], result.fileName, { type: mimeType });
      }
    }

    // 回退到浏览器方式
    const response = await this.http.fetchWithTimeout(emotion.url);
    if (!response.ok) {
      throw new Error('无法读取本地文件');
    }
    const blob = await response.blob();
    const fileName = emotion.metadata?.originalName || 'emotion_' + Date.now() + '.' + MimeUtils.getExtensionFromMimeType(blob.type);
    return new File([blob], fileName, { type: blob.type });
  }

  /**
   * 删除表情包（可选同时删除本地文件）
   * @param {object} emotion
   * @param {boolean} deleteLocalFile
   */
  async deleteEmotion(emotion, deleteLocalFile = false) {
    if (deleteLocalFile && emotion.storageType === 'local') {
      const filePath = emotion.url.replace('file://', '').replace(/\//g, '\\');
      if (this.file && typeof this.file.deleteFile === 'function') {
        this.file.deleteFile(filePath);
      }
    }

    this.removeEmotion(emotion);
    await this.saveData();
  }

  /**
   * 删除指定存储类型的配对表情包
   * 用于同一表情包同时存在于本地和云端时，删除指定一端。
   * @param {object} emotion - 当前表情包
   * @param {'local'|'cloud'} targetType - 要删除的目标存储类型
   * @param {boolean} deleteLocalFile - 是否同时删除本地文件
   */
  async deletePairedEmotion(emotion, targetType, deleteLocalFile = false) {
    const paired = this.findPairedEmotion(emotion, targetType);
    if (paired) {
      await this.deleteEmotion(paired, deleteLocalFile);
    }
  }

  /**
   * 复制表情包到剪贴板
   * @param {object} emotion
   */
  async copyToClipboard(emotion) {
    const getErrorMessage = (error) => {
      if (error.name === 'AbortError' || error.message.includes('超时')) {
        return '请求超时，请检查网络连接后重试';
      }
      if (error.message.includes('CORS') || error.message.includes('跨域')) {
        return '图片存在跨域限制，无法复制';
      }
      if (error.message.includes('网络') || error.message.includes('network')) {
        return '网络连接失败，请检查网络后重试';
      }
      return '复制失败: ' + (error.message || '请重试');
    };

    // 方案1: Canvas 绘制
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = emotion.url;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('图片加载超时')), 10000);
        img.onload = () => { clearTimeout(timeout); resolve(); };
        img.onerror = () => { clearTimeout(timeout); reject(new Error('图片加载失败')); };
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = canvas.toDataURL('image/png');
      this.clipboard.copyImage(imageData);
      return;
    } catch (error) {
      console.warn('Canvas 方案失败，尝试备用方案:', error);
    }

    // 方案2: fetch + FileReader
    try {
      const response = await this.http.fetchWithTimeout(emotion.url);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      const blob = await response.blob();
      const reader = new FileReader();

      await new Promise((resolve, reject) => {
        reader.onload = (e) => {
          try {
            this.clipboard.copyImage(e.target.result);
            resolve();
          } catch (copyError) {
            reject(copyError);
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  }

  /**
   * 本地搜索表情包
   * @param {string} keyword
   * @returns {Array}
   */
  searchLocal(keyword) {
    if (!keyword.trim()) {
      return this.getAllEmotions();
    }

    const lowerKeyword = keyword.toLowerCase();
    return this.getAllEmotions().filter(emotion => {
      if (!emotion.tags || !Array.isArray(emotion.tags)) {
        return false;
      }
      return emotion.tags.some(tag =>
        tag && typeof tag === 'string' &&
        tag.toLowerCase().includes(lowerKeyword)
      );
    });
  }

  /**
   * 获取图片显示 URL
   * @param {object} emotion
   * @returns {string}
   */
  getImageSrc(emotion) {
    return emotion.url;
  }

  /**
   * 获取统计信息
   * total 为去重后的总数（同一表情包在本地和云端只计一次）
   * @returns {{total: number, cloud: number, local: number}}
   */
  getStats() {
    return {
      total: this.getAllEmotions().length,
      cloud: this.emotions.cloud.length,
      local: this.emotions.local.length,
    };
  }

  /**
   * File 转 base64
   * @param {File} file
   * @returns {Promise<string>}
   */
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmotionService;
}
