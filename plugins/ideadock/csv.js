// CSV 表格 / 图表 / 统计 —— 从 app.js 拆出。经典脚本、全局作用域，须在 app.js 之后、bootstrap 之前加载。

// ==================== CSV 表格预览 ====================

let csvTimer = null
const csvColumnFilters = []
const csvColumnWidths = []
const csvHiddenColumns = new Set()
let csvAllRowsFilter = ''
let csvFirstRowHeader = true
let csvDelimiter = ','
let csvWrapCells = false
let csvResizeState = null
let csvSelection = null
let csvDragSelection = null
let csvSuppressNextClick = false
let csvClickTimer = null
let csvRenderFrame = null
const CSV_COL_MIN_WIDTH = 48
const CSV_COL_MAX_WIDTH = 220

function normalizeCsvDelimiter(value) {
  const raw = String(value || '')
  if (raw === '' || raw === ',') return ','
  if (raw === '\\t' || raw.toLowerCase() === 'tab') return '\t'
  if (raw === '\\s') return ' '
  return raw
}

function displayCsvDelimiter(value) {
  if (value === '\t') return '\\t'
  if (value === ' ') return '\\s'
  return value
}

function requestCsvRender() {
  if (csvRenderFrame) return
  csvRenderFrame = requestAnimationFrame(() => {
    csvRenderFrame = null
    renderCsv()
  })
}

// RFC4180 风格解析：逗号分隔，双引号包裹字段内可含逗号/换行，"" 表示转义引号
// 每个单元格记录 { value, start, end }：start/end 为该字段在原文中的字符区间（含外层引号）
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false, start = 0
  const delimiter = csvDelimiter || ','
  const pushField = end => { row.push({ value: field, start, end }); field = '' }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (delimiter && text.startsWith(delimiter, i)) {
      pushField(i); i += delimiter.length - 1; start = i + 1
    } else if (c === '\n') {
      pushField(i); rows.push(row); row = []; start = i + 1
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length) { pushField(text.length); rows.push(row) }
  return rows
}

function renderCsv() {
  if (csvRenderFrame) {
    cancelAnimationFrame(csvRenderFrame)
    csvRenderFrame = null
  }
  const host = $('csv-preview')
  host.classList.toggle('csv-wrap-cells', csvWrapCells)
  const model = getCsvPreviewModel()
  if (!model) {
    host.innerHTML = '<div class="csv-empty">内容较大，已跳过自动预览</div>'
    return
  }
  if (!model.rows.length) {
    host.innerHTML = '<div class="csv-empty">无 CSV 数据，首行作为表头</div>'
    return
  }
  syncCsvSizeInputs(model)
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const { rows, cols, head, visibleBody } = model
  ensureCsvColumnWidths(model)
  const widthStyle = col => csvColumnWidths[col]
    ? ` style="width:${csvColumnWidths[col]}px;min-width:${csvColumnWidths[col]}px;max-width:${csvColumnWidths[col]}px"`
    : ''
  const selectedClass = (row, col) => {
    if (!csvSelection) return ''
    if (csvSelection.type === 'cell' && csvSelection.row === row && csvSelection.col === col) return ' csv-selected'
    if (csvSelection.type === 'row' && csvSelection.row === row) return ' csv-selected'
    if (csvSelection.type === 'col' && csvSelection.col === col) return ' csv-selected'
    if (csvSelection.type === 'range' && row != null && col != null && csvInRange(row, col, csvSelection)) return ' csv-selected'
    if (csvSelection.type === 'rowRange' && row != null && csvInNumberRange(row, csvSelection.startRow, csvSelection.endRow)) return ' csv-selected'
    if (csvSelection.type === 'colRange' && col != null && csvInNumberRange(col, csvSelection.startCol, csvSelection.endCol)) return ' csv-selected'
    return ''
  }
  const tdHtml = (cell, col, row) => cell
    ? `<td class="${selectedClass(row, col)}" data-start="${cell.start}" data-end="${cell.end}" data-row="${row}" data-col="${col}"${widthStyle(col)}>${esc(cell.value)}</td>`
    : `<td class="${selectedClass(row, col)}" data-row="${row}" data-col="${col}"${widthStyle(col)}></td>`
  const filterCellHtml = col => {
    const label = csvColumnFilters[col] ? esc(csvColumnFilters[col]) : ''
    return `<th class="csv-filter-cell" data-filter-col="${col}" data-col="${col}" contenteditable="false" spellcheck="false"${widthStyle(col)}>${label}</th>`
  }
  const rowFilterCellHtml = () => {
    const label = csvAllRowsFilter ? esc(csvAllRowsFilter) : ''
    return `<th class="csv-row-filter-cell csv-filter-cell" data-filter-scope="row" contenteditable="false" spellcheck="false">${label}</th>`
  }
  const thHtml = (cell, col) => {
    const attrs = cell && !cell.generated ? ` data-start="${cell.start}" data-end="${cell.end}"` : ''
    const value = cell ? esc(cell.value) : ''
    return `<th${attrs} class="csv-head-cell${selectedClass(null, col)}" data-col="${col}"${widthStyle(col)}><span class="csv-th-inner">${value}</span><span class="csv-col-resizer" data-resize-col="${col}"></span></th>`
  }
  const rowNumberHtml = index => `<th class="csv-row-number${selectedClass(index, null)}" data-row="${index}">${index + 1}</th>`
  let html = '<table class="csv-table"><thead><tr class="csv-filter-row">'
  html += rowFilterCellHtml()
  for (let k = 0; k < cols; k++) {
    if (!csvHiddenColumns.has(k)) html += filterCellHtml(k)
  }
  html += '</tr><tr class="csv-head-row">'
  html += '<th class="csv-row-number csv-row-head">#</th>'
  for (let k = 0; k < cols; k++) {
    if (!csvHiddenColumns.has(k)) html += thHtml(head[k], k)
  }
  html += '</tr></thead><tbody>'
  visibleBody.forEach(item => {
    html += '<tr>'
    html += rowNumberHtml(item.sourceIndex)
    const r = item.row
    for (let k = 0; k < cols; k++) {
      if (!csvHiddenColumns.has(k)) html += tdHtml(r[k], k, item.sourceIndex)
    }
    html += '</tr>'
  })
  const visibleCols = Math.max(1, cols - csvHiddenColumns.size)
  if (!visibleBody.length) html += `<tr><td colspan="${visibleCols + 1}" class="csv-no-match">无匹配数据</td></tr>`
  html += '</tbody></table>'
  host.innerHTML = html
  const table = host.querySelector('.csv-table')
  if (table) {
    const tableWidth = 42 + Array.from({ length: cols }, (_, col) =>
      csvHiddenColumns.has(col) ? 0 : (csvColumnWidths[col] || CSV_COL_MIN_WIDTH)
    ).reduce((sum, width) => sum + width, 0)
    table.style.width = `${tableWidth}px`
  }
  lockCsvColumnWidths(cols)
}

