const FENCED_CODE_PATTERN = /(^|\n)([ \t]*)(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n[ \t]*\3[ \t]*(?=\n|$)|$)/g
const INLINE_CODE_PATTERN = /(`+)([^`\n]*?)\1/g
const CODE_LATEX_DELIMITERS = [
  ['\\[', '\uE100'],
  ['\\]', '\uE101'],
  ['\\(', '\uE102'],
  ['\\)', '\uE103'],
]
const FENCE_START_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/
const LIST_START_PATTERN = /^[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+/
const LIST_CONTINUATION_PATTERN = /^(?:[ \t]{2,}|\t)\S/
const BLOCKQUOTE_START_PATTERN = /^[ \t]{0,3}>/

/**
 * 统计一行中未转义的块级公式定界符数量，忽略行内代码中的同名字符。
 * @param {string} line 待检查的 Markdown 行。
 * @returns {number} 未转义 `$$` 定界符数量。
 */
function countBlockMathDelimiters(line) {
  let count = 0
  let inlineFenceLength = 0
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] === '`') {
      let runLength = 1
      while (line[index + runLength] === '`') runLength += 1
      inlineFenceLength = inlineFenceLength === 0 ? runLength : (inlineFenceLength === runLength ? 0 : inlineFenceLength)
      index += runLength - 1
      continue
    }
    if (inlineFenceLength > 0 || line[index] !== '$' || line[index + 1] !== '$') continue
    let escapeCount = 0
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) escapeCount += 1
    if (escapeCount % 2 === 0) count += 1
    index += 1
  }
  return count
}

/**
 * 判断代码围栏行是否关闭当前围栏。
 * @param {string} line 待检查的 Markdown 行。
 * @param {{ marker: string, length: number }} fence 当前围栏信息。
 * @returns {boolean} 当前行是否为匹配的关闭围栏。
 */
function isClosingFence(line, fence) {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== fence.marker) return false
  let markerLength = 0
  while (trimmed[markerLength] === fence.marker) markerLength += 1
  return markerLength >= fence.length && trimmed.slice(markerLength).trim() === ''
}

/**
 * 识别流式 Markdown 片段所属的连续结构类型。
 * @param {string} block Markdown 片段。
 * @returns {'list'|'continuation'|'blockquote'|'regular'} 用于合并连续结构的类型。
 */
function classifyStreamingBlock(block) {
  const firstLine = block.split('\n').find((line) => line.trim()) || ''
  if (LIST_START_PATTERN.test(firstLine)) return 'list'
  if (LIST_CONTINUATION_PATTERN.test(firstLine)) return 'continuation'
  if (BLOCKQUOTE_START_PATTERN.test(firstLine)) return 'blockquote'
  return 'regular'
}

/**
 * 合并被空行分隔但仍属于同一列表或引用的片段，避免流式追加时重置结构。
 * @param {string[]} blocks 按安全空行切出的 Markdown 片段。
 * @returns {{ content: string, type: 'list'|'continuation'|'blockquote'|'regular' }[]} 合并后的稳定候选块。
 */
function mergeStreamingStructures(blocks) {
  const groups = []
  for (const content of blocks) {
    const type = classifyStreamingBlock(content)
    const previous = groups.at(-1)
    const continuesList = previous?.type === 'list' && (type === 'list' || type === 'continuation')
    const continuesQuote = previous?.type === 'blockquote' && type === 'blockquote'
    if (continuesList || continuesQuote) {
      previous.content += `\n\n${content}`
      continue
    }
    groups.push({ content, type })
  }
  return groups
}

/**
 * 将持续增长的 Markdown 拆为不会再变化的完整块和末尾草稿。
 * 仅在代码围栏及块级公式之外的空行切块，并保留连续列表和引用的整体语义。
 * @param {string} content 当前流式 Markdown 全文。
 * @returns {{ completedBlocks: string[], tail: string }} 已稳定块与无需 Markdown 解析的尾部草稿。
 */
