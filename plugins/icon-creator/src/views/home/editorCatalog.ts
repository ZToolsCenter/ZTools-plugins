import type { ColorPaletteGroup, GradientPresetItem } from './types'

export type ShapeId =
  | 'base-rectangle'
  | 'base-square'
  | 'base-circle'
  | 'base-line'
  | 'base-triangle'
  | 'base-inverted-triangle'
  | 'base-rhombus'
  | 'base-wide-cross'
  | 'base-parallelogram'
  | 'base-inverted-parallelogram'
  | 'base-trapezoid'
  | 'base-inverted-trapezoid'
  | 'base-doorway'
  | 'base-inverted-arch'
  | 'base-rotated-right-triangle'
  | 'base-half-moon'
  | 'base-pentagon'
  | 'base-hexagon'
  | 'base-octagon'
  | 'base-arrow-right'
  | 'base-solid-shaft-arrow'
  | 'base-double-solid-shaft-arrow'
  | 'base-star'
  | 'base-heart'

export type ShapeLibraryItem = {
  id: ShapeId
  label: string
  previewKind: string
  defaultWidth: number
  defaultHeight: number
}

export type TextLibraryItem = {
  id: string
  label: string
  text: string
  fontSize: number
  fontWeight?: string
}

export type IconTemplateItem = {
  id: string
  name: string
  category: string
  description: string
  width: number
  height: number
  background: string
  svg: string
}

export type CanvasPreset = {
  label: string
  value: string
  width: number
  height: number
}

const basicShapeItems: Array<Omit<ShapeLibraryItem, 'previewKind'>> = [
  { id: 'base-rectangle', label: '矩形', defaultWidth: 120, defaultHeight: 76 },
  { id: 'base-square', label: '正方形', defaultWidth: 96, defaultHeight: 96 },
  { id: 'base-circle', label: '圆形', defaultWidth: 96, defaultHeight: 96 },
  { id: 'base-line', label: '直线', defaultWidth: 120, defaultHeight: 2 },
  { id: 'base-triangle', label: '三角形', defaultWidth: 110, defaultHeight: 96 },
  { id: 'base-inverted-triangle', label: '倒三角形', defaultWidth: 110, defaultHeight: 96 },
  { id: 'base-rhombus', label: '菱形', defaultWidth: 100, defaultHeight: 100 },
  { id: 'base-wide-cross', label: '宽十字', defaultWidth: 100, defaultHeight: 100 },
  { id: 'base-parallelogram', label: '平行四边形', defaultWidth: 120, defaultHeight: 76 },
  { id: 'base-inverted-parallelogram', label: '反向平行四边形', defaultWidth: 120, defaultHeight: 76 },
  { id: 'base-trapezoid', label: '梯形', defaultWidth: 120, defaultHeight: 78 },
  { id: 'base-inverted-trapezoid', label: '倒梯形', defaultWidth: 120, defaultHeight: 78 },
  { id: 'base-doorway', label: '拱形', defaultWidth: 96, defaultHeight: 120 },
  { id: 'base-inverted-arch', label: '倒拱形', defaultWidth: 96, defaultHeight: 120 },
  { id: 'base-rotated-right-triangle', label: '直角三角形', defaultWidth: 100, defaultHeight: 100 },
  { id: 'base-half-moon', label: '半月形', defaultWidth: 110, defaultHeight: 78 },
  { id: 'base-pentagon', label: '五边形', defaultWidth: 104, defaultHeight: 100 },
  { id: 'base-hexagon', label: '六边形', defaultWidth: 110, defaultHeight: 96 },
  { id: 'base-octagon', label: '八边形', defaultWidth: 104, defaultHeight: 104 },
  { id: 'base-arrow-right', label: '箭头', defaultWidth: 118, defaultHeight: 70 },
  { id: 'base-solid-shaft-arrow', label: '空心箭头', defaultWidth: 120, defaultHeight: 78 },
  { id: 'base-double-solid-shaft-arrow', label: '双向箭头', defaultWidth: 120, defaultHeight: 78 },
  { id: 'base-star', label: '五角星', defaultWidth: 110, defaultHeight: 104 },
  { id: 'base-heart', label: '心形', defaultWidth: 108, defaultHeight: 96 }
]

