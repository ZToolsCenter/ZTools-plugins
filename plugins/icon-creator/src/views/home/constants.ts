import type { KeylineTemplate } from './types'

export const PROJECT_SCHEMA_VERSION = 1
export const PROJECT_FILE_EXTENSION = 'iconcreator.json'
export const DRAFT_STORAGE_KEY = 'icon-creator:auto-save-draft:v1'
export const USER_ASSET_STORAGE_KEY = 'icon-creator:user-assets:v1'
export const USER_STYLE_PRESET_STORAGE_KEY = 'icon-creator:user-style-presets:v1'
export const USER_PREFERENCES_STORAGE_KEY = 'icon-creator:user-preferences:v1'
// 用户偏好存储结构版本：字段新增或语义变化时递增，读取侧按需做旧结构迁移。
export const USER_PREFERENCES_SCHEMA_VERSION = 1
export const USER_ASSET_THUMBNAIL_SIZE = 96
export const USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE = 1600
export const DRAFT_SAVE_DELAY = 800
// 草稿结构版本：1 = 旧版单 project 结构；2 = 多标签结构（tabs + activeTabId）。
export const DRAFT_SCHEMA_VERSION = 2
// 草稿写入因存储配额连续失败时的 toast 提示节流间隔（毫秒），避免频繁编辑下提示刷屏。
export const DRAFT_QUOTA_TOAST_THROTTLE = 5000
export const EXPORT_PNG_SIZE_OPTIONS = [16, 24, 32, 48, 64, 128, 256, 512]
export const SMALL_PREVIEW_SIZE_OPTIONS = [16, 24, 32, 48]
export const DEFAULT_PIXEL_GRID_SIZE = 16
export const MIN_PIXEL_GRID_SIZE = 1
export const MAX_PIXEL_GRID_SIZE = 256
export const MIN_PIXEL_GRID_VISIBLE_STEP = 4
// 油漆桶网格上色的画笔大小：以网格单元格为单位的方形边长（N × N 格）。
export const DEFAULT_PIXEL_PAINT_BRUSH_SIZE = 1
export const MIN_PIXEL_PAINT_BRUSH_SIZE = 1
export const MAX_PIXEL_PAINT_BRUSH_SIZE = 32
export const DEFAULT_KEYLINE_TEMPLATE: KeylineTemplate = 'none'
export const DEFAULT_KEYLINE_MARGIN = 48
export const MIN_KEYLINE_MARGIN = 0
export const MAX_KEYLINE_MARGIN = 512
export const DEFAULT_KEYLINE_OPACITY = 1
export const MIN_KEYLINE_OPACITY = 0
export const MAX_KEYLINE_OPACITY = 1
export const TEXT_OUTLINE_TRACE_MULTIPLIER = 2
export const TEXT_OUTLINE_ALPHA_THRESHOLD = 12
export const BITMAP_VECTOR_TRACE_MULTIPLIER = 2
export const BITMAP_VECTOR_MAX_TRACE_SIDE = 1024
export const BITMAP_VECTOR_ALPHA_THRESHOLD = 8
export const BITMAP_VECTOR_DEFAULT_THRESHOLD = 180
export const DEFAULT_COLOR_PALETTE_COLUMNS = 6
export const MIN_COLOR_PALETTE_COLUMNS = 1
export const MAX_COLOR_PALETTE_COLUMNS = 12
export const STYLE_PRESET_STORAGE_SCHEMA_VERSION = 3
export const GRADIENT_PRESET_GRID_COLUMNS = 2
export const MIN_GRADIENT_PRESET_ROWS = 1
export const MAX_GRADIENT_PRESET_ROWS = 24
export const ICONIFY_SEARCH_LIMIT = 48
export const ICONIFY_BROWSE_BATCH_SIZE = 24
// 全量图标集列表的本地缓存：7 天内直接复用，避免每次启动重复拉取约 100KB 的集合元数据。
export const ICONIFY_COLLECTIONS_STORAGE_KEY = 'icon-creator:iconify-collections:v1'
export const ICONIFY_COLLECTIONS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
