export type Platform = 'win32' | 'darwin' | 'linux' | string

export interface PluginFeatureCommand {
  type?: string
  label?: string
  [key: string]: unknown
}

export interface PluginFeature {
  code: string
  name?: string
  explain?: string
  icon?: string
  cmds?: Array<string | PluginFeatureCommand>
  [key: string]: unknown
}

export interface PluginMarketCategoryDto {
  key: string
  title: string
  description?: string
  icon?: string
  list: string[]
}

export interface PluginMarketPluginDto {
  name: string
  version: string
  title?: string
  description?: string
  author?: string
  main?: string
  logo?: string
  preload?: string
  features?: PluginFeature[]
  platform?: Platform[]
  categories?: string[]
  categoryFallback?: boolean
  downloadUrl?: string
  hash?: string | null
  source?: PluginReleaseSource
  uploaderUserId?: string | null
  uploaderAccount?: string | null
  uploaderUsername?: string | null
  risk?: PluginMarketListRiskInfo | null
}

export interface PluginMarketPluginReference {
  name: string
}

export interface PluginMarketListRiskSummary {
  level?: string | null
  summary?: string | null
  filePath?: string | null
  reasons?: string[]
  warningsCn?: string[]
}

export interface PluginMarketListRiskInfo {
  riskLevel?: string | null
  riskSummary?: PluginMarketListRiskSummary | null
  warningsCn?: string[]
  reviewDecision?: string | null
}

export interface PluginMarketStreamSnapshot extends PluginMarketFetchResponse {
  complete: boolean
}

export interface StreamPluginMarketOptions {
  platform: Platform
  signal?: AbortSignal
  onSnapshot?: (snapshot: PluginMarketStreamSnapshot) => void
}


export interface PluginMarketPlugin {
  name: string
  version: string
  title?: string
  description?: string
  logo?: string
  downloadUrl?: string
  hash?: string
  platform?: Platform[]
  author?: string
  homepage?: string
  size?: number
  totalDownloads?: number
  avgRating?: number
  ratingCount?: number
  features?: PluginFeature[]
  main?: string
  preload?: string
  categories?: string[]
  categoryFallback?: boolean
  source?: PluginReleaseSource
  uploaderUserId?: string | null
  uploaderAccount?: string | null
  uploaderUsername?: string | null
  risk?: PluginMarketListRiskInfo | null
}

export interface InjectedPluginRecord {
  name: string
  path?: string
  version?: string
  [key: string]: unknown
}

export interface InstalledPlugin {
  name: string
  path: string
  version: string
  hash?: string
  title?: string
  description?: string
  logo?: string
  features?: PluginFeature[]
  author?: string
  homepage?: string
  size?: number
  isDevelopment?: boolean
  installedAt?: string
  [key: string]: unknown
}

export interface OperationResult {
  success: boolean
  error?: string
}

export interface PluginMutationResult extends OperationResult {
  plugin?: InstalledPlugin
}

export interface PluginReadmeResponse extends OperationResult {
  content?: string
}

export interface HashFileResult extends OperationResult {
  hash?: string
  algorithm?: string
}

export interface PluginUploadPayload {
  file: Blob
  fileName?: string
}

export interface PluginUploadAcceptedResponse {
  message: string
  reviewTaskId: string
}

export interface PluginUploadResponse extends OperationResult {
  data?: PluginUploadAcceptedResponse | unknown
  message?: string
  reviewTaskId?: string
}

export type PluginHashCheckStatus = 'blocked' | 'processing' | 'safe' | 'exists'

export interface PluginHashCheckResponse {
  status: PluginHashCheckStatus
  pluginName?: string
  version?: string
}

export interface PluginUpdateCheckRequestItem {
  name: string
  hash: string
}

export interface PluginUpdateCheckResponseItem {
  name: string
  latestHash: string
}

