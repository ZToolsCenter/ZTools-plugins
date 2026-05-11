export const TOOLS = [
  { id: 'compression', label: '图片压缩', icon: 'compress', mode: 'preview', page: 'compression' },
  { id: 'format', label: '格式转换', icon: 'insert_drive_file', mode: 'preview', page: 'format' },
  { id: 'resize', label: '修改尺寸', icon: 'aspect_ratio', mode: 'preview', page: 'resize' },
  { id: 'watermark', label: '添加水印', icon: 'branding_watermark', mode: 'preview', page: 'watermark' },
  { id: 'corners', label: '添加圆角', icon: 'rounded_corner', mode: 'preview', page: 'corners' },
  { id: 'padding', label: '补边留白', icon: 'padding', mode: 'preview', page: 'padding' },
  { id: 'crop', label: '裁剪', icon: 'crop', mode: 'preview', page: 'crop' },
  { id: 'rotate', label: '旋转', icon: 'rotate_right', mode: 'preview', page: 'rotate' },
  { id: 'flip', label: '翻转', icon: 'flip', mode: 'preview', page: 'flip' },
  { id: 'merge-pdf', label: '合并为 PDF', icon: 'picture_as_pdf', mode: 'sort', page: 'mergePdf' },
  { id: 'merge-image', label: '合并为图片', icon: 'image', mode: 'sort', page: 'mergeImage' },
  { id: 'merge-gif', label: '合并为 GIF', icon: 'gif', mode: 'sort', page: 'mergeGif' },
  { id: 'manual-crop', label: '手动裁剪', icon: 'crop_free', mode: 'manual', page: 'manualCrop' },
]

export const DEFAULT_TOOL = TOOLS[0].id

export const TOOL_MAP = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool]))
