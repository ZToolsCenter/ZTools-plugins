import type {
  CompressOptions,
  ConvertOptions,
  CropOptions,
  MergeOptions,
  RenameOptions,
  ResizeOptions,
  RotateOptions,
  StyleOptions,
  ToolDefinition,
  ToolId,
  ToolOptions,
  WatermarkOptions
} from '../types'

export const TOOLS: ToolDefinition[] = [
  { id: 'compress', label: '图片压缩', icon: '压', description: '调节质量或目标体积', minImages: 1, batchMode: 'single' },
  { id: 'convert', label: '格式转换', icon: '转', description: '批量转换输出格式', minImages: 1, batchMode: 'single' },
  { id: 'resize', label: '更改尺寸', icon: '尺', description: '像素或百分比缩放', minImages: 1, batchMode: 'single' },
  { id: 'rotate', label: '旋转翻转', icon: '旋', description: '旋转角度与镜像', minImages: 1, batchMode: 'single' },
  { id: 'crop', label: '裁剪图片', icon: '裁', description: '固定比例居中裁剪', minImages: 1, batchMode: 'single' },
  { id: 'watermark', label: '添加水印', icon: '印', description: '文字或图片水印', minImages: 1, batchMode: 'single' },
  { id: 'style', label: '圆角边框', icon: '饰', description: '圆角、边框与边距', minImages: 1, batchMode: 'single' },
  { id: 'merge', label: '合并图片', icon: '合', description: '长图 / PDF / GIF', minImages: 2, batchMode: 'merge' },
  { id: 'rename', label: '批量重命名', icon: '名', description: '序号模板或查找替换', minImages: 1, batchMode: 'single' }
]

export const FORMAT_OPTIONS = [
  { value: 'original', label: '保持原格式' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'gif', label: 'GIF' },
  { value: 'bmp', label: 'BMP' },
  { value: 'ico', label: 'ICO' }
] as const

export const MERGE_MODE_OPTIONS = [
  { value: 'long-vertical', label: '纵向长图' },
  { value: 'long-horizontal', label: '横向长图' },
  { value: 'pdf', label: '合并 PDF' },
  { value: 'gif-animated', label: '动画 GIF' }
] as const

export const WATERMARK_POSITIONS = [
  { value: 'northwest', label: '左上' },
  { value: 'north', label: '上' },
  { value: 'northeast', label: '右上' },
  { value: 'west', label: '左' },
  { value: 'center', label: '居中' },
  { value: 'east', label: '右' },
  { value: 'southwest', label: '左下' },
  { value: 'south', label: '下' },
  { value: 'southeast', label: '右下' }
] as const

export const CROP_PRESETS = [
  { label: '1:1', w: 1, h: 1 },
  { label: '4:3', w: 4, h: 3 },
  { label: '3:4', w: 3, h: 4 },
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 }
] as const

const baseOutput = {
  outputMode: 'same-folder' as const,
  outputDir: '',
  suffix: '_processed'
}

export function createDefaultOptions(tool: ToolId): ToolOptions {
  switch (tool) {
    case 'compress':
      return {
        tool: 'compress',
        quality: 80,
        targetSizeKb: null,
        format: 'original',
        ...baseOutput
      } satisfies CompressOptions
    case 'convert':
      return {
        tool: 'convert',
        format: 'webp',
        quality: 90,
        ...baseOutput
      } satisfies ConvertOptions
    case 'resize':
      return {
        tool: 'resize',
        resizeMode: 'pixel',
        width: '',
        height: '',
        scalePercent: 100,
        keepAspectRatio: true,
        withoutEnlargement: true,
        format: 'original',
        quality: 90,
        ...baseOutput
      } satisfies ResizeOptions
    case 'rotate':
      return {
        tool: 'rotate',
        rotateAngle: 90,
        flipHorizontal: false,
        flipVertical: false,
        format: 'original',
        quality: 90,
        ...baseOutput
      } satisfies RotateOptions
    case 'crop':
      return {
        tool: 'crop',
        cropMode: 'manual',
        cropRatioW: 1,
        cropRatioH: 1,
        cropLeft: 0.1,
        cropTop: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
        format: 'original',
        quality: 90,
        ...baseOutput
      } satisfies CropOptions
    case 'watermark':
      return {
        tool: 'watermark',
        watermarkType: 'text',
        watermarkText: 'Watermark',
        watermarkFontSize: 32,
        watermarkColor: '#ffffff',
        watermarkOpacity: 50,
        watermarkPosition: 'southeast',
        watermarkScale: 20,
        format: 'original',
        quality: 90,
        ...baseOutput
      } satisfies WatermarkOptions
    case 'style':
      return {
        tool: 'style',
        borderRadius: 0,
        borderWidth: 0,
        borderColor: '#333333',
        padding: 0,
        paddingColor: '#ffffff',
        paddingOpacity: 100,
        format: 'original',
        quality: 90,
        ...baseOutput
      } satisfies StyleOptions
    case 'merge':
      return {
        tool: 'merge',
        mergeMode: 'long-vertical',
        gifDelay: 500,
        format: 'jpeg',
        quality: 90,
        ...baseOutput,
        suffix: '_merged'
      } satisfies MergeOptions
    case 'rename':
      return {
        tool: 'rename',
        renameMode: 'sequence',
        prefix: 'image',
        startIndex: 1,
        padLength: 3,
        separator: '_',
        findText: '',
        replaceText: '',
        ...baseOutput,
        suffix: ''
      } satisfies RenameOptions
    default:
      return createDefaultOptions('compress')
  }
}

export function createDefaultOptionsMap(): Record<ToolId, ToolOptions> {
  return Object.fromEntries(TOOLS.map((item) => [item.id, createDefaultOptions(item.id)])) as Record<
    ToolId,
    ToolOptions
  >
}

export function getToolDefinition(tool: ToolId) {
  return TOOLS.find((item) => item.id === tool) ?? TOOLS[0]
}
