/**
 * @fileoverview 差异导航工具函数
 * @module utils/diffNavigation
 * @description 提供在差异结果中导航的实用函数，支持循环导航
 */

/**
 * 获取下一个差异索引
 * @function getNextIndex
 * @description 在当前索引基础上获取下一个差异项的索引，支持循环到开头
 * @param {number[]} indices - 差异索引数组，如 [0, 3, 7]
 * @param {number} current - 当前激活索引
 * @returns {number} 下一个差异项的索引，如果没有则返回 -1
 * 
 * @example
 * ```typescript
 * // 基本用法
 * const next = getNextIndex([0, 2, 4], 0); // 返回 2
 * 
 * // 循环到开头
 * const next = getNextIndex([0, 2, 4], 4); // 返回 0
 * 
 * // 当前索引不在数组中
 * const next = getNextIndex([0, 2, 4], 1); // 返回 0
 * ```
 * 
 * @remarks
 * - 如果 current 不在 indices 中，返回数组第一个元素
 * - 索引计算采用循环方式，到达末尾后回到开头
 * - 如果 indices 为空数组，返回 -1
 */
export function getNextIndex(indices: number[], current: number): number {
  if (!indices.length) return -1;
  const pos = indices.indexOf(current);
  if (pos === -1) return indices[0];
  return indices[(pos + 1) % indices.length];
}

/**
 * 获取上一个差异索引
 * @function getPrevIndex
 * @description 在当前索引基础上获取上一个差异项的索引，支持循环到末尾
 * @param {number[]} indices - 差异索引数组，如 [0, 3, 7]
 * @param {number} current - 当前激活索引
 * @returns {number} 上一个差异项的索引，如果没有则返回 -1
 * 
 * @example
 * ```typescript
 * // 基本用法
 * const prev = getPrevIndex([0, 2, 4], 2); // 返回 0
 * 
 * // 循环到末尾
 * const prev = getPrevIndex([0, 2, 4], 0); // 返回 4
 * 
 * // 当前索引不在数组中
 * const prev = getPrevIndex([0, 2, 4], 1); // 返回 4（最后一个）
 * ```
 * 
 * @remarks
 * - 如果 current 不在 indices 中，返回数组最后一个元素
 * - 索引计算采用循环方式，到达开头后跳到末尾
 * - 如果 indices 为空数组，返回 -1
 */
export function getPrevIndex(indices: number[], current: number): number {
  if (!indices.length) return -1;
  const pos = indices.indexOf(current);
  if (pos <= 0) return indices[indices.length - 1];
  return indices[pos - 1];
}
