import type { Category } from '../types'
import { CAT_ICONS } from './icons'

export interface CatDef {
  key: Category
  label: string
  /** 未定义表示"中性"（如"全部"不是一种内容类型） */
  color?: string
  /** 图标资源 URL（PNG 素材，见 utils/icons.ts） */
  icon: string
}

/**
 * 侧栏分类。
 *
 * 图标是 20px 显示的，两个分类的图标一旦长得像（比如都是几条横线），
 * 用户根本分不出来 —— "全部"和"文本"就撞过一次。
 * 现在图标统一来自共享图标库的彩色字形素材（utils/icons.ts），
 * 图形本身两两不同；design/check-cats.mts 直接解 PNG 比像素，仍会断言它们不重复。
 */
export const CATS: CatDef[] = [
  { key: 'all', label: '全部', icon: CAT_ICONS.all },
  { key: 'text', label: '文本', color: 'var(--c-text)', icon: CAT_ICONS.text },
  { key: 'link', label: '链接', color: 'var(--c-link)', icon: CAT_ICONS.link },
  { key: 'code', label: '代码', color: 'var(--c-code)', icon: CAT_ICONS.code },
  { key: 'color', label: '颜色', color: 'var(--c-color)', icon: CAT_ICONS.color },
  { key: 'image', label: '图片', color: 'var(--c-image)', icon: CAT_ICONS.image },
  { key: 'file', label: '文件', color: 'var(--c-file)', icon: CAT_ICONS.file },
  { key: 'star', label: '收藏', color: 'var(--star)', icon: CAT_ICONS.star }
]
