import { Fragment, h, Text } from 'vue'
import MarkdownCodeBlock from '../../components/MarkdownCodeBlock.vue'
import MarkdownMath from '../../components/MarkdownMath.vue'
import { sanitizeImageUrl, sanitizeLinkUrl } from './sanitize.js'

/**
 * 生成安全的链接 VNode。
 * @param {string} url 原始链接地址。
 * @param {Array<unknown>} children 链接子节点。
 * @param {string|number} key 当前节点 key。
 * @returns {unknown} 链接 VNode 或纯文本回退节点。
 */
function renderSafeLink(url, children, key) {
  const safeUrl = sanitizeLinkUrl(url)
  if (!safeUrl) return h(Fragment, { key }, children)
  return h('a', { key, href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }, children)
}

/**
 * 创建一个稳定的子节点 key，避免不同父节点中的下标冲突。
 * @param {string|number} parentKey 父节点 key。
 * @param {number} index 子节点下标。
 * @returns {string} 子节点 key。
 */
function childKey(parentKey, index) {
  return `${String(parentKey)}.${index}`
}

/**
 * 渲染 Markdown 节点的子节点。
 * @param {Array<object>} nodes mdast 子节点列表。
 * @param {object} context 当前渲染上下文。
 * @param {string|number} parentKey 父节点 key。
 * @returns {Array<unknown>} Vue VNode 或文本节点列表。
 */
function renderChildren(nodes, context, parentKey) {
  return (nodes || []).map((node, index) => renderNode(node, childKey(parentKey, index), context)).filter(Boolean)
}

/**
 * 渲染一个 Markdown 列表。
 * @param {object} node mdast list 节点。
 * @param {string|number} key 当前节点 key。
 * @param {object} context 当前渲染上下文。
 * @returns {unknown} 列表 VNode。
 */
function renderList(node, key, context) {
  const tag = node.ordered ? 'ol' : 'ul'
  const props = { key }
  if (node.ordered && Number.isInteger(node.start) && node.start !== 1) props.start = node.start
  return h(tag, props, renderChildren(node.children, context, key))
}

/**
 * 渲染 Markdown 表格，保持横向滚动由外层样式控制。
 * @param {object} node mdast table 节点。
 * @param {string|number} key 当前节点 key。
 * @param {object} context 当前渲染上下文。
 * @returns {unknown} 表格滚动容器 VNode。
 */
function renderTable(node, key, context) {
  const rows = (node.children || []).map((row, rowIndex) => {
    const cells = (row.children || []).map((cell, cellIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td'
      const align = node.align?.[cellIndex]
      return h(tag, { key: childKey(`${key}.${rowIndex}`, cellIndex), style: align ? { textAlign: align } : undefined }, renderChildren(cell.children, context, `${key}.${rowIndex}.${cellIndex}`))
    })
    return h('tr', { key: `${key}.${rowIndex}` }, cells)
  })
  return h('div', { key, class: 'markdown-table-scroll' }, [h('table', rows)])
}

/**
 * 渲染一个 Markdown 节点为 Vue VNode。
 * @param {object} node mdast 节点。
 * @param {string|number} key 当前节点 key。
 * @param {object} context 当前渲染上下文。
 * @returns {unknown|null} 节点 VNode；不可见定义节点返回空值。
 */
function renderNode(node, key, context) {
  if (!node) return null
  switch (node.type) {
    case 'text': return h(Text, { key }, node.value || '')
    case 'root': return h(Fragment, { key }, renderChildren(node.children, context, key))
    case 'paragraph': return h('p', { key }, renderChildren(node.children, context, key))
    case 'heading': return h(`h${Math.min(6, Math.max(1, node.depth || 1))}`, { key }, renderChildren(node.children, context, key))
    case 'strong': return h('strong', { key }, renderChildren(node.children, context, key))
    case 'emphasis': return h('em', { key }, renderChildren(node.children, context, key))
    case 'delete': return h('del', { key }, renderChildren(node.children, context, key))
    case 'blockquote': return h('blockquote', { key }, renderChildren(node.children, context, key))
    case 'list': return renderList(node, key, context)
    case 'listItem': {
      const children = renderChildren(node.children, context, key)
      if (node.checked !== null && node.checked !== undefined) children.unshift(h('input', { key: `${key}.checkbox`, type: 'checkbox', checked: node.checked, disabled: true }))
      return h('li', { key, class: node.checked === null || node.checked === undefined ? undefined : 'task-list-item' }, children)
    }
    case 'table': return renderTable(node, key, context)
    case 'thematicBreak': return h('hr', { key })
    case 'break': return h(Fragment, { key }, [h('br', { key: `${key}.br` }), h(Text, { key: `${key}.newline` }, '\n')])
    case 'inlineCode': return h('code', { key }, node.value || '')
    case 'code': return h(MarkdownCodeBlock, { key, code: node.value || '', language: node.lang || '', streaming: context.streaming })
    case 'link': return renderSafeLink(node.url || '', renderChildren(node.children, { ...context, inLink: true }, key), key)
    case 'image': {
      const url = sanitizeImageUrl(node.url || '')
      return url
        ? h('img', { key, class: 'markdown-image', src: url, alt: node.alt || '', loading: 'lazy', decoding: 'async' })
        : h('span', { key, class: 'markdown-image-alt' }, node.alt || '')
    }
    case 'linkReference': {
      const definition = context.targets.definitions.get(String(node.identifier || '').toUpperCase())
      return definition ? renderSafeLink(definition.url, renderChildren(node.children, { ...context, inLink: true }, key), key) : h(Text, { key }, `[${node.label || node.identifier || ''}]`)
    }
    case 'imageReference': {
      const definition = context.targets.definitions.get(String(node.identifier || '').toUpperCase())
      const url = sanitizeImageUrl(definition?.url || '')
      return url ? h('img', { key, class: 'markdown-image', src: url, alt: node.alt || definition?.title || '', loading: 'lazy', decoding: 'async' }) : h('span', { key }, node.alt || '')
    }
    case 'math': return h(MarkdownMath, { key, value: node.value || '', display: true })
    case 'inlineMath': return h(MarkdownMath, { key, value: node.value || '', display: false })
    case 'html': return h(Text, { key }, node.value || '')
    case 'definition':
    case 'footnoteDefinition':
      return null
    default:
      return Array.isArray(node.children) ? h(Fragment, { key }, renderChildren(node.children, context, key)) : h(Text, { key }, node.value || '')
  }
}

/**
 * 收集并渲染一个 Markdown AST 的顶层块。
 * @param {Array<object>} blocks 顶层 mdast 节点及其稳定 key。
 * @param {object} context 当前渲染上下文。
 * @returns {Array<unknown>} 顶层 VNode 列表。
 */
export function renderMarkdownBlocks(blocks, context) {
  return (blocks || []).map(({ node, key }) => renderNode(node, key, context)).filter(Boolean)
}

/**
 * 渲染单个完整 Markdown 根节点。
 * @param {object} root mdast 根节点。
 * @param {object} context 当前渲染上下文。
 * @returns {Array<unknown>} 完整文档的 VNode 列表。
 */
export function renderMarkdownRoot(root, context) {
  return renderMarkdownBlocks((root?.children || []).map((node, index) => ({ node, key: node.position?.start?.offset ?? index })), context)
}
