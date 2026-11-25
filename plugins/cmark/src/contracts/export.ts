/**
 * ExportPort —— 导出的「落地」部分
 *
 * 内容生成（md / html / 主题 CSS）在 core/export，与平台无关。
 * 这里只负责：把字节写出去、渲染成 PDF / 图片、调起分享。
 *
 * 平台差异：
 *  - ZTools/uTools：隐藏窗口 print → PDF
 *  - Tauri 桌面/移动：前端 html2canvas + jsPDF 生成（三端同一套）
 *  - 移动端额外有系统分享面板
 */
import type { Result } from './result'

export interface ExportFile {
  name: string
  bytes: Uint8Array
}

export interface SaveBytesOptions {
  name: string
  bytes: Uint8Array
  /** 目标目录；'ask' = 弹选择器 */
  dir?: string | 'ask'
  /** 需要一起复制的附件（导出 md 便携目录时用） */
  attachments?: ExportFile[]
}

export interface RenderOptions {
  theme: 'light' | 'dark'
  /** 长图缩放倍率，默认 2 */
  scale?: number
}

export interface ExportPort {
  saveBytes(o: SaveBytesOptions): Promise<Result<{ path: string } | null>>
  /** caps.export.pdf=false 时返回 unsupported */
  renderPdf(html: string, o: RenderOptions): Promise<Result<Uint8Array>>
  /** caps.export.longImage=false 时返回 unsupported */
  renderImage(html: string, o: RenderOptions): Promise<Result<Uint8Array>>
  /** caps.export.shareSheet=false 时返回 unsupported */
  share(o: ExportFile): Promise<Result<void>>
}