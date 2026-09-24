/*
 * 「这一行要不要浮出详情」—— 纯判断，不碰 DOM，可以单独跑测试。
 *
 * 详情浮层是**浮在列表之上**的临时物：选中项一变就收掉，停稳之后再决定要不要给新的一行弹。
 * 所以判定必须保守 —— 一行能看全的短文本弹出来只是噪声，挡的还是后面的行。
 *
 * 三条规则：
 *   图片 —— 永远弹。列表里的缩略图只有 32×24，本来就只能看个大概。
 *   文本 —— 只有真被 CSS 截断了才弹（调用方拿 scrollWidth > clientWidth 实测，不猜字数）。
 *   文件 —— 多个文件必弹（要列全路径）；单个文件只在名字显示不全时才弹。
 *          （「文件已不存在」**不是**这里的判据 —— 那是行内的事：
 *           浮层里不存在的那条路径会变灰，见 App.vue 的 `.peek-files .gone`。）
 */

export type PeekKind = 'text' | 'image' | 'file'

/** 只要求结构上够用，不为一个纯函数去依赖宿主类型 */
export interface PeekTarget {
  type: 'text' | 'image' | 'file'
  files?: readonly unknown[]
}

export function peekKindOf(item: PeekTarget, truncated: boolean): PeekKind | null {
  if (item.type === 'image') return 'image'

  if (item.type === 'file') {
    // 没有 files 的记录弹出来是个空壳，不如不弹
    const count = item.files?.length ?? 0
    if (!count) return null
    return count > 1 || truncated ? 'file' : null
  }

  return truncated ? 'text' : null
}

/* ------------------------------------------------------------------ *
 * 「浮层摆在哪儿、多大」—— 也是纯算术，同样能单测
 * ------------------------------------------------------------------ */

/** 浮层与行之间的缝 */
export const PEEK_GAP = 6
/** 可用的空间比这还小就干脆不弹 */
export const PEEK_MIN = 88
/** 平时的限高；再长的内容在浮层里滚 */
export const PEEK_SOFT_MAX = 260

/** 只需要这几个量，`DOMRect` 结构上就满足，所以调用方直接把 rect 丢进来 */
export interface Rect {
  top: number
  bottom: number
  left: number
  width: number
}

export interface PeekGeom {
  /** 弹在行的下方还是翻到上方 */
  dir: 'down' | 'up'
  /**
   * 相对 `.root` 的偏移。`dir === 'down'` 时当 `top`、`'up'` 时当 `bottom` ——
   * 用 bottom 定位是为了不依赖浮层自己渲染完的高度（那段注释在 App.vue 的 `peekStyle`）。
   */
  offset: number
  left: number
  width: number
  /** 限高：内容再长也在浮层里滚 */
  maxH: number
}

/**
 * 算出浮层的落位和宽度。返回 `null` = 这块地方塞不下，干脆不弹。
 *
 * **宽度和左边距一律以「行」的矩形为准，绝不用 `.list` 的** —— 这是老大 09-16 抓到的 bug：
 * `.list` 的 `getBoundingClientRect()` 把 **7px 自绘滚动条**也算进宽度（`base.css` 里写了
 * `::-webkit-scrollbar { width: 7px }`，Chromium 里给滚动条写了样式就不再是 overlay 的、会真占布局），
 * 于是「list.width - 16」比行宽多出 7px，浮层右边一路顶到滚动条上 ——
 * 看着就是「右边填满了、左边还留着缝」，两边不对称。
 * 行宽本身就是这个内容区的准确宽度，拿它当尺子，浮层左右自然跟行对齐。
 *
 * 上下边界仍然用 `.list` 的：浮层不许越过列表的可视区域。
 */
export function peekGeom(row: Rect, list: Rect, root: Rect): PeekGeom | null {
  const below = list.bottom - row.bottom - PEEK_GAP
  const above = row.top - list.top - PEEK_GAP
  // 下方优先；下方不够就先看上方够不够，都不够就缩着放下方（宁可小，不要跳）
  const down = below >= PEEK_MIN || below >= above
  const room = down ? below : above
  if (room < PEEK_MIN) return null

  return {
    dir: down ? 'down' : 'up',
    offset: down ? row.bottom - root.top + PEEK_GAP : root.bottom - row.top + PEEK_GAP,
    left: row.left - root.left,
    width: row.width,
    maxH: Math.min(PEEK_SOFT_MAX, room)
  }
}
