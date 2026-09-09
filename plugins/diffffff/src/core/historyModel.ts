/**
 * ============================================================================
 * 本地历史纯模型（roadmap 任务 INT-004）
 * ============================================================================
 *
 * 「已保存差异」历史的数据模型层：条目形状、去重入库、搜索过滤与标题推导
 * 四件套，全部为纯函数 / 纯类型 —— 零 UI、零 DOM、零 store 依赖（与
 * options.ts 同级的引擎层约束），持久化与 UI 交互分别归 stores/history.ts
 * 与 components/HistoryPanel.vue。
 *
 * 与参照实现（f-provider 的 useHistory）的分工差异：那边把「去重 / 截尾 /
 * id 生成」内联在组合式函数里无法单测；本工程沿用 core 纯模型可单测的惯例
 * （ENG-006 optionsKey、ENG-009 hunkAnchorRows 同风格），store 层只做编排。
 *
 * 去重键的组成（`pushHistoryItem`）：left 全文 + right 全文 +
 * `optionsKey(options)`（core/options.ts 的稳定选项键，含启用规则指纹）+
 * contextLines —— 与「本次对比的完整输入」一一对应：四元组全同即视为同一次
 * 对比的重复入库（实时对比连续触发、恢复历史后重算等场景），替换为新条目
 * 置顶；任一不同（哪怕只差一个选项开关）都是新条目。
 * ============================================================================
 */

import { optionsKey } from './options'
import type { DiffOptions, DiffStats } from './types'

/**
 * 单条历史记录（「已保存差异」）。
 *
 * 由 stores/history.ts 的 saveFromResult() 在对比成功后组装：
 * 输入文本（left / right）+ 生效选项（options）+ 上下文行数（contextLines）
 * + 统计（stats）+ 语言（language）+ 展示元数据（title / savedAt / id）。
 */
export interface HistoryItem {
  /** 稳定唯一 id（crypto.randomUUID()，宿主不可用时时间戳+随机数兜底）。 */
  id: string
  /** 展示标题（deriveHistoryTitle 产物：文件名对或左侧首非空行摘要）。 */
  title: string
  /** 入库时间戳（ms，Date.now()）。去重替换时更新为最新时间。 */
  savedAt: number
  /** 左侧（原始文本）完整输入，原样保留（BOM / 行尾符不动）。 */
  left: string
  /** 右侧（更改后文本）完整输入，原样保留。 */
  right: string
  /** 本次对比实际生效的选项快照（diffStore.lastOptions 同构，含规则列表）。 */
  options: DiffOptions
  /** 本次对比生效的 hunk 上下文行数（viewStore.contextLines 快照）。 */
  contextLines: number
  /** 本次对比的统计快照（+N / −M / ~K / hunk 数 / 总行数）。 */
  stats: DiffStats
  /** 本次对比生效的语言（viewStore.effectiveLanguage，'auto' 已解析为检测结果）。 */
  language: string
}

/** 最多保留的历史条数（超出自动淘汰最旧的，数组尾部）。 */
export const HISTORY_MAX_ITEMS = 100

/**
 * 无文件名对时的标题兜底文案：left 无任何非空行（空文本 / 全空白文本）时
 * deriveHistoryTitle 的返回值。
 */
export const UNTITLED_HISTORY_TEXT = '未命名对比'

/** 文件名对不存在时，标题摘要取 left 首非空行的最大字符数（超出截断加省略号）。 */
const TITLE_MAX_CHARS = 24

/** 标题摘要被截断时追加的省略号。 */
const TITLE_ELLIPSIS = '…'

/**
 * 计算一条历史记录的「去重身份键」：`optionsKey(options) + contextLines +
 * left + right` 按固定顺序拼接。
 *
 * 身份键是 INT-004 两个消费方的单一事实来源：
 * - `pushHistoryItem` 的去重判断；
 * - stores/history.ts 的写入节流（同键且距上次保存 <3s 的连续 run 跳过写盘，
 *   避免实时对比高频刷 storage）。
 *
 * optionsKey 不含 U+0000 与 `|`（core/options.ts 契约），contextLines 为
 * 十进制数字串，文本段放在最后 —— 段边界可从拼接结果无歧义分离，不同字段
 * 不会拼出同串。
 */
