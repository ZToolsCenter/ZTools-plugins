/**
 * 图片存储类型定义
 */

/**
 * 图片存储策略接口
 * 所有存储策略都需要实现这个接口
 */
export interface IImageStorageStrategy {
  /**
   * 存储图片，返回引用标识符
   * @param blob 图片数据
   * @param mimeType MIME 类型
   * @returns 引用标识符（uuid:xxx 或 ./assets/xxx.jpg 或 data:...）
   */
  save(blob: Blob, mimeType: string): Promise<string>

  /**
   * 根据引用标识符获取图片
   * @param ref 引用标识符
   * @returns 图片 Blob，如果不存在返回 null
   */
  load(ref: string): Promise<Blob | null>

  /**
   * 删除图片
   * @param ref 引用标识符
   */
  delete(ref: string): Promise<void>

  /**
   * 检查引用是否由该策略处理
   * @param ref 引用标识符
   */
  canHandle(ref: string): boolean
}

/**
 * 存储配置
 */
export interface StorageConfig {
  inlineThreshold: number  // 内嵌阈值（字节），默认 100KB
  compressThreshold: number // 压缩阈值（字节），默认 500KB
  compressQuality: number   // 压缩质量，默认 0.8
  maxEdge: number           // 最大边长（像素），超过则等比降采样，默认 2560
}

/**
 * 默认存储配置
 */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  inlineThreshold: 100 * 1024,   // 100KB
  compressThreshold: 500 * 1024, // 500KB（策略侧参考；编码默认 WebP）
  compressQuality: 0.8,         // 固定 WebP 80%
  maxEdge: 4096,                 // 超大边等比缩到此上限
}

/**
 * uTools db.postAttachment 上限约 10MB。
 * 超过则拒绝入库（不再降质量兜底）。
 */
export const MAX_IMAGE_STORE_BYTES = 10 * 1024 * 1024

/**
 * 存储策略类型
 */
export type StorageStrategyType = 'base64' | 'attachment' | 'file-system' | 'inlined'
