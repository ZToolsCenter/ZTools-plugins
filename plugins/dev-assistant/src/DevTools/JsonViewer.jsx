import { useState } from 'react'

// ─── 折叠状态管理 ─────────────────────────────────────────────────────────────

function buildFoldable (node, path = '') {
  if (Array.isArray(node)) {
    return { path, type: 'array', length: node.length, children: node.map((v, i) => buildFoldable(v, `${path}[${i}]`)) }
  }
  if (node !== null && typeof node === 'object') {
    const keys = Object.keys(node)
    return { path, type: 'object', keys, children: keys.map((k) => buildFoldable(node[k], `${path}.${k}`)) }
  }
  return { path, type: 'leaf', value: node }
}

// ─── JSON 渲染行 ──────────────────────────────────────────────────────────────

function Token ({ type, children }) {
  const colors = {
    string: '#22863a',
    number: '#005cc5',
    boolean: '#e36209',
    null: '#e36209',
    key: '#b31d28',
    punctuation: '#586069',
    default: '#24292e'
  }
  return <span style={{ color: colors[type] ?? colors.default }}>{children}</span>
}

function renderValue (value) {
  if (value === null) return <Token type='null'>null</Token>
  if (typeof value === 'boolean') return <Token type='boolean'>{String(value)}</Token>
  if (typeof value === 'number') return <Token type='number'>{String(value)}</Token>
  if (typeof value === 'string') return <Token type='string'>"{escapeString(value)}"</Token>
  return null
}

function escapeString (str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

// ─── 树节点 ───────────────────────────────────────────────────────────────────

function TreeNode ({ node, keyName, isLast, depth, collapsed, onToggle }) {
  const indent = depth * 16
  const isFolded = collapsed.has(node.path)

  const openBracket = node.type === 'array' ? '[' : '{'
  const closeBracket = node.type === 'array' ? ']' : '}'
  const childCount = node.type === 'array' ? node.length : node.keys?.length

  const handleToggle = (e) => {
    e.stopPropagation()
    onToggle(node.path)
  }

  // 叶节点
  if (node.type === 'leaf') {
    return (
      <div className='jv-line'>
        <span className='jv-indent' style={{ width: indent }} />
        {keyName != null && (
          <><Token type='key'>"{keyName}"</Token><Token type='punctuation'>: </Token></>
        )}
        {renderValue(node.value)}
        {!isLast && <Token type='punctuation'>,</Token>}
      </div>
    )
  }

  // 折叠状态
  if (isFolded) {
    return (
      <div className='jv-line jv-line--collapsible' onClick={handleToggle}>
        <span className='jv-indent' style={{ width: indent }} />
        <span className='jv-fold-icon'>▶</span>
        {keyName != null && (
          <><Token type='key'>"{keyName}"</Token><Token type='punctuation'>: </Token></>
        )}
        <Token type='punctuation'>{openBracket}</Token>
        <span className='jv-collapsed-hint'> {childCount} {node.type === 'array' ? 'items' : 'keys'} </span>
        <Token type='punctuation'>{closeBracket}</Token>
        {!isLast && <Token type='punctuation'>,</Token>}
      </div>
    )
  }

  const children = node.type === 'array'
    ? node.children.map((child, i) => ({ child, key: String(i), isLast: i === node.children.length - 1 }))
    : node.keys.map((k, i) => ({ child: node.children[i], key: k, isLast: i === node.keys.length - 1 }))

  return (
    <>
      <div className='jv-line jv-line--collapsible' onClick={handleToggle}>
        <span className='jv-indent' style={{ width: indent }} />
        <span className='jv-fold-icon'>▼</span>
        {keyName != null && (
          <><Token type='key'>"{keyName}"</Token><Token type='punctuation'>: </Token></>
        )}
        <Token type='punctuation'>{openBracket}</Token>
      </div>
      {children.map(({ child, key, isLast: childIsLast }) => (
        <TreeNode
          key={child.path}
          node={child}
          keyName={node.type === 'object' ? key : null}
          isLast={childIsLast}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
      <div className='jv-line'>
        <span className='jv-indent' style={{ width: indent }} />
        <Token type='punctuation'>{closeBracket}</Token>
        {!isLast && <Token type='punctuation'>,</Token>}
      </div>
    </>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function JsonViewer ({ value, raw }) {
  const [collapsed, setCollapsed] = useState(new Set())

  const handleToggle = (path) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleCollapseAll = () => {
    const allPaths = collectCollapsiblePaths(value)
    setCollapsed(new Set(allPaths))
  }

  const handleExpandAll = () => {
    setCollapsed(new Set())
  }

  if (value === null || value === undefined) return null

  const tree = buildFoldable(value)

  return (
    <div className='jv'>
      <div className='jv-toolbar'>
        <button type='button' onClick={handleExpandAll}>展开全部</button>
        <button type='button' onClick={handleCollapseAll}>折叠全部</button>
      </div>
      <div className='jv-body'>
        <TreeNode
          node={tree}
          keyName={null}
          isLast
          depth={0}
          collapsed={collapsed}
          onToggle={handleToggle}
        />
      </div>
    </div>
  )
}

function collectCollapsiblePaths (node, path = '', result = []) {
  if (Array.isArray(node)) {
    result.push(path)
    node.forEach((v, i) => collectCollapsiblePaths(v, `${path}[${i}]`, result))
  } else if (node !== null && typeof node === 'object') {
    result.push(path)
    Object.entries(node).forEach(([k, v]) => collectCollapsiblePaths(v, `${path}.${k}`, result))
  }
  return result
}