function getCsvPreviewModel() {
  const text = $('editor').value
  if (text.length > CSV_PREVIEW_TEXT_LIMIT) return null
  const rows = parseCsv(text)
  if (!rows.length) return { rows, cols: 0, head: [], visibleBody: [] }
  const cols = Math.max(...rows.map(r => r.length))
  const head = csvFirstRowHeader ? rows[0] : createCsvGeneratedHead(cols)
  const bodyStartIndex = csvFirstRowHeader ? 1 : 0
  const body = (csvFirstRowHeader ? rows.slice(1) : rows).map((row, i) => ({ row, sourceIndex: bodyStartIndex + i }))
  const visibleBody = csvHasActiveFilters()
    ? body.filter(item => csvRowMatchesFilters(item.row, csvColumnFilters, csvAllRowsFilter))
    : body
  return { rows, cols, head, visibleBody }
}

function createCsvGeneratedHead(cols) {
  return Array.from({ length: cols }, (_, i) => ({ value: csvColumnName(i), generated: true }))
}

function csvColumnName(index) {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

function csvHasActiveFilters() {
  return !!csvAllRowsFilter || csvColumnFilters.some(Boolean)
}

function csvRowMatchesFilters(row, columnFilters, rowFilter) {
  if (rowFilter) {
    const rowText = row.map(cell => cell ? cell.value : '').join('\u0000')
    if (!csvMatchesFilter(rowText, rowFilter)) return false
  }
  return columnFilters.every((filter, col) => {
    if (!filter) return true
    const value = row[col] ? row[col].value : ''
    return csvMatchesFilter(value, filter)
  })
}

function csvMatchesFilter(value, filter) {
  if (!filter.includes('*')) return value.toLowerCase().includes(filter.toLowerCase())
  const pattern = filter
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(pattern, 'i').test(value)
}

function estimateCsvColumnWidth(value) {
  const text = String(value || '')
  const wide = (text.match(/[^\x00-\xff]/g) || []).length
  const narrow = text.length - wide
  return Math.ceil(wide * 12 + narrow * 7 + 24)
}

function ensureCsvColumnWidths(model) {
  const sampleRows = model.visibleBody.slice(0, 80)
  for (let col = 0; col < model.cols; col++) {
    if (csvColumnWidths[col]) continue
    const values = [model.head[col]?.value || csvColumnName(col)]
    sampleRows.forEach(item => values.push(item.row[col]?.value || ''))
    const width = Math.max(...values.map(estimateCsvColumnWidth))
    csvColumnWidths[col] = Math.max(CSV_COL_MIN_WIDTH, Math.min(CSV_COL_MAX_WIDTH, width))
  }
}

function lockCsvColumnWidths(cols) {
  const heads = document.querySelectorAll('#csv-preview .csv-head-cell[data-col]')
  for (let col = 0; col < cols; col++) {
    if (!csvColumnWidths[col] && heads[col]) {
      csvColumnWidths[col] = Math.max(CSV_COL_MIN_WIDTH, Math.min(CSV_COL_MAX_WIDTH, Math.round(heads[col].getBoundingClientRect().width)))
    }
  }
  document.querySelectorAll('#csv-preview [data-col]').forEach(cell => {
    const width = csvColumnWidths[parseInt(cell.dataset.col, 10)]
    if (!width) return
    cell.style.width = `${width}px`
    cell.style.minWidth = `${width}px`
    cell.style.maxWidth = `${width}px`
  })
}

function applyCsvColumnWidth(col, width) {
  document.querySelectorAll(`#csv-preview [data-col="${col}"]`).forEach(cell => {
    cell.style.width = `${width}px`
    cell.style.minWidth = `${width}px`
    cell.style.maxWidth = `${width}px`
  })
}

function setCsvDragSelection(selection) {
  csvSelection = selection
  requestCsvRender()
}

function finishCsvDragSelection() {
  if (!csvDragSelection) return
  csvSuppressNextClick = csvDragSelection.moved
  csvDragSelection = null
}

function csvInNumberRange(value, a, b) {
  return value >= Math.min(a, b) && value <= Math.max(a, b)
}

function csvInRange(row, col, selection) {
  return csvInNumberRange(row, selection.startRow, selection.endRow) &&
    csvInNumberRange(col, selection.startCol, selection.endCol)
}

function csvNearColumnEdge(e, th) {
  return th.getBoundingClientRect().right - e.clientX <= 8
}

function serializeCsv(rows) {
  return rows.map(row => row.map(cell => serializeCsvField(cell ? cell.value : '')).join(csvDelimiter || ',')).join('\n')
}

function serializeCsvField(value) {
  const s = String(value)
  const delimiter = csvDelimiter || ','
  return (s.includes(delimiter) || /["\r\n]|^\s|\s$/.test(s))
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function csvTemplateText(rowCount, colCount) {
  const rows = Math.max(1, rowCount)
  const cols = Math.max(1, colCount)
  const line = Array.from({ length: cols }, () => '').join(csvDelimiter || ',')
  return Array.from({ length: rows }, () => line).join('\n')
}

function syncCsvSizeInputs(model) {
  const rowInput = $('csv-template-rows')
  const colInput = $('csv-template-cols')
  if (!rowInput || !colInput || !model || !model.rows.length) return
  if (document.activeElement !== rowInput) rowInput.value = String(model.rows.length)
  if (document.activeElement !== colInput) colInput.value = String(model.cols)
}

function resizeCsvRows(rows, rowCount, colCount) {
  const next = rows.slice(0, rowCount).map(row => row.slice(0, colCount))
  while (next.length < rowCount) next.push(createEmptyCsvRow(colCount))
  next.forEach(row => {
    while (row.length < colCount) row.push({ value: '', start: 0, end: 0 })
  })
  return next
}

function applyCsvSizeFromInputs() {
  const rowInput = $('csv-template-rows')
  const colInput = $('csv-template-cols')
  if (!rowInput || !colInput) return
  const rows = parseInt(rowInput.value, 10)
  const cols = parseInt(colInput.value, 10)
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return
  const editor = $('editor')
  const before = editor.value
  const parsed = before.length <= CSV_PREVIEW_TEXT_LIMIT ? parseCsv(before) : []
  const after = parsed.length
    ? serializeCsv(resizeCsvRows(parsed, rows, cols))
    : csvTemplateText(rows, cols)
  if (after === before) return
  flushTyping()
  pushUndo({ value: before, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd })
  editor.value = after
  csvSelection = null
  csvColumnWidths.length = 0
  csvColumnFilters.length = 0
  csvHiddenColumns.clear()
  persistCurrent()
  updateCount()
  $('csv-stats-output').innerHTML = ''
  renderCsv()
  showUndo('调整 CSV 行列')
}

function applyCsvRows(name, rows) {
  const editor = $('editor')
  const before = editor.value
  const after = serializeCsv(rows)
  if (after === before) return
  flushTyping()
  pushUndo({ value: before, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd })
  editor.value = after
  persistCurrent()
  updateCount()
  $('csv-stats-output').innerHTML = ''
  renderCsv()
  showUndo(name)
}

function getCsvRowsForEdit() {
  const text = $('editor').value
  if (text.length > CSV_PREVIEW_TEXT_LIMIT) return null
  const rows = parseCsv(text)
  return rows.length ? rows : null
}

function getCsvSelectedRow() {
  if (!csvSelection) return null
  return csvSelection.type === 'row' || csvSelection.type === 'cell' ? csvSelection.row : null
}

function getCsvSelectedCol() {
  if (!csvSelection) return null
  return csvSelection.type === 'col' || csvSelection.type === 'cell' ? csvSelection.col : null
}

function getCsvSelectedRowIndexes() {
  if (!csvSelection) return []
  if (csvSelection.type === 'row') return [csvSelection.row]
  if (csvSelection.type === 'cell') return [csvSelection.row]
  if (csvSelection.type === 'rowRange') return csvRangeValues(csvSelection.startRow, csvSelection.endRow)
  return []
}

function getCsvSelectedColIndexes() {
  if (!csvSelection) return []
  const cols = (() => {
    if (csvSelection.type === 'col') return [csvSelection.col]
    if (csvSelection.type === 'cell') return [csvSelection.col]
    if (csvSelection.type === 'colRange') return csvRangeValues(csvSelection.startCol, csvSelection.endCol)
    return []
  })()
  return cols.filter(col => !csvHiddenColumns.has(col))
}

function getCsvRowInsertIndex(position) {
  const indexes = getCsvSelectedRowIndexes()
  if (!indexes.length) return null
  return position === 'above' ? Math.min(...indexes) : Math.max(...indexes) + 1
}

function getCsvColInsertIndex(position) {
  const indexes = getCsvSelectedColIndexes()
  if (!indexes.length) return null
  return position === 'left' ? Math.min(...indexes) : Math.max(...indexes) + 1
}

function csvRangeValues(a, b) {
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

function createEmptyCsvRow(cols) {
  return Array.from({ length: cols }, () => ({ value: '', start: 0, end: 0 }))
}

function insertCsvRow(position) {
  const rows = getCsvRowsForEdit()
  if (!rows) return
  const index = getCsvRowInsertIndex(position)
  if (index == null) { showToast('先选中一行或单元格'); return }
  const cols = Math.max(1, ...rows.map(row => row.length))
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, createEmptyCsvRow(cols))
  csvSelection = { type: 'row', row: Math.max(0, Math.min(index, rows.length - 1)) }
  applyCsvRows(position === 'above' ? '上方新增 CSV 行' : '下方新增 CSV 行', rows)
}

function insertCsvCol(position) {
  const rows = getCsvRowsForEdit()
  if (!rows) return
  const index = getCsvColInsertIndex(position)
  if (index == null) { showToast('先选中一列或单元格'); return }
  const insertAt = Math.max(0, index)
  rows.forEach(row => {
    while (row.length < insertAt) row.push({ value: '', start: 0, end: 0 })
    row.splice(insertAt, 0, { value: '', start: 0, end: 0 })
  })
  csvColumnFilters.splice(insertAt, 0, '')
  csvColumnWidths.splice(insertAt, 0, 0)
  shiftCsvHiddenColumns(insertAt, 1)
  csvSelection = { type: 'col', col: insertAt }
  applyCsvRows(position === 'left' ? '左侧新增 CSV 列' : '右侧新增 CSV 列', rows)
}

function shiftCsvHiddenColumns(start, delta) {
  const shifted = new Set()
  csvHiddenColumns.forEach(col => {
    shifted.add(col >= start ? col + delta : col)
  })
  csvHiddenColumns.clear()
  shifted.forEach(col => csvHiddenColumns.add(col))
}

function deleteCsvSelectedRow() {
  const rowIndexes = getCsvSelectedRowIndexes()
  if (!rowIndexes.length) { showToast('先选中行、行范围或单元格'); return }
  const rows = getCsvRowsForEdit()
  if (!rows) return
  rowIndexes.sort((a, b) => b - a).forEach(rowIndex => {
    if (rows[rowIndex]) rows.splice(rowIndex, 1)
  })
  csvSelection = null
  applyCsvRows('删除 CSV 行', rows)
}

function deleteCsvSelectedCol() {
  const cols = getCsvSelectedColIndexes()
  if (!cols.length) { showToast('先选中列、列范围或单元格'); return }
  const rows = getCsvRowsForEdit()
  if (!rows) return
  const deleteCols = new Set(cols)
  cols.sort((a, b) => b - a).forEach(col => {
    rows.forEach(row => {
      if (col < row.length) row.splice(col, 1)
    })
    csvColumnFilters.splice(col, 1)
    csvColumnWidths.splice(col, 1)
  })
  remapCsvHiddenColumnsAfterDelete(deleteCols)
  csvSelection = null
  applyCsvRows('删除 CSV 列', rows)
}

function remapCsvHiddenColumnsAfterDelete(deleteCols) {
  const shifted = new Set()
  csvHiddenColumns.forEach(col => {
    if (deleteCols.has(col)) return
    let removedBefore = 0
    deleteCols.forEach(deleted => {
      if (deleted < col) removedBefore++
    })
    shifted.add(col - removedBefore)
  })
  csvHiddenColumns.clear()
  shifted.forEach(col => csvHiddenColumns.add(col))
}

function hideCsvSelectedCols() {
  const cols = getCsvSelectedColIndexes()
  if (!cols.length) { showToast('先选中列或单元格'); return }
  cols.forEach(col => csvHiddenColumns.add(col))
  csvSelection = null
  $('csv-stats-output').innerHTML = ''
  renderCsv()
}

function showAllCsvCols() {
  csvHiddenColumns.clear()
  $('csv-stats-output').innerHTML = ''
  renderCsv()
}

function openCsvChartModal() {
  const model = getCsvPreviewModel()
  if (!model || !model.rows.length) { showToast('没有可绘制的 CSV 数据'); return }
  const cols = getCsvVisibleColumns(model)
  if (!cols.length) { showToast('没有可见列'); return }
  const options = cols.map(col => `<option value="${col}">${escapeHtml(csvColumnNameOnly(model.head, col))}</option>`).join('')
  $('csv-chart-x').innerHTML = options
  $('csv-chart-y').innerHTML = options
  if (cols.length > 1) $('csv-chart-y').value = String(cols[1])
  $('csv-chart-error').textContent = ''
  $('csv-chart-view').innerHTML = ''
  $('csv-chart-modal').style.display = ''
  updateCsvChartAxisControls()
  drawCsvChart()
}

function closeCsvChartModal() {
  $('csv-chart-modal').style.display = 'none'
}

function getCsvVisibleColumns(model) {
  return Array.from({ length: model.cols }, (_, i) => i).filter(col => !csvHiddenColumns.has(col))
}

function csvColumnLabel(head, col) {
  const value = head[col] && head[col].value ? head[col].value : csvColumnName(col)
  return `${csvColumnName(col)} · ${value}`
}

function csvColumnNameOnly(head, col) {
  return head[col] && head[col].value ? head[col].value : csvColumnName(col)
}

function drawCsvChart() {
  const model = getCsvPreviewModel()
  if (!model || !model.rows.length) return
  updateCsvChartAxisControls()
  const xCol = parseInt($('csv-chart-x').value, 10)
  const yCol = parseInt($('csv-chart-y').value, 10)
  const type = $('csv-chart-type').value
  let points = model.visibleBody.map((item, i) => {
    const xRaw = item.row[xCol] ? item.row[xCol].value : ''
    const yRaw = item.row[yCol] ? item.row[yCol].value : ''
    const histRaw = item.row[xCol] ? item.row[xCol].value : ''
    return { label: xRaw || String(i + 1), x: Number(xRaw), y: Number(type === 'histogram' ? histRaw : yRaw), index: i }
  }).filter(p => Number.isFinite(p.y))
  if (!points.length) {
    $('csv-chart-error').textContent = type === 'histogram' ? '数据列没有可绘制的数值' : 'Y 轴没有可绘制的数值'
    $('csv-chart-view').innerHTML = ''
    return
  }
  if (type === 'histogram') points = buildCsvHistogramPoints(points.map(p => p.y), getCsvChartBinCount())
  const sampled = sampleCsvChartPoints(points, type === 'bar' ? 300 : 1200)
  $('csv-chart-error').textContent = sampled.length < points.length ? `数据较多，已抽样绘制 ${sampled.length} / ${points.length}` : ''
  $('csv-chart-view').innerHTML = renderCsvChartSvg(sampled, type, {
    xName: type === 'histogram' ? csvColumnNameOnly(model.head, xCol) : csvColumnNameOnly(model.head, xCol),
    yName: type === 'histogram' ? '频率' : csvColumnNameOnly(model.head, yCol),
    useNumericX: (type === 'line' || type === 'scatter') && points.every(p => Number.isFinite(p.x)),
    xMinOverride: parseFiniteNumber($('csv-chart-x-min').value),
    xMaxOverride: parseFiniteNumber($('csv-chart-x-max').value),
    yMinOverride: parseFiniteNumber($('csv-chart-y-min').value),
    yMaxOverride: parseFiniteNumber($('csv-chart-y-max').value)
  })
}

function updateCsvChartAxisControls() {
  const isBar = $('csv-chart-type').value === 'bar'
  const isHistogram = $('csv-chart-type').value === 'histogram'
  $('csv-chart-x-label').textContent = isBar ? '类别列' : (isHistogram ? '数据列' : 'X 轴')
  $('csv-chart-y-field').style.display = isHistogram ? 'none' : ''
  $('csv-chart-bin-field').style.display = isHistogram ? '' : 'none'
  $('csv-chart-x-scale-field').style.display = (isBar || isHistogram) ? 'none' : ''
}

function parseFiniteNumber(value) {
  if (String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function sampleCsvChartPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  return Array.from({ length: maxPoints }, (_, i) => points[Math.floor(i * step)])
}

function getCsvChartBinCount() {
  const n = parseInt($('csv-chart-bins').value, 10)
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 10
}

function buildCsvHistogramPoints(values, bins) {
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) { min -= 0.5; max += 0.5 }
  const width = (max - min) / bins
  const counts = Array.from({ length: bins }, () => 0)
  values.forEach(v => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)))
    counts[index]++
  })
  return counts.map((count, i) => {
    const start = min + i * width
    const end = start + width
    return { label: `${formatCsvNumber(start)}-${formatCsvNumber(end)}`, x: i, y: count, index: i }
  })
}

