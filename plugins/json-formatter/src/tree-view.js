import { formatJsonPath, getJsonType } from './json-utils.js'

const MAX_RENDERED_NODES = 12000

/**
 * 渲染可折叠 JSON 树。
 * @param {HTMLElement} container
 * @param {unknown} value
 * @param {{onSelect?: (detail: {path: (string|number)[], value: unknown, row: HTMLElement}) => void}} options
 */
export function renderJsonTree(container, value, { onSelect } = {}) {
  container.replaceChildren()
  let renderedCount = 0

  const renderNode = (key, nodeValue, path, depth, isLast) => {
    renderedCount += 1
    if (renderedCount > MAX_RENDERED_NODES) {
      const limit = document.createElement('div')
      limit.className = 'tree-limit'
      limit.textContent = `已达到 ${MAX_RENDERED_NODES.toLocaleString()} 个节点的显示上限`
      return limit
    }

    const type = getJsonType(nodeValue)
    const complex = type === 'array' || type === 'object'
    const details = document.createElement('details')
    details.className = `tree-node type-${type}`
    details.open = depth < 2
    details.dataset.path = formatJsonPath(path)

    const row = document.createElement('summary')
    row.className = 'tree-row'
    row.__jsonPath = path
    row.__jsonValue = nodeValue
    if (!complex) row.classList.add('leaf')

    const keyElement = document.createElement('span')
    keyElement.className = 'node-key'
    keyElement.textContent = key === null ? '$' : typeof key === 'number' ? `[${key}]` : key
    row.append(keyElement)

    const separator = document.createElement('span')
    separator.className = 'node-separator'
    separator.textContent = complex ? '' : ':'
    row.append(separator)

    const valueElement = document.createElement('span')
    valueElement.className = 'node-value'
    if (complex) {
      const count = Object.keys(nodeValue).length
      valueElement.textContent = type === 'array' ? `Array(${count})` : `Object(${count})`
    } else if (type === 'string') {
      valueElement.textContent = JSON.stringify(nodeValue)
    } else {
      valueElement.textContent = String(nodeValue)
    }
    row.append(valueElement)

    const typeElement = document.createElement('span')
    typeElement.className = 'node-type'
    typeElement.textContent = type
    row.append(typeElement)

    row.addEventListener('click', (event) => {
      if (!complex) event.preventDefault()
      container.querySelector('.tree-row.selected')?.classList.remove('selected')
      row.classList.add('selected')
      onSelect?.({ path, value: nodeValue, row })
    })

    details.append(row)
    if (complex) {
      const children = document.createElement('div')
      children.className = 'tree-children'
      const entries = Array.isArray(nodeValue)
        ? nodeValue.map((item, index) => [index, item])
        : Object.entries(nodeValue)
      entries.forEach(([childKey, childValue], index) => {
        children.append(renderNode(childKey, childValue, [...path, childKey], depth + 1, index === entries.length - 1))
      })
      if (entries.length === 0) details.classList.add('empty-complex')
      details.append(children)
    }
    if (isLast) details.classList.add('last-node')
    return details
  }

  container.append(renderNode(null, value, [], 0, true))
  return { renderedCount: Math.min(renderedCount, MAX_RENDERED_NODES), limited: renderedCount > MAX_RENDERED_NODES }
}

/** @param {HTMLElement} container @param {boolean} open */
export function setAllTreeNodesOpen(container, open) {
  for (const node of container.querySelectorAll('details.tree-node')) node.open = open
}