export type MyPluginUploadStatus =
  | 'AI_CLASSIFYING'
  | 'AI_REVIEWING'
  | 'MANUAL_REVIEW'
  | 'PUBLISHED'
  | 'PUBLISH_FAILED'

export interface MyPluginUploadProgress {
  code: MyPluginUploadStatus
  label: string
}

export interface MyPluginUploadRecord {
  id: string
  pluginName: string
  version: string
  originalName: string
  fileSize: number
  createdAt: string
  status: MyPluginUploadStatus
  progress?: MyPluginUploadProgress
  downloads: number
}

export interface MyPluginUploadsQuery extends PluginPageQuery {
  keyword?: string
}

export interface MyPluginUploadsResponse {
  items: MyPluginUploadRecord[]
  total: number
  page: number
  pageSize: number
}

export interface PluginMarketBannerItem {
  image: string
  url?: string
}

export interface StorefrontCategorySummary {
  key: string
  title: string
  description?: string
  icon?: string
  showDescription: boolean
  pluginCount: number
}

export interface PluginMarketStorefrontCategory {
  key: string
  title: string
  description?: string
  icon?: string
  plugins: PluginMarketPluginReference[]
}

export interface StorefrontBannerSection {
  type: 'banner'
  key: string
  items: PluginMarketBannerItem[]
  height?: number
}

export interface StorefrontNavigationSection {
  type: 'navigation'
  key: string
  title?: string
  categories: StorefrontCategorySummary[]
}

export interface StorefrontPluginSection {
  type: 'fixed' | 'random'
  key: string
  title?: string
  plugins: PluginMarketPluginReference[]
}

export type PluginMarketStorefrontSection =
  | StorefrontBannerSection
  | StorefrontNavigationSection
  | StorefrontPluginSection

export interface CategoryLayoutSection {
  type: 'list' | 'fixed' | 'random' | string
  title?: string
  count?: number
  plugins?: string[]
}

export interface PluginMarketStorefront {
  sections: PluginMarketStorefrontSection[]
  categories: Record<string, PluginMarketStorefrontCategory>
  categoryLayouts: Record<string, CategoryLayoutSection[]>
}

export interface PluginMarketFetchResponse extends OperationResult {
  data?: PluginMarketPlugin[]
  storefront?: PluginMarketStorefront
}

export interface PluginLaunchOptions {
  path: string
  type: 'plugin'
  name: string
  param: Record<string, unknown>
}

export interface PluginLaunchResult extends OperationResult {}

export interface PluginMarketUiPlugin extends PluginMarketPlugin {
  title: string
  description: string
  installed: boolean
  path?: string
  localVersion?: string
  latestVersion?: string
  localHash?: string
  latestHash?: string
  marketPlugin?: PluginMarketPlugin
  hasUpdate?: boolean
  isRunning?: boolean
  isDevelopment?: boolean
  installedAt?: string
}

export interface InstalledViewPlugin extends PluginMarketUiPlugin {
  installed: true
  path: string
  localVersion: string
  latestVersion: string
  localHash?: string
  latestHash?: string
  installedAt?: string
}

export interface CategoryInfo {
  key: string
  title: string
  description?: string
  icon?: string
  plugins: PluginMarketUiPlugin[]
}

export type PluginReleaseSource = string | Record<string, unknown> | null

export interface PluginDetailReadme {
  hash?: string | null
  content?: string | null
  source?: PluginReleaseSource
  isAiGenerated?: boolean
}

export interface PluginDetailVersion {
  id: string
  version: string
  hash: string
  fileSize: number
  downloads: number
  createdAt: string
  source?: PluginReleaseSource
  uploaderUserId?: string | null
  uploaderAccount?: string | null
  uploaderUsername?: string | null
}

export interface ResolvedPluginDownloadTarget {
  version: string
  hash: string | null
  downloadMode: 'latest' | 'hash'
  downloadUrl: string
  build: PluginDetailVersion | null
  plugin: PluginMarketPlugin
}