function renderCsvChartSvg(points, type, meta) {
  const w = 720, h = 340
  const pad = { l: 56, r: 18, t: 32, b: 48 }
  const plotW = w - pad.l - pad.r
  const plotH = h - pad.t - pad.b
  const ys = points.map(p => p.y)
  const yRange = paddedRange(ys, meta.yMinOverride, meta.yMaxOverride)
  const minY = yRange.min
  const maxY = yRange.max
  const yScale = y => pad.t + (maxY - y) / (maxY - minY) * plotH
  const xs = meta.useNumericX ? points.map(p => p.x) : points.map(p => p.index)
  const xRange = meta.useNumericX
    ? paddedRange(xs, meta.xMinOverride, meta.xMaxOverride)
    : { min: -0.5, max: Math.max(points.length - 0.5, 0.5) }
  const minX = xRange.min
  const maxX = xRange.max
  const xScale = (x, i) => meta.useNumericX
    ? pad.l + (x - minX) / (maxX - minX) * plotW
    : pad.l + ((i + 0.5) / Math.max(1, points.length)) * plotW
  const axis = `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" stroke="var(--border)"/><line x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}" stroke="var(--border)"/>`
  const axisLabels = `<text x="${pad.l + plotW / 2}" y="${h - 12}" text-anchor="middle" fill="var(--text-dim)" font-size="11">${escapeHtml(meta.xName)}</text><text x="14" y="${pad.t + plotH / 2}" transform="rotate(-90 14 ${pad.t + plotH / 2})" text-anchor="middle" fill="var(--text-dim)" font-size="11">${escapeHtml(meta.yName)}</text>`
  const yLabels = makeChartTicks(minY, maxY, 5).map(v => {
    const y = yScale(v)
    return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="var(--border)" opacity=".35"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-dim)" font-size="10">${escapeHtml(formatCsvNumber(v))}</text>`
  }).join('')
  const xLabels = makeChartXTicks(points, meta.useNumericX, minX, maxX, xScale).map(t =>
    `<line x1="${t.x}" y1="${h - pad.b}" x2="${t.x}" y2="${h - pad.b + 4}" stroke="var(--border)"/><text x="${t.x}" y="${h - pad.b + 17}" text-anchor="middle" fill="var(--text-dim)" font-size="10">${escapeHtml(t.label)}</text>`
  ).join('')
  const coords = points.map((p, i) => ({ ...p, sx: xScale(p.x, i), sy: yScale(p.y) }))
  let body = ''
  if (type === 'bar' || type === 'histogram') {
    const bw = Math.max(4, Math.min(28, plotW / Math.max(1, points.length) * 0.62))
    const base = yScale(Math.max(minY, Math.min(maxY, 0)))
    body = coords.map(p => `<rect x="${p.sx - bw / 2}" y="${Math.min(p.sy, base)}" width="${bw}" height="${Math.max(1, Math.abs(base - p.sy))}" fill="var(--accent)" opacity=".8"><title>${escapeHtml(p.label)}: ${escapeHtml(formatCsvNumber(p.y))}</title></rect>`).join('')
  } else {
    const dots = coords.map(p => `<circle cx="${p.sx}" cy="${p.sy}" r="3" fill="var(--accent)"><title>${escapeHtml(p.label)}: ${escapeHtml(formatCsvNumber(p.y))}</title></circle>`).join('')
    const line = type === 'line' ? `<polyline points="${coords.map(p => `${p.sx},${p.sy}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ''
    body = line + dots
  }
  return `<svg viewBox="0 0 ${w} ${h}" role="img">${axis}${yLabels}${xLabels}${axisLabels}${body}</svg>`
}

