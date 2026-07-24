// preload.js - ZTools预加载脚本
// 此文件在插件初始化时加载，可用于Node.js环境下的操作

console.log('表情罐头插件 preload.js 已加载');

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

// 暴露必要的功能到 window 对象
window.emotionCan = {
  // 选择文件夹 - 使用多种方式兼容
  selectFolder: async function() {
    try {
      // 方式1: 直接使用 ZTools showOpenDialog
      if (window.ztools && window.ztools.showOpenDialog) {
        try {
          const result = await window.ztools.showOpenDialog({
            properties: ['openDirectory', 'createDirectory']
          });
          if (Array.isArray(result) && result.length > 0) {
            return result[0];
          }
        } catch (e) {
          console.log('ZTools showOpenDialog 失败，尝试其他方法');
        }
      }

      // 方式2: 尝试使用 electron remote（如果有）
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
        console.log('electron.remote 方式失败:', e.message);
      }

      // 方式3: 所有方法都失败，返回默认目录
      const defaultDir = path.join(os.homedir(), '表情罐头');
      console.log('使用默认目录:', defaultDir);
      return defaultDir;

    } catch (error) {
      console.error('选择文件夹失败，返回默认目录:', error);
      // 出错时返回默认目录
      return path.join(os.homedir(), '表情罐头');
    }
  },

  // 保存文件到本地
  saveFile: async function(fileData, targetPath) {
    try {
      // 确保目录存在
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 如果 fileData 是 base64 格式
      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const base64Data = fileData.replace(/^data:\w+\/\w+;base64,/, '');
        fs.writeFileSync(targetPath, base64Data, 'base64');
      } else if (fileData instanceof Buffer) {
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

  // 文件是否存在
  fileExists: function(filePath) {
    return fs.existsSync(filePath);
  },

  // 删除文件
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

  // 获取用户默认目录
  getDefaultDir: function() {
    return path.join(os.homedir(), '表情罐头');
  },

  // Node.js HTTP请求（支持下载和上传，绕过CORS）
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
          // 跟随重定向
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

  // 下载图片文件
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

  // 上传数据到S3（Node.js方式）
  uploadToS3Node: function(s3Config, fileName, data, contentType) {
    return new Promise((resolve, reject) => {
      try {
        let endpoint = s3Config.s3Endpoint;

        if (!endpoint) {
          reject(new Error('S3 Endpoint未配置'));
          return;
        }

        // 确保endpoint有协议头
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
