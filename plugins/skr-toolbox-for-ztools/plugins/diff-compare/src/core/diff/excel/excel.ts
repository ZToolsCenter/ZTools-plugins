/**
 * @fileoverview Excel 差异比较策略
 * @module core/diff/excel/excel
 * @description 提供基于单元格的 Excel 表格差异比较功能
 */

import { DiffResult, IDiffStrategy } from '../types'
import { normalizeString } from '../../../utils/string'

/**
 * Excel 差异比较策略
 * @class ExcelDiffStrategy
 * @implements IDiffStrategy<any[]>
 * @description 逐单元格比较两个 Excel 表格的内容差异
 * @example
 * ```typescript
 * const strategy = new ExcelDiffStrategy();
 * const source = [['A1', 'B1'], ['A2', 'B2']];
 * const target = [['A1', 'C1'], ['A2', 'B2']];
 * const result = strategy.diff(source, target);
 * // result will contain the cell B1 was changed from 'B1' to 'C1'
 * ```
 */
export class ExcelDiffStrategy implements IDiffStrategy<any[]> {
  /** 策略类型标识 */
  type = 'excel' as const

  /**
   * 执行 Excel 差异比较
   * @param source - 源表格数据（二维数组，每行是一个数组）
   * @param target - 目标表格数据（二维数组，每行是一个数组）
   * @returns 包含差异信息和元数据的对象
   * @description 逐行逐列比较单元格值，返回所有差异的单元格列表
   * 
   * @example
   * ```typescript
   * const diffs = strategy.diff(
   *   [['Name', 'Age'], ['John', '25']],
   *   [['Name', 'Age'], ['John', '26']]
   * );
   * // diffs.diffs will contain: { row: 1, col: 1, source: '25', target: '26' }
   * ```
   */
  diff(source: any[][], target: any[][]): DiffResult<any[]>[] {
    const diffs: any[] = []
    const maxRows = Math.max(source.length, target.length)
    let maxCols = 0

    for (let r = 0; r < maxRows; r++) {
      const sourceRow = source[r] || []
      const targetRow = target[r] || []
      const rowMaxCols = Math.max(sourceRow.length, targetRow.length)
      if (rowMaxCols > maxCols) maxCols = rowMaxCols

      for (let c = 0; c < rowMaxCols; c++) {
        const sVal = normalizeString(sourceRow[c])
        const tVal = normalizeString(targetRow[c])

        if (sVal !== tVal) {
          diffs.push({
            row: r,
            col: c,
            source: sVal,
            target: tVal
          })
        }
      }
    }

    return {
      type: 'excel',
      chunks: [], // Excel diff results are handled differently by ExcelDiffView
      // We extend the result with extra data that the view expects
      ...({
        diffs,
        maxRows,
        maxCols
      } as any)
    }
  }
}
