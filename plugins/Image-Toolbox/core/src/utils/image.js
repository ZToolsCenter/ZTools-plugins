/**
 * 图片工具函数
 */

/**
 * 从 DataURL 加载图片
 * @param {string} dataURL
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageFromDataURL(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataURL;
  });
}

/**
 * 从 File 对象读取为 DataURL
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * 从 URL 获取 Blob
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function urlToBlob(url) {
  const response = await fetch(url);
  return response.blob();
}

/**
 * Canvas 转 Blob
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type='image/png']
 * @param {number} [quality=1]
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = 'image/png', quality = 1) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob 失败'));
    }, type, quality);
  });
}

/**
 * 检测是否为支持的图片格式
 * @param {string} filename
 * @returns {boolean}
 */
export function isSupportedImage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const supported = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'];
  return supported.includes(ext);
}

/**
 * 获取图片文件的 MIME 类型
 * @param {string} extension
 * @returns {string}
 */
export function getImageMimeType(extension) {
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return mimeMap[extension.toLowerCase()] || 'image/png';
}

/**
 * 在画布上绘制棋盘格背景
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} [size=8]
 * @param {string} [color1='#c8d0d4']
 * @param {string} [color2='#d2d6d9']
 */
export function drawCheckerboard(ctx, width, height, size = 8, color1 = '#c8d0d4', color2 = '#d2d6d9') {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillStyle = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? color1 : color2;
      ctx.fillRect(x, y, size, size);
    }
  }
}
