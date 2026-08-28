/**
 * Markdown 表格解析工具
 * 将 Markdown 格式的表格文本解析为结构化数据
 */

export interface TableData {
  headers: string[]
  rows: string[][]
}

/**
 * 解析 Markdown 表格文本
 * 支持标准 Markdown 表格格式：
 * | 表头1 | 表头2 |
 * |-------|-------|
 * | 数据1 | 数据2 |
 */
export function parseMarkdownTable(text: string): TableData | null {
  if (!text || !text.trim()) return null

  // 按行分割，过滤空行
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) return null

  // 提取表格行（以 | 开头和结尾，或者至少包含 |）
  const tableLines = lines.filter((line) => line.includes('|'))

  if (tableLines.length < 2) return null

  // 解析单行单元格
  const parseCells = (line: string): string[] => {
    // 去掉首尾可能多余的 |
    let trimmed = line
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
    return trimmed.split('|').map((cell) => cell.trim())
  }

  // 判断是否是分隔行（如 |---|---| 或 |:---|:---:|）
  const isSeparatorLine = (line: string): boolean => {
    const cells = parseCells(line)
    return cells.every((cell) => /^:?-{1,}:?$/.test(cell))
  }

  // 过滤掉分隔行
  const dataLines = tableLines.filter((line) => !isSeparatorLine(line))

  if (dataLines.length < 1) return null

  const headers = parseCells(dataLines[0])
  if (headers.length === 0 || headers.every((h) => h === '')) return null

  const rows = dataLines.slice(1).map((line) => parseCells(line))

  return { headers, rows }
}
