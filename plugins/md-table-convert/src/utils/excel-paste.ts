/**
 * Excel 粘贴内容解析工具
 * 解析从 Excel 复制的内容（Tab 分隔的 TSV 格式，支持引号转义）
 * 自动处理合并单元格：向下填充空值
 */

export interface TableData {
  headers: string[]
  rows: string[][]
}

/**
 * 解析 Excel 复制粘贴的 TSV 文本
 * - 字段用 Tab 分隔，行用换行符分隔
 * - 包含换行/制表符的字段会被双引号包裹
 * - 引号内 "" 表示转义的双引号
 * - 合并单元格的空位自动向下填充
 */
export function parseExcelPaste(text: string): TableData | null {
  if (!text || !text.trim()) return null

  // ---- 1. TSV 解析：处理引号转义字段 ----
  const rows: string[][] = []
  let curRow: string[] = []
  let curField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1]
        if (next === '"') {
          // 转义引号 ""
          curField += '"'
          i++
        } else {
          // 引号结束
          inQuotes = false
        }
      } else {
        curField += ch
      }
    } else {
      if (ch === '"' && curField === '') {
        // 字段以引号开头 → 进入引号模式
        inQuotes = true
      } else if (ch === '\t') {
        // Tab → 字段结束
        curRow.push(curField)
        curField = ''
      } else if (ch === '\n') {
        // 换行 → 行结束
        curRow.push(curField)
        curField = ''
        rows.push(curRow)
        curRow = []
      } else if (ch === '\r') {
        // 跳过 \r（\r\n 中的 \r）
        if (text[i + 1] === '\n') {
          // \r\n → 行结束
          curRow.push(curField)
          curField = ''
          rows.push(curRow)
          curRow = []
          i++
        } else {
          // 单独的 \r 当作换行
          curRow.push(curField)
          curField = ''
          rows.push(curRow)
          curRow = []
        }
      } else {
        curField += ch
      }
    }
  }
  // 最后一个字段
  curRow.push(curField)
  if (curRow.some((c) => c !== '')) {
    rows.push(curRow)
  }

  if (rows.length === 0) return null

  // ---- 2. 合并单元格填充：空单元格向下填充 ----
  const colCount = Math.max(...rows.map((r) => r.length))
  for (let col = 0; col < colCount; col++) {
    let lastValue = ''
    for (let row = 0; row < rows.length; row++) {
      while (rows[row].length < colCount) rows[row].push('')
      const cell = rows[row][col]
      if (cell !== '') {
        lastValue = cell
      } else if (lastValue !== '') {
        rows[row][col] = lastValue
      }
    }
  }

  // ---- 3. 去除全空行 ----
  const validRows = rows.filter((r) => r.some((c) => c !== ''))
  if (validRows.length < 2) {
    // 只有一行（仅表头，无数据），也返回
    if (validRows.length === 1) {
      return { headers: validRows[0], rows: [] }
    }
    return null
  }

  return {
    headers: validRows[0],
    rows: validRows.slice(1)
  }
}
