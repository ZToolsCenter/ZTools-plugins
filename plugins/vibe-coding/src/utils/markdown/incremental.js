const UNSTABLE_TAIL_BLOCKS = 2

/**
 * 计算顶层 Markdown 节点在完整原文中的稳定 key。
 * @param {Record<string, unknown>} node 顶层 mdast 节点。
 * @param {number} base 当前解析片段在完整原文中的起始偏移。
 * @param {number} index 节点在当前尾部中的下标。
 * @returns {number} 可用于 Vue key 的源码绝对偏移。
 */
function blockKey(node, base, index) {
  const offset = node?.position?.start?.offset
  return Number.isInteger(offset) ? base + offset : -(index + 1)
}

/**
 * 管理追加式 Markdown 流的冻结块和不稳定尾部。
 * @param {(text: string) => Record<string, unknown>} parse 使用的 Markdown 解析函数。
 * @returns {object} 包含 update 方法和当前流状态的增量解析器。
 */
export function createIncrementalMarkdownParser(parse) {
  let previousText = ''
  let tailStart = 0
  let generation = 0
  let frozen = []
  let cached = null

  return {
    /**
     * 更新追加式文本并返回冻结块与不稳定尾部。
     * @param {string} text 当前完整 Markdown 文本。
     * @returns {{frozen: Array<object>, tail: Array<object>, generation: number}} 增量解析结果。
     */
    update(text) {
      const source = String(text || '')
      if (cached && source === previousText) return cached

      // 非追加更新代表重试、停止后重建或会话切换，必须丢弃旧 AST 和 VNode 缓存。
      if (!source.startsWith(previousText)) {
        previousText = ''
        tailStart = 0
        generation += 1
        frozen = []
      }

      previousText = source
      const base = tailStart
      const parsed = parse(source.slice(base))
      const blocks = Array.isArray(parsed?.children) ? parsed.children : []
      let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS)

      // 没有位置时不能安全切割，宁可保守地重新保留完整尾部。
      const cutEnd = firstUnstable > 0 ? blocks[firstUnstable - 1]?.position?.end?.offset : undefined
      if (firstUnstable > 0 && !Number.isInteger(cutEnd)) firstUnstable = 0

      if (firstUnstable > 0) {
        // 只有解析器确认已经结束的块才进入冻结区。
        for (const node of blocks.slice(0, firstUnstable)) {
          frozen.push({ node, key: blockKey(node, base, frozen.length) })
        }
        tailStart = base + cutEnd
      }

      const tail = blocks.slice(firstUnstable).map((node, index) => ({
        node,
        key: blockKey(node, base, index),
      }))
      cached = { frozen: [...frozen], tail, generation }
      return cached
    },
  }
}
