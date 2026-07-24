/**
 * 父（主窗）↔ 子（阅读窗）之间的 IPC 通道。
 * 阅读窗的 BrowserWindow proxy 由主窗 preload 持有，真隐藏等操作需经 IPC 回主窗；
 * 其余阅读交互在阅读窗内自闭环，不经过 IPC。
 */
export const IPC = {
  /** 阅读窗 → 主窗：通知主窗隐藏阅读窗（真隐藏 win.hide()） */
  HIDE_READER: 'sr:hide-reader',
  /** 阅读窗 → 主窗：保存阅读窗的位置/尺寸 */
  SAVE_BOUNDS: 'sr:save-bounds',
  /** 阅读窗 → 主窗：阅读进度变化（用于主窗刷新书架进度展示） */
  PROGRESS: 'sr:progress',
  /** 主窗 → 阅读窗：推送新的阅读状态（打开新文件/切章） */
  READING_STATE: 'sr:reading-state',
  /** 主窗 → 阅读窗：请求显示阅读窗（命令恢复） */
  SHOW_READER: 'sr:show-reader',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** 通过 reading-state 通道下发给阅读窗的状态 */
export interface ReadingState {
  filePath: string
  format: 'txt' | 'epub' | 'pdf'
  settings?: any
  chapterIndex?: number
  pageIndex?: number
  charOffset?: number
  /** PDF 页码 */
  pdfPage?: number
}