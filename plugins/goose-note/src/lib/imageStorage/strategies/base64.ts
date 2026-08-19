/**
 * Base64 存储策略
 * 用于 uTools 默认模式，保持现有 Base64 方案（支持多端同步）
 */

import type { IImageStorageStrategy } from '../types'
import { blobToBase64 } from '../utils'
import { compressIfNeeded } from '../../imageProcessor'

export class Base64Strategy implements IImageStorageStrategy {
  /**
   * 保存为 base64（统一 WebP@80%；已是 WebP 不二次压缩）
   */
  async save(blob: Blob, _mimeType: string): Promise<string> {
    const out = await compressIfNeeded(blob)
    return blobToBase64(out)
  }

  /**
   * 加载 - base64 数据直接使用
   */
  async load(_ref: string): Promise<Blob | null> {
    // 返回 null 表示直接使用 ref 作为 src
    return null
  }

  /**
   * 删除 - base64 存在文档中，删除时自动清理
   */
  async delete(_ref: string): Promise<void> {
    // Base64 存在文档中，删除文档时自动清理
  }

  /**
   * 检查是否处理该引用
   */
  canHandle(ref: string): boolean {
    return ref.startsWith('data:image/')
  }
}
