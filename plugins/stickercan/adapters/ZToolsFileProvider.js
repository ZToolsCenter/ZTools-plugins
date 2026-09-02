/**
 * ZToolsFileProvider - ZTools 文件适配器
 *
 * 实现 FileProvider 接口，通过 window.emotionCan（由 preload.js 暴露）
 * 操作本地文件系统。所有 Node.js 能力都在 preload.js 中实现，
 * 此适配器仅做桥接调用，确保在浏览器环境中正常运行。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class ZToolsFileProvider extends FileProvider {
  async selectFolder() {
    // 优先使用 window.emotionCan（preload.js 暴露）
    if (window.emotionCan && typeof window.emotionCan.selectFolder === 'function') {
      return await window.emotionCan.selectFolder();
    }

    // 回退: ztools.showOpenDialog
    if (typeof ztools !== 'undefined' && ztools.showOpenDialog) {
      try {
        const result = await ztools.showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        });
        if (Array.isArray(result) && result.length > 0) {
          return result[0];
        }
      } catch (e) {
        // 继续尝试
      }
    }

    // 最终回退: 返回默认目录
    return this.getDefaultDir();
  }

  async saveFile(fileData, targetPath) {
    if (window.emotionCan && typeof window.emotionCan.saveFile === 'function') {
      return await window.emotionCan.saveFile(fileData, targetPath);
    }
    throw new Error('文件保存功能不可用（preload.js 未加载）');
  }

  fileExists(filePath) {
    if (window.emotionCan && typeof window.emotionCan.fileExists === 'function') {
      return window.emotionCan.fileExists(filePath);
    }
    return false;
  }

  deleteFile(filePath) {
    if (window.emotionCan && typeof window.emotionCan.deleteFile === 'function') {
      return window.emotionCan.deleteFile(filePath);
    }
    return false;
  }

  async readFile(filePath) {
    if (window.emotionCan && typeof window.emotionCan.readFile === 'function') {
      return window.emotionCan.readFile(filePath);
    }
    return null;
  }

  getDefaultDir() {
    if (window.emotionCan && typeof window.emotionCan.getDefaultDir === 'function') {
      return window.emotionCan.getDefaultDir();
    }
    return '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZToolsFileProvider;
}
