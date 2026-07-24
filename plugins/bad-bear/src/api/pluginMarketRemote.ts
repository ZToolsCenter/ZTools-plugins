import { HttpClientError, requestFormData, requestJson } from './httpClient'
import { appendQuery } from './query'
import { getShopApiRuntimeConfig } from '../config/runtimeConfig'
import {
  adaptPlugin,
  buildStorefront,
  deriveFallbackCategories,
} from './pluginMarketStorefront'
import type {
  ChunkedUploadCancelResponse,
  ChunkedUploadChunkPayload,
  ChunkedUploadChunkResponse,
  ChunkedUploadCompleteResponse,
  ChunkedUploadInitRequest,
  ChunkedUploadInitResponse,
  ChunkedUploadProgressResponse,
  CreatePluginCommentRequest,
  CreatePluginRatingRequest,
  MyPluginUploadRecord,
  MyPluginUploadsQuery,
  MyPluginUploadsResponse,
  Platform,
  PluginCommentRecord,
  PluginCommentsPage,
  PluginDetailResponse,
  PluginHashCheckResponse,
  PluginMarketCategoryDto,
  PluginMarketFetchResponse,
  PluginMarketPlugin,
  PluginMarketPluginDto,
  PluginMarketStreamSnapshot,
  PluginPageQuery,
  PluginRatingRecord,
  PluginRatingsPage,
  PluginRiskInfo,
  PluginStatsResponse,
  PluginUpdateCheckRequestItem,
  PluginUpdateCheckResponseItem,
  PluginUploadAcceptedResponse,
  PluginUploadPayload,
  PluginUploadResponse,
  StreamPluginMarketOptions,
} from '../types/pluginMarket'

const PLUGIN_MARKET_CACHE_KEY = 'bad-bear.plugin-market.cache.v2'
const PLUGIN_MARKET_STREAM_PATH = '/api/v1/plugins/stream'
const STREAM_ACCEPT_HEADER = 'text/event-stream'

interface PluginMarketLatestResponse {
  latestAt: string
}

interface PluginMarketStreamStartPayload {
  platform?: string
  category?: string
  total?: number
}

interface PluginMarketStreamEndPayload {
  platform?: string
  total?: number
  sent?: number
}

interface PluginMarketCacheRecord {
  version: 2
  latestSignature: string
  plugins: PluginMarketPluginDto[]
  categories: PluginMarketCategoryDto[]
}

type PluginMarketStreamEvent =
  | { type: 'plugins.start'; data: PluginMarketStreamStartPayload }
  | { type: 'plugins.item'; data: PluginMarketPluginDto }
  | { type: 'plugins.end'; data: PluginMarketStreamEndPayload }

function getPluginMarketCacheStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 校验本地缓存结构，避免旧版本快照污染新的按平台流式结果。
 */
function isPluginMarketCacheRecord(value: unknown): value is PluginMarketCacheRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 2 &&
    typeof candidate.latestSignature === 'string' &&
    Array.isArray(candidate.plugins) &&
    Array.isArray(candidate.categories)
  )
}

/**
 * 以商店地址和平台维度隔离缓存，避免不同平台复用错列表结果。
 */
function buildPluginMarketCacheKey(platform: Platform): string {
  const { baseUrl } = getShopApiRuntimeConfig()
  return `${PLUGIN_MARKET_CACHE_KEY}:${baseUrl}:${platform}`
}

/**
 * 读取当前平台的插件市场快照，格式不合法时自动清理脏数据。
 */
function readPluginMarketCache(platform: Platform): PluginMarketCacheRecord | null {
  const storage = getPluginMarketCacheStorage()
  if (!storage) {
    return null
  }

  const cacheKey = buildPluginMarketCacheKey(platform)
  const rawValue = storage.getItem(cacheKey)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)
    return isPluginMarketCacheRecord(parsed) ? parsed : null
  } catch {
    storage.removeItem(cacheKey)
    return null
  }
}

/**
 * 仅在拿到完整快照后写入缓存，避免后续刷新读到半截流数据。
 */
function writePluginMarketCache(platform: Platform, record: PluginMarketCacheRecord): void {
  const storage = getPluginMarketCacheStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(buildPluginMarketCacheKey(platform), JSON.stringify(record))
  } catch (error) {
    console.warn('[PluginMarket] 缓存插件商店数据失败:', error)
  }
}

