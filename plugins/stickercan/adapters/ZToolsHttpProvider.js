/**
 * ZToolsHttpProvider - ZTools HTTP 适配器
 *
 * 实现 HttpProvider 接口。
 * 优先使用 Node.js http/https 模块绕过 CORS，
 * 回退到浏览器标准 fetch。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class ZToolsHttpProvider extends HttpProvider {
  async fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接');
      }
      throw error;
    }
  }

  async nodeFetch(url, options = {}) {
    if (window.emotionCan && typeof window.emotionCan.nodeFetch === 'function') {
      try {
        return await window.emotionCan.nodeFetch(url, options);
      } catch (error) {
        console.warn('Node.js请求失败，尝试浏览器fetch:', error);
        return null;
      }
    }
    return null;
  }

  async downloadImage(imageUrl) {
    // 尝试 Node.js 方式（绕过 CORS）
    if (window.emotionCan && typeof window.emotionCan.downloadImage === 'function') {
      try {
        return await window.emotionCan.downloadImage(imageUrl);
      } catch (error) {
        console.warn('Node.js下载失败，尝试浏览器fetch:', error);
      }
    }

    // 回退到浏览器 fetch
    const response = await this.fetchWithTimeout(imageUrl);
    if (!response.ok) {
      throw new Error('下载图片失败');
    }

    const blob = await response.blob();
    const contentType = blob.type || 'image/png';
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = () => {
        resolve({
          dataUrl: reader.result,
          buffer: null,
          contentType: contentType
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async uploadToS3(s3Config, fileName, data, contentType) {
    if (window.emotionCan && typeof window.emotionCan.uploadToS3Node === 'function') {
      return await window.emotionCan.uploadToS3Node(s3Config, fileName, data, contentType);
    }
    throw new Error('Node.js环境不可用，无法上传到S3');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZToolsHttpProvider;
}
