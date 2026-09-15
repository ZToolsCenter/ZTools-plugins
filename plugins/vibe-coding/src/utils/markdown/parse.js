import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { preprocessMarkdownLatex } from '../markdown.js'

const STREAMING_EXTENSIONS = [gfm()]
const STREAMING_MDAST_EXTENSIONS = [gfmFromMarkdown()]
const SETTLED_EXTENSIONS = [gfm(), math()]
const SETTLED_MDAST_EXTENSIONS = [gfmFromMarkdown(), mathFromMarkdown()]

/**
 * 解析流式 Markdown，保留 GFM 节点位置并避免未完成公式进入 KaTeX。
 * @param {string} text 待解析的 Markdown 原文。
 * @returns {Record<string, unknown>} 不包含数学节点的 GFM mdast 根节点。
 */
export function parseStreamingMarkdown(text) {
  return fromMarkdown(String(text || ''), {
    extensions: STREAMING_EXTENSIONS,
    mdastExtensions: STREAMING_MDAST_EXTENSIONS,
  })
}

/**
 * 解析已完成的 Markdown，启用 GFM、数学公式和历史公式定界符兼容。
 * @param {string} text 待解析的 Markdown 原文。
 * @returns {Record<string, unknown>} 包含数学节点的完整 mdast 根节点。
 */
export function parseSettledMarkdown(text) {
  const normalized = preprocessMarkdownLatex(String(text || ''))
  return fromMarkdown(normalized, {
    extensions: SETTLED_EXTENSIONS,
    mdastExtensions: SETTLED_MDAST_EXTENSIONS,
  })
}
