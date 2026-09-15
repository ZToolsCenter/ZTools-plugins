const getImagePath = (item) => {
  if (typeof item.imagePath === 'string' && item.imagePath) {
    return item.imagePath
  }

  if (typeof item.content !== 'string' || item.content.startsWith('data:')) {
    return ''
  }

  return item.content.startsWith('file://')
    ? item.content.slice('file://'.length)
    : item.content
}

const getFilePaths = (item) => {
  if (Array.isArray(item.files)) {
    return item.files.map(file => file?.path)
  }
  return [item.filePath]
}

const uniquePaths = (paths) => {
  const seen = new Set()
  return paths.filter(path => {
    if (typeof path !== 'string' || !path || seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export const buildClipboardPayload = (items) => {
  if (!Array.isArray(items) || items.length === 0) return null

  const type = items[0].type
  if (!items.every(item => item?.type === type)) return null

  if (type === 'text') {
    return {
      type: 'text',
      content: items.map(item => String(item.content ?? '')).join('\n')
    }
  }

  if (type === 'image') {
    if (items.length === 1) {
      const content = itemImageContent(items[0])
      return content ? { type: 'image', content } : null
    }

    const paths = uniquePaths(items.map(getImagePath))
    return paths.length > 0 ? { type: 'file', content: paths } : null
  }

  if (type === 'file') {
    const paths = uniquePaths(items.flatMap(getFilePaths))
    return paths.length > 0 ? { type: 'file', content: paths } : null
  }

  return null
}

const itemImageContent = (item) => item.imagePath || item.content?.replace(/^file:\/\//, '') || ''
