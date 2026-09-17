export type ToolId =
  | 'compress'
  | 'convert'
  | 'resize'
  | 'rotate'
  | 'crop'
  | 'watermark'
  | 'style'
  | 'merge'
  | 'rename'

export type RenameMode = 'sequence' | 'replace'

export type OutputMode = 'same-folder' | 'overwrite' | 'output-dir'

export type ImageFormat =
  | 'original'
  | 'jpeg'
  | 'jpg'
  | 'png'
  | 'webp'
  | 'avif'
  | 'tiff'
  | 'gif'
  | 'bmp'
  | 'ico'

export type MergeMode = 'long-vertical' | 'long-horizontal' | 'pdf' | 'gif-animated'

export interface EnterAction {
  code?: string
  type?: string
  payload?: string | Array<{ path: string }>
}

export interface ImageItem {
  path: string
  name: string
  size: number
  width: number
  height: number
  format: string
  thumb?: string
}

export interface BaseProcessOptions {
  tool: ToolId
  outputMode: OutputMode
  outputDir?: string
  suffix?: string
}

export interface CompressOptions extends BaseProcessOptions {
  tool: 'compress'
  quality: number
  targetSizeKb?: number | null
  format: ImageFormat
}

export interface ConvertOptions extends BaseProcessOptions {
  tool: 'convert'
  format: ImageFormat
  quality: number
}

export interface ResizeOptions extends BaseProcessOptions {
  tool: 'resize'
  resizeMode: 'pixel' | 'percent'
  width?: string
  height?: string
  scalePercent?: number
  keepAspectRatio: boolean
  withoutEnlargement: boolean
  format: ImageFormat
  quality: number
}

export interface RotateOptions extends BaseProcessOptions {
  tool: 'rotate'
  rotateAngle: number
  flipHorizontal: boolean
  flipVertical: boolean
  format: ImageFormat
  quality: number
}

export interface CropOptions extends BaseProcessOptions {
  tool: 'crop'
  cropMode: 'ratio' | 'manual'
  cropRatioW: number
  cropRatioH: number
  /** 相对原图的裁剪框，取值 0–1 */
  cropLeft: number
  cropTop: number
  cropWidth: number
  cropHeight: number
  format: ImageFormat
  quality: number
}

export interface WatermarkOptions extends BaseProcessOptions {
  tool: 'watermark'
  watermarkType: 'none' | 'text' | 'image'
  watermarkText?: string
  watermarkImagePath?: string
  watermarkFontSize?: number
  watermarkColor?: string
  watermarkOpacity?: number
  watermarkPosition?: string
  watermarkScale?: number
  format: ImageFormat
  quality: number
}

export interface StyleOptions extends BaseProcessOptions {
  tool: 'style'
  borderRadius?: number
  borderWidth?: number
  borderColor?: string
  padding?: number
  paddingColor?: string
  paddingOpacity?: number
  format: ImageFormat
  quality: number
}

export interface MergeOptions extends BaseProcessOptions {
  tool: 'merge'
  mergeMode: MergeMode
  gifDelay?: number
  format: ImageFormat
  quality: number
}

/** 原地重命名；outputMode/suffix 仅占位以兼容统一处理入口 */
export interface RenameOptions extends BaseProcessOptions {
  tool: 'rename'
  renameMode: RenameMode
  prefix: string
  startIndex: number
  padLength: number
  separator: string
  findText: string
  replaceText: string
}

export type ToolOptions =
  | CompressOptions
  | ConvertOptions
  | ResizeOptions
  | RotateOptions
  | CropOptions
  | WatermarkOptions
  | StyleOptions
  | MergeOptions
  | RenameOptions

export interface ProcessResult {
  inputPath?: string
  inputPaths?: string[]
  outputPath?: string
  success: boolean
  inputSize?: number
  outputSize?: number
  error?: string
}

export interface ToolDefinition {
  id: ToolId
  label: string
  icon: string
  description: string
  minImages: number
  batchMode: 'single' | 'merge'
}
