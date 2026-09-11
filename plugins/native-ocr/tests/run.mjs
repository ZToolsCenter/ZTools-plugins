// native-ocr 表格模型回归测试 —— node tests/run.mjs
import assert from 'node:assert/strict'
import {
  bandIndexFor,
  buildGrid,
  clusterTable,
  extractCells,
  LOW_CONFIDENCE_THRESHOLD,
  median
} from '../src/lib/tableModel.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${error.message}`)
  }
}

function makeLines(rows, cols, score = null) {
  // 生成 rows×cols 的归一化坐标行（行距 0.35，列距 0.3，居中）
  const lines = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const line = {
        text: `R${r + 1}C${c + 1}`,
        box: {
          x: 0.2 + c * 0.3,
          y: 1 - (0.25 + r * 0.35) - 0.12,
          w: 0.12,
          h: 0.12
        }
      }
      if (score !== null) line.score = score
      lines.push(line)
    }
  }
  return lines
}

function autoSeps(lines) {
  const cells = extractCells(lines)
  const rowThreshold = median(cells.map((c) => c.h)) * 0.6
  const colThreshold = median(cells.map((c) => c.w)) * 0.6
  const { rowClusters, colClusters } = clusterTable(lines, 0.6)
  const rowSeps = []
  for (let i = 0; i < rowClusters.length - 1; i += 1) {
    rowSeps.push((rowClusters[i].cy + rowClusters[i + 1].cy) / 2)
  }
  const colSeps = []
  for (let i = 0; i < colClusters.length - 1; i += 1) {
    colSeps.push((colClusters[i].cx + colClusters[i + 1].cx) / 2)
  }
  void rowThreshold
  void colThreshold
  return {
    rowSeps: rowSeps.sort((a, b) => a - b),
    colSeps: colSeps.sort((a, b) => a - b)
  }
}

console.log('[tableModel]')

test('median 奇偶长度', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})

test('自动聚类等价分隔线模型（2×3）', () => {
  const lines = makeLines(2, 3)
  const auto = clusterTable(lines, 0.6)
  const { rowSeps, colSeps } = autoSeps(lines)
  const cells = extractCells(lines)
  const model = buildGrid(cells, rowSeps, colSeps)
  assert.deepEqual(model.grid, auto.grid)
  assert.deepEqual(model.grid, [['R1C1', 'R1C2', 'R1C3'], ['R2C1', 'R2C2', 'R2C3']])
})

test('拖动行分隔线重排（移到边缘产生空带）', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const dragged = [0.05]
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, dragged, auto.colSeps)
  assert.equal(grid.length, 2)
  assert.equal(grid[0].join('|'), 'R1C1 R2C1|R1C2 R2C2|R1C3 R2C3')
  assert.ok(grid[1].every((cell) => cell === ''))
})

test('双击删线合并行列', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, auto.rowSeps, auto.colSeps.slice(1))
  assert.equal(grid[0].length, 2)
  assert.equal(grid[0][0], 'R1C1 R1C2')
  assert.equal(grid[0][1], 'R1C3')
  assert.equal(grid[1][0], 'R2C1 R2C2')
})

test('+列线在最大空隙插入产生空列', () => {
  const lines = makeLines(2, 3)
  const auto = autoSeps(lines)
  const bounds = [0, ...auto.colSeps, 1]
  let bestGap = -1
  let bestPos = 0.5
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const gap = bounds[i + 1] - bounds[i]
    if (gap > bestGap) {
      bestGap = gap
      bestPos = (bounds[i] + bounds[i + 1]) / 2
    }
  }
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, auto.rowSeps, [...auto.colSeps, bestPos].sort((a, b) => a - b))
  assert.equal(grid[0].length, 4)
  const emptyIndex = grid[0].findIndex((cell) => cell === '')
  assert.ok(emptyIndex >= 0, '应存在一个空列')
  const filled = grid[0].filter((cell) => cell)
  assert.deepEqual(filled, ['R1C1', 'R1C2', 'R1C3'])
})

test('单元格编辑覆盖', () => {
  const lines = makeLines(2, 3)
  const { rowSeps, colSeps } = autoSeps(lines)
  const cells = extractCells(lines)
  const { grid } = buildGrid(cells, rowSeps, colSeps, { '0-1': '校对后' })
  assert.equal(grid[0][1], '校对后')
  assert.equal(grid[1][2], 'R2C3')
})

test('低置信度单元格标记', () => {
  const low = makeLines(2, 3, 0.6)
  const high = makeLines(2, 3, 0.95)
  const { rowSeps, colSeps } = autoSeps(low)
  const lowResult = buildGrid(extractCells(low), rowSeps, colSeps)
  const highResult = buildGrid(extractCells(high), rowSeps, colSeps)
  assert.equal(lowResult.lowCells.size, 6)
  assert.equal(highResult.lowCells.size, 0)
  assert.ok(LOW_CONFIDENCE_THRESHOLD === 0.85)
})

test('bandIndexFor 边界', () => {
  assert.equal(bandIndexFor(0.5, []), 0)
  assert.equal(bandIndexFor(0.2, [0.3, 0.6]), 0)
  assert.equal(bandIndexFor(0.4, [0.3, 0.6]), 1)
  assert.equal(bandIndexFor(0.9, [0.3, 0.6]), 2)
})

test('无 box 行不影响提取', () => {
  const lines = [{ text: 'no box' }, ...makeLines(1, 1)]
  assert.equal(extractCells(lines).length, 1)
})

console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
