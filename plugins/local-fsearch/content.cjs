/**
 * 将引擎的 UTF-8 字节区间转成安全的文本片段，中文前缀不能按 JavaScript 下标切割。
 * @param {object} match 引擎返回的一条行命中
 * @returns {object} 带行号、上下文及高亮片段的预览
 */
function normalizeMatch(match) {
  if (!Number.isSafeInteger(match.line) || match.line < 1 || typeof match.text !== 'string' || !Array.isArray(match.ranges)) {
    throw new Error('FSearch 返回的内容命中格式无效')
  }
  const bytes = Buffer.from(match.text, 'utf8')
  const parts = []
  let position = 0
  for (const range of match.ranges) {
    const [start, end] = range
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < position || end < start || end > bytes.length) {
      throw new Error('FSearch 返回的命中区间无效')
    }
    if (start > position) parts.push({ text: bytes.subarray(position, start).toString('utf8'), matched: false })
    parts.push({ text: bytes.subarray(start, end).toString('utf8'), matched: true })
    position = end
  }
  if (position < bytes.length) parts.push({ text: bytes.subarray(position).toString('utf8'), matched: false })
  return {
    line: match.line,
    parts,
    before: (match.before || []).map((text, index, lines) => ({ line: match.line - lines.length + index, text })),
    after: (match.after || []).map((text, index) => ({ line: match.line + index + 1, text })),
    // 引擎只返回每行开头的有限预览，不能把末尾命中伪装成已显示的高亮。
    outsidePreview: match.ranges.length === 0 && match.col >= bytes.length
  }
}

/**
 * 内容检索的下一页是候选游标，不是结果条数；返回它的原值供下一次请求使用。
 * @param {object} response 官方 grep 响应
 * @param {number} cursor 本次候选游标
 * @returns {object} 当前页文件及预览、下一游标、内容索引状态
 */
function normalizeContent(response, cursor) {
  if (!Array.isArray(response.files)) throw new Error('FSearch 返回的内容结果格式无效')
  const next = response.next
  if (next !== undefined && (!Number.isSafeInteger(next) || next <= cursor)) {
    throw new Error('内容检索暂未能继续，请稍后刷新或缩小目录范围')
  }
  const hits = response.files.map(file => {
    if (typeof file.path !== 'string' || !Array.isArray(file.matches)) throw new Error('FSearch 返回的文件命中格式无效')
    return { path: file.path, kind: 'file', git: file.git, matches: file.matches.map(normalizeMatch) }
  })
  return {
    hits,
    took_us: response.took_us,
    offset: cursor,
    next: next === undefined ? null : next,
    windowLimited: false,
    content: true,
    complete: response.complete,
    contentIndexing: response.indexing,
    source: response.source
  }
}

module.exports = { normalizeMatch, normalizeContent }
