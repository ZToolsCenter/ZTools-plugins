/**
 * HostAdapter 接口定义（JSDoc）
 *
 * 端侧能力统一注入接口。
 * 各端根据自身环境实现：UtoolsHostAdapter、WebHostAdapter、ElectronHostAdapter 等。
 *
 * @interface HostAdapter
 */
export default class HostAdapter {
  /**
   * 弹出图片选择对话框，返回图片 source（dataURL / URL / File / Blob）。
   * 不支持的环境返回 null。
   * @returns {Promise<string|null>}
   */
  async pickImage() { return null; }

  /**
   * 读取本地文件路径，返回 dataURL。
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async readImageFile(filePath) { throw new Error('Not implemented'); }

  /**
   * 弹出保存对话框，写入图片。
   * @param {Blob|string} data - Blob 对象或 dataURL 字符串
   * @param {string} [suggestedName='edited']
   * @returns {Promise<boolean>}
   */
  async saveImage(data, suggestedName = 'edited') { return false; }

  /**
   * 复制图片到系统剪贴板。
   * @param {Blob|string} data - Blob 对象或 dataURL 字符串
   * @returns {Promise<boolean>}
   */
  async copyImage(data) { return false; }

  /**
   * 获取系统字体列表。
   * @returns {Promise<string[]>}
   */
  async getSystemFonts() { return []; }

  /**
   * 异步获取系统字体列表（不阻塞UI线程）。
   * @returns {Promise<string[]>}
   */
  async getSystemFontsAsync() { return []; }

  /**
   * 获取存储值。
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async getStorageItem(key) { return null; }

  /**
   * 设置存储值。
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async setStorageItem(key, value) {}

  /**
   * 用系统浏览器打开外部链接。
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async openExternal(url) { return false; }

  /**
   * 调整宿主窗口高度。
   * @param {number} height
   */
  setWindowHeight(height) {}

  /**
   * 注册宿主进入事件（文件匹配 / 超级面板等）。
   * @param {function} callback
   * @returns {function} 取消订阅函数
   */
  onPluginEnter(callback) { return () => {}; }

  /**
   * 获取当前宿主名称。
   * @returns {string}
   */
  getHostName() { return 'browser'; }

  /**
   * 获取当前宿主用户信息。
   * @returns {Promise<object|null>}
   */
  async getHostUser() { return null; }
}