function makeChartTicks(min, max, target) {
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / Math.max(1, target - 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const residual = rawStep / magnitude
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10
  const step = nice * magnitude
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step * 0.5; v += step) {
    if (v >= min - step * 0.5) ticks.push(Number(v.toFixed(10)))
  }
  if (!ticks.length) return [min, max]
  return ticks
}

function makeChartXTicks(points, numeric, minX, maxX, xScale) {
  if (numeric) {
    return makeChartTicks(minX, maxX, 5).map(v => ({ x: xScale(v, 0), label: formatCsvNumber(v) }))
  }
  const count = points.length
  if (!count) return []
  const maxLabels = 6
  const step = Math.max(1, Math.ceil(count / maxLabels))
  const ticks = []
  for (let i = 0; i < count; i += step) {
    ticks.push({ x: xScale(points[i].x, i), label: truncateChartLabel(points[i].label) })
  }
  if (ticks[ticks.length - 1]?.label !== truncateChartLabel(points[count - 1].label)) {
    ticks.push({ x: xScale(points[count - 1].x, count - 1), label: truncateChartLabel(points[count - 1].label) })
  }
  return ticks
}

function truncateChartLabel(label) {
  const s = String(label)
  return s.length > 10 ? `${s.slice(0, 9)}…` : s
}

