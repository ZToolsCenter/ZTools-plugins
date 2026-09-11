/**
 * 内联存储策略
 * 用于小图片（< 100KB），直接用 base64 内嵌在文档中
 */

import type { IImageStorageStrategy } from '../types'
import { blobToBase64 } from '../utils'

export class InlinedStrategy implements IImageStorageStrategy {
  private threshold: number

  constructor(threshold: number) {
    this.threshold = threshold
  }

  /**
   * 保存为 base64
   */
  async save(blob: Blob, mimeType: string): Promise<string> {
    return blobToBase64(blob)
  }

  /**
   * 加载 - base64 数据直接使用，无需加载
   */
  async load(ref: string): Promise<Blob | null> {
    // 返回 null 表示直接使用 ref 作为 src，不需要额外加载
    return null
  }

  /**
   * 删除 - 内联数据无需删除
   */
  async delete(ref: string): Promise<void> {
    // 内联数据存在文档中，删除文档时自动清理
  }

  /**
   * 检查是否处理该引用
   */
  canHandle(ref: string): boolean {
    return ref.startsWith('data:image/')
  }
}
