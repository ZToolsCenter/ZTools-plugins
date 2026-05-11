/**
 * @fileoverview Word 文档差异比较策略
 * @module core/diff/word/word
 * @description 提供基于段落的 Word 文档差异比较功能
 */

import { DiffResult, IDiffStrategy } from '../types'
import { TextDiffStrategy } from '../text/text'

/**
 * Word 文档差异比较策略
 * @class WordDiffStrategy
 * @implements IDiffStrategy<string>
 * @description 将 Word 文档的段落差异比较委托给文本差异策略
 * @example
 * ```typescript
 * const strategy = new WordDiffStrategy();
 * const source = ['Paragraph 1', 'Paragraph 2'];
 * const target = ['Paragraph 1', 'Modified Paragraph 2'];
 * const result = strategy.diff(source, target);
 * ```
 */
export class WordDiffStrategy implements IDiffStrategy<string> {
  /** 策略类型标识 */
  type = 'word' as const

  /**
   * 内部文本差异策略实例
   * @private
   * @description 用于实际执行段落级别的文本差异比较
   */
  private textStrategy = new TextDiffStrategy()

  /**
   * 执行 Word 文档差异比较
   * @param source - 源文档段落数组
   * @param target - 目标文档段落数组
   * @returns 差异比较结果数组
   * @description 将段落数组委托给文本差异策略进行比较
   * 
   * @example
   * ```typescript
   * const diffs = strategy.diff(
   *   ['First paragraph', 'Second paragraph'],
   *   ['First paragraph', 'Modified second']
   * );
   * // Returns: [{ type: 'equal', ... }, { type: 'modify', ... }]
   * ```
   */
  diff(source: string[], target: string[]): DiffResult<string>[] {
    // Word diff is essentially text diff on paragraphs
    return this.textStrategy.diff(source, target)
  }
}
