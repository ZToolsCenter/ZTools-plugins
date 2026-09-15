const BLOCK_TYPES = new Set(['heading', 'paragraph', 'bullet', 'table'])

function asString(v) {
  if (v == null) return ''
  return String(v)
}

function normalizeBlock(block) {
  if (!block || typeof block !== 'object') return null
  const type = block.type
  if (!BLOCK_TYPES.has(type)) return null
  if (type === 'heading') {
    const level = [1, 2, 3].includes(Number(block.level)) ? Number(block.level) : 1
    return { type, level, text: asString(block.text) }
  }
  if (type === 'paragraph') {
    return { type, text: asString(block.text) }
  }
  if (type === 'bullet') {
    const items = Array.isArray(block.items) ? block.items.map(asString) : []
    return { type, items }
  }
  if (type === 'table') {
    const rows = Array.isArray(block.rows)
      ? block.rows.map((row) => (Array.isArray(row) ? row.map(asString) : []))
      : []
    return { type, rows }
  }
  return null
}

function normalizeDocument(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('文档结构无效：根对象缺失')
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new Error('文档结构无效：缺少 pages')
  }
  const pages = raw.pages.map((p, i) => {
    const blocksIn = Array.isArray(p && p.blocks) ? p.blocks : []
    const blocks = blocksIn.map(normalizeBlock).filter(Boolean)
    return {
      page: typeof (p && p.page) === 'number' ? p.page : i + 1,
      title: p && p.title != null ? asString(p.title) : undefined,
      blocks,
    }
  })
  const doc = {
    title: raw.title != null ? asString(raw.title) : undefined,
    pages,
  }
  if (Array.isArray(raw.sheets) && raw.sheets.length) {
    doc.sheets = raw.sheets.map((s, i) => ({
      name: (s && s.name != null ? asString(s.name) : `Sheet${i + 1}`).slice(0, 31),
      rows: Array.isArray(s.rows)
        ? s.rows.map((row) => (Array.isArray(row) ? row.map(asString) : []))
        : [],
    }))
  }
  return doc
}

module.exports = { normalizeDocument, BLOCK_TYPES }