function buildPluginMarketLatestSignature(value: PluginMarketLatestResponse): string {
  return value.latestAt
}

function isPluginMarketLatestResponse(value: unknown): value is PluginMarketLatestResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  return typeof (value as Record<string, unknown>).latestAt === 'string'
}

/**
 * 过滤掉缺失关键字段的插件条目，保证后续适配和列表合并按 name/version 工作。
 */
function normalizePluginDtos(pluginResponse: PluginMarketPluginDto[]): PluginMarketPluginDto[] {
  return (Array.isArray(pluginResponse) ? pluginResponse : []).filter(
    (plugin): plugin is PluginMarketPluginDto =>
      !!plugin && typeof plugin.name === 'string' && typeof plugin.version === 'string',
  )
}

/**
 * 将插件 DTO 与分类 DTO 统一投影成页面可直接消费的市场返回结构。
 */
function buildPluginMarketResponse(
  pluginDtos: PluginMarketPluginDto[],
  categoryDtos: PluginMarketCategoryDto[],
): PluginMarketFetchResponse {
  const plugins: PluginMarketPlugin[] = pluginDtos.map(adaptPlugin)
  const resolvedCategoryDtos = categoryDtos.length > 0 ? categoryDtos : deriveFallbackCategories(plugins)

  return {
    success: true,
    data: plugins,
    storefront: buildStorefront(plugins, resolvedCategoryDtos),
  }
}

/**
 * 单独拉取分类目录；失败时返回空数组，让调用方按当前已到达的插件回退生成分类。
 */
async function fetchPluginCategoryDtos(): Promise<PluginMarketCategoryDto[]> {
  try {
    const categoryResponse = await requestJson<PluginMarketCategoryDto[]>({
      path: '/api/v1/plugins/categories',
    })
    return Array.isArray(categoryResponse) ? categoryResponse : []
  } catch (error) {
    console.warn('[PluginMarket] 加载插件分类失败，回退到插件自带分类:', error)
    return []
  }
}

/**
 * 为流式接口构造与运行时认证配置一致的请求头。
 */
function buildPluginMarketStreamHeaders(): Headers {
  const { token } = getShopApiRuntimeConfig()
  const headers = new Headers({
    Accept: STREAM_ACCEPT_HEADER,
    'Cache-Control': 'no-cache',
  })

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

/**
 * 解析 SSE data 行中的 JSON 载荷，非法数据直接丢弃，避免打断整条流。
 */
function parsePluginMarketStreamPayload<TPayload>(payload: string): TPayload | null {
  const trimmed = payload.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as TPayload
  } catch {
    return null
  }
}

/**
 * 把单个 SSE frame 解析成插件市场事件，只识别当前页面会消费的三种事件。
 */
function parsePluginMarketStreamChunk(chunk: string): PluginMarketStreamEvent[] {
  return chunk
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter(Boolean)
      .flatMap<PluginMarketStreamEvent>((frame) => {
      const lines = frame.split(/\r?\n/)
      let eventType = ''
      const dataLines: string[] = []

      lines.forEach((line) => {
        if (!line || line.startsWith(':')) {
          return
        }

        if (line.startsWith('event:')) {
          eventType = line.slice('event:'.length).trim()
          return
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }
      })

      const payload = dataLines.join('\n')
      if (eventType === 'plugins.start') {
        const parsed = parsePluginMarketStreamPayload<PluginMarketStreamStartPayload>(payload)
        return parsed ? [{ type: 'plugins.start', data: parsed }] : []
      }

      if (eventType === 'plugins.item') {
        const parsed = parsePluginMarketStreamPayload<PluginMarketPluginDto>(payload)
        return parsed ? [{ type: 'plugins.item', data: parsed }] : []
      }

      if (eventType === 'plugins.end') {
        const parsed = parsePluginMarketStreamPayload<PluginMarketStreamEndPayload>(payload)
        return parsed ? [{ type: 'plugins.end', data: parsed }] : []
      }

      return []
    })
}

/**
 * 把当前累计到的插件条目投影成可渲染快照，并在需要时通知页面立即刷新。
 */
