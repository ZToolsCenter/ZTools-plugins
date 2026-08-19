/**
 * Attachment 存储策略
 * 用于 uTools 默认模式，使用 db.postAttachment 存储二进制图片
 * 相比 Base64Strategy：支持约 10MB 上限（vs 1MB），且不膨胀文档体积
 */

import type { IImageStorageStrategy } from '../types'
import { getExtensionFromMimeType } from '../utils'
import { UToolsAdapter } from '../../utools'
import { compressIfNeeded } from '../../imageProcessor'
import { MAX_IMAGE_STORE_BYTES } from '../types'

const ATT_PREFIX = 'att:'
const ID_PREFIX = 'goose-img/'

/**
 * 计算 Blob 的 SHA-256 hex 摘要（需在 secure context / Electron 渲染进程中调用）
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class AttachmentStrategy implements IImageStorageStrategy {
  /**
   * 保存图片为 uTools attachment
   * - 入口/本处 compressIfNeeded：统一 WebP@80%，已是 WebP 不二次压缩
   * - SHA-256 确定性 id，重复图片直接复用已有 attachment（去重）
   */
  async save(blob: Blob, _mimeType: string): Promise<string> {
    // 统一 WebP 压缩（入口已做；此处对 WebP 幂等跳过）
    const out = await compressIfNeeded(blob)

    if (out.size > MAX_IMAGE_STORE_BYTES) {
      throw new Error(
        `图片过大（约 ${(out.size / (1024 * 1024)).toFixed(1)}MB），压缩后仍超过 ${Math.floor(MAX_IMAGE_STORE_BYTES / (1024 * 1024))}MB 上限`,
      )
    }

    // Blob → ArrayBuffer（SHA-256 和写入共用）
    const arrayBuf = await out.arrayBuffer()
    const buffer = new Uint8Array(arrayBuf)

    // SHA-256 确定性 id
    const hash = await sha256Hex(arrayBuf)
    const ext = getExtensionFromMimeType(out.type)
    const id = `${ID_PREFIX}${hash}.${ext}`

    // 去重：已存在则直接复用，不重复写入
    const existing = UToolsAdapter.db.getAttachment(id)
    if (existing) {
      return `${ATT_PREFIX}${id}`
    }

    // 存储到 uTools attachment（宿主上限约 10MB）
    const result = UToolsAdapter.db.postAttachment(id, buffer, out.type)
    if (!result || result.ok === false) {
      const detail =
        result && typeof result.error === 'string'
          ? result.error
          : result?.error
            ? JSON.stringify(result.error)
            : 'unknown'
      throw new Error(
        `图片保存失败（可能超过 uTools 附件上限）: ${detail}`,
      )
    }

    return `${ATT_PREFIX}${id}`
  }

  /**
   * 加载附件图片
   */
  async load(ref: string): Promise<Blob | null> {
    const id = ref.slice(ATT_PREFIX.length)
    const data = UToolsAdapter.db.getAttachment(id)
    if (!data) return null

    const mimeType = UToolsAdapter.db.getAttachmentType(id) || 'image/jpeg'
    return new Blob([data.buffer as ArrayBuffer], { type: mimeType })
  }

  /**
   * 删除附件
   */
  async delete(ref: string): Promise<void> {
    const id = ref.slice(ATT_PREFIX.length)
    try {
      UToolsAdapter.db.remove(id)
    } catch {
      // 忽略删除失败
    }
  }

  /**
   * 检查是否处理该引用
   */
  canHandle(ref: string): boolean {
    return ref.startsWith(ATT_PREFIX)
  }
}
