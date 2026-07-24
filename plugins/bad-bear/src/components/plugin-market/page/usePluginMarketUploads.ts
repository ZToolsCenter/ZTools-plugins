import { computed, ref, type Ref } from 'vue'
import {
  checkPluginUploadHash,
  deleteMyPluginUpload,
  getMyPluginUpload,
  getMyPluginUploads,
  uploadPluginPackage,
  uploadPluginWithChunks,
  type ChunkedUploadProgressInfo,
} from '../../../api/pluginMarket'
import type {
  MyPluginUploadRecord,
  MyPluginUploadsQuery,
  MyPluginUploadsResponse,
  PluginHashCheckResponse,
} from '../../../types/pluginMarket'
import type { AuthUser } from '../../../types/auth'
import { getErrorMessage } from './shared'

const MAX_UPLOAD_SIZE = 75 * 1024 * 1024
const CHUNKED_UPLOAD_THRESHOLD = 20 * 1024 * 1024 // 20MB
const UPLOADS_PAGE_SIZE = 20
const PROCESSING_UPLOAD_STATUSES = new Set(['AI_CLASSIFYING', 'AI_REVIEWING'])
const DELETABLE_UPLOAD_STATUSES = new Set(['PUBLISHED', 'MANUAL_REVIEW'])

type HashCheckState = Pick<PluginHashCheckResponse, 'status' | 'pluginName' | 'version'> | null