function paddedRange(values, minOverride, maxOverride) {
  let min = minOverride != null ? minOverride : Math.min(...values)
  let max = maxOverride != null ? maxOverride : Math.max(...values)
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1)
    if (minOverride == null) min -= pad
    if (maxOverride == null) max += pad
  } else {
    const pad = (max - min) * 0.06
    if (minOverride == null) min -= pad
    if (maxOverride == null) max += pad
  }
  if (min === max) max = min + 1
  return { min, max }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showCsvStats() {
  const values = getCsvSelectedValues()
  if (!values) { showToast('先选中行、列或单元格'); return }
  const nonEmpty = values.filter(v => v !== '')
  const nums = nonEmpty.map(v => Number(v)).filter(Number.isFinite)
  const parts = [
    ['COUNT', values.length],
    ['NONEMPTY', nonEmpty.length],
    ['EMPTY', values.length - nonEmpty.length],
    ['UNIQUE', new Set(nonEmpty).size]
  ]
  if (nums.length) {
    let sum = 0
    let min = nums[0]
    let max = nums[0]
    nums.forEach(n => {
      sum += n
      if (n < min) min = n
      if (n > max) max = n
    })
    parts.push(
      ['NUMERIC', nums.length],
      ['SUM', formatCsvNumber(sum)],
      ['AVG', formatCsvNumber(sum / nums.length)],
      ['MIN', formatCsvNumber(min)],
      ['MAX', formatCsvNumber(max)]
    )
  }
  $('csv-stats-output').innerHTML = parts.map(([label, value]) =>
    `<span class="csv-stat-item"><span class="csv-stat-label">${label}</span><span class="csv-stat-value">${value}</span></span>`
  ).join('')
}