function emitPluginMarketSnapshot(
  options: StreamPluginMarketOptions,
  pluginDtos: PluginMarketPluginDto[],
  categoryDtos: PluginMarketCategoryDto[],
  complete: boolean,
): PluginMarketStreamSnapshot {
  const snapshot: PluginMarketStreamSnapshot = {
    ...buildPluginMarketResponse(pluginDtos, categoryDtos),
    complete,
  }

  if (!options.signal?.aborted) {
    options.onSnapshot?.(snapshot)
  }

  return snapshot
}

/**
 * 构造插件分页查询串，供评分、评论等分页接口复用统一的 page/pageSize 编码规则。
 */
export function buildPluginPageQuery(query?: PluginPageQuery): string {
  return appendQuery('', {
    page: query?.page,
    pageSize: query?.pageSize,
  })
}

/**
 * 为当前平台流式读取插件列表，并在插件或分类变化时持续产出可消费快照。
 */
export async function streamPluginMarket(
  options: StreamPluginMarketOptions,
): Promise<PluginMarketFetchResponse> {
  const cachedMarket = readPluginMarketCache(options.platform)

  let latestSignature: string | null = null
  try {
    const latestResponse = await requestJson<PluginMarketLatestResponse>({
      path: '/api/v1/plugins/latest',
    })
    if (!isPluginMarketLatestResponse(latestResponse)) {
      throw new Error('插件商店 latest 响应格式无效')
    }

    latestSignature = buildPluginMarketLatestSignature(latestResponse)

    if (cachedMarket && cachedMarket.latestSignature === latestSignature) {
      const cachedSnapshot = emitPluginMarketSnapshot(
        options,
        cachedMarket.plugins,
        cachedMarket.categories,
        true,
      )
      return cachedSnapshot
    }
  } catch (error) {
    console.warn('[PluginMarket] 检查商店更新失败，将直接拉取插件列表:', error)
  }

  const categoryTask = fetchPluginCategoryDtos()
  let categoryDtos: PluginMarketCategoryDto[] = []
  const pluginDtos: PluginMarketPluginDto[] = []
  let expectedTotal: number | null = null
  let streamEnded = false

  categoryTask.then((resolvedCategories) => {
    categoryDtos = resolvedCategories
    if (options.signal?.aborted) {
      return
    }

    if (pluginDtos.length > 0 || expectedTotal === 0) {
      emitPluginMarketSnapshot(options, pluginDtos, categoryDtos, false)
    }
  })

  const { baseUrl } = getShopApiRuntimeConfig()
  const streamPath = appendQuery(PLUGIN_MARKET_STREAM_PATH, {
    platform: options.platform,
  })
  const response = await fetch(`${baseUrl}${streamPath}`, {
    method: 'GET',
    headers: buildPluginMarketStreamHeaders(),
    signal: options.signal,
  })

  if (!response.ok) {
    throw new Error(`插件商店流连接失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error('插件商店流不可用')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''

      frames.forEach((frame) => {
        parsePluginMarketStreamChunk(frame).forEach((event) => {
          if (event.type === 'plugins.start') {
            expectedTotal =
              typeof event.data.total === 'number' && Number.isFinite(event.data.total)
                ? event.data.total
                : null
            return
          }

          if (event.type === 'plugins.item') {
            const nextPlugins = normalizePluginDtos([event.data])
            if (nextPlugins.length === 0) {
              return
            }

            pluginDtos.push(nextPlugins[0])
            emitPluginMarketSnapshot(options, pluginDtos, categoryDtos, false)
            return
          }

          streamEnded = true
          if (typeof event.data.sent === 'number' && event.data.sent !== pluginDtos.length) {
            throw new Error('插件商店流返回数量与 sent 不一致')
          }
          if (typeof event.data.total === 'number' && event.data.total !== pluginDtos.length) {
            throw new Error('插件商店流返回数量与 total 不一致')
          }
        })
      })
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      parsePluginMarketStreamChunk(buffer).forEach((event) => {
        if (event.type === 'plugins.start') {
          expectedTotal =
            typeof event.data.total === 'number' && Number.isFinite(event.data.total)
              ? event.data.total
              : null
          return
        }

        if (event.type === 'plugins.item') {
          const nextPlugins = normalizePluginDtos([event.data])
          if (nextPlugins.length === 0) {
            return
          }

          pluginDtos.push(nextPlugins[0])
          emitPluginMarketSnapshot(options, pluginDtos, categoryDtos, false)
          return
        }

        streamEnded = true
        if (typeof event.data.sent === 'number' && event.data.sent !== pluginDtos.length) {
          throw new Error('插件商店流返回数量与 sent 不一致')
        }
        if (typeof event.data.total === 'number' && event.data.total !== pluginDtos.length) {
          throw new Error('插件商店流返回数量与 total 不一致')
        }
      })
    }
  } finally {
    reader.releaseLock()
  }

  if (!streamEnded) {
    throw new Error('插件商店流提前结束')
  }

  if (expectedTotal !== null && expectedTotal !== pluginDtos.length) {
    throw new Error('插件商店流返回数量与 start.total 不一致')
  }

  categoryDtos = await categoryTask
  const finalSnapshot = emitPluginMarketSnapshot(options, pluginDtos, categoryDtos, true)

  if (latestSignature !== null && !options.signal?.aborted) {
    writePluginMarketCache(options.platform, {
      version: 2,
      latestSignature,
      plugins: pluginDtos,
      categories: categoryDtos,
    })
  }

  return finalSnapshot
}

/**
 * 获取插件市场完整快照，供不需要渐进刷新的调用方复用同一条流式链路。
 */
export async function fetchPluginMarket(platform: Platform): Promise<PluginMarketFetchResponse> {
  return streamPluginMarket({ platform })
}

export function getPluginDetail(name: string): Promise<PluginDetailResponse> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginDetailResponse>({
    path: `/api/v1/plugins/${pluginName}`,
  })
}

export function getPluginDetailByHash(hash: string): Promise<PluginDetailResponse> {
  return requestJson<PluginDetailResponse>({
    path: `/api/v1/plugins/hash/${encodeURIComponent(hash)}`,
  })
}

export function getPluginRisk(name: string, version?: string | null): Promise<PluginRiskInfo> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginRiskInfo>({
    path: appendQuery(`/api/v1/plugins/${pluginName}/risk`, {
      version: version?.trim() || undefined,
    }),
  })
}

export function getPluginStats(name: string): Promise<PluginStatsResponse> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginStatsResponse>({
    path: `/api/v1/plugins/${pluginName}/stats`,
  })
}

export function getPluginRatings(
  name: string,
  query?: PluginPageQuery,
): Promise<PluginRatingsPage> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginRatingsPage>({
    path: appendQuery(`/api/v1/plugins/${pluginName}/ratings`, {
      page: query?.page,
      pageSize: query?.pageSize,
    }),
  })
}

export function createPluginRating(
  name: string,
  payload: CreatePluginRatingRequest,
): Promise<PluginRatingRecord> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginRatingRecord, CreatePluginRatingRequest>({
    path: `/api/v1/plugins/${pluginName}/ratings`,
    method: 'POST',
    body: payload,
  })
}

export function getPluginComments(
  name: string,
  query?: PluginPageQuery,
): Promise<PluginCommentsPage> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginCommentsPage>({
    path: appendQuery(`/api/v1/plugins/${pluginName}/comments`, {
      page: query?.page,
      pageSize: query?.pageSize,
    }),
  })
}

export function checkPluginUploadHash(hash: string): Promise<PluginHashCheckResponse> {
  return requestJson<PluginHashCheckResponse, { hash: string }>({
    path: '/api/v1/plugins/check-hash',
    method: 'POST',
    body: { hash },
  })
}

/**
 * 按宿主返回的本地插件 hash 批量查询同一上传者范围内是否存在新版本。
 */
export function checkPluginUpdates(
  plugins: PluginUpdateCheckRequestItem[],
): Promise<PluginUpdateCheckResponseItem[]> {
  return requestJson<PluginUpdateCheckResponseItem[], { plugins: PluginUpdateCheckRequestItem[] }>({
    path: '/api/v1/plugins/check-updates',
    method: 'POST',
    body: { plugins },
  })
}

/**
 * 分页读取当前用户的上传记录，列表中的 id 与上传接口返回的 reviewTaskId 一致。
 */
export function getMyPluginUploads(query?: MyPluginUploadsQuery): Promise<MyPluginUploadsResponse> {
  return requestJson<MyPluginUploadsResponse>({
    path: appendQuery('/api/v1/plugins/me/uploads', {
      page: query?.page,
      pageSize: query?.pageSize,
      keyword: query?.keyword?.trim() || undefined,
    }),
  })
}

/**
 * 按上传任务 ID 查询单条记录，用于上传接口返回后立即刷新该次处理进度。
 */
export function getMyPluginUpload(id: string): Promise<MyPluginUploadRecord> {
  return requestJson<MyPluginUploadRecord>({
    path: `/api/v1/plugins/me/uploads/${encodeURIComponent(id)}`,
  })
}

/**
 * 删除当前用户的一次上传记录；未发布记录由服务端保留并标记为发布失败。
 */
export function deleteMyPluginUpload(id: string): Promise<{ message?: string } | null> {
  return requestJson<{ message?: string } | null>({
    path: `/api/v1/plugins/me/uploads/${encodeURIComponent(id)}`,
    method: 'DELETE',
  })
}

export function createPluginComment(
  name: string,
  payload: CreatePluginCommentRequest,
): Promise<PluginCommentRecord> {
  const pluginName = encodeURIComponent(name)
  return requestJson<PluginCommentRecord, CreatePluginCommentRequest>({
    path: `/api/v1/plugins/${pluginName}/comments`,
    method: 'POST',
    body: payload,
  })
}

export async function uploadPluginPackage(
  payload: PluginUploadPayload,
): Promise<PluginUploadResponse> {
  const fileName = payload.fileName || 'plugin.zpx'
  const formData = new FormData()
  formData.append('file', payload.file, fileName)

  console.log('[PluginMarket] uploadPluginPackage 请求准备完成:', {
    fileName,
    fileSize: payload.file.size,
    fileType: payload.file.type,
  })

  try {
    const data = await requestFormData<PluginUploadAcceptedResponse>({
      path: '/api/v1/plugins/upload',
      method: 'POST',
      body: formData,
    })

    console.log('[PluginMarket] uploadPluginPackage 请求成功:', data)

    return {
      success: true,
      message: typeof data?.message === 'string' ? data.message : '上传成功',
      reviewTaskId: typeof data?.reviewTaskId === 'string' ? data.reviewTaskId : undefined,
      data,
    }
  } catch (error) {
    console.error('[PluginMarket] uploadPluginPackage 请求失败:', error)
    if (error instanceof HttpClientError) {
      console.error('[PluginMarket] uploadPluginPackage 响应详情:', {
        status: error.status,
        data: error.data,
      })
      return {
        success: false,
        error: error.message,
        data: error.data,
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : '上传失败',
    }
  }
}

/**
 * 初始化分片上传
 */
export async function initChunkedUpload(
  request: ChunkedUploadInitRequest,
): Promise<ChunkedUploadInitResponse> {
  return requestJson<ChunkedUploadInitResponse, ChunkedUploadInitRequest>({
    path: '/api/v1/plugins/chunked-upload/init',
    method: 'POST',
    body: request,
  })
}

/**
 * 上传单个分片
 */
export async function uploadChunk(
  payload: ChunkedUploadChunkPayload,
): Promise<ChunkedUploadChunkResponse> {
  const formData = new FormData()
  formData.append('chunk', payload.chunk)
  formData.append('chunkIndex', payload.chunkIndex.toString())
  formData.append('chunkHash', payload.chunkHash)

  return requestFormData<ChunkedUploadChunkResponse>({
    path: `/api/v1/plugins/chunked-upload/${encodeURIComponent(payload.uploadId)}/chunks`,
    method: 'POST',
    body: formData,
  })
}

/**
 * 完成分片上传
 */
export async function completeChunkedUpload(
  uploadId: string,
): Promise<ChunkedUploadCompleteResponse> {
  return requestJson<ChunkedUploadCompleteResponse>({
    path: `/api/v1/plugins/chunked-upload/${encodeURIComponent(uploadId)}/complete`,
    method: 'POST',
  })
}

/**
 * 取消分片上传
 */
export async function cancelChunkedUpload(
  uploadId: string,
): Promise<ChunkedUploadCancelResponse> {
  return requestJson<ChunkedUploadCancelResponse>({
    path: `/api/v1/plugins/chunked-upload/${encodeURIComponent(uploadId)}/cancel`,
    method: 'POST',
  })
}

/**
 * 查询分片上传进度
 */
export async function getChunkedUploadProgress(
  uploadId: string,
): Promise<ChunkedUploadProgressResponse> {
  return requestJson<ChunkedUploadProgressResponse>({
    path: `/api/v1/plugins/chunked-upload/${encodeURIComponent(uploadId)}/progress`,
  })
}