export interface PluginDetailResponse {
  id: string
  name: string
  title?: string
  description?: string
  author?: string
  logo?: string
  features?: PluginFeature[]
  version?: string
  main?: string
  preload?: string
  categories: string[]
  categoryFallback: boolean
  avgRating: number
  ratingCount: number
  totalDownloads: number
  source?: PluginReleaseSource
  readme?: PluginDetailReadme | null
  versions: PluginDetailVersion[]
  createdAt: string
  updatedAt: string
}

export interface PluginRiskSummary {
  level?: string | null
  summary?: string | null
  filePath?: string | null
  reasons?: string[]
}

export interface PluginRiskInfo {
  pluginName: string
  version: string
  riskLevel: string
  riskSummary: PluginRiskSummary | null
  reviewDecision?: string | null
  updatedAt: string
}

export interface PluginStatsResponse {
  totalDownloads?: number
  [key: string]: unknown
}

export interface PluginPageQuery {
  page?: number
  pageSize?: number
}

export interface PluginInteractionUser {
  id: string
  account: string
  username: string
  avatarUrl: string | null
}

export interface CreatePluginRatingRequest {
  score: number
}

export interface PluginRatingRecord {
  id: string
  score: number
  user: PluginInteractionUser
  createdAt: string
  updatedAt: string
}

export interface PluginRatingsPage {
  items: PluginRatingRecord[]
  avgRating: number
  total: number
  page: number
  pageSize: number
}

export interface CreatePluginCommentRequest {
  content: string
  parentId?: string
}

export interface PluginCommentRecord {
  id: string
  content: string
  parentId: string | null
  user: PluginInteractionUser
  createdAt: string
  updatedAt: string
  replies?: PluginCommentRecord[]
}

export interface PluginCommentsPage {
  items: PluginCommentRecord[]
  total: number
  page: number
  pageSize: number
}

export interface PluginCommentTreeNode extends PluginCommentRecord {
  replies: PluginCommentTreeNode[]
}

export interface UiStorefrontBannerSection {
  type: 'banner'
  key: string
  items: PluginMarketBannerItem[]
  height?: number
}

export interface UiStorefrontNavigationSection {
  type: 'navigation'
  key: string
  title?: string
  categories: StorefrontCategorySummary[]
}

export interface UiStorefrontPluginSection {
  type: 'fixed' | 'random'
  key: string
  title?: string
  plugins: PluginMarketUiPlugin[]
}

export type PluginMarketSectionModel =
  | UiStorefrontBannerSection
  | UiStorefrontNavigationSection
  | UiStorefrontPluginSection

export interface CategorySectionModel {
  key: string
  type: 'list' | 'fixed' | 'random'
  title?: string
  plugins: PluginMarketUiPlugin[]
}

// 分片上传相关类型定义

export interface ChunkedUploadInitRequest {
  fileName: string
  totalSize: number
  totalChunks: number
  fileHash?: string
}

export interface ChunkedUploadInitResponse {
  uploadId: string
  existingChunks: number[]
  fileExists: boolean
  existingPlugin?: {
    pluginName: string
    version: string
  }
}

export interface ChunkedUploadChunkPayload {
  uploadId: string
  chunk: Blob
  chunkIndex: number
  chunkHash: string
}

export interface ChunkedUploadChunkResponse {
  chunkIndex: number
  success: boolean
}

export type ChunkedUploadStatus =
  | 'UPLOADING'
  | 'COMPLETED'
  | 'MERGING'
  | 'MERGED'
  | 'FAILED'
  | 'CANCELLED'

export interface ChunkedUploadProgressResponse {
  uploadId: string
  fileName: string
  totalChunks: number
  uploadedChunks: number
  status: ChunkedUploadStatus
  progress: number
}

export interface ChunkedUploadCompleteResponse {
  message: string
  reviewTaskId: string
}

export interface ChunkedUploadCancelResponse {
  message: string
}
