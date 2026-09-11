import {
  DEFAULT_PIXEL_PAINT_BRUSH_SIZE,
  DEFAULT_PIXEL_GRID_SIZE,
  USER_PREFERENCES_SCHEMA_VERSION,
  USER_PREFERENCES_STORAGE_KEY
} from './constants'
import { normalizePixelGridSize, normalizePixelPaintBrushSize } from './canvasSettings'

/**
 * 应用级用户偏好：跨会话记住编辑器环境状态，关闭插件再打开恢复到上次状态。
 * 与随工程文件 / 草稿保存的画布设置相互独立：这里只记录「最后一次的界面状态」，
 * 工程恢复覆盖这些值后同样会被记住，作为下一次打开的初始状态。
 */
export interface UserPreferences {
  /** 网格间距（吸附与网格上色共用的单元格边长）。 */
  pixelGridSize: number
  /** 油漆桶网格上色画笔大小（N × N 个网格单元格）。 */
  pixelPaintBrushSize: number
  /** 左侧插入面板是否收起。 */
  leftPanelCollapsed: boolean
  /** 是否显示标尺。 */
  showRuler: boolean
  /** 移动 / 点位编辑是否吸附网格。 */
  snapToPixelGrid: boolean
}

/**
 * 生成用户偏好的默认值：与 useHomeEditorRuntime 中各 ref 的历史初始值保持一致，
 * 无存储记录或字段缺失时按此回退，保证新旧版本升级后行为不变。
 */
export function createUserPreferencesDefaults(): UserPreferences {
  return {
    pixelGridSize: DEFAULT_PIXEL_GRID_SIZE,
    pixelPaintBrushSize: DEFAULT_PIXEL_PAINT_BRUSH_SIZE,
    leftPanelCollapsed: false,
    showRuler: true,
    snapToPixelGrid: false
  }
}

/**
 * 将任意来源（旧版本、手改存储）的偏好数据归一化为安全值：
 * 数值字段复用画布设置的 normalize 逻辑做范围钳制，布尔字段仅接受 boolean，
 * 缺失或非法字段逐个回退默认值，绝不让脏数据导致界面处于不可控状态。
 */
export function normalizeUserPreferences(raw: unknown): UserPreferences {
  const defaults = createUserPreferencesDefaults()
  if (raw == null || typeof raw !== 'object') return defaults
  const source = raw as Record<string, unknown>
  return {
    pixelGridSize: source.pixelGridSize === undefined
      ? defaults.pixelGridSize
      : normalizePixelGridSize(source.pixelGridSize),
    pixelPaintBrushSize: source.pixelPaintBrushSize === undefined
      ? defaults.pixelPaintBrushSize
      : normalizePixelPaintBrushSize(source.pixelPaintBrushSize),
    leftPanelCollapsed: typeof source.leftPanelCollapsed === 'boolean'
      ? source.leftPanelCollapsed
      : defaults.leftPanelCollapsed,
    showRuler: typeof source.showRuler === 'boolean'
      ? source.showRuler
      : defaults.showRuler,
    snapToPixelGrid: typeof source.snapToPixelGrid === 'boolean'
      ? source.snapToPixelGrid
      : defaults.snapToPixelGrid
  }
}

/**
 * 启动时从 localStorage 读取用户偏好；无记录、脏数据或存储异常一律回退默认值，
 * 读取失败只记录警告，不允许阻断编辑器启动流程。
 */
export function loadUserPreferences(): UserPreferences {
  if (typeof window === 'undefined') return createUserPreferencesDefaults()
  try {
    const raw = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)
    if (!raw) return createUserPreferencesDefaults()
    return normalizeUserPreferences(JSON.parse(raw))
  } catch (error) {
    console.warn('读取用户偏好失败', error)
    return createUserPreferencesDefaults()
  }
}

/**
 * 将当前偏好写回 localStorage（附带 schema 版本便于后续迁移）；
 * 写入失败（多为存储配额）只记录警告，不打断编辑主流程。
 */
export function saveUserPreferences(preferences: UserPreferences) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: USER_PREFERENCES_SCHEMA_VERSION,
      ...preferences
    }))
  } catch (error) {
    console.warn('保存用户偏好失败', error)
  }
}