function getCsvSelectedValues() {
  if (!csvSelection) return null
  if (csvSelection.type === 'cell') {
    const cell = document.querySelector(`#csv-preview td[data-row="${csvSelection.row}"][data-col="${csvSelection.col}"]`)
    return cell ? [cell.textContent] : []
  }
  if (csvSelection.type === 'row') {
    return Array.from(document.querySelectorAll(`#csv-preview td[data-row="${csvSelection.row}"]`)).map(cell => cell.textContent)
  }
  if (csvSelection.type === 'col') {
    return Array.from(document.querySelectorAll(`#csv-preview tbody td[data-col="${csvSelection.col}"]`)).map(cell => cell.textContent)
  }
  if (csvSelection.type === 'range') {
    return Array.from(document.querySelectorAll('#csv-preview tbody td[data-row][data-col]'))
      .filter(cell => csvInRange(parseInt(cell.dataset.row, 10), parseInt(cell.dataset.col, 10), csvSelection))
      .map(cell => cell.textContent)
  }
  if (csvSelection.type === 'rowRange') {
    return Array.from(document.querySelectorAll('#csv-preview tbody td[data-row]'))
      .filter(cell => csvInNumberRange(parseInt(cell.dataset.row, 10), csvSelection.startRow, csvSelection.endRow))
      .map(cell => cell.textContent)
  }
  if (csvSelection.type === 'colRange') {
    return Array.from(document.querySelectorAll('#csv-preview tbody td[data-col]'))
      .filter(cell => csvInNumberRange(parseInt(cell.dataset.col, 10), csvSelection.startCol, csvSelection.endCol))
      .map(cell => cell.textContent)
  }
  return null
}

function formatCsvNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)))
}

// 双击单元格：在左侧编辑器选中该字段对应的原文区间，便于直接修改
$('csv-preview').addEventListener('dblclick', e => {
  if (e.target.closest('.csv-col-resizer')) return
  clearTimeout(csvClickTimer)
  csvClickTimer = null
  csvSuppressNextClick = false
  const filterCell = e.target.closest('.csv-filter-cell')
  if (filterCell) {
    filterCell.contentEditable = 'true'
    filterCell.focus()
    selectElementText(filterCell)
    return
  }
  const cell = e.target.closest('[data-start]')
  if (!cell) return
  const start = parseInt(cell.dataset.start, 10)
  const end = parseInt(cell.dataset.end, 10)
  const editor = $('editor')
  editor.focus()
  editor.setSelectionRange(start, end)
})

$('csv-preview').addEventListener('click', e => {
  if (csvSuppressNextClick) {
    csvSuppressNextClick = false
    return
  }
  if (e.target.closest('.csv-filter-cell')) return
  if (e.target.closest('.csv-col-resizer')) return
  clearTimeout(csvClickTimer)
  csvClickTimer = setTimeout(() => {
    csvClickTimer = null
    handleCsvSingleClick(e.target)
  }, 180)
})

function handleCsvSingleClick(target) {
  const rowNumber = target.closest('.csv-row-number[data-row]')
  if (rowNumber) {
    csvSelection = { type: 'row', row: parseInt(rowNumber.dataset.row, 10) }
    renderCsv()
    return
  }
  const head = target.closest('.csv-head-cell[data-col]')
  if (head) {
    csvSelection = { type: 'col', col: parseInt(head.dataset.col, 10) }
    renderCsv()
    return
  }
  const cell = target.closest('td[data-row][data-col]')
  if (cell) {
    csvSelection = { type: 'cell', row: parseInt(cell.dataset.row, 10), col: parseInt(cell.dataset.col, 10) }
    renderCsv()
  }
}

$('csv-preview').addEventListener('keydown', e => {
  const filterCell = e.target.closest('.csv-filter-cell')
  if (!filterCell) return
  if (e.key !== 'Enter') return
  e.preventDefault()
  if (filterCell.dataset.filterScope === 'row') {
    csvAllRowsFilter = filterCell.textContent.trim()
    renderCsv()
    return
  }
  const col = parseInt(filterCell.dataset.filterCol, 10)
  if (Number.isNaN(col)) return
  csvColumnFilters[col] = filterCell.textContent.trim()
  renderCsv()
})

$('csv-preview').addEventListener('blur', e => {
  const filterCell = e.target.closest('.csv-filter-cell')
  if (!filterCell) return
  if (filterCell.dataset.filterScope === 'row') {
    csvAllRowsFilter = filterCell.textContent.trim()
  } else {
    const col = parseInt(filterCell.dataset.filterCol, 10)
    if (!Number.isNaN(col)) csvColumnFilters[col] = filterCell.textContent.trim()
  }
  filterCell.contentEditable = 'false'
  renderCsv()
}, true)

$('csv-first-row-header').addEventListener('change', e => {
  csvFirstRowHeader = e.target.checked
  csvColumnWidths.length = 0
  csvSelection = null
  $('csv-stats-output').innerHTML = ''
  renderCsv()
})

$('csv-delimiter').addEventListener('input', e => {
  csvDelimiter = normalizeCsvDelimiter(e.target.value)
  csvColumnWidths.length = 0
  csvSelection = null
  $('csv-stats-output').innerHTML = ''
  renderCsv()
})

$('csv-delimiter').addEventListener('blur', e => {
  e.target.value = displayCsvDelimiter(csvDelimiter)
})

$('csv-template-rows').addEventListener('input', applyCsvSizeFromInputs)
$('csv-template-cols').addEventListener('input', applyCsvSizeFromInputs)

$('csv-wrap-cells').addEventListener('change', e => {
  csvWrapCells = e.target.checked
  renderCsv()
})