export const basicShapes: ShapeLibraryItem[] = basicShapeItems.map((item) => ({
  ...item,
  previewKind: item.id.replace('base-', '')
}))

export const shapePreviewPaths: Record<ShapeId, string> = {
  'base-rectangle': 'M 8 20 H 56 V 44 H 8 Z',
  'base-square': 'M 14 14 H 50 V 50 H 14 Z',
  'base-circle': 'M 32 14 A 18 18 0 1 1 31.9 14 Z',
  'base-line': 'M 10 32 H 54',
  'base-triangle': 'M 32 10 L 54 54 H 10 Z',
  'base-inverted-triangle': 'M 10 10 H 54 L 32 54 Z',
  'base-rhombus': 'M 32 8 L 56 32 L 32 56 L 8 32 Z',
  'base-wide-cross': 'M 25 8 H 39 V 25 H 56 V 39 H 39 V 56 H 25 V 39 H 8 V 25 H 25 Z',
  'base-parallelogram': 'M 18 20 H 56 L 46 44 H 8 Z',
  'base-inverted-parallelogram': 'M 8 20 H 46 L 56 44 H 18 Z',
  'base-trapezoid': 'M 20 20 H 44 L 56 44 H 8 Z',
  'base-inverted-trapezoid': 'M 8 20 H 56 L 44 44 H 20 Z',
  'base-doorway': 'M 14 56 V 32 A 18 18 0 0 1 50 32 V 56 Z',
  'base-inverted-arch': 'M 14 8 H 50 V 32 A 18 18 0 0 1 14 32 Z',
  'base-rotated-right-triangle': 'M 12 12 L 52 52 H 12 Z',
  'base-half-moon': 'M 32 14 C 46 14 54 30 54 50 H 10 C 10 30 18 14 32 14 Z',
  'base-pentagon': 'M 32 8 L 55 26 L 46 56 H 18 L 9 26 Z',
  'base-hexagon': 'M 32 8 L 54 20 L 54 44 L 32 56 L 10 44 L 10 20 Z',
  'base-octagon': 'M 20 8 H 44 L 56 20 V 44 L 44 56 H 20 L 8 44 V 20 Z',
  'base-arrow-right': 'M 10 32 H 52 M 52 32 L 40 20 M 52 32 L 40 44',
  'base-solid-shaft-arrow': 'M 8 24 H 38 V 14 L 56 32 L 38 50 V 40 H 8 Z',
  'base-double-solid-shaft-arrow': 'M 8 32 L 24 14 V 24 H 40 V 14 L 56 32 L 40 50 V 40 H 24 V 50 Z',
  'base-star': 'M 32 8 L 38 25 H 56 L 42 36 L 48 54 L 32 43 L 16 54 L 22 36 L 8 25 H 26 Z',
  'base-heart': 'M 32 54 C 16 40 8 32 8 22 C 8 14 14 10 21 10 C 26 10 30 13 32 18 C 34 13 38 10 43 10 C 50 10 56 14 56 22 C 56 32 48 40 32 54 Z'
}

export const textPresets: TextLibraryItem[] = [
  {
    id: 'display',
    label: '特大标题',
    text: '特大标题',
    fontSize: 56,
    fontWeight: '800'
  },
  {
    id: 'title',
    label: '标题',
    text: '输入标题',
    fontSize: 42,
    fontWeight: '700'
  },
  {
    id: 'subtitle',
    label: '副标题',
    text: '副标题',
    fontSize: 32,
    fontWeight: '600'
  },
  {
    id: 'body',
    label: '正文',
    text: '输入文字',
    fontSize: 24,
    fontWeight: '500'
  },
  {
    id: 'body-small',
    label: '小正文',
    text: '正文内容',
    fontSize: 20,
    fontWeight: '400'
  },
  {
    id: 'caption',
    label: '注释',
    text: '辅助说明',
    fontSize: 18,
    fontWeight: '400'
  },
  {
    id: 'label',
    label: '标签',
    text: '标签',
    fontSize: 16,
    fontWeight: '600'
  },
  {
    id: 'button-text',
    label: '按钮文字',
    text: '按钮',
    fontSize: 18,
    fontWeight: '600'
  }
]

