/**
 * 创建当前 Markdown 渲染帧使用的引用定义状态。
 * @returns {{definitions: Map<string, object>, footnotes: Map<string, object>}} 空引用状态。
 */
export function createReferenceTargets() {
  return { definitions: new Map(), footnotes: new Map() }
}

/**
 * 收集 Markdown 子树中的链接定义和脚注定义，保留首次出现的定义。
 * @param {Array<object>} nodes 待扫描的 mdast 节点。
 * @param {{definitions: Map<string, object>, footnotes: Map<string, object>}} targets 引用状态。
 * @returns {void} 无返回值。
 */
export function collectReferenceTargets(nodes, targets) {
  for (const node of nodes || []) {
    if (node.type === 'definition') {
      const id = String(node.identifier || '').toUpperCase()
      if (id && !targets.definitions.has(id)) targets.definitions.set(id, node)
    }
    if (node.type === 'footnoteDefinition') {
      const id = String(node.identifier || '').toUpperCase()
      if (id && !targets.footnotes.has(id)) targets.footnotes.set(id, node)
    }
    if (Array.isArray(node.children)) collectReferenceTargets(node.children, targets)
  }
}
