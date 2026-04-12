/**
 * ZTools 子网掩码计算器 - Preload 脚本
 * 此文件可调用 Node.js 和 Electron API
 * 注意：代码不能压缩/混淆，必须保持可读
 */

const { clipboard } = require('electron');

window.subnetApi = {
  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   */
  copyToClipboard: function (text) {
    clipboard.writeText(text);
  }
};