export function usePluginMarketUploads(options: {
  authToken: Ref<string>
  currentUser: Ref<AuthUser | null>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  confirmAction: (params: {
    title?: string
    message: string
    type?: 'info' | 'warning' | 'danger'
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
  reloadMarket: () => Promise<void>
}) {
  const selectedFile = ref<File | null>(null)
  const validationError = ref('')
  const computedHash = ref('')
  const hashCheckResult = ref<HashCheckState>(null)
  const isHashing = ref(false)
  const isCheckingHash = ref(false)
  const isUploading = ref(false)
  const uploadProgress = ref(0)
  const uploadStage = ref<'hashing' | 'uploading' | 'merging' | 'completed' | null>(null)
  const uploadAbortController = ref<AbortController | null>(null)

  const uploads = ref<MyPluginUploadRecord[]>([])
  const uploadsTotal = ref(0)
  const uploadsPage = ref(1)
  const uploadsLoading = ref(false)
  const uploadsError = ref('')
  const deletingIds = ref<Set<string>>(new Set())

  const uploadSupported = ref(true)

  const canUpload = computed(
    () =>
      !!selectedFile.value &&
      !validationError.value &&
      !isHashing.value &&
      !isCheckingHash.value &&
      !isUploading.value &&
      (!hashCheckResult.value || hashCheckResult.value.status === 'safe'),
  )

  function validateFile(file: File): string {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.zpx') && !name.endsWith('.zip')) {
      return '仅支持 .zpx 或 .zip 格式的插件包'
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      return '文件大小不能超过 75MB'
    }
    return ''
  }

  function selectFile(file: File | null): void {
    selectedFile.value = file
    validationError.value = file ? validateFile(file) : ''
    computedHash.value = ''
    hashCheckResult.value = null
  }

  /**
   * 计算当前插件包的 SHA-256 并请求服务端检查重复、封禁或处理中状态；哈希或预检失败时仍允许上传，由后端最终拦截。
   */
  async function computeHashAndPrecheck(): Promise<HashCheckState> {
    const file = selectedFile.value
    if (!file || validationError.value) return hashCheckResult.value

    hashCheckResult.value = null
    computedHash.value = ''

    isHashing.value = true
    try {
      const buffer = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(digest))
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      computedHash.value = `sha256:${hex}`
    } catch {
      isHashing.value = false
      hashCheckResult.value = { status: 'safe' }
      return hashCheckResult.value
    }
    isHashing.value = false

    isCheckingHash.value = true
    try {
      const response = await checkPluginUploadHash(computedHash.value)
      hashCheckResult.value = {
        status: response.status,
        pluginName: response.pluginName,
        version: response.version,
      }
    } catch {
      hashCheckResult.value = { status: 'safe' }
    } finally {
      isCheckingHash.value = false
    }

    return hashCheckResult.value
  }

  /**
   * 用单条进度接口返回的最新记录更新当前分页列表；若当前页未包含该记录则插入到顶部便于用户立即看到进度。
   */
  function upsertUploadRecord(record: MyPluginUploadRecord): void {
    const existingIndex = uploads.value.findIndex((item) => item.id === record.id)
    if (existingIndex >= 0) {
      const nextUploads = [...uploads.value]
      nextUploads[existingIndex] = record
      uploads.value = nextUploads
      return
    }

    uploads.value = [record, ...uploads.value].slice(0, UPLOADS_PAGE_SIZE)
    uploadsTotal.value += 1
  }

  /**
   * 按上传接口返回的 reviewTaskId 拉取该次记录，避免等待列表刷新才能看到新进度。
   */
  async function refreshUploadProgress(reviewTaskId: string | undefined): Promise<void> {
    if (!reviewTaskId || !options.authToken.value || !options.currentUser.value) {
      return
    }

    try {
      const record = await getMyPluginUpload(reviewTaskId)
      upsertUploadRecord(record)
    } catch (error) {
      console.warn('[PluginMarket] 刷新上传进度失败:', error)
    }
  }

  /**
   * 取消当前正在进行的上传
   */
  function cancelUpload(): void {
    if (uploadAbortController.value) {
      uploadAbortController.value.abort()
      uploadAbortController.value = null
    }
  }

  /**
   * 响应确认上传操作：先执行哈希预检，根据文件大小选择单次上传或分片上传。
   */
  async function performUpload(): Promise<{ success: boolean; reviewTaskId?: string }> {
    const file = selectedFile.value
    if (!file || !canUpload.value) return { success: false }

    const precheckResult = await computeHashAndPrecheck()
    if (precheckResult?.status !== 'safe') {
      return { success: false }
    }

    isUploading.value = true
    uploadProgress.value = 0
    uploadStage.value = null
    uploadAbortController.value = new AbortController()

    try {
      let result

      // 根据文件大小选择上传方式
      if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
        // 大于 20MB 使用分片上传
        result = await uploadPluginWithChunks(file, file.name, {
          chunkSize: 5 * 1024 * 1024, // 5MB 每片
          maxConcurrency: 3,
          onProgress: (progress: ChunkedUploadProgressInfo) => {
            uploadProgress.value = progress.progress
            uploadStage.value = progress.stage
          },
          signal: uploadAbortController.value.signal,
        })
      } else {
        // 小于等于 20MB 使用单次上传
        result = await uploadPluginPackage({
          file,
          fileName: file.name,
        })
      }

      if (!result.success) {
        options.notifyError(result.error || '上传失败')
        return { success: false }
      }

      options.notifySuccess(result.message || '插件上传成功，正在后台处理中')
      selectFile(null)
      uploadProgress.value = 0
      uploadStage.value = null
      await loadUploads()
      await refreshUploadProgress(result.reviewTaskId)
      return { success: true, reviewTaskId: result.reviewTaskId }
    } catch (error) {
      // 检查是否是用户主动取消
      if (error instanceof Error && error.message === '上传已取消') {
        options.notifyError('上传已取消')
      } else {
        options.notifyError(getErrorMessage(error, '上传失败'))
      }
      return { success: false }
    } finally {
      isUploading.value = false
      uploadProgress.value = 0
      uploadStage.value = null
      uploadAbortController.value = null
    }
  }

  async function loadUploads(query?: MyPluginUploadsQuery): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value) {
      uploads.value = []
      uploadsTotal.value = 0
      uploadsPage.value = 1
      uploadsError.value = ''
      return
    }

    uploadsLoading.value = true
    uploadsError.value = ''

    try {
      const response: MyPluginUploadsResponse = await getMyPluginUploads({
        page: query?.page ?? uploadsPage.value,
        pageSize: UPLOADS_PAGE_SIZE,
        keyword: query?.keyword,
      })
      uploads.value = response.items
      uploadsTotal.value = response.total
      uploadsPage.value = response.page
      uploadSupported.value = true
    } catch (error) {
      uploadsError.value = getErrorMessage(error, '加载上传记录失败')
      uploads.value = []
      uploadsTotal.value = 0
    } finally {
      uploadsLoading.value = false
    }
  }

  async function handleDeleteUpload(record: MyPluginUploadRecord): Promise<void> {
    if (deletingIds.value.has(record.id)) return
    if (PROCESSING_UPLOAD_STATUSES.has(record.status)) {
      options.notifyError('正在处理的记录不可删除')
      return
    }
    if (!DELETABLE_UPLOAD_STATUSES.has(record.status)) {
      options.notifyError('该上传记录已是最终状态，无需删除')
      return
    }

    const confirmed = await options.confirmAction({
      title: '确认删除',
      message: `确定删除 ${record.originalName} 的上传记录吗？${
        record.status === 'PUBLISHED'
          ? '该记录已发布，删除后对应插件版本也会同步删除。'
          : '该记录将保留并标记为发布失败。'
      }`,
      type: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!confirmed) return

    deletingIds.value = new Set([...deletingIds.value, record.id])
    try {
      await deleteMyPluginUpload(record.id)
      options.notifySuccess('已删除上传记录')
      await Promise.all([loadUploads(), options.reloadMarket()])
    } catch (error) {
      options.notifyError(getErrorMessage(error, '删除上传记录失败'))
    } finally {
      const next = new Set(deletingIds.value)
      next.delete(record.id)
      deletingIds.value = next
    }
  }

  function resetState(): void {
    cancelUpload()
    selectedFile.value = null
    validationError.value = ''
    computedHash.value = ''
    hashCheckResult.value = null
    isHashing.value = false
    isCheckingHash.value = false
    isUploading.value = false
    uploadProgress.value = 0
    uploadStage.value = null
    uploads.value = []
    uploadsTotal.value = 0
    uploadsPage.value = 1
    uploadsLoading.value = false
    uploadsError.value = ''
    deletingIds.value = new Set()
  }

  return {
    selectedFile,
    validationError,
    computedHash,
    hashCheckResult,
    isHashing,
    isCheckingHash,
    isUploading,
    uploadProgress,
    uploadStage,
    canUpload,
    uploads,
    uploadsTotal,
    uploadsPage,
    uploadsLoading,
    uploadsError,
    deletingIds,
    uploadSupported,
    selectFile,
    computeHashAndPrecheck,
    performUpload,
    cancelUpload,
    loadUploads,
    handleDeleteUpload,
    resetState,
  }
}
