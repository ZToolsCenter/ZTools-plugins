/** 贴图（悬浮贴）通用设置：按钮显隐、滚轮缩放、关闭手势、复制/保存后行为、翻译结果形态。 */

export type WheelZoomMode = 'plain' | 'ctrl'
export type CloseGesture = 'dblclick' | 'rightclick' | 'both'
export type CopyAction = 'copy' | 'copy-close'
export type SaveAction = 'save' | 'save-close'
/** 点「翻译」后的结果展示：侧边弹窗，或盖在贴图原文字上。 */
export type TranslateResultMode = 'popup' | 'overlay'

export interface BoardButtonSettings {
  ocr: boolean
  translate: boolean
  copy: boolean
  save: boolean
  doodle: boolean
  settings: boolean
  close: boolean
}

export interface BoardSettings {
  buttons: BoardButtonSettings
  wheelZoom: WheelZoomMode
  closeGesture: CloseGesture
  copyAction: CopyAction
  saveAction: SaveAction
  translateResultMode: TranslateResultMode
}

export const BOARD_SETTINGS_KEY = 'snap-translate.boardSettings'

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  buttons: {
    ocr: true,
    translate: true,
    copy: true,
    save: true,
    doodle: true,
    settings: true,
    close: true
  },
  wheelZoom: 'ctrl',
  closeGesture: 'both',
  copyAction: 'copy',
  saveAction: 'save',
  translateResultMode: 'popup'
}

function cloneDefaults(): BoardSettings {
  return {
    buttons: { ...DEFAULT_BOARD_SETTINGS.buttons },
    wheelZoom: DEFAULT_BOARD_SETTINGS.wheelZoom,
    closeGesture: DEFAULT_BOARD_SETTINGS.closeGesture,
    copyAction: DEFAULT_BOARD_SETTINGS.copyAction,
    saveAction: DEFAULT_BOARD_SETTINGS.saveAction,
    translateResultMode: DEFAULT_BOARD_SETTINGS.translateResultMode
  }
}

function normalize(input: unknown): BoardSettings {
  const base = cloneDefaults()
  if (!input || typeof input !== 'object') return base
  const raw = (typeof input === 'string'
    ? (() => {
        try {
          return JSON.parse(input)
        } catch (_) {
          return null
        }
      })()
    : input) as Partial<BoardSettings> | null
  if (!raw || typeof raw !== 'object') return base
  const buttons = (raw.buttons || {}) as Partial<BoardButtonSettings>
  for (const key of Object.keys(base.buttons) as (keyof BoardButtonSettings)[]) {
    if (typeof buttons[key] === 'boolean') base.buttons[key] = buttons[key] as boolean
  }
  if (raw.wheelZoom === 'plain' || raw.wheelZoom === 'ctrl') base.wheelZoom = raw.wheelZoom
  if (raw.closeGesture === 'dblclick' || raw.closeGesture === 'rightclick' || raw.closeGesture === 'both') {
    base.closeGesture = raw.closeGesture
  }
  if (raw.copyAction === 'copy' || raw.copyAction === 'copy-close') base.copyAction = raw.copyAction
  if (raw.saveAction === 'save' || raw.saveAction === 'save-close') base.saveAction = raw.saveAction
  if (raw.translateResultMode === 'popup' || raw.translateResultMode === 'overlay') {
    base.translateResultMode = raw.translateResultMode
  }
  return base
}

export function loadBoardSettings(): BoardSettings {
  try {
    const raw = window.ztools?.dbStorage?.getItem(BOARD_SETTINGS_KEY)
    return normalize(raw)
  } catch (_) {
    return cloneDefaults()
  }
}

export function saveBoardSettings(settings: BoardSettings): void {
  try {
    window.ztools?.dbStorage?.setItem(BOARD_SETTINGS_KEY, settings)
  } catch (_) {
    /* ignore */
  }
}

export function defaultBoardSettings(): BoardSettings {
  return cloneDefaults()
}
