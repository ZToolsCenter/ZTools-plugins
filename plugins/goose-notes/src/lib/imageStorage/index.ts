/**
 * 图片存储统一入口
 * 根据笔记来源自动选择最优存储策略
 */

import type { IImageStorageStrategy } from './types'
import { DEFAULT_STORAGE_CONFIG } from './types'
import { AttachmentStrategy } from './strategies/attachment'
import { Base64Strategy } from './strategies/base64'
import { FileSystemStrategy } from './strategies/file-system'
import { InlinedStrategy } from './strategies/inlined'
import { UToolsAdapter } from '../utools'
import { compressIfNeeded } from '../imageProcessor'

type LocalFolderAccessState =
  | boolean
  | string
  | null
  | undefined
  | Promise<boolean | string | null | undefined>

/**
 * 图片存储管理器
 */
export class ImageStorage {
  private strategy: IImageStorageStrategy | null = null
  private strategyPromise: Promise<IImageStorageStrategy> | null = null
  private inlinedStrategy: InlinedStrategy
  private localFolderAccessResolver: (() => LocalFolderAccessState) | null =
    null

  constructor() {
    // 小图片策略（< 100KB），阈值与 DEFAULT_STORAGE_CONFIG 保持一致
    this.inlinedStrategy = new InlinedStrategy(DEFAULT_STORAGE_CONFIG.inlineThreshold)
  }

  /**
   * 根据笔记来源选择存储策略
   */
  private async resolveStrategy(): Promise<IImageStorageStrategy> {
    if (this.strategy) return this.strategy
    if (this.strategyPromise) return this.strategyPromise

    this.strategyPromise = (async () => {
      const localFolderPath = await this.resolveLocalFolderPath()

      if (localFolderPath) {
        return new FileSystemStrategy(() => this.resolveLocalFolderPath())
      }

      if (UToolsAdapter.isUTools) {
        return new AttachmentStrategy()
      }

      return new Base64Strategy()
    })()

    this.strategy = await this.strategyPromise
    this.strategyPromise = null
    return this.strategy
  }

  /**
   * 检测是否有本地文件夹访问权限
   */
  private async resolveLocalFolderPath(): Promise<string | null> {
    if (!this.localFolderAccessResolver) return null

    const resolved = await Promise.resolve(this.localFolderAccessResolver())
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : null
  }

  /**
   * 注入本地文件夹访问检测器（避免依赖 store 造成循环）
   */
  setLocalFolderAccessResolver(
    resolver: () => LocalFolderAccessState,
  ): void {
    this.localFolderAccessResolver = resolver
    this.strategy = null
    this.strategyPromise = null
  }

  /**
   * 存储图片
   * - 入口统一 WebP@80%（SVG 跳过；已是 WebP 不二次压缩）
   * - 小图片（< 100KB）：直接 base64 内嵌
   * - 大图片（≥ 100KB）：使用策略存储
   */
  async save(blob: Blob, mimeType: string): Promise<string> {
    // 入口统一处理：WebP@80%；用压缩后的 size 决定是否内嵌
    const processed = await compressIfNeeded(blob, DEFAULT_STORAGE_CONFIG)
    const processedMime = processed.type || mimeType

    // 小图片直接内嵌
    if (processed.size < DEFAULT_STORAGE_CONFIG.inlineThreshold) {
      return this.inlinedStrategy.save(processed, processedMime)
    }

    // 大图片使用策略存储（策略内 compressIfNeeded 幂等，不会重复编码）
    const strategy = await this.resolveStrategy()
    return strategy.save(processed, processedMime)
  }

  /**
   * 加载图片
   */
  async load(ref: string): Promise<Blob | null> {
    // 先检查内联策略
    if (this.inlinedStrategy.canHandle(ref)) {
      return this.inlinedStrategy.load(ref)
    }

    // 检查主策略
    const strategy = await this.resolveStrategy()
    if (strategy.canHandle(ref)) {
      return strategy.load(ref)
    }

    // 尝试文件系统策略（兼容本地文件模式）
    const fsStrategy = new FileSystemStrategy(() => this.resolveLocalFolderPath())
    if (fsStrategy.canHandle(ref)) {
      return fsStrategy.load(ref)
    }

    // 尝试 attachment 策略（兼容默认模式切换场景）
    const attStrategy = new AttachmentStrategy()
    if (attStrategy.canHandle(ref)) {
      return attStrategy.load(ref)
    }

    return null
  }

  /**
   * 删除图片
   */
  async delete(ref: string): Promise<void> {
    if (this.inlinedStrategy.canHandle(ref)) {
      return this.inlinedStrategy.delete(ref)
    }

    const strategy = await this.resolveStrategy()
    if (strategy.canHandle(ref)) {
      return strategy.delete(ref)
    }

    // 尝试文件系统策略
    const fsStrategy = new FileSystemStrategy(() => this.resolveLocalFolderPath())
    if (fsStrategy.canHandle(ref)) {
      return fsStrategy.delete(ref)
    }

    // 尝试 attachment 策略
    const attStrategy = new AttachmentStrategy()
    if (attStrategy.canHandle(ref)) {
      return attStrategy.delete(ref)
    }
  }
}

// 单例导出
export const imageStorage = new ImageStorage()

// 重新导出类型
export * from './types'
export * from './utils'