export function splitStreamingMarkdown(content) {
  const source = typeof content === 'string' ? content : ''
  if (!source) return { completedBlocks: [], tail: '' }

  const blocks = []
  let blockStart = 0
  let blankRunStart = -1
  let fence = null
  let inBlockMath = false
  let lineStart = 0

  // 单次扫描只记录语法安全的空行边界，避免完整 Markdown 解析进入高频路径。
  while (lineStart < source.length) {
    const newlineIndex = source.indexOf('\n', lineStart)
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex
    const line = source.slice(lineStart, lineEnd)
    const trimmed = line.trim()
    const protectedAtLineStart = Boolean(fence) || inBlockMath

    if (fence) {
      if (isClosingFence(line, fence)) fence = null
    } else {
      const fenceMatch = line.match(FENCE_START_PATTERN)
      if (fenceMatch) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length }
      } else if (countBlockMathDelimiters(line) % 2 === 1) {
        inBlockMath = !inBlockMath
      }
    }

    const protectedAtLineEnd = Boolean(fence) || inBlockMath
    if (!trimmed && !protectedAtLineStart && !protectedAtLineEnd) {
      if (blankRunStart < 0) blankRunStart = lineStart
    } else if (blankRunStart >= 0) {
      const block = source.slice(blockStart, blankRunStart).replace(/[ \t\n]+$/, '')
      if (block) blocks.push(block)
      blockStart = lineStart
      blankRunStart = -1
    }

    if (newlineIndex === -1) break
    lineStart = newlineIndex + 1
  }

  const endedAtSafeBlank = blankRunStart >= 0
  const remainingEnd = endedAtSafeBlank ? blankRunStart : source.length
  const remaining = source.slice(blockStart, remainingEnd).replace(/[ \t\n]+$/, '')
  if (remaining) blocks.push(remaining)
  const groups = mergeStreamingStructures(blocks)
  if (!groups.length) return { completedBlocks: [], tail: source }

  // 列表和引用允许空行后继续，只有后续普通块出现时才冻结它们。
  const last = groups.at(-1)
  const canFinalizeLast = endedAtSafeBlank && !['list', 'continuation', 'blockquote'].includes(last.type)
  const completedGroups = canFinalizeLast ? groups : groups.slice(0, -1)
  return {
    completedBlocks: completedGroups.map((group) => group.content),
    tail: canFinalizeLast ? '' : last.content,
  }
}

/**
 * 临时替换行内代码中的 LaTeX 定界符，避免公式预处理误改代码。
 * @param {string} segment 行内代码文本。
 * @returns {string} 带占位符的代码文本。
 */
function protectInlineCodeLatex(segment) {
  return CODE_LATEX_DELIMITERS.reduce(
    (result, [delimiter, placeholder]) => result.split(delimiter).join(placeholder),
    segment,
  )
}

/**
 * 恢复行内代码中被保护的 LaTeX 定界符。
 * @param {string} value 带占位符的文本。
 * @returns {string} 恢复后的文本。
 */
function restoreInlineCodeLatex(value) {
  return CODE_LATEX_DELIMITERS.reduce(
    (result, [delimiter, placeholder]) => result.split(placeholder).join(delimiter),
    value,
  )
}

/**
 * 在保护代码片段的前提下规范化 Markdown 中的 LaTeX 写法。
 * @param {string} markdown 原始 Markdown 文本。
 * @returns {string} 可交给 KaTeX 处理的 Markdown 文本。
 */
export function preprocessMarkdownLatex(markdown) {
  if (!markdown) return ''

  const protectedSegments = new Map()
  let placeholderIndex = 0

  /**
   * 保存代码片段并返回不会被 Markdown 规则处理的占位符。
   * @param {string} segment 待保护的代码片段。
   * @returns {string} 唯一占位符。
   */
  const protect = (segment) => {
    const placeholder = `\uE000ZVC_CODE_${placeholderIndex++}\uE001`
    protectedSegments.set(placeholder, segment)
    return placeholder
  }

  // 先隔离代码内容，避免公式规则改变示例代码的原始语义。
  let processed = markdown.replace(FENCED_CODE_PATTERN, (match) => protect(match))
  processed = processed.replace(INLINE_CODE_PATTERN, (match) => protect(protectInlineCodeLatex(match)))
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => `$$${expression}$$`)
  processed = processed.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, expression) => `$${expression}$`)
  processed = processed.replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
  processed = processed.replace(/\\end\{align\*?\}/g, '\\end{aligned}')
  processed = processed.replace(/\\begin\{equation\*?\}/g, '\\begin{aligned}')
  processed = processed.replace(/\\end\{equation\*?\}/g, '\\end{aligned}')
  processed = processed.replace(/(?<!\\)\\tag\s*\{([^{}]+)\}/g, '\\qquad \\text{($1)}')

  protectedSegments.forEach((segment, placeholder) => {
    processed = processed.split(placeholder).join(segment)
  })
  return processed
}

/**
 * 创建 rehype 插件，用于恢复 AST 中受保护的代码定界符。
 * @returns {(tree: Record<string, unknown>) => void} rehype AST 转换函数。
 */
export function restoreProtectedLatexCodePlugin() {
  /**
   * 遍历 Markdown AST 并恢复节点文本。
   * @param {Record<string, unknown>} tree Markdown AST 根节点。
   * @returns {void} 无返回值。
   */
  return (tree) => {
    /**
     * 递归恢复单个 AST 节点及其子节点。
     * @param {Record<string, unknown>} node 当前 AST 节点。
     * @returns {void} 无返回值。
     */
    const restoreNode = (node) => {
      if (typeof node.value === 'string') node.value = restoreInlineCodeLatex(node.value)
      node.children?.forEach(restoreNode)
    }
    restoreNode(tree)
  }
}
