import type {
  ChunkedUploadInitRequest,
  ChunkedUploadInitResponse,
  ChunkedUploadProgressResponse,
  PluginUploadResponse,
} from '../types/pluginMarket'
import {
  cancelChunkedUpload,
  completeChunkedUpload,
  getChunkedUploadProgress,
  initChunkedUpload,
  uploadChunk,
} from './pluginMarketRemote'

/**
 * 分片上传配置
 */
export interface ChunkedUploadConfig {
  /**
   * 分片大小（字节），默认 5MB
   */
  chunkSize?: number
  /**
   * 最大并发上传数，默认 3
   */
  maxConcurrency?: number
  /**
   * 是否计算文件完整哈希（用于秒传），默认 true
   */
  calculateFileHash?: boolean
  /**
   * 重试次数，默认 3
   */
  retryCount?: number
  /**
   * 重试延迟（毫秒），默认 1000
   */
  retryDelay?: number
}

/**
 * 分片上传进度回调参数
 */
export interface ChunkedUploadProgressInfo {
  /**
   * 已上传的字节数
   */
  uploadedBytes: number
  /**
   * 文件总字节数
   */
  totalBytes: number
  /**
   * 上传进度百分比 (0-100)
   */
  progress: number
  /**
   * 当前上传的分片索引
   */
  currentChunkIndex: number
  /**
   * 总分片数
   */
  totalChunks: number
  /**
   * 当前阶段
   */
  stage: 'hashing' | 'uploading' | 'merging' | 'completed'
}

/**
 * 分片上传选项
 */
export interface ChunkedUploadOptions extends ChunkedUploadConfig {
  /**
   * 进度回调
   */
  onProgress?: (progress: ChunkedUploadProgressInfo) => void
  /**
   * 取消信号
   */
  signal?: AbortSignal
}

/**
 * 计算 Blob 的 SHA-256 哈希值
 */
