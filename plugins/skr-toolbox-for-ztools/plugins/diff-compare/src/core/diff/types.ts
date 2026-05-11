/**
 * 差异比较支持的文件类型
 * @example 'text' - 文本文件对比
 * @example 'image' - 图像文件对比
 * @example 'word' - Word文档对比
 * @example 'excel' - Excel表格对比
 * @example 'pdf' - PDF文档对比
 */
export type DiffType = 'text' | 'image' | 'word' | 'excel' | 'pdf'

/**
 * 差异比较结果项
 * @typeParam T - 对比元素的类型
 * @property type - 差异类型：equal(相同)、modify(修改)、delete(删除)、insert(插入)
 * @property source - 源数据（对于 delete 和 modify 类型存在）
 * @property target - 目标数据（对于 insert 和 modify 类型存在）
 * @example
 * ```typescript
 * const result: DiffResult<string> = {
 *   type: 'modify',
 *   source: 'old text',
 *   target: 'new text'
 * }
 * ```
 */
export interface DiffResult<T> {
  /** 差异类型 */
  type: 'equal' | 'modify' | 'delete' | 'insert'
  /** 源数据 */
  source?: T
  /** 目标数据 */
  target?: T
  /** 额外元数据 */
  metadata?: Record<string, any>
}

/**
 * 差异比较策略接口
 * 实现此接口可自定义不同类型文件的差异比较逻辑
 * @typeParam T - 对比元素的类型
 * @example
 * ```typescript
 * class MyDiffStrategy implements IDiffStrategy<string> {
 *   type = 'text' as DiffType
 *   
 *   diff(source: string[], target: string[]): DiffResult<string>[] {
 *     // 实现差异比较逻辑
 *   }
 * }
 * ```
 */
export interface IDiffStrategy<T = any> {
  /** 策略类型标识 */
  type: DiffType
  /**
   * 执行差异比较
   * @param source - 源数据数组
   * @param target - 目标数据数组
   * @returns 差异比较结果数组
   */
  diff(source: T[], target: T[]): DiffResult<T>[]
}