export const canvasPresets: CanvasPreset[] = [
  {
    label: '512×512',
    value: '512x512',
    width: 512,
    height: 512
  },
  {
    label: '256×256',
    value: '256x256',
    width: 256,
    height: 256
  },
  {
    label: '128×128',
    value: '128x128',
    width: 128,
    height: 128
  },
  {
    label: '64×64',
    value: '64x64',
    width: 64,
    height: 64
  },
  {
    label: '32×32',
    value: '32x32',
    width: 32,
    height: 32
  }
]

export const colorPaletteGroups: ColorPaletteGroup[] = [
  {
    id: 'brand',
    name: '品牌色',
    colors: [
      { id: 'brand-blue', name: '品牌蓝', color: '#2563eb' },
      { id: 'brand-cyan', name: '清爽青', color: '#06b6d4' },
      { id: 'brand-violet', name: '品牌紫', color: '#7c3aed' },
      { id: 'brand-pink', name: '活力粉', color: '#ec4899' },
      { id: 'brand-orange', name: '暖橙', color: '#f97316' },
      { id: 'brand-lime', name: '荧光绿', color: '#84cc16' }
    ]
  },
  {
    id: 'neutral',
    name: '中性色',
    colors: [
      { id: 'neutral-950', name: '深墨', color: '#030712' },
      { id: 'neutral-800', name: '标题灰', color: '#1f2937' },
      { id: 'neutral-500', name: '正文灰', color: '#6b7280' },
      { id: 'neutral-300', name: '边框灰', color: '#d1d5db' },
      { id: 'neutral-100', name: '浅底灰', color: '#f3f4f6' },
      { id: 'neutral-white', name: '纯白', color: '#ffffff' }
    ]
  },
  {
    id: 'status',
    name: '状态色',
    colors: [
      { id: 'status-success', name: '成功', color: '#22c55e' },
      { id: 'status-info', name: '信息', color: '#0ea5e9' },
      { id: 'status-warning', name: '警告', color: '#f59e0b' },
      { id: 'status-danger', name: '错误', color: '#ef4444' },
      { id: 'status-muted', name: '禁用', color: '#94a3b8' },
      { id: 'status-focus', name: '强调', color: '#a855f7' }
    ]
  },
  {
    id: 'chinese-traditional',
    name: '中国传统色',
    colors: [
      { id: 'chinese-vermillion', name: '朱红', color: '#ff4e50' },
      { id: 'chinese-azure', name: '天青', color: '#4a90e2' },
      { id: 'chinese-emerald', name: '翠绿', color: '#00a86b' },
      { id: 'chinese-golden', name: '金黄', color: '#f8b500' },
      { id: 'chinese-ink', name: '墨色', color: '#2c3e50' },
      { id: 'chinese-rose', name: '胭脂', color: '#c91f37' },
      { id: 'chinese-purple', name: '紫罗兰', color: '#7b68ee' },
      { id: 'chinese-cyan', name: '青碧', color: '#2db7b5' },
      { id: 'chinese-orange', name: '橘黄', color: '#ff8c00' },
      { id: 'chinese-jade', name: '玉色', color: '#66cdaa' }
    ]
  }
]