async function calculateSHA256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256:${hashHex}`
}

/**
 * 将文件切分为多个分片
 */
function sliceFileIntoChunks(file: Blob, chunkSize: number): Blob[] {
  const chunks: Blob[] = []
  let offset = 0

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size)
    chunks.push(file.slice(offset, end))
    offset = end
  }

  return chunks
}

/**
 * 带重试的上传单个分片
 */
async function uploadChunkWithRetry(
  uploadId: string,
  chunk: Blob,
  chunkIndex: number,
  chunkHash: string,
  retryCount: number,
  retryDelay: number,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (signal?.aborted) {
      throw new Error('上传已取消')
    }

    try {
      await uploadChunk({
        uploadId,
        chunk,
        chunkIndex,
        chunkHash,
      })
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('上传失败')

      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)))
      }
    }
  }

  throw lastError || new Error('上传失败')
}

/**
 * 并发上传多个分片
 */
async function uploadChunksConcurrently(
  uploadId: string,
  chunks: Blob[],
  existingChunks: Set<number>,
  maxConcurrency: number,
  retryCount: number,
  retryDelay: number,
  onProgress: (chunkIndex: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pendingChunks = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ index }) => !existingChunks.has(index))

  let activeUploads = 0
  let currentIndex = 0
  const errors: Error[] = []

  return new Promise((resolve, reject) => {
    const startNextUpload = async () => {
      if (signal?.aborted) {
        reject(new Error('上传已取消'))
        return
      }

      if (currentIndex >= pendingChunks.length) {
        if (activeUploads === 0) {
          if (errors.length > 0) {
            reject(errors[0])
          } else {
            resolve()
          }
        }
        return
      }

      const { chunk, index } = pendingChunks[currentIndex++]
      activeUploads++

      try {
        const chunkHash = await calculateSHA256(chunk)
        await uploadChunkWithRetry(uploadId, chunk, index, chunkHash, retryCount, retryDelay, signal)
        onProgress(index)
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error('上传失败'))
        reject(errors[0])
        return
      } finally {
        activeUploads--
      }

      startNextUpload()
    }

    // 启动初始并发上传
    for (let i = 0; i < Math.min(maxConcurrency, pendingChunks.length); i++) {
      startNextUpload()
    }

    // 如果没有待上传的分片，直接完成
    if (pendingChunks.length === 0) {
      resolve()
    }
  })
}

/**
 * 使用分片上传方式上传插件包
 *
 * @param file 插件文件（最大 75MB）
 * @param fileName 文件名
 * @param options 上传选项
 * @returns 上传结果
 *
 * @example
 * ```typescript
 * const result = await uploadPluginWithChunks(file, 'my-plugin.zpx', {
 *   chunkSize: 5 * 1024 * 1024, // 5MB
 *   maxConcurrency: 3,
 *   onProgress: (progress) => {
 *     console.log(`进度: ${progress.progress}%`)
 *   }
 * })
 * ```
 */
export async function uploadPluginWithChunks(
  file: Blob,
  fileName: string,
  options?: ChunkedUploadOptions,
): Promise<PluginUploadResponse> {
  const {
    chunkSize = 5 * 1024 * 1024, // 5MB
    maxConcurrency = 3,
    calculateFileHash = true,
    retryCount = 3,
    retryDelay = 1000,
    onProgress,
    signal,
  } = options || {}

  try {
    // 阶段 1: 计算文件哈希（可选）
    let fileHash: string | undefined
    if (calculateFileHash) {
      onProgress?.({
        uploadedBytes: 0,
        totalBytes: file.size,
        progress: 0,
        currentChunkIndex: 0,
        totalChunks: 0,
        stage: 'hashing',
      })

      fileHash = await calculateSHA256(file)

      if (signal?.aborted) {
        throw new Error('上传已取消')
      }
    }

    // 阶段 2: 切分文件
    const chunks = sliceFileIntoChunks(file, chunkSize)
    const totalChunks = chunks.length

    // 阶段 3: 初始化分片上传
    const initRequest: ChunkedUploadInitRequest = {
      fileName,
      totalSize: file.size,
      totalChunks,
      fileHash,
    }

    const initResponse: ChunkedUploadInitResponse = await initChunkedUpload(initRequest)

    // 如果文件已存在（秒传）
    if (initResponse.fileExists) {
      onProgress?.({
        uploadedBytes: file.size,
        totalBytes: file.size,
        progress: 100,
        currentChunkIndex: totalChunks,
        totalChunks,
        stage: 'completed',
      })

      return {
        success: true,
        message: '文件已存在，跳过上传',
        data: {
          message: '文件已存在',
          reviewTaskId: '',
          ...initResponse.existingPlugin,
        },
      }
    }

    const { uploadId, existingChunks } = initResponse
    const existingChunksSet = new Set(existingChunks)

    // 阶段 4: 上传分片
    const uploadedChunks = new Set(existingChunks)
    let uploadedBytes = existingChunks.reduce((sum, index) => sum + chunks[index].size, 0)

    const handleChunkProgress = (chunkIndex: number) => {
      uploadedChunks.add(chunkIndex)
      uploadedBytes += chunks[chunkIndex].size

      onProgress?.({
        uploadedBytes,
        totalBytes: file.size,
        progress: Math.round((uploadedBytes / file.size) * 100),
        currentChunkIndex: chunkIndex,
        totalChunks,
        stage: 'uploading',
      })
    }

    try {
      await uploadChunksConcurrently(
        uploadId,
        chunks,
        existingChunksSet,
        maxConcurrency,
        retryCount,
        retryDelay,
        handleChunkProgress,
        signal,
      )
    } catch (error) {
      // 上传失败，尝试取消
      try {
        await cancelChunkedUpload(uploadId)
      } catch {
        // 忽略取消错误
      }
      throw error
    }

    if (signal?.aborted) {
      try {
        await cancelChunkedUpload(uploadId)
      } catch {
        // 忽略取消错误
      }
      throw new Error('上传已取消')
    }

    // 阶段 5: 完成上传
    onProgress?.({
      uploadedBytes: file.size,
      totalBytes: file.size,
      progress: 100,
      currentChunkIndex: totalChunks,
      totalChunks,
      stage: 'merging',
    })

    const completeResponse = await completeChunkedUpload(uploadId)

    onProgress?.({
      uploadedBytes: file.size,
      totalBytes: file.size,
      progress: 100,
      currentChunkIndex: totalChunks,
      totalChunks,
      stage: 'completed',
    })

    return {
      success: true,
      message: completeResponse.message || '上传成功',
      reviewTaskId: completeResponse.reviewTaskId,
      data: completeResponse,
    }
  } catch (error) {
    console.error('[ChunkedUpload] 上传失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '上传失败',
    }
  }
}

/**
 * 查询分片上传进度
 */
export async function queryChunkedUploadProgress(
  uploadId: string,
): Promise<ChunkedUploadProgressResponse> {
  return getChunkedUploadProgress(uploadId)
}

/**
 * 取消分片上传
 */
export async function abortChunkedUpload(uploadId: string): Promise<void> {
  await cancelChunkedUpload(uploadId)
}
