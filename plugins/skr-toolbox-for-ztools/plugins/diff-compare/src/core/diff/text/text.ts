/**
 * 文本差异比较模块
 * 提供基于行的文本差异检测和行内差异分析
 */

import { diffArrays, diffWordsWithSpace, Change } from 'diff';
import { DiffResult, IDiffStrategy } from '../types';

/**
 * 文本差异比较结果
 * 扩展基础 DiffResult，添加行号和行内差异信息
 */
export interface TextDiffResult extends DiffResult<string> {
  /** 源文本行号 */
  sourceLine?: number
  /** 目标文本行号 */
  targetLine?: number
  /** 行内差异变化列表 */
  inlineChanges?: Change[]
}

/**
 * 文本差异比较策略
 * 实现 IDiffStrategy 接口，提供文本文件的差异比较功能
 */
export class TextDiffStrategy implements IDiffStrategy<string> {
  /** 策略类型标识 */
  type = 'text' as const;

  /**
   * 执行文本差异比较
   * @param source - 源文本行数组
   * @param target - 目标文本行数组
   * @returns 文本差异比较结果数组
   */
  diff(source: string[], target: string[]): TextDiffResult[] {
    const changes = diffArrays(source, target);
    const result: TextDiffResult[] = [];

    let sourceIndex = 1;
    let targetIndex = 1;

    for (let k = 0; k < changes.length; k++) {
      const part = changes[k];

      if (part.removed && changes[k + 1] && changes[k + 1].added) {
        const removedPart = part;
        const addedPart = changes[k + 1];

        const maxLength = Math.max(removedPart.value.length, addedPart.value.length);

        for (let idx = 0; idx < maxLength; idx++) {
          const sLine = removedPart.value[idx];
          const tLine = addedPart.value[idx];

          if (sLine !== undefined && tLine !== undefined) {
            const inlineChanges = diffWordsWithSpace(sLine, tLine);
            result.push({
              type: 'modify',
              source: sLine,
              target: tLine,
              sourceLine: sourceIndex++,
              targetLine: targetIndex++,
              inlineChanges
            });
          } else if (sLine !== undefined) {
            result.push({ type: 'delete', source: sLine, sourceLine: sourceIndex++ });
          } else if (tLine !== undefined) {
            result.push({ type: 'insert', target: tLine, targetLine: targetIndex++ });
          }
        }
        k++;
        continue;
      }

      if (!part.added && !part.removed) {
        for (const value of part.value) {
          result.push({
            type: 'equal',
            source: value,
            target: value,
            sourceLine: sourceIndex++,
            targetLine: targetIndex++
          });
        }
      } else if (part.removed) {
        for (const value of part.value) {
          result.push({
            type: 'delete',
            source: value,
            sourceLine: sourceIndex++
          });
        }
      } else if (part.added) {
        for (const value of part.value) {
          result.push({
            type: 'insert',
            target: value,
            targetLine: targetIndex++
          });
        }
      }
    }

    return result;
  }
}