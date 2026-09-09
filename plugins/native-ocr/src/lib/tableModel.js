// 表格聚类/网格构建纯函数模块 —— App.vue 与 tests/run.mjs 共用
// 坐标约定：归一化 [0,1]，行 y 为底部原点（与 Vision 输出一致），列 x 为左侧原点

export const LOW_CONFIDENCE_THRESHOLD = 0.85

export function median(values) {
  if (!values || !values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function extractCells(lines) {
  const cells = []
  const list = Array.isArray(lines) ? lines : []
  for (let index = 0; index < list.length; index += 1) {
    const line = list[index]
    const box = line && line.box
    const x = Number(box && box.x)
    const y = Number(box && box.y)
    const w = Number(box && box.w)
    const h = Number(box && box.h)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue
    const cell = {
      text: String(line.text || ''),
      cx: x + w / 2,
      cy: y + h / 2,
      w,
      h
    }
    const score = Number(line && line.score)
    if (Number.isFinite(score)) cell.score = score
    cells.push(cell)
  }
  return cells
}

export function clusterRows(cells, threshold) {
  const sorted = [...cells].sort((a, b) => b.cy - a.cy)
  const rows = []
  for (const cell of sorted) {
    const last = rows[rows.length - 1]
    // 与前一个单元格（而非滑动均值）比较：间隙判定，避免簇中心漂移吞行
    const prev = last && last.cells[last.cells.length - 1]
    if (last && prev && Math.abs(cell.cy - prev.cy) <= threshold) {
      last.cells.push(cell)
      last.cy = last.cells.reduce((sum, item) => sum + item.cy, 0) / last.cells.length
    } else {
      rows.push({ cy: cell.cy, cells: [cell] })
    }
  }
  return rows
}

export function clusterColumns(cells, threshold) {
  const sorted = [...cells].sort((a, b) => a.cx - b.cx)
  const cols = []
  for (const cell of sorted) {
    const last = cols[cols.length - 1]
    // 与前一个单元格（而非滑动均值）比较：间隙判定，避免簇中心漂移吞列
    const prev = last && last.cells[last.cells.length - 1]
    if (last && prev && Math.abs(cell.cx - prev.cx) <= threshold) {
      last.cells.push(cell)
      last.cx = last.cells.reduce((sum, item) => sum + item.cx, 0) / last.cells.length
    } else {
      cols.push({ cx: cell.cx, cells: [cell] })
    }
  }
  return cols
}

export function clusterTable(lines, factor = 0.6) {
  const cells = extractCells(lines)
  if (!cells.length) {
    return { grid: [], rowClusters: [], colClusters: [] }
  }
  const rowThreshold = median(cells.map((cell) => cell.h)) * factor
  const colThreshold = median(cells.map((cell) => cell.w)) * factor
  const rowClusters = clusterRows(cells, rowThreshold)
  const colClusters = clusterColumns(cells, colThreshold)

  const rowCount = rowClusters.length
  const colCount = colClusters.length
  const grid = Array.from({ length: rowCount }, () => Array(colCount).fill(''))

  for (const cell of cells) {
    let bestRow = 0
    let bestRowDist = Infinity
    for (let r = 0; r < rowCount; r += 1) {
      const dist = Math.abs(cell.cy - rowClusters[r].cy)
      if (dist < bestRowDist) {
        bestRowDist = dist
        bestRow = r
      }
    }
    let bestCol = 0
    let bestColDist = Infinity
    for (let c = 0; c < colCount; c += 1) {
      const dist = Math.abs(cell.cx - colClusters[c].cx)
      if (dist < bestColDist) {
        bestColDist = dist
        bestCol = c
      }
    }
    grid[bestRow][bestCol] = grid[bestRow][bestCol] ? `${grid[bestRow][bestCol]} ${cell.text}` : cell.text
  }

  return { grid, rowClusters, colClusters }
}

export function bandIndexFor(value, seps) {
  let count = 0
  for (const sep of seps) {
    if (sep < value) count += 1
  }
  return count
}

/**
 * 按分隔线构建网格：单元格按带归属落格，行索引需底部原点反转。
 * edits: { "r-c": "text" } 手动编辑覆盖。
 * 返回 { grid, lowCells }，lowCells 为置信度低于阈值的 "r-c" 集合。
 */
export function buildGrid(cells, rowSeps, colSeps, edits = {}) {
  const rows = rowSeps.length + 1
  const cols = colSeps.length + 1
  const grid = Array.from({ length: rows }, () => Array(cols).fill(''))
  const minScore = {}

  for (const cell of cells) {
    const r = rowSeps.length - bandIndexFor(cell.cy, rowSeps)
    const c = bandIndexFor(cell.cx, colSeps)
    grid[r][c] = grid[r][c] ? `${grid[r][c]} ${cell.text}` : cell.text
    if (Number.isFinite(cell.score)) {
      const key = `${r}-${c}`
      minScore[key] = Math.min(minScore[key] ?? 1, cell.score)
    }
  }

  for (const key of Object.keys(edits || {})) {
    const [r, c] = key.split('-').map(Number)
    if (Number.isFinite(r) && Number.isFinite(c) && r >= 0 && r < rows && c >= 0 && c < cols) {
      grid[r][c] = edits[key]
    }
  }

  const lowCells = new Set()
  for (const [key, score] of Object.entries(minScore)) {
    if (score < LOW_CONFIDENCE_THRESHOLD) lowCells.add(key)
  }
  return { grid, lowCells }
}
