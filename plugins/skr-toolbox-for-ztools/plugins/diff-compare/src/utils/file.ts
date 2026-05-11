/**
 * @fileoverview 文件工具函数
 * @module utils/file
 * @description 提供文件读取和下载相关的实用函数
 */

/**
 * 将文件读取为 ArrayBuffer
 * @function readFileAsArrayBuffer
 * @description 异步读取文件内容为 ArrayBuffer 格式
 * @param {File} file - 要读取的文件对象
 * @returns {Promise<ArrayBuffer>} 包含文件内容的 ArrayBuffer
 * @throws {Error} 当文件读取失败时抛出错误
 * 
 * @example
 * ```typescript
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async (e) => {
 *   const file = e.target.files[0];
 *   try {
 *     const buffer = await readFileAsArrayBuffer(file);
 *     console.log('File size:', buffer.byteLength);
 *   } catch (error) {
 *     console.error('Failed to read file:', error);
 *   }
 * });
 * ```
 * 
 * @remarks
 * - 适用于读取二进制文件（如 PDF、图片等）
 * - 返回的 ArrayBuffer 可以转换为其他格式（如 Uint8Array）
 * - 对于大文件，建议使用分片读取或流式处理
 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Failed to read file as ArrayBuffer'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 将文件读取为 Data URL
 * @function readFileAsDataURL
 * @description 异步读取文件内容为 Base64 Data URL 格式，适用于图片预览
 * @param {File} file - 要读取的文件对象
 * @returns {Promise<string>} Base64 Data URL 字符串
 * @throws {Error} 当文件读取失败时抛出错误
 * 
 * @example
 * ```typescript
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async (e) => {
 *   const file = e.target.files[0];
 *   try {
 *     const dataUrl = await readFileAsDataURL(file);
 *     const img = document.createElement('img');
 *     img.src = dataUrl;
 *     document.body.appendChild(img);
 *   } catch (error) {
 *     console.error('Failed to read file:', error);
 *   }
 * });
 * ```
 * 
 * @remarks
 * - 适用于图片预览（`<img src="...">`）
 * - 返回的 Data URL 格式为 `data:[mimeType];base64,[data]`
 * - 对于大文件（如视频），可能导致性能问题
 * - 返回的字符串可以直接用作图片的 src 属性
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error('Failed to read file as DataURL'))
    reader.readAsDataURL(file)
  })
}

/**
 * 下载文本内容为文件
 * @function downloadTextFile
 * @description 将文本内容下载为本地文件
 * @param {string} content - 要下载的文本内容
 * @param {string} filename - 下载后的文件名
 * @param {string} [mimeType='text/plain'] - MIME 类型，默认为纯文本
 * 
 * @example
 * ```typescript
 * // 下载文本文件
 * downloadTextFile('Hello, World!', 'hello.txt');
 * 
 * // 下载 JSON 文件
 * const json = JSON.stringify({ name: 'John' }, null, 2);
 * downloadTextFile(json, 'data.json', 'application/json');
 * 
 * // 下载 CSV 文件
 * const csv = 'Name,Age\nJohn,30\nJane,25';
 * downloadTextFile(csv, 'data.csv', 'text/csv');
 * ```
 * 
 * @remarks
 * - 使用 Blob 和 URL.createObjectURL 实现下载
 * - 兼容性：现代浏览器都支持
 * - 对于大文件，建议使用分块下载或流式下载
 * - 文件名可能受浏览器安全策略限制（如不允许某些字符）
 */
export function downloadTextFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
