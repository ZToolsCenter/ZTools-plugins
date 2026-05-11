/**
 * @fileoverview 剪贴板工具函数
 * @module utils/clipboard
 * @description 提供与剪贴板交互的实用函数
 */

/**
 * 写入文本到剪贴板
 * @function writeText
 * @description 异步将文本写入系统剪贴板
 * @param {string} text - 要写入的文本内容
 * @returns {Promise<void>} 操作完成的 Promise
 * @throws {Error} 当写入失败时抛出错误
 * 
 * @example
 * ```typescript
 * try {
 *   await writeText('Hello, Clipboard!');
 *   console.log('Text copied successfully');
 * } catch (error) {
 *   console.error('Failed to copy:', error);
 * }
 * ```
 * 
 * @remarks
 * - 需要用户交互触发（如按钮点击）
 * - 浏览器权限：需要剪贴板写入权限
 * - 兼容性：现代浏览器支持，HTTPS 环境
 * - 降级方案：可回退到 document.execCommand('copy')
 */
export async function writeText(text: string): Promise<void> {
  return await navigator.clipboard.writeText(text);
}

/**
 * 从剪贴板读取文本
 * @function readText
 * @description 异步从系统剪贴板读取文本内容
 * @returns {Promise<string>} 剪贴板中的文本内容
 * @throws {Error} 当读取失败或无权限时抛出错误
 * 
 * @example
 * ```typescript
 * try {
 *   const text = await readText();
 *   console.log('Pasted text:', text);
 * } catch (error) {
 *   console.error('Failed to read clipboard:', error);
 * }
 * ```
 * 
 * @remarks
 * - 需要用户授权：浏览器会提示用户允许读取剪贴板
 * - 浏览器权限：需要剪贴板读取权限
 * - 安全性：仅在用户触发的事件中可用（如粘贴操作）
 * - 兼容性：现代浏览器支持，HTTPS 环境
 */
export async function readText(): Promise<string> {
  return await navigator.clipboard.readText();
}

/**
 * 从剪贴板中提取文件
 * @function extractFilesFromClipboard
 * @description 从剪贴板事件中提取满足条件的文件列表
 * @param {ClipboardEvent} e - 剪贴板事件对象
 * @param {(file: File) => boolean} accept - 文件过滤器函数，用于判断是否接受该文件
 * @returns {File[]} 满足条件的文件数组
 * 
 * @example
 * ```typescript
 * // 只接受图片文件
 * document.addEventListener('paste', (e) => {
 *   const images = extractFilesFromClipboard(e, (file) => 
 *     file.type.startsWith('image/')
 *   );
 *   console.log('Pasted images:', images);
 * });
 * 
 * // 接受 PDF 文件
 * const pdfs = extractFilesFromClipboard(e, (file) => 
 *   file.type === 'application/pdf'
 * );
 * ```
 * 
 * @remarks
 * - 仅在粘贴事件（paste event）中可用
 * - 用户需要授权剪贴板访问权限
 * - 某些浏览器可能不支持从剪贴板读取文件
 * - 返回的是 File 对象的数组，可以直接用于文件上传
 */
export function extractFilesFromClipboard(
  e: ClipboardEvent,
  accept: (file: File) => boolean
): File[] {
  const items = e.clipboardData?.items
  if (!items) return []

  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      const file = items[i].getAsFile()
      if (file && accept(file)) {
        files.push(file)
      }
    }
  }

  return files
}