$('csv-insert-row-above').addEventListener('click', () => insertCsvRow('above'))
$('csv-insert-row-below').addEventListener('click', () => insertCsvRow('below'))
$('csv-insert-col-left').addEventListener('click', () => insertCsvCol('left'))
$('csv-insert-col-right').addEventListener('click', () => insertCsvCol('right'))
$('csv-delete-row').addEventListener('click', deleteCsvSelectedRow)
$('csv-delete-col').addEventListener('click', deleteCsvSelectedCol)
$('csv-hide-col').addEventListener('click', hideCsvSelectedCols)
$('csv-show-cols').addEventListener('click', showAllCsvCols)
$('csv-stats').addEventListener('click', showCsvStats)
$('csv-chart').addEventListener('click', openCsvChartModal)
$('csv-chart-type').addEventListener('change', drawCsvChart)
$('csv-chart-x').addEventListener('change', drawCsvChart)
$('csv-chart-y').addEventListener('change', drawCsvChart)
$('csv-chart-x-min').addEventListener('input', drawCsvChart)
$('csv-chart-x-max').addEventListener('input', drawCsvChart)
$('csv-chart-y-min').addEventListener('input', drawCsvChart)
$('csv-chart-y-max').addEventListener('input', drawCsvChart)
$('csv-chart-bins').addEventListener('input', drawCsvChart)
$('csv-chart-close').addEventListener('click', closeCsvChartModal)
$('csv-chart-overlay').addEventListener('click', closeCsvChartModal)

function selectElementText(el) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

$('csv-preview').addEventListener('mousedown', e => {
  const resizer = e.target.closest('.csv-col-resizer')
  if (resizer) {
    e.preventDefault()
    e.stopPropagation()
    const col = parseInt(resizer.dataset.resizeCol, 10)
    if (Number.isNaN(col)) return
    const resizeHead = resizer.closest('.csv-head-cell[data-col]')
    if (!resizeHead) return
    csvResizeState = {
      col,
      startX: e.clientX,
      startWidth: resizeHead.getBoundingClientRect().width
    }
    document.body.classList.add('csv-resizing')
    return
  }
  if (e.button !== 0 || e.target.closest('.csv-filter-cell')) return
  const rowNumber = e.target.closest('.csv-row-number[data-row]')
  if (rowNumber) {
    const row = parseInt(rowNumber.dataset.row, 10)
    if (Number.isNaN(row)) return
    csvDragSelection = { mode: 'row', startRow: row, endRow: row, moved: false }
    return
  }
  const head = e.target.closest('.csv-head-cell[data-col]')
  if (head) {
    const col = parseInt(head.dataset.col, 10)
    if (Number.isNaN(col)) return
    csvDragSelection = { mode: 'col', startCol: col, endCol: col, moved: false }
    return
  }
  const cell = e.target.closest('td[data-row][data-col]')
  if (!cell) return
  e.preventDefault()
  const row = parseInt(cell.dataset.row, 10)
  const col = parseInt(cell.dataset.col, 10)
  if (Number.isNaN(row) || Number.isNaN(col)) return
  csvDragSelection = { mode: 'cell', startRow: row, startCol: col, endRow: row, endCol: col, moved: false }
})

document.addEventListener('mouseover', e => {
  if (!csvDragSelection) return
  if (csvDragSelection.mode === 'cell') {
    const cell = e.target.closest('#csv-preview td[data-row][data-col]')
    if (!cell) return
    const row = parseInt(cell.dataset.row, 10)
    const col = parseInt(cell.dataset.col, 10)
    if (Number.isNaN(row) || Number.isNaN(col)) return
    if (row === csvDragSelection.endRow && col === csvDragSelection.endCol) return
    csvDragSelection.endRow = row
    csvDragSelection.endCol = col
    csvDragSelection.moved = true
    setCsvDragSelection({ type: 'range', startRow: csvDragSelection.startRow, startCol: csvDragSelection.startCol, endRow: row, endCol: col })
    return
  }
  if (csvDragSelection.mode === 'row') {
    const rowNumber = e.target.closest('#csv-preview .csv-row-number[data-row]')
    if (!rowNumber) return
    const row = parseInt(rowNumber.dataset.row, 10)
    if (Number.isNaN(row) || row === csvDragSelection.endRow) return
    csvDragSelection.endRow = row
    csvDragSelection.moved = true
    setCsvDragSelection({ type: 'rowRange', startRow: csvDragSelection.startRow, endRow: row })
    return
  }
  if (csvDragSelection.mode === 'col') {
    const head = e.target.closest('#csv-preview .csv-head-cell[data-col]')
    if (!head) return
    const col = parseInt(head.dataset.col, 10)
    if (Number.isNaN(col) || col === csvDragSelection.endCol) return
    csvDragSelection.endCol = col
    csvDragSelection.moved = true
    setCsvDragSelection({ type: 'colRange', startCol: csvDragSelection.startCol, endCol: col })
  }
})

document.addEventListener('mousemove', e => {
  if (!csvResizeState) return
  const width = Math.max(48, Math.round(csvResizeState.startWidth + e.clientX - csvResizeState.startX))
  csvColumnWidths[csvResizeState.col] = width
  applyCsvColumnWidth(csvResizeState.col, width)
})

document.addEventListener('mouseup', () => {
  if (csvResizeState) {
    csvResizeState = null
    document.body.classList.remove('csv-resizing')
  }
  finishCsvDragSelection()
})

window.addEventListener('blur', finishCsvDragSelection)
document.addEventListener('mouseleave', finishCsvDragSelection)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') finishCsvDragSelection()
})
