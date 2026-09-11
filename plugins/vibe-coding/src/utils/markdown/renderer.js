import { markRaw } from 'vue'
import { parseSettledMarkdown, parseStreamingMarkdown } from './parse.js'
import { collectReferenceTargets, createReferenceTargets } from './references.js'
import { renderMarkdownBlocks, renderMarkdownRoot } from './render.js'
import { createIncrementalMarkdownParser } from './incremental.js'

/**
 * 创建一个会话消息专用的 Markdown 渲染状态。
 * @returns {{render: (text: string, streaming: boolean) => Array<unknown>}} 消息级 Markdown 渲染器。
 */
export function createMarkdownRenderer() {
  const parser = createIncrementalMarkdownParser(parseStreamingMarkdown)
  let generation = -1
  let frozenVNodeCache = new Map()
  let lastText = null
  let lastResult = []

  /**
   * 重置流式状态，避免完成态或重试内容复用旧 VNode。
   * @returns {void} 无返回值。
   */
  function resetStreamingState() {
    generation = -1
    frozenVNodeCache = new Map()
    lastText = null
    lastResult = []
  }

  /**
   * 构建当前渲染帧可见的链接和脚注定义集合。
   * @param {Array<object>} frozen 冻结顶层块。
   * @param {Array<object>} tail 不稳定顶层块。
   * @returns {{definitions: Map<string, object>, footnotes: Map<string, object>}} 当前帧引用状态。
   */
  function buildReferenceTargets(frozen, tail) {
    const targets = createReferenceTargets()
    collectReferenceTargets(frozen.map((block) => block.node), targets)
    collectReferenceTargets(tail.map((block) => block.node), targets)
    return targets
  }

  /**
   * 以增量方式渲染仍在输出的 Markdown。
   * @param {string} text 当前完整 AI 文本。
   * @returns {Array<unknown>} 冻结 VNode 与尾部 VNode。
   */
  function renderStreaming(text) {
    if (text === lastText) return lastResult
    const result = parser.update(text)
    if (result.generation !== generation) {
      // 生成号变化说明文本发生了非追加更新，旧节点不能继续复用。
      generation = result.generation
      frozenVNodeCache = new Map()
    }

    const targets = buildReferenceTargets(result.frozen, result.tail)
    const context = { streaming: true, targets }
    const newlyFrozen = result.frozen.filter((block) => !frozenVNodeCache.has(block.key))
    if (newlyFrozen.length > 0) {
      // 冻结块只创建一次，后续 SSE 分片只更新尾部节点。
      for (const block of newlyFrozen) {
        const nodes = renderMarkdownBlocks([block], context)
        if (nodes[0]) frozenVNodeCache.set(block.key, markRaw(nodes[0]))
      }
    }

    const tailNodes = renderMarkdownBlocks(result.tail, context)
    lastText = text
    lastResult = result.frozen.map((block) => frozenVNodeCache.get(block.key)).filter(Boolean).concat(tailNodes)
    return lastResult
  }

  /**
   * 对完成态 Markdown 进行一次完整解析和渲染。
   * @param {string} text 已完成的 AI 文本。
   * @returns {Array<unknown>} 完整 Markdown VNode 列表。
   */
  function renderSettled(text) {
    const root = parseSettledMarkdown(text)
    const targets = createReferenceTargets()
    collectReferenceTargets(root.children || [], targets)
    const result = renderMarkdownRoot(root, { streaming: false, targets })
    resetStreamingState()
    return result
  }

  return {
    /**
     * 根据消息状态选择流式或完成态 Markdown 渲染路径。
     * @param {string} text 当前完整 AI 文本。
     * @param {boolean} streaming 是否仍处于流式输出。
     * @returns {Array<unknown>} Markdown VNode 列表。
     */
    render(text, streaming) {
      const source = String(text || '')
      return streaming ? renderStreaming(source) : renderSettled(source)
    },
  }
}
