/** 自动生成：请勿手工编辑。源文件 src/components/page/tool/sticky-notes/colors.js */
/* 由 scripts/gen-sticky-palette.js 在构建时生成（npm run gen:sticky-palette / npm run build） */
;(function (global) {
/**
 * 便签颜色调色板与颜色工具函数（单一数据源）
 *
 * 此文件不依赖 vue / naive-ui，可被主应用 store 与浮窗生成脚本共同引用。
 * 浮窗通过 scripts/gen-sticky-palette.js 生成 public/sticky-palette.js 引入。
 */

const NOTE_COLORS = [
  { id: 'butter', value: '#FFE566', soft: '#FFF6C2', name: '黄油' },
  { id: 'apricot', value: '#FFB86C', soft: '#FFE2C2', name: '杏橙' },
  { id: 'rose', value: '#FF8FAB', soft: '#FFD6E0', name: '玫瑰' },
  { id: 'mint', value: '#7DDEA8', soft: '#D4F5E4', name: '薄荷' },
  { id: 'sky', value: '#7EC8E3', soft: '#D4EFF8', name: '天空' },
  { id: 'lavender', value: '#B8A9E8', soft: '#E8E2F8', name: '薰衣草' },
  { id: 'sand', value: '#F5F0E8', soft: '#FAF8F4', name: '沙色' },
  { id: 'slate', value: '#CFD8DC', soft: '#ECEFF1', name: '青灰' },
  { id: 'ink', value: '#1f1f23', soft: '#2a2a30', name: '墨黑', dark: true },
]

/**
 * 判断颜色是否为深色（用于自动切换便签文字色）
 * 支持 #rgb / #rrggbb 格式
 */
function isDarkColor(hex) {
  if (!hex || typeof hex !== 'string') return false
  const m = hex.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (!m) return false
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  // 相对亮度（W3C 公式简化版）
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum < 0.5
}

/**
 * 根据便签纸色返回其柔色（soft），找不到则原样返回
 */
function softColor(bg) {
  const hit = NOTE_COLORS.find(c => c.value === bg)
  return hit ? hit.soft : bg
}

/**
 * hex → "r, g, b" 字符串（供 CSS 变量使用）
 */
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '255, 229, 102'
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ].join(', ')
}


  global.StickyPalette = {
    isDarkColor: isDarkColor,
    softColor: softColor,
    hexToRgb: hexToRgb,
    NOTE_COLORS: NOTE_COLORS
  }
})(typeof window !== 'undefined' ? window : globalThis)
