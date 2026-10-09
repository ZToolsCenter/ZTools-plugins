import type { ClipboardRecord } from '../types'
import { CODE_MAX_LINES, codeLinesOf as codeLinesShown, codeLines as splitCode } from './code'

/**
 * 列表度量：文本类行固定紧凑高度，图片类行按真实宽高比撑开。
 * 目的是让图片"一眼看清内容"，同时不影响文本行的扫视效率。
 */

/** 文本类行的高度（不含行间距） */
export const ROW_H_TEXT = 72

/** 相邻行之间的间距 */
export const ROW_GAP = 6

/**
 * 文件行：每个文件独占一行（文件名 + 完整路径 + 定位按钮）。
 * 文件记录多为 1~3 个文件，逐行列出才能看清路径；再多就折叠。
 */
export const FILE_LINE_H = 34
/** 文件卡片的上下内边距 */
export const FILE_CARD_PAD = 10
/** 最多列出几个文件，其余折叠成一行"还有 N 个" */
export const FILE_MAX_LINES = 4
/** 折叠提示行的高度 */
export const FILE_MORE_H = 18

/**
 * 代码行：代码块用等宽字体逐行展示，行高必须与 CodeCard 的 CSS 一致，
 * 否则虚拟列表算出的总高度会和真实 DOM 对不上（滚动条跳、底部留白）。
 */
export const CODE_LINE_H = 19
/** 代码块的内边距（上下） */
export const CODE_BLOCK_PAD = 6
/**
 * 代码块边框宽度。DOM 的 offsetHeight **包含边框**，
 * 不计这一项行高就会比真实高度少 2px（实测：need - row 从 -6 变成 -4）。
 */
export const CODE_BLOCK_BORDER = 1
/** 卡片上下留白（语言条 / 时间行之外的呼吸空间） */
export const CODE_CARD_PAD = 6
/** 单行代码块的最小高度：贴近普通文本行，混排时不会显得忽高忽低 */
export const CODE_MIN_H = 64
/** 折叠提示行（"还有 N 行"）的高度 */
export const CODE_MORE_H = 18
/** 语言标签那一行元信息条的高度 */
export const CODE_META_H = 16
/** 元信息条与代码块之间的间距 */
export const CODE_META_GAP = 4

/**
 * 图片缩放档位。
 *   min     —— 最小高度，避免超宽图被压成一条线
 *   ratio   —— 高度上限占视口高度的比例（图片最多占屏多少）
 *   hardMax —— 绝对上限，防止超长屏幕上图片过大
 * 上限同时受视口高度约束：窗口小的时候图片也自动变小，
 * 这样任何窗口尺寸下一屏都至少能看到一张半图。
 */
export const IMG_SCALES = {
  /** 紧凑：混排浏览用，图片与文本行高度差距不大 */
  sm: { min: 80, ratio: 0.30, hardMax: 200, label: '紧凑' },
  /** 标准：默认，兼顾图片清晰度与一屏可看条数 */
  md: { min: 120, ratio: 0.55, hardMax: 360, label: '标准' },
  /** 大图：专注看细节 */
  lg: { min: 180, ratio: 0.82, hardMax: 620, label: '大图' }
} as const

export type ImgScale = keyof typeof IMG_SCALES

export const IMG_SCALE_ORDER: ImgScale[] = ['sm', 'md', 'lg']

/** 图片区之外占掉的水平空间：列表容器 padding + 卡片 padding */
const CHROME_W = 40

/** 宿主未提供分辨率时的兜底比例（中性 3:2，不至于出现极端长条） */
const DEFAULT_RATIO = 3 / 2

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 当前档位下的高度上限（取整，避免浮点尾差造成亚像素行高） */
export function maxHeightOf(scale: ImgScale, viewportH: number): number {
  const s = IMG_SCALES[scale]
  return Math.round(Math.max(s.min, Math.min(s.hardMax, viewportH * s.ratio)))
}

/** 宿主提供的真实宽高比；未提供时返回 null（不要拿兜底值假装知道比例） */
export function ratioOf(r: ClipboardRecord): number | null {
  const m = r.resolution?.match(/^(\d+)\s*\*\s*(\d+)$/)
  if (m) {
    const w = Number(m[1])
    const h = Number(m[2])
    if (w > 0 && h > 0) return w / h
  }
  return null
}

/** 用于行高计算的宽高比（未知时用中性兜底值，保证行高可预算） */
export function imageRatio(r: ClipboardRecord): number {
  return ratioOf(r) ?? DEFAULT_RATIO
}

/** 文件记录里的路径列表（content 作为单文件时的兜底） */
export function filePathsOf(r: ClipboardRecord): string[] {
  const list = r.files?.filter(Boolean)
  if (list && list.length) return list
  return r.content ? [r.content] : []
}

/** 文件行实际渲染的文件行数（超过上限的折叠成一行提示） */
export function fileLinesOf(r: ClipboardRecord): number {
  return Math.min(Math.max(filePathsOf(r).length, 1), FILE_MAX_LINES)
}

/** 文件行的高度（含行间距）：与 FileCard 的行高定义严格一致 */
export function fileRowHeight(r: ClipboardRecord): number {
  const n = filePathsOf(r).length
  const lines = Math.min(Math.max(n, 1), FILE_MAX_LINES)
  const more = n > FILE_MAX_LINES ? FILE_MORE_H : 0
  return FILE_CARD_PAD * 2 + lines * FILE_LINE_H + more + ROW_GAP
}

/** 代码记录实际渲染的代码行数（超过上限的折叠成一行提示） */
export function codeRowLines(r: ClipboardRecord): number {
  return codeLinesShown(r)
}

/** 代码行的高度（含行间距）：与 CodeCard 的排版严格一致 */
export function codeRowHeight(r: ClipboardRecord): number {
  const total = splitCode(r.content).length
  const shown = Math.min(Math.max(total, 1), CODE_MAX_LINES)
  const more = total > CODE_MAX_LINES ? CODE_MORE_H : 0
  const body = (CODE_BLOCK_PAD + CODE_BLOCK_BORDER) * 2 + shown * CODE_LINE_H + more
  return Math.round(
    Math.max(
      CODE_MIN_H,
      CODE_CARD_PAD * 2 + CODE_META_H + CODE_META_GAP + body
    ) + ROW_GAP
  )
}

/** 该记录的行高（含行间距） */
export function rowHeightOf(
  r: ClipboardRecord,
  availWidth: number,
  scale: ImgScale,
  viewportH = 600
): number {
  if (r.kind === 'file') return fileRowHeight(r)
  if (r.kind === 'code') return codeRowHeight(r)
  if (r.kind !== 'image') return ROW_H_TEXT + ROW_GAP

  const { min } = IMG_SCALES[scale]
  const max = maxHeightOf(scale, viewportH)
  const w = Math.max(60, availWidth - CHROME_W)
  return Math.round(clamp(w / imageRatio(r), min, max) + ROW_GAP)
}

/** 分辨率文案 "1920 * 1080" → "1920×1080" */
export function resolutionText(resolution?: string): string {
  const m = resolution?.match(/^(\d+)\s*\*\s*(\d+)$/)
  return m ? `${m[1]}×${m[2]}` : ''
}

export { ROW_H_TEXT as ROW_H_BASE }
