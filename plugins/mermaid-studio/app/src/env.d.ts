/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

/** 可导出的图表格式 */
export type ExportFormat = 'png' | 'svg' | 'pdf'

/** 插件配置 */
export interface StudioSettings {
  theme: 'default' | 'dark' | 'forest' | 'neutral'
  layout: 'split' | 'editor' | 'preview'
  exportScale: 1 | 2 | 3 | 4
  autoSave: boolean
}

/** 导出请求 */
export interface SaveRequest {
  format: ExportFormat
  base64: string
  fileName?: string
  saveAs?: boolean
}

/** 导出结果；用户取消时 saved 为 false */
export interface SaveResult {
  saved: boolean
  filePath?: string
}

/** preload 注入的桥接能力（对应 src-ztools/preload/services.js） */
interface MermaidStudioBridge {
  saveFile: (request: SaveRequest) => Promise<SaveResult>
  readSettings: () => StudioSettings
  writeSettings: (patch: Partial<StudioSettings>) => StudioSettings
}

declare global {
  interface Window {
    mermaidStudio?: MermaidStudioBridge
  }
}

export {}