export const gradientPresets: GradientPresetItem[] = [
  {
    id: 'gradient-ocean-blue',
    name: '海洋蓝',
    type: 'linear',
    angle: 45,
    stops: [
      { color: '#22d3ee', offset: 0 },
      { color: '#2563eb', offset: 1 }
    ]
  },
  {
    id: 'gradient-violet-glow',
    name: '紫光',
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#c084fc', offset: 0 },
      { color: '#7c3aed', offset: 0.55 },
      { color: '#312e81', offset: 1 }
    ]
  },
  {
    id: 'gradient-sunset',
    name: '日落橙',
    type: 'linear',
    angle: 35,
    stops: [
      { color: '#facc15', offset: 0 },
      { color: '#fb7185', offset: 0.55 },
      { color: '#7c2d12', offset: 1 }
    ]
  },
  {
    id: 'gradient-mint',
    name: '薄荷绿',
    type: 'linear',
    angle: 25,
    stops: [
      { color: '#86efac', offset: 0 },
      { color: '#14b8a6', offset: 1 }
    ]
  },
  {
    id: 'gradient-radial-focus',
    name: '中心高光',
    type: 'radial',
    centerX: 0.42,
    centerY: 0.36,
    radius: 0.7,
    stops: [
      { color: '#ffffff', offset: 0 },
      { color: '#60a5fa', offset: 0.42 },
      { color: '#1d4ed8', offset: 1 }
    ]
  },
  {
    id: 'gradient-radial-badge',
    name: '徽章暗角',
    type: 'radial',
    centerX: 0.35,
    centerY: 0.3,
    radius: 0.85,
    stops: [
      { color: '#fef3c7', offset: 0 },
      { color: '#f97316', offset: 0.55 },
      { color: '#9a3412', offset: 1 }
    ]
  },
  {
    id: 'gradient-fire',
    name: '火焰',
    type: 'linear',
    angle: 180,
    stops: [
      { color: '#fef08a', offset: 0 },
      { color: '#fb923c', offset: 0.4 },
      { color: '#dc2626', offset: 1 }
    ]
  },
  {
    id: 'gradient-emerald',
    name: '翡翠',
    type: 'linear',
    angle: 90,
    stops: [
      { color: '#34d399', offset: 0 },
      { color: '#059669', offset: 1 }
    ]
  },
  {
    id: 'gradient-purple-pink',
    name: '紫粉',
    type: 'linear',
    angle: 315,
    stops: [
      { color: '#a78bfa', offset: 0 },
      { color: '#ec4899', offset: 1 }
    ]
  },
  {
    id: 'gradient-metallic-silver',
    name: '金属银',
    type: 'linear',
    angle: 90,
    stops: [
      { color: '#f8fafc', offset: 0 },
      { color: '#cbd5e1', offset: 0.5 },
      { color: '#64748b', offset: 1 }
    ]
  },
  {
    id: 'gradient-metallic-gold',
    name: '金属金',
    type: 'linear',
    angle: 90,
    stops: [
      { color: '#fef3c7', offset: 0 },
      { color: '#fbbf24', offset: 0.5 },
      { color: '#b45309', offset: 1 }
    ]
  },
  {
    id: 'gradient-cool-breeze',
    name: '清风',
    type: 'linear',
    angle: 45,
    stops: [
      { color: '#dbeafe', offset: 0 },
      { color: '#67e8f9', offset: 0.5 },
      { color: '#06b6d4', offset: 1 }
    ]
  },
  {
    id: 'gradient-warm-flame',
    name: '暖阳',
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#fef9c3', offset: 0 },
      { color: '#fdba74', offset: 0.5 },
      { color: '#f97316', offset: 1 }
    ]
  },
  {
    id: 'gradient-dark-purple',
    name: '深紫',
    type: 'linear',
    angle: 180,
    stops: [
      { color: '#5b21b6', offset: 0 },
      { color: '#1e1b4b', offset: 1 }
    ]
  }
]

