/**
 * ClipboardProvider - 剪贴板抽象接口
 *
 * 定义跨平台的剪贴板能力。
 */

class ClipboardProvider {
  /**
   * 复制图片到剪贴板
   * @param {string} imageData - base64 格式的图片数据 (data URL)
   */
  copyImage(imageData) {
    throw new Error('ClipboardProvider.copyImage() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClipboardProvider;
}