export function historyItemKey(
  item: Pick<HistoryItem, 'left' | 'right' | 'options' | 'contextLines'>,
): string {
  return `${optionsKey(item.options)}|${item.contextLines}|${item.left}|${item.right}`
}

/**
 * 入库一条历史记录（不可变更新）：
 *
 * - 去重：已有条目与 item 的「left + right + optionsKey(options) +
 *   contextLines」全同时，用 item（更新时间的最新条目）替换该位置之外整体
 *   置顶 —— 重复对比同一输入只保留一条且时间戳刷新；
 * - 否则插入头部（最新在前，列表按 savedAt 降序的约定由此维持）；
 * - 超出 max 条时从数组尾部截掉最旧的（默认 HISTORY_MAX_ITEMS，与
 *   f-provider 的 100 条上限惯例一致）。
 *
 * @param items 现有历史列表（只读，不修改入参）
 * @param item 待入库的新条目
 * @param max 条数上限（默认 HISTORY_MAX_ITEMS；非正数截为空数组）
 * @returns 新数组（原数组与其元素不被修改；item 以引用语义入列）
 */
export function pushHistoryItem(
  items: HistoryItem[],
  item: HistoryItem,
  max: number = HISTORY_MAX_ITEMS,
): HistoryItem[] {
  const identity = historyItemKey(item)
  // 去重命中即「替换 + 置顶」：过滤掉旧条目后把新条目放头部。
  const deduped = items.filter((it) => historyItemKey(it) !== identity)
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  return [item, ...deduped].slice(0, limit)
}

/**
 * 按关键字过滤历史列表（不区分大小写的子串匹配）。
 *
 * @param items 历史列表（只读）
 * @param query 搜索关键字：trim 后为空串视为无关键字，原样返回入参数组；
 *              否则对 title / left / right 任一字段含关键字（忽略大小写）
 *              的条目做过滤
 * @returns 过滤后的新数组（无关键字时为入参原引用）
 */
export function searchHistoryItems(items: HistoryItem[], query: string): HistoryItem[] {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') return items
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(keyword) ||
      item.left.toLowerCase().includes(keyword) ||
      item.right.toLowerCase().includes(keyword),
  )
}

/**
 * 推导历史条目的展示标题：
 *
 * 1. 两侧来源文件名【对】同时存在（均非空白）→ `nameA ↔ nameB`（trim 后
 *    原样使用；「对」同时存在才走此分支 —— 单侧文件名不足以建立「文件 ↔
 *    文件」的标题语义，按 spec 的「否则」分支回退内容摘要，该行为见下）；
 * 2. 否则取 left 的第一个非空行（trim 后非空白的首行），截断到
 *    TITLE_MAX_CHARS 个字符（按 Unicode 码点切分，不劈开代理对），超出时
 *    尾部追加省略号；
 * 3. left 无任何非空行（空文本 / 全空白）→ `UNTITLED_HISTORY_TEXT`。
 *
 * @param left 左侧文本（内容摘要来源）
 * @param right 右侧文本（当前不参与推导，入参保留以对齐调用点语义）
 * @param leftFileName 左侧来源文件名（'' / undefined = 无文件来源）
 * @param rightFileName 右侧来源文件名（'' / undefined = 无文件来源）
 * @returns 展示标题（恒非空串）
 */
export function deriveHistoryTitle(
  left: string,
  right: string,
  leftFileName?: string,
  rightFileName?: string,
): string {
  void right
  const nameA = typeof leftFileName === 'string' ? leftFileName.trim() : ''
  const nameB = typeof rightFileName === 'string' ? rightFileName.trim() : ''
  if (nameA !== '' && nameB !== '') {
    return `${nameA} ↔ ${nameB}`
  }

  // 内容摘要：取 left 首个「trim 后非空」的行。split 不带行尾符语义即可
  // （摘要只看行内可见内容，CRLF 的 \r 已被 trim 削平）。
  for (const line of left.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') {
      // 按码点截断：Array.from 展开为码点数组，避免 slice 按 UTF-16 码元
      // 劈开 emoji / 扩展区汉字产生乱码尾。
      const chars = Array.from(trimmed)
      if (chars.length <= TITLE_MAX_CHARS) return trimmed
      return chars.slice(0, TITLE_MAX_CHARS).join('') + TITLE_ELLIPSIS
    }
  }
  return UNTITLED_HISTORY_TEXT
}
