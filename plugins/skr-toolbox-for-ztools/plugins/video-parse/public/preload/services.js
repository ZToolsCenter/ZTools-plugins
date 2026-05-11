const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { parseInfo } = require('./parser');

window.utools = {
  ...window.ztools,
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // 下载视频到本地下载目录
  async downloadVideo (url, type = 'pic', onProgress, filenameSuffix) {
    const https = require('https');
    const fs = require('fs');
    return new Promise(async (resolve, reject) => {
      // 从URL提取文件名，如果没有则使用时间戳
      let filename = '';
      if (!filename || filename === '/') {
        // 视频20251216-220506.mp4
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const prefix = type === 'video' ? '视频' : '图片';
        const imageType = await this.getImageType(url);
        const suffix = type === 'video' ? '.mp4' : (imageType === 'gif' ? '.gif' : '.jpg');
        // 兼容多个同时下载，增加自定义后缀
        const moreSuffix = filenameSuffix ? `-${filenameSuffix}` : '';
        filename = `${prefix}${year}${month}${day}-${hours}${minutes}${seconds}${moreSuffix}` + suffix;
      }
      const downloadPath = window.utools.dbStorage.getItem('downloadPath') || window.utools.getPath('downloads');
      const filePath = path.join(downloadPath, filename);
      
      const file = fs.createWriteStream(filePath);
      https.get(url, (response) => {
        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        // 监听数据传输
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress && total) {
            onProgress(downloaded, total);
          }
        });
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(filePath);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  },
  // 根据url判断图片类型
  async getImageType(url) {
    return new Promise((resolve) => {
      const knownTypes = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
      };
      https.get(url, (res) => {
        const contentType = res.headers['content-type'];
        resolve(knownTypes[contentType] || 'jpg');
      }).on('error', () => {
        resolve('jpg');
      });
    });
  },
  parseInfo (sharedUrl) {
    return parseInfo(sharedUrl);
  },
}
