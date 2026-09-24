/**
 * 聚光灯插件 preload
 * ZTools 会自动向页面注入 window.ztools，这里只补充少量原生信息。
 * 注意：本文件遵循 ZTools 规范，保持清晰可读，不做压缩混淆。
 */

window.spotlightPreload = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  }
};
