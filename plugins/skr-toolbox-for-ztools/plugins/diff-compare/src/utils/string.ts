/**
 * @fileoverview 字符串工具函数
 * @module utils/string
 * @description 提供字符串处理和归一化相关的实用函数
 */

/**
 * 归一化字符串
 * @function normalizeString
 * @description 将输入值转换为字符串，统一换行符格式，并去除首尾空白
 * @param {any} str - 待归一化的值，可以是任意类型
 * @returns {string} 归一化后的字符串
 * 
 * @example
 * ```typescript
 * normalizeString('Hello\r\nWorld\r') // 'Hello\nWorld'
 * normalizeString('  test  ') // 'test'
 * normalizeString(null) // ''
 * ```
 * 
 * @remarks
 * - 处理 Windows 换行符 (\r\n) 和旧 Mac 换行符 (\r)，统一为 \n
 * - 自动调用 toString() 处理非字符串类型
 * - 对 null 和 undefined 返回空字符串
 */
export function normalizeString(str: any): string {
  if (str === null || str === undefined) return ''
  
  return str
    .toString()
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/**
 * 安全字符串转换
 * @function safeString
 * @description 将任意值安全地转换为字符串，提供默认值回退
 * @param {any} val - 待转换的值
 * @param {string} [fallback=''] - 当值为 null 或 undefined 时的回退值，默认为空字符串
 * @returns {string} 转换后的字符串
 * 
 * @example
 * ```typescript
 * safeString('test') // 'test'
 * safeString(123) // '123'
 * safeString(null, 'default') // 'default'
 * safeString(undefined) // ''
 * ```
 * 
 * @remarks
 * - 与 normalizeString 不同，此方法不会去除空白或处理换行符
 * - 仅对 null 和 undefined 使用回退值，空字符串和其他 falsy 值会被正常转换
 * - 使用 String() 构造函数进行转换，对对象会调用 toString() 方法
 */
export function safeString(val: any, fallback: string = ''): string {
  if (val === null || val === undefined) return fallback
  return String(val)
}
