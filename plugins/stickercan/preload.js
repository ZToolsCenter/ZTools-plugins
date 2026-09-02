/**
 * preload.js - ZTools 预加载脚本
 *
 * 在 Node.js 环境中运行，将文件操作和 HTTP 能力暴露到 window.emotionCan。
 * 这里的函数供 ZToolsHttpProvider / ZToolsFileProvider 调用。
 *
 * 注意：此文件是 ZTools 平台专有的，属于 clients/ztools 层。
 *       core 层不直接依赖 window.emotionCan。
 */

console.log('表情罐头插件 preload.js 已加载');

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

window.emotionCan = {
  // ── 文件操作 ──

  /**
   * 选择文件夹
   * @returns {Promise<string|null>}
   */
  selectFolder: async function() {
    try {
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

      try {
        const electron = require('electron');
        if (electron && electron.remote) {
          const dialog = electron.remote.dialog;
          if (dialog) {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory', 'createDirectory']
            });
            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
              return result.filePaths[0];
            }
          }
        }
      } catch (e) {
        // 继续尝试
      }

      return path.join(os.homedir(), '表情罐头');
    } catch (error) {
      console.error('选择文件夹失败:', error);
      return path.join(os.homedir(), '表情罐头');
    }
  },

  /**
   * 保存文件到本地
   * @param {string|Buffer} fileData
   * @param {string} targetPath
   * @returns {Promise<string>}
   */
  saveFile: async function(fileData, targetPath) {
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const base64Data = fileData.replace(/^data:\w+\/\w+;base64,/, '');
        fs.writeFileSync(targetPath, base64Data, 'base64');
      } else if (Buffer.isBuffer(fileData)) {
        fs.writeFileSync(targetPath, fileData);
      } else {
        throw new Error('不支持的文件数据格式');
      }

      return targetPath;
    } catch (error) {
      console.error('保存文件失败:', error);
      throw error;
    }
  },

  /**
   * 判断文件是否存在
   */
  fileExists: function(filePath) {
    return fs.existsSync(filePath);
  },

  /**
   * 删除文件
   */
  deleteFile: function(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error('删除文件失败:', error);
      return false;
    }
  },

  /**
   * 读取本地文件
   * @param {string} filePath
   * @returns {{base64: string, fileName: string}|null}
   */
  readFile: function(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const fileName = path.basename(filePath);
      return { base64, fileName };
    } catch (error) {
      console.error('读取文件失败:', error);
      return null;
    }
  },

  /**
   * 获取默认存储目录
   */
  getDefaultDir: function() {
    return path.join(os.homedir(), '表情罐头');
  },

  // ── HTTP 操作 ──

  /**
   * Node.js HTTP 请求（绕过 CORS）
   * @param {string} url
   * @param {object} options
   * @returns {Promise<object>}
   */
  nodeFetch: function(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 30000
      };

      const req = lib.request(requestOptions, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.nodeFetch(res.headers.location, options).then(resolve).catch(reject);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            body: data,
            text: () => data.toString('utf8'),
            json: () => JSON.parse(data.toString('utf8'))
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  },

  /**
   * 下载图片
   * @param {string} imageUrl
   * @returns {Promise<{dataUrl: string, buffer: Buffer, contentType: string}>}
   */
  downloadImage: function(imageUrl) {
    return new Promise((resolve, reject) => {
      this.nodeFetch(imageUrl, { method: 'GET' })
        .then(response => {
          if (!response.ok) {
            reject(new Error(`下载失败: ${response.status} ${response.statusText}`));
            return;
          }

          const contentType = response.headers['content-type'] || 'image/png';
          const base64 = response.body.toString('base64');
          const dataUrl = `data:${contentType};base64,${base64}`;

          resolve({
            dataUrl: dataUrl,
            buffer: response.body,
            contentType: contentType
          });
        })
        .catch(reject);
    });
  },

  /**
   * 上传数据到 S3 兼容存储
   * @param {object} s3Config
   * @param {string} fileName
   * @param {Buffer|Uint8Array} data
   * @param {string} contentType
   * @returns {Promise<string>} 上传后的 URL
   */
  uploadToS3Node: function(s3Config, fileName, data, contentType) {
    return new Promise((resolve, reject) => {
      try {
        let endpoint = s3Config.s3Endpoint;

        if (!endpoint) {
          reject(new Error('S3 Endpoint未配置'));
          return;
        }

        if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
          endpoint = 'https://' + endpoint;
        }

        let urlObj;
        try {
          urlObj = new URL(endpoint);
        } catch (e) {
          reject(new Error('S3 Endpoint格式无效: ' + endpoint));
          return;
        }

        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;

        let buffer;
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (data instanceof Uint8Array) {
          buffer = Buffer.from(data);
        } else if (data instanceof ArrayBuffer) {
          buffer = Buffer.from(new Uint8Array(data));
        } else {
          reject(new Error('不支持的数据格式'));
          return;
        }

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: '/' + fileName,
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Content-Length': buffer.length,
            ...s3Config.customHeaders || {}
          }
        };

        const req = lib.request(options, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const cdnUrl = endpoint.replace(/\/$/, '');
              resolve(`${cdnUrl}/${fileName}`);
            } else {
              const errorBody = Buffer.concat(chunks).toString();
              console.error('S3上传失败详情:', res.statusCode, res.statusMessage, errorBody);
              reject(new Error(`S3上传失败: HTTP ${res.statusCode} ${res.statusMessage}`));
            }
          });
        });

        req.on('error', (error) => {
          console.error('S3上传请求错误:', error);
          reject(new Error('S3上传请求失败: ' + error.message));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('S3上传超时'));
        });

        req.write(buffer);
        req.end();
      } catch (error) {
        console.error('S3上传初始化错误:', error);
        reject(new Error('S3上传初始化失败: ' + error.message));
      }
    });
  }
};

console.log('表情罐头插件 API 已暴露');
