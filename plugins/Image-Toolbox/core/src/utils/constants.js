/**
 * 常量定义
 */

// 画布默认配置
export const CANVAS_DEFAULTS = {
  WIDTH: 800,
  HEIGHT: 600,
  BACKGROUND_COLOR: '#d2d6d9',
  PRESERVE_OBJECT_STACKING: true,
  SELECTION: true,
  STOP_CONTEXT_MENU: true,
  FIRE_RIGHT_CLICK: true,
};

// 马赛克默认值
export const MOSAIC_DEFAULTS = {
  MODE: 'mosaic',
  DRAW_MODE: 'rect',
  MOSAIC_SIZE: 12,
  BLUR_RADIUS: 8,
  BRUSH_SIZE: 20,
  MIN_MOSAIC_SIZE: 2,
  MAX_MOSAIC_SIZE: 50,
  MIN_BLUR_RADIUS: 1,
  MAX_BLUR_RADIUS: 30,
  MIN_BRUSH_SIZE: 4,
  MAX_BRUSH_SIZE: 100,
};

// 文字默认样式
export const TEXT_DEFAULTS = {
  FONT_FAMILY: 'Microsoft YaHei, PingFang SC, sans-serif',
  FONT_SIZE: 24,
  FILL: '#d83b31',
  STROKE: null,
  STROKE_WIDTH: 0,
  FONT_WEIGHT: 'normal',
  FONT_STYLE: 'normal',
  TEXT_ALIGN: 'left',
};

// 历史记录
export const HISTORY_MAX_STEPS = 30;

// 缩放范围
export const ZOOM = {
  MIN: 0.1,
  MAX: 5.0,
  STEP: 0.1,
  DEFAULT: 1,
};

// 裁剪
export const CROP_DEFAULTS = {
  ASPECT_RATIO: null,
  SHAPE: 'rect',
};

// 裁剪比例预设
export const CROP_RATIOS = [
  { id: 'crop-ratio-free', w: null, h: null, label: '自由比例' },
  { id: 'crop-ratio-1-1', w: 1, h: 1, label: '1:1' },
  { id: 'crop-ratio-3-2', w: 3, h: 2, label: '3:2' },
  { id: 'crop-ratio-2-3', w: 2, h: 3, label: '2:3' },
  { id: 'crop-ratio-3-4', w: 3, h: 4, label: '3:4' },
  { id: 'crop-ratio-4-3', w: 4, h: 3, label: '4:3' },
  { id: 'crop-ratio-16-9', w: 16, h: 9, label: '16:9' },
  { id: 'crop-ratio-9-16', w: 9, h: 16, label: '9:16' },
];

// 文字预设样式
export const TEXT_PRESETS = {
  red: {
    fill: '#d83b31',
    fontWeight: 'bold',
    stroke: '#FFFFFF',
    strokeWidth: 2,
  },
  white: {
    fill: '#FFFFFF',
    fontWeight: 'normal',
    stroke: null,
    strokeWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  yellow: {
    fill: '#FFD700',
    fontWeight: 'bold',
    stroke: '#000000',
    strokeWidth: 2,
  },
};

// 支持的图片格式
export const SUPPORTED_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg'];

// 导出格式
export const EXPORT_FORMATS = {
  png: { label: 'PNG', mime: 'image/png', extension: 'png' },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', quality: true },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', quality: true },
};

// 工具分组
export const TOOL_GROUPS = {
  edit: '编辑工具',
  annotate: '标注工具',
  view: '视图工具',
  action: '操作',
};