export const iconTemplates: IconTemplateItem[] = [
  {
    id: 'app-icon-rounded-square',
    name: 'App Icon 圆角底板',
    category: 'App Icon',
    description: '圆角渐变底板搭配中心符号，适合快速制作应用入口图标。',
    width: 512,
    height: 512,
    background: 'transparent',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="app-bg" x1="96" y1="72" x2="416" y2="440" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5ee7ff" />
      <stop offset="1" stop-color="#2563eb" />
    </linearGradient>
    <linearGradient id="app-mark" x1="176" y1="144" x2="336" y2="368" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#dbeafe" />
    </linearGradient>
  </defs>
  <rect x="72" y="72" width="368" height="368" rx="92" fill="url(#app-bg)" />
  <path d="M256 136 L352 312 H304 L286 276 H226 L208 312 H160 L256 136 Z M242 238 H270 L256 208 Z" fill="url(#app-mark)" />
  <circle cx="348" cy="160" r="34" fill="#ffffff" opacity="0.28" />
</svg>`
  },
  {
    id: 'icon-editor-ic-app-icon',
    name: 'IC 应用图标模板',
    category: 'App Icon',
    description: '以 App Icon 圆角底板为原型，搭配流畅的 IC 字母标识和柔和高光，富有现代感的设计风格。',
    width: 512,
    height: 512,
    background: 'transparent',
    svg: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <desc>
    Created with Fabric.js 7.3.1
  </desc>
  <defs/>
  <g transform="matrix(1.3875 0 0 1.3875 256 256)">
    <g>
      <g transform="matrix(1 0 0 1 0 0)">
        <linearGradient id="SVGID_20" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 1 -256 -256)" x1="96" y1="72" x2="416" y2="440">
          <stop offset="0%" style="stop-color:rgba(103,232,249,1);"/>
          <stop offset="48%" style="stop-color:rgba(59,130,246,1);"/>
          <stop offset="100%" style="stop-color:rgba(49,46,129,1);"/>
        </linearGradient>
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: url(#SVGID_20); fill-rule: nonzero; opacity: 1;" x="-184" y="-184" rx="92" ry="92" width="368" height="368"/>
      </g>
      <g transform="matrix(1 0 0 1 96 -100)">
        <circle style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(255,255,255); fill-rule: nonzero; opacity: 0.22;" cx="0" cy="0" r="42"/>
      </g>
      <g transform="matrix(1 0 0 1 -106 104)">
        <circle style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(34,211,238); fill-rule: nonzero; opacity: 0.18;" cx="0" cy="0" r="72"/>
      </g>
      <g transform="matrix(1 0 0 1 -7.9496 1.1425)">
        <path style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(255,255,255); fill-rule: nonzero; opacity: 0.08;" transform=" translate(-248.0504, -257.1425)" d="M 112 168 C 148 104 232 92 308 116 C 378 138 412 202 398 272 C 388 324 350 378 290 400 C 218 426 132 400 108 322 C 92 270 88 212 112 168 Z" stroke-linecap="round"/>
      </g>
      <g transform="matrix(1 0 0 1 0 0)">
        <rect style="stroke: rgb(255,255,255); stroke-width: 6; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: none; fill-rule: nonzero; opacity: 0.2;" x="-168" y="-168" rx="82" ry="82" width="336" height="336"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 -69)">
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(15,23,42); fill-rule: nonzero; opacity: 0.16;" x="-39" y="-15" rx="15" ry="15" width="78" height="30"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 12)">
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(15,23,42); fill-rule: nonzero; opacity: 0.16;" x="-15" y="-92" rx="15" ry="15" width="30" height="184"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 93)">
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(15,23,42); fill-rule: nonzero; opacity: 0.16;" x="-39" y="-15" rx="15" ry="15" width="78" height="30"/>
      </g>
      <g transform="matrix(1 0 0 1 51.5 12)">
        <path style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(15,23,42); fill-rule: nonzero; opacity: 0.16;" transform=" translate(-307.5, -256)" d="M 325 176 L 355 176 C 363.2843 176 370 182.7157 370 191 C 370 199.2843 363.2843 206 355 206 L 325 206 C 297.3858 206 275 228.3858 275 256 C 275 283.6142 297.3858 306 325 306 L 355 306 C 363.2843 306 370 312.7157 370 321 C 370 329.2843 363.2843 336 355 336 L 325 336 C 280.8172 336 245 300.1828 245 256 C 245 211.8172 280.8172 176 325 176 Z" stroke-linecap="round"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 -81)">
        <linearGradient id="SVGID_21" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 1 -181 -175)" x1="168" y1="148" x2="352" y2="356">
          <stop offset="0%" style="stop-color:rgba(255,255,255,1);"/>
          <stop offset="57.99999999999999%" style="stop-color:rgba(239,246,255,1);"/>
          <stop offset="100%" style="stop-color:rgba(191,219,254,1);"/>
        </linearGradient>
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: url(#SVGID_21); fill-rule: nonzero; opacity: 1;" x="-39" y="-15" rx="15" ry="15" width="78" height="30"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 0)">
        <linearGradient id="SVGID_22" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 1 -181 -256)" x1="168" y1="148" x2="352" y2="356">
          <stop offset="0%" style="stop-color:rgba(255,255,255,1);"/>
          <stop offset="57.99999999999999%" style="stop-color:rgba(239,246,255,1);"/>
          <stop offset="100%" style="stop-color:rgba(191,219,254,1);"/>
        </linearGradient>
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: url(#SVGID_22); fill-rule: nonzero; opacity: 1;" x="-15" y="-92" rx="15" ry="15" width="30" height="184"/>
      </g>
      <g transform="matrix(1 0 0 1 -75 81)">
        <linearGradient id="SVGID_23" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 1 -181 -337)" x1="168" y1="148" x2="352" y2="356">
          <stop offset="0%" style="stop-color:rgba(255,255,255,1);"/>
          <stop offset="57.99999999999999%" style="stop-color:rgba(239,246,255,1);"/>
          <stop offset="100%" style="stop-color:rgba(191,219,254,1);"/>
        </linearGradient>
        <rect style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: url(#SVGID_23); fill-rule: nonzero; opacity: 1;" x="-39" y="-15" rx="15" ry="15" width="78" height="30"/>
      </g>
      <g transform="matrix(1.1468 0 0 1.1863 49.25 3)">
        <linearGradient id="SVGID_24" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 1 0 0)" x1="168" y1="148" x2="352" y2="356">
          <stop offset="0%" style="stop-color:rgba(255,255,255,1);"/>
          <stop offset="57.99999999999999%" style="stop-color:rgba(239,246,255,1);"/>
          <stop offset="100%" style="stop-color:rgba(191,219,254,1);"/>
        </linearGradient>
        <path style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: url(#SVGID_24); fill-rule: nonzero; opacity: 1;" transform=" translate(-307.5, -256)" d="M 325 176 L 355 176 C 363.2843 176 370 182.7157 370 191 C 370 199.2843 363.2843 206 355 206 L 325 206 C 297.3858 206 275 228.3858 275 256 C 275 283.6142 297.3858 306 325 306 L 355 306 C 363.2843 306 370 312.7157 370 321 C 370 329.2843 363.2843 336 355 336 L 325 336 C 280.8172 336 245 300.1828 245 256 C 245 211.8172 280.8172 176 325 176 Z" stroke-linecap="round"/>
      </g>
    </g>
  </g>
</svg>
`
  },
  {
    id: 'favicon-letter-mark',
    name: 'Favicon 字母标识',
    category: 'Favicon',
    description: '高对比单字母标识，保留粗边界和安全留白，便于 16px 小尺寸识别。',
    width: 256,
    height: 256,
    background: 'transparent',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="32" y="32" width="192" height="192" rx="48" fill="#111827" />
  <path d="M82 180 L128 64 L174 180 H142 L134 154 H122 L114 180 H82 Z M126 132 H130 L128 126 Z" fill="#f9fafb" />
  <rect x="64" y="198" width="128" height="14" rx="7" fill="#38bdf8" />
</svg>`
  },
  {
    id: 'status-success-badge',
    name: '状态成功徽章',
    category: '状态图标',
    description: '圆形状态徽章和对勾结构，可快速改色为成功、警告或错误状态。',
    width: 512,
    height: 512,
    background: 'transparent',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="184" fill="#22c55e" />
  <circle cx="256" cy="256" r="136" fill="#ffffff" opacity="0.16" />
  <path d="M168 264 L226 322 L352 190" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" />
</svg>`
  },
  {
    id: 'badge-notification',
    name: '通知徽章模板',
    category: '徽章',
    description: '主体图形叠加右上角提示点，适合制作消息、提醒或角标图标。',
    width: 512,
    height: 512,
    background: 'transparent',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="92" y="132" width="328" height="248" rx="54" fill="#4f46e5" />
  <path d="M148 204 H320 M148 256 H278 M148 308 H224" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" />
  <circle cx="386" cy="142" r="58" fill="#ef4444" stroke="#ffffff" stroke-width="22" />
</svg>`
  },
  {
    id: 'file-type-document',
    name: '文件类型图标',
    category: '文件类型',
    description: '带折角的文件底板和可替换扩展名区域，适合制作不同文件格式图标。',
    width: 512,
    height: 512,
    background: 'transparent',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M136 64 H300 L392 156 V448 H136 Z" fill="#e0f2fe" stroke="#0284c7" stroke-width="18" stroke-linejoin="round" />
  <path d="M300 64 V156 H392" fill="#bae6fd" stroke="#0284c7" stroke-width="18" stroke-linejoin="round" />
  <rect x="172" y="300" width="168" height="64" rx="18" fill="#0284c7" />
  <path d="M196 342 H316" stroke="#ffffff" stroke-width="20" stroke-linecap="round" />
  <path d="M188 220 H324 M188 260 H292" stroke="#0f172a" stroke-width="20" stroke-linecap="round" opacity="0.5" />
</svg>`
  }
]
