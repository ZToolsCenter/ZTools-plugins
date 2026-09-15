// ==================== 工具函数 ====================

const $ = id => document.getElementById(id)

function getDbStorage() {
  return window.ideadockHost.storage
}

function storeGet(key) {
  const db = getDbStorage()
  if (!db || typeof db.getItem !== 'function') return null
  try {
    const value = db.getItem(key)
    return value !== undefined ? value : null
  } catch {
    return null
  }
}

function storeSet(key, value) {
  const db = getDbStorage()
  if (!db || typeof db.setItem !== 'function') return
  try { db.setItem(key, value) } catch {}
}

function storeRemove(key) {
  const db = getDbStorage()
  if (!db || typeof db.removeItem !== 'function') return
  try { db.removeItem(key) } catch {}
}

const RIGHT_PANEL_IDS = ['python-output-panel', 'js-output-panel', 'md-preview-panel', 'csv-preview-panel', 'html-preview-panel', 'ai-panel']
const EDITOR_RIGHT_PANEL_IDS = [...RIGHT_PANEL_IDS, 'compare-panel']

function hasEditorRightPanel() {
  return EDITOR_RIGHT_PANEL_IDS.some(id => {
    const el = $(id)
    return el && el.style.display !== 'none'
  })
}

function updateEditorGridLayout() {
  const grid = $('editor-grid')
  if (!grid || typeof splitCols === 'undefined') return
  grid.classList.toggle('two-pane-horizontal', splitCols === 2 && !hasEditorRightPanel())
}

function renderLangPanel(lang) {
  if (lang === 'markdown') renderMarkdown()
  if (lang === 'csv') renderCsv()
  if (lang === 'html') renderHtml()
}

function setLangPanel(lang, opts = {}) {
  const render = opts.render !== false
  RIGHT_PANEL_IDS.forEach(id => { $(id).style.display = 'none' })
  $('python-output-panel').style.display = lang === 'python' ? '' : 'none'
  $('js-output-panel').style.display = lang === 'js' ? '' : 'none'
  $('md-preview-panel').style.display = lang === 'markdown' ? '' : 'none'
  $('csv-preview-panel').style.display = lang === 'csv' ? '' : 'none'
  $('html-preview-panel').style.display = lang === 'html' ? '' : 'none'
  if (render) renderLangPanel(lang)
  updateEditorGridLayout()
  updateSplitHandle()
}

function showLangPanel(lang = $('lang-select').value, opts = {}) {
  if (typeof compareOpen !== 'undefined' && compareOpen) closeCompare({ restorePanel: false })
  if ($('ai-panel')) $('ai-panel').style.display = 'none'
  if ($('btn-ai')) $('btn-ai').classList.remove('active')
  if (window.markAiPanelClosed) window.markAiPanelClosed()
  $('compare-panel').style.display = 'none'
  $('btn-compare').classList.remove('active')
  $('editor-grid').style.display = ''
  updateEditorGridLayout()
  setLangPanel(lang, opts)
}

// 文本处理纯函数（splitWords / MORSE / ops）已抽至 text-ops.js（在 app.js 前加载）

// ==================== 暂存槽管理 ====================

const SLOTS_KEY = 'ideadock.slots'
const ACTIVE_KEY = 'ideadock.activeSlot'
const PINNED_KEY = 'ideadock.pinned'
const SPLIT_COLS_KEY = 'ideadock.splitCols'
const SPLIT_BINDINGS_KEY = 'ideadock.splitBindings'

let slots = []
let activeId = null
let editingSlotId = null
let slotTitleClickTimer = null
let splitCols = 1
let splitBindings = [null, null, null, null]
let activePaneIndex = 0

// 固定到桌面：slotId -> 悬浮窗 bounds（持久化），slotId -> 悬浮窗对象（仅本次会话）
const pinnedRecords = new Map()
const pinnedWindows = new Map()

// 撤销/重做历史：每个暂存槽各自维护一份栈，参考主流编辑器约定保留最近 100 步
const MAX_HISTORY = 100
const slotHistory = new Map() // id -> { undo: [], redo: [] }
let typingActive = false
let typingTimer = null
let beforeTypingState = null
let persistTimer = null
let slotsDirty = false
let slotTabsDirty = false
let findTimer = null
let resizeWorkFrame = null
let slotDeleteUndo = null
const FIND_HIGHLIGHT_TEXT_LIMIT = 120000
const FIND_HIGHLIGHT_MATCH_LIMIT = 1000

function loadSlots() {
  try {
    const raw = storeGet(SLOTS_KEY)
    if (raw) slots = JSON.parse(raw)
  } catch {}
  if (!slots || slots.length === 0) {
    slots = [{ id: 1, name: '暂存1', text: '' }]
  }
  activeId = parseInt(storeGet(ACTIVE_KEY), 10)
  if (!slots.some(s => s.id === activeId)) activeId = slots[0].id
}

function saveSlots() {
  clearTimeout(persistTimer)
  persistTimer = null
  slotsDirty = false
  storeSet(SLOTS_KEY, JSON.stringify(slots))
  storeSet(ACTIVE_KEY, String(activeId))
}

function nextSlotId() {
  const maxId = slots.reduce((max, slot) => Math.max(max, Number(slot.id) || 0), 0)
  return maxId + 1
}

function nextDefaultSlotName() {
  const used = new Set()
  slots.forEach(slot => {
    const match = /^暂存(\d+)$/.exec(slot.name || '')
    if (match) used.add(Number(match[1]))
  })
  let n = 1
  while (used.has(n)) n++
  return `暂存${n}`
}

function loadSplitLayout() {
  splitCols = Math.max(1, Math.min(4, parseInt(storeGet(SPLIT_COLS_KEY), 10) || 1))
  try {
    const arr = JSON.parse(storeGet(SPLIT_BINDINGS_KEY))
    if (Array.isArray(arr)) splitBindings = arr.slice(0, 4)
  } catch {}
  while (splitBindings.length < 4) splitBindings.push(null)
  splitBindings = splitBindings.map(id => slots.some(s => s.id === id) ? id : null)
  splitBindings[0] = activeId
  const seen = new Set()
  splitBindings = splitBindings.map(id => {
    if (id == null) return null
    if (seen.has(id)) return null
    seen.add(id)
    return id
  })
}

function saveSplitLayout() {
  storeSet(SPLIT_COLS_KEY, String(splitCols))
  storeSet(SPLIT_BINDINGS_KEY, JSON.stringify(splitBindings))
}

function visiblePaneIndexForSlot(id) {
  for (let i = 0; i < splitCols; i++) {
    if (splitBindings[i] === id) return i
  }
  return -1
}

function slotById(id) {
  return slots.find(s => s.id === id)
}

function loadPinned() {
  try {
    const raw = storeGet(PINNED_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    pinnedRecords.clear()
    Object.keys(obj).forEach(k => {
      const n = Number(k)
      pinnedRecords.set(Number.isFinite(n) && String(n) === k ? n : k, obj[k])
    })
  } catch {}
}

function savePinned() {
  const obj = {}
  pinnedRecords.forEach((bounds, id) => { obj[id] = bounds })
  storeSet(PINNED_KEY, JSON.stringify(obj))
}

function getActiveSlot() {
  return slots.find(s => s.id === activeId)
}

function updatePinButton() {
  const btn = $('btn-pin-slot')
  if (!btn) return
  const pinned = pinnedRecords.has(activeId)
  btn.classList.toggle('active', pinned)
  btn.setAttribute('aria-pressed', String(pinned))
  btn.title = pinned ? '取消钉住当前文本槽' : '将当前文本槽钉住到桌面'
}

function slotTitle(slot) {
  if (slot.named) return slot.name
  const text = slot.text.trim()
  if (!text) return slot.name
  const firstLine = text.split(/\r?\n/)[0].trim()
  const title = firstLine || text
  return title.length > 8 ? title.slice(0, 8) + '…' : title
}

// 隐藏了原生横向滚动条后：滚轮转横向滚动 + 两侧按需显示滚动箭头。仅绑定一次
function initSlotsScroll() {
  const wrap = $('slots')
  const left = $('slots-arrow-left')
  const right = $('slots-arrow-right')
  wrap.addEventListener('wheel', e => {
    if (e.deltaY === 0) return
    if (wrap.scrollWidth <= wrap.clientWidth) return
    wrap.scrollLeft += e.deltaY
    e.preventDefault()
  }, { passive: false })
  wrap.addEventListener('scroll', updateSlotsArrows)
  window.addEventListener('resize', updateSlotsArrows)
  const step = () => Math.max(120, Math.round(wrap.clientWidth * 0.7))
  left.addEventListener('click', () => wrap.scrollBy({ left: -step(), behavior: 'smooth' }))
  right.addEventListener('click', () => wrap.scrollBy({ left: step(), behavior: 'smooth' }))
  updateSlotsArrows()
}

// 依据当前滚动位置，某侧还有可滚动内容才显示对应箭头
function updateSlotsArrows() {
  const wrap = $('slots')
  const left = $('slots-arrow-left')
  const right = $('slots-arrow-right')
  if (!wrap || !left || !right) return
  const max = wrap.scrollWidth - wrap.clientWidth
  left.classList.toggle('visible', wrap.scrollLeft > 1)
  right.classList.toggle('visible', wrap.scrollLeft < max - 1)
}

function renderSlots() {
  const wrap = $('slots')
  wrap.innerHTML = ''
  slots.forEach(s => {
    const tab = document.createElement('div')
    tab.className = 'slot-tab' + (s.id === activeId ? ' active' : '')
    tab.title = s.name
    tab.draggable = true
    tab.dataset.slotId = s.id

    const nameSpan = document.createElement('span')
    nameSpan.className = 'slot-title'
    nameSpan.textContent = slotTitle(s)
    nameSpan.draggable = false
    nameSpan.addEventListener('click', e => {
      e.stopPropagation()
      clearTimeout(slotTitleClickTimer)
      slotTitleClickTimer = setTimeout(() => switchSlot(s.id), 180)
    })
    nameSpan.addEventListener('dblclick', e => {
      e.preventDefault()
      e.stopPropagation()
      clearTimeout(slotTitleClickTimer)
      startRenameSlot(s.id, nameSpan)
    })

    const actions = document.createElement('span')
    actions.className = 'slot-actions'

    tab.appendChild(nameSpan)
    tab.appendChild(actions)

    if (slots.length > 1) {
      const closeSpan = document.createElement('span')
      closeSpan.className = 'slot-close'
      closeSpan.textContent = '×'
      actions.appendChild(closeSpan)
    }

    tab.addEventListener('click', e => {
      if (e.target.classList.contains('slot-close')) { closeSlot(s.id); return }
      if (e.target.closest('.slot-title')) return
      switchSlot(s.id)
    })
    tab.addEventListener('dragstart', e => {
      if (e.target.closest('.slot-actions, .slot-rename-input')) {
        e.preventDefault()
        return
      }
      e.dataTransfer.setData('text/plain', String(s.id))
      e.dataTransfer.effectAllowed = 'move'
    })
    wrap.appendChild(tab)
  })
  const spacer = document.createElement('div')
  spacer.className = 'slots-end-spacer'
  spacer.setAttribute('aria-hidden', 'true')
  wrap.appendChild(spacer)
  updatePinButton()
  updateSlotsArrows()
}

function attachPaneDnD(pane) {
  pane.addEventListener('dragover', e => {
    e.preventDefault()
    pane.classList.add('drag-over')
    e.dataTransfer.dropEffect = 'move'
  })
  pane.addEventListener('dragleave', () => pane.classList.remove('drag-over'))
  pane.addEventListener('drop', e => {
    e.preventDefault()
    pane.classList.remove('drag-over')
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (slots.some(s => s.id === id)) bindSlotToPane(parseInt(pane.dataset.pane, 10), id, true)
  })
}

function updateSplitButtons() {
  document.querySelectorAll('.split-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cols, 10) === splitCols)
  })
}

function renderEditorPanes(focusEditor = false) {
  const grid = $('editor-grid')
  const editorWrap = document.querySelector('.editor-wrap')
  const wrapEnabled = !editorWrap.classList.contains('nowrap')
  grid.innerHTML = ''
  grid.style.setProperty('--editor-cols', splitCols)
  grid.dataset.cols = String(splitCols)
  updateEditorGridLayout()

  if (activePaneIndex >= splitCols) activePaneIndex = 0
  if (splitBindings[activePaneIndex] == null && splitBindings[0] != null) activePaneIndex = 0

  for (let i = 0; i < splitCols; i++) {
    let lineNumberJob = null
    const pane = document.createElement('div')
    pane.className = 'editor-pane' + (i === activePaneIndex ? ' active' : '')
    pane.dataset.pane = String(i)
    attachPaneDnD(pane)

    const slot = slotById(splitBindings[i])
    if (slot && i === activePaneIndex) {
      pane.appendChild(editorWrap)
    } else if (slot) {
      const previewWrap = document.createElement('div')
      previewWrap.className = 'pane-preview-wrap' + (wrapEnabled ? '' : ' nowrap')
      previewWrap.title = slotTitle(slot)

      const lines = slot.text === '' ? 1 : slot.text.split(/\r?\n/).length
      const nums = document.createElement('div')
      nums.className = 'line-numbers pane-line-numbers'

      const preview = document.createElement('textarea')
      preview.className = 'pane-preview'
      preview.value = slot.text
      preview.readOnly = true
      preview.spellcheck = false
      preview.addEventListener('scroll', () => { nums.scrollTop = preview.scrollTop })
      previewWrap.addEventListener('mousedown', e => {
        e.preventDefault()
        activatePane(i, true)
      })
      preview.addEventListener('focus', () => activatePane(i, true))

      previewWrap.appendChild(nums)
      previewWrap.appendChild(preview)
      pane.appendChild(previewWrap)
      lineNumberJob = () => renderTextareaLineNumbers(nums, preview, lines, slot.text, wrapEnabled)
    } else {
      const empty = document.createElement('div')
      empty.className = 'editor-placeholder'
      empty.textContent = '拖入文本槽，或点击新建'
      empty.addEventListener('click', () => createSlotForPane(i))
      pane.appendChild(empty)
    }
    grid.appendChild(pane)
    if (lineNumberJob) lineNumberJob()
  }

  updateSplitButtons()
  saveSplitLayout()
  if (focusEditor && slotById(splitBindings[activePaneIndex])) $('editor').focus()
}

function activatePane(index, focusEditor = true) {
  if (index < 0 || index >= splitCols) return
  if (splitBindings[index] == null) {
    activePaneIndex = index
    renderEditorPanes(false)
    return
  }
  flushTyping()
  const oldSlot = getActiveSlot()
  if (oldSlot) oldSlot.text = $('editor').value
  activePaneIndex = index
  activeId = splitBindings[index]
  const slot = getActiveSlot()
  $('editor').value = slot ? slot.text : ''
  saveSlots()
  renderEditorPanes(focusEditor)
  renderSlots()
  updateCount()
  hideUndo()
  applyLang(slot ? slot.lang || '' : '')
}

function bindSlotToPane(index, id, activate = true) {
  if (index < 0 || index >= splitCols) return
  flushTyping()
  const oldSlot = getActiveSlot()
  if (oldSlot) oldSlot.text = $('editor').value
  const oldIndex = visiblePaneIndexForSlot(id)
  if (oldIndex >= 0 && oldIndex !== index) splitBindings[oldIndex] = null
  splitBindings[index] = id
  if (activate) {
    activePaneIndex = index
    activeId = id
    const slot = getActiveSlot()
    $('editor').value = slot ? slot.text : ''
  }
  saveSlots()
  saveSplitLayout()
  renderEditorPanes(activate)
  renderSlots()
  updateCount()
  hideUndo()
  applyLang(getActiveSlot()?.lang || '')
}

function setSplitCols(cols) {
  cols = Math.max(1, Math.min(4, cols))
  if (cols === splitCols) return
  flushTyping()
  const slot = getActiveSlot()
  if (slot) slot.text = $('editor').value
  splitCols = cols
  if (activePaneIndex >= splitCols) activePaneIndex = 0
  if (visiblePaneIndexForSlot(activeId) < 0) {
    splitBindings[activePaneIndex] = activeId
  } else {
    activePaneIndex = visiblePaneIndexForSlot(activeId)
  }
  saveSlots()
  renderEditorPanes(true)
  renderSlots()
  updateCount()
  updateSplitHandle()
}

function startRenameSlot(id, nameSpan) {
  const slot = slots.find(s => s.id === id)
  if (!slot) return
  const input = document.createElement('input')
  input.className = 'slot-rename-input'
  input.value = slotTitle(slot)
  nameSpan.replaceWith(input)
  input.select()

  let committed = false
  function commit() {
    if (committed) return
    committed = true
    const name = input.value.trim()
    if (name) {
      slot.name = name
      slot.named = true
      saveSlots()
    }
    renderSlots()
  }
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { committed = true; renderSlots() }
  })
  input.focus()
}

function switchSlot(id) {
  const prevId = activeId
  const prevText = $('editor').value
  if (splitCols > 1) {
    bindSlotToPane(activePaneIndex, id, true)
    if (id !== prevId) removeEmptySlotById(prevId, prevText, '已移除空文本槽')
    return
  }
  if (id === activeId) return
  flushTyping()
  getActiveSlot().text = $('editor').value
  activeId = id
  splitBindings[0] = id
  $('editor').value = getActiveSlot().text
  saveSlots()
  saveSplitLayout()
  renderSlots()
  updateCount()
  hideUndo()
  applyLang(getActiveSlot().lang || '')
  removeEmptySlotById(prevId, prevText, '已移除空文本槽')
}

function closeSlot(id) {
  const idx = slots.findIndex(s => s.id === id)
  if (idx < 0 || slots.length <= 1) return
  deleteSlotWithUndo(id, '已删除文本槽')
}

function restoreDeletedSlot() {
  if (!slotDeleteUndo) return false
  const snap = slotDeleteUndo
  slotDeleteUndo = null
  flushTyping()
  const insertAt = Math.max(0, Math.min(snap.index, slots.length))
  slots.splice(insertAt, 0, snap.slot)
  if (snap.pinnedBounds) {
    pinnedRecords.set(snap.slot.id, snap.pinnedBounds)
    savePinned()
    createNoteWindow(snap.slot, snap.pinnedBounds)
  }
  slotHistory.set(snap.slot.id, snap.history || { undo: [], redo: [] })
  splitBindings = snap.splitBindings.slice(0, 4)
  while (splitBindings.length < 4) splitBindings.push(null)
  splitCols = snap.splitCols
  activePaneIndex = snap.activePaneIndex
  activeId = snap.activeId
  $('editor').value = getActiveSlot()?.text || ''
  saveSlots()
  saveSplitLayout()
  renderEditorPanes(true)
  renderSlots()
  updateCount()
  hideUndo()
  applyLang(getActiveSlot()?.lang || '')
  return true
}

function showSlotDeleteUndo(message) {
  const bar = $('undo-bar')
  const msg = $('undo-msg')
  const btn = $('btn-undo')
  clearTimeout(undoBarTimer)
  bar.classList.remove('hidden')
  msg.textContent = `${message}（可撤销）`
  btn.textContent = '撤销'
  btn.classList.remove('hidden')
  undoBarTimer = setTimeout(() => {
    slotDeleteUndo = null
    hideUndo()
  }, 3500)
}

function deleteSlotWithUndo(id, message = '已删除文本槽') {
  const idx = slots.findIndex(s => s.id === id)
  if (idx < 0 || slots.length <= 1) return false
  flushTyping()
  if (id === activeId) {
    const slot = getActiveSlot()
    if (slot) slot.text = $('editor').value
  }
  const pinnedBounds = pinnedRecords.has(id) ? { ...pinnedRecords.get(id) } : null
  const history = slotHistory.get(id)
  slotDeleteUndo = {
    slot: JSON.parse(JSON.stringify(slots[idx])),
    index: idx,
    activeId,
    activePaneIndex,
    splitCols,
    splitBindings: splitBindings.slice(0, 4),
    pinnedBounds,
    history: history ? JSON.parse(JSON.stringify(history)) : { undo: [], redo: [] }
  }
  if (pinnedRecords.has(id)) unpinSlot(id)
  slots.splice(idx, 1)
  splitBindings = splitBindings.map(slotId => slotId === id ? null : slotId)
  slotHistory.delete(id)
  if (activeId === id || !slots.some(s => s.id === activeId)) {
    activeId = slots[Math.max(0, Math.min(idx, slots.length - 1))].id
    activePaneIndex = Math.min(activePaneIndex, splitCols - 1)
    splitBindings[activePaneIndex] = activeId
    $('editor').value = getActiveSlot().text
    applyLang(getActiveSlot().lang || '')
  }
  saveSlots()
  saveSplitLayout()
  renderSlots()
  renderEditorPanes()
  updateCount()
  showSlotDeleteUndo(message)
  return true
}

function removeEmptyActiveSlot(reason = '已移除空文本槽') {
  const slot = getActiveSlot()
  if (!slot || slots.length <= 1) return false
  if ($('editor').value.trim() || (slot.text || '').trim()) return false
  return deleteSlotWithUndo(slot.id, reason)
}

function removeEmptySlotById(id, textSnapshot, reason = '已移除空文本槽') {
  const slot = slotById(id)
  if (!slot || slots.length <= 1) return false
  if ((textSnapshot || '').trim() || (slot.text || '').trim()) return false
  return deleteSlotWithUndo(id, reason)
}

function removeSlotAfterTodo(id) {
  const idx = slots.findIndex(s => s.id === id)
  if (idx < 0) return
  if (pinnedRecords.has(id)) unpinSlot(id)
  slots.splice(idx, 1)
  splitBindings = splitBindings.map(slotId => slotId === id ? null : slotId)
  slotHistory.delete(id)

  if (slots.length === 0) {
    slots.push({ id: nextSlotId(), name: nextDefaultSlotName(), text: '' })
  }

  if (activeId === id || !slots.some(s => s.id === activeId)) {
    activeId = slots[Math.max(0, Math.min(idx, slots.length - 1))].id
    activePaneIndex = Math.min(activePaneIndex, splitCols - 1)
    splitBindings[activePaneIndex] = activeId
    $('editor').value = getActiveSlot().text
    updateCount()
    hideUndo()
    applyLang(getActiveSlot().lang || '')
  }

  saveSlots()
  saveSplitLayout()
  renderSlots()
  renderEditorPanes()
}

function createSlotForPane(paneIndex, initial = {}) {
  flushTyping()
  const current = getActiveSlot()
  if (current) current.text = $('editor').value
  const id = nextSlotId()
  slots.push({
    id,
    name: initial.name || nextDefaultSlotName(),
    text: initial.text || '',
    named: !!initial.named,
    lang: initial.lang || '',
    filename: initial.filename || ''
  })
  splitBindings[paneIndex] = id
  activePaneIndex = paneIndex
  activeId = id
  saveSlots()
  saveSplitLayout()
  $('editor').value = initial.text || ''
  renderEditorPanes(true)
  renderSlots()
  updateCount()
  hideUndo()
  applyLang(initial.lang || '')
}

function addSlot() {
  const emptyPane = splitBindings.slice(0, splitCols).findIndex(id => id == null)
  createSlotForPane(emptyPane >= 0 ? emptyPane : activePaneIndex, {})
}

// 文件后缀 → 语言类型；未列出的按纯文本处理
const IMPORT_EXT_LANG = {
  json: 'json', py: 'python', js: 'js', mjs: 'js', cjs: 'js',
  html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', csv: 'csv'
}

// 将导入的文本写入新暂存槽，按文件后缀自动匹配语言
function applyImportedText(filename, text, meta = {}) {
  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
  const lang = IMPORT_EXT_LANG[ext] || ''
  const name = dot > 0 ? filename.slice(0, dot) : filename

  createSlotForPane(activePaneIndex, { name, text, named: true, lang, filename })
  if ((meta.size || 0) > LARGE_TEXT_FILE_BYTES || text.length > LARGE_TEXT_LENGTH) {
    showToast('已进入大文件模式，预览将按需加载')
  }
}

function selectedFileName(filePath) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''
}

function selectedFilePaths(payload) {
  const raw = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.files) ? payload.files
        : Array.isArray(payload?.paths) ? payload.paths
          : payload?.data || payload?.path || payload?.filePath || payload
  return (Array.isArray(raw) ? raw : [raw])
    .map(item => typeof item === 'string'
      ? item
      : (item && (item.path || item.filePath || item.fullPath || item.nativePath || item.name)))
    .filter(Boolean)
}

function importSelectedTextFiles(payload) {
  if (!window.textTool?.readTextFile) {
    showToast('当前环境不支持读取选中文件')
    return
  }
  const paths = selectedFilePaths(payload)
  if (!paths.length) {
    showToast('未获取到选中文件')
    return
  }
  let imported = 0
  let skipped = 0
  let failed = 0
  paths.forEach(filePath => {
    const name = selectedFileName(filePath)
    if (!isWorkspaceTextFile(name)) {
      skipped++
      return
    }
    const file = window.textTool.readTextFile(filePath)
    if (!file || file.error) {
      failed++
      return
    }
    applyImportedText(file.name || name, file.content, { size: file.size || 0 })
    imported++
  })
  if (imported) {
    persistCurrent()
    updateCount()
    showToast(imported === 1 ? '已处理选中文件文本内容' : `已处理 ${imported} 个文本文件`)
  } else if (failed) {
    showToast('选中文件读取失败')
  } else if (skipped) {
    showToast('未找到支持的文本文件')
  }
}

// ==================== 固定到桌面 ====================

function defaultBounds() {
  const width = 280
  const height = 200
  const screenW = window.screen.availWidth || 1280
  const screenH = window.screen.availHeight || 800
  return { x: Math.max(0, screenW - width - 20), y: Math.max(0, screenH - height - 60), width, height }
}

const NOTE_COLORS = ['#fdf5b8', '#ffd6e0', '#d5f0c7', '#cfe6ff', '#e7d9f7', '#ffe2c0']

function createNoteWindow(slot, bounds) {
  if (!window.ideadockHost.supports('createBrowserWindow')) return
  const win = window.ideadockHost.createBrowserWindow('note.html', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    thickFrame: false,
    alwaysOnTop: bounds.alwaysOnTop !== false,
    resizable: true,
    skipTaskbar: true
  }, () => {
    win.webContents.executeJavaScript(`window.initNote(${JSON.stringify(slot.id)})`)
  })
  pinnedWindows.set(slot.id, win)
}

function togglePin(id) {
  if (pinnedRecords.has(id)) {
    unpinSlot(id)
    return
  }
  if (!window.ideadockHost.supports('createBrowserWindow')) {
    showToast('当前环境不支持固定到桌面')
    return
  }
  if (id === activeId) persistCurrentNow()
  const slot = slots.find(s => s.id === id)
  const bounds = defaultBounds()
  bounds.color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
  pinnedRecords.set(id, bounds)
  savePinned()
  createNoteWindow(slot, bounds)
  renderSlots()
}

function unpinSlot(id) {
  pinnedRecords.delete(id)
  savePinned()
  const win = pinnedWindows.get(id)
  if (win) {
    try { win.webContents.executeJavaScript('window.close()') } catch {}
    pinnedWindows.delete(id)
  }
  renderSlots()
}

// 启动时把上次固定在桌面的悬浮便签重新打开
function restorePinnedNotes() {
  let changed = false
  const pending = []
  pinnedRecords.forEach((bounds, id) => {
    const slot = slots.find(s => s.id === id)
    if (slot) {
      pending.push({ slot, bounds })
    } else if (typeof id === 'string' && id.startsWith('todo:')) {
      pending.push({ slot: { id }, bounds })
    } else {
      pinnedRecords.delete(id)
      changed = true
    }
  })
  if (changed) savePinned()
  pending.forEach((item, i) => {
    setTimeout(() => createNoteWindow(item.slot, item.bounds), i * 120)
  })
}

// ==================== 编辑区 ====================

function updateCount() {
  const editor = $('editor')
  const text = editor.value
  const lines = text === '' ? 0 : text.split(/\r?\n/).length
  const { selectionStart, selectionEnd } = editor
  let info = `${text.length} 字符 / ${lines} 行`
  if (selectionEnd > selectionStart) {
    info += ` (选中 ${selectionEnd - selectionStart})`
  }
  $('char-count').textContent = info
  renderLineNumbers(lines, text)
}

let lineMeasureEl = null

function getLineMeasureEl() {
  if (!lineMeasureEl) {
    lineMeasureEl = document.createElement('div')
    lineMeasureEl.className = 'line-measure'
    document.body.appendChild(lineMeasureEl)
  }
  return lineMeasureEl
}

function editorLineHeight(editor) {
  const cs = getComputedStyle(editor)
  const lh = parseFloat(cs.lineHeight)
  return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.5
}

function renderLineNumbers(lines, text = $('editor').value) {
  const editorWrap = $('app').querySelector('.editor-wrap')
  renderTextareaLineNumbers($('line-numbers'), $('editor'), lines, text, !editorWrap.classList.contains('nowrap'))
}

function renderTextareaLineNumbers(ln, textControl, lines, text, wrapEnabled) {
  const maxLines = 5000
  const logicalLines = text === '' ? [''] : text.split(/\r?\n/)
  const shownLines = Math.max(1, Math.min(lines || 1, maxLines))
  const lineHeight = editorLineHeight(textControl)
  const frag = document.createDocumentFragment()
  const measure = wrapEnabled ? getLineMeasureEl() : null

  if (measure) {
    const cs = getComputedStyle(textControl)
    const padLeft = parseFloat(cs.paddingLeft) || 0
    const padRight = parseFloat(cs.paddingRight) || 0
    const contentWidth = Math.max(1, textControl.clientWidth - padLeft - padRight)
    measure.style.width = contentWidth + 'px'
    measure.style.fontFamily = cs.fontFamily
    measure.style.fontSize = cs.fontSize
    measure.style.fontWeight = cs.fontWeight
    measure.style.letterSpacing = cs.letterSpacing
    measure.style.lineHeight = cs.lineHeight
    measure.style.tabSize = cs.tabSize
    measure.style.whiteSpace = cs.whiteSpace
    measure.style.overflowWrap = cs.overflowWrap
    measure.style.wordBreak = cs.wordBreak
  }

  for (let i = 0; i < shownLines; i++) {
    const row = document.createElement('div')
    row.className = 'line-number-row'
    row.textContent = String(i + 1)
    if (measure) {
      measure.textContent = logicalLines[i] || ' '
      row.style.height = Math.ceil(Math.max(lineHeight, measure.getBoundingClientRect().height)) + 'px'
    } else {
      row.style.height = lineHeight + 'px'
    }
    frag.appendChild(row)
  }
  if (lines > maxLines) {
    const row = document.createElement('div')
    row.className = 'line-number-row'
    row.textContent = '...'
    row.style.height = lineHeight + 'px'
    frag.appendChild(row)
  }
  ln.replaceChildren(frag)
}

let editorLayoutResizeDepth = 0

function beginEditorLayoutResize() {
  editorLayoutResizeDepth += 1
  document.body.classList.add('editor-layout-resizing')
}

function endEditorLayoutResize() {
  editorLayoutResizeDepth = Math.max(0, editorLayoutResizeDepth - 1)
  if (editorLayoutResizeDepth > 0) return
  document.body.classList.remove('editor-layout-resizing')
  requestAnimationFrame(() => {
    updateCount()
    if (splitCols > 1) renderEditorPanes(false)
  })
}

function persistCurrent() {
  getActiveSlot().text = $('editor').value
  scheduleSlotsSave()
  scheduleSlotTabsRender()
}

function scheduleSlotsSave(delay = 500) {
  slotsDirty = true
  clearTimeout(persistTimer)
  persistTimer = setTimeout(flushSlotsSave, delay)
}

function flushSlotsSave() {
  clearTimeout(persistTimer)
  persistTimer = null
  if (!slotsDirty) return
  slotsDirty = false
  saveSlots()
}

function scheduleSlotTabsRender() {
  if (slotTabsDirty) return
  slotTabsDirty = true
  requestAnimationFrame(() => {
    slotTabsDirty = false
    renderSlots()
  })
}

function persistCurrentNow() {
  getActiveSlot().text = $('editor').value
  slotsDirty = true
  flushSlotsSave()
  renderSlots()
}

// ==================== 撤销 / 重做 ====================

function getHistory() {
  if (!slotHistory.has(activeId)) slotHistory.set(activeId, { undo: [], redo: [] })
  return slotHistory.get(activeId)
}

function currentState() {
  const editor = $('editor')
  return { value: editor.value, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd }
}

// 在修改内容前调用：记录修改前的状态，供 Ctrl+Z 恢复
function pushUndo(state) {
  const h = getHistory()
  h.undo.push(state)
  if (h.undo.length > MAX_HISTORY) h.undo.shift()
  h.redo = []
}

function restoreState(state) {
  const editor = $('editor')
  editor.value = state.value
  editor.focus()
  editor.setSelectionRange(state.selectionStart, state.selectionEnd)
  persistCurrent()
  updateCount()
  const lang = $('lang-select').value
  if (lang === 'markdown') renderMarkdown()
  if (lang === 'csv') {
    csvSelection = null
    $('csv-stats-output').innerHTML = ''
    renderCsv()
  }
  if (lang === 'html') renderHtml()
}

// 结束当前的打字连续输入，让下一次输入重新开始一个新的撤销步骤
function flushTyping() {
  typingActive = false
  beforeTypingState = null
  clearTimeout(typingTimer)
  flushSlotsSave()
}

function scheduleFindRun(keepIndex = true, delay = 120) {
  clearTimeout(findTimer)
  findTimer = setTimeout(() => {
    findTimer = null
    frRunFind(keepIndex)
  }, delay)
}

function undo() {
  flushTyping()
  const h = getHistory()
  if (h.undo.length === 0) return
  h.redo.push(currentState())
  if (h.redo.length > MAX_HISTORY) h.redo.shift()
  restoreState(h.undo.pop())
  hideUndo()
}

function redo() {
  flushTyping()
  const h = getHistory()
  if (h.redo.length === 0) return
  h.undo.push(currentState())
  if (h.undo.length > MAX_HISTORY) h.undo.shift()
  restoreState(h.redo.pop())
  hideUndo()
}

async function applyOp(name, fn) {
  const editor = $('editor')
  const before = editor.value
  const { selectionStart, selectionEnd } = editor
  const hasSelection = selectionEnd > selectionStart
  try {
    if (hasSelection) {
      const selected = before.slice(selectionStart, selectionEnd)
      const replaced = await fn(selected)
      if (replaced === selected) return
      const after = before.slice(0, selectionStart) + replaced + before.slice(selectionEnd)
      flushTyping()
      pushUndo({ value: before, selectionStart, selectionEnd })
      editor.value = after
      editor.focus()
      editor.setSelectionRange(selectionStart, selectionStart + replaced.length)
    } else {
      const after = await fn(before)
      if (after === before) return
      flushTyping()
      pushUndo({ value: before, selectionStart, selectionEnd })
      editor.value = after
    }
    persistCurrent()
    updateCount()
    if ($('lang-select').value === 'markdown') renderMarkdown()
    if ($('lang-select').value === 'csv') renderCsv()
    if ($('lang-select').value === 'html') renderHtml()
    showUndo(name)
  } catch (e) {
    showUndo(null, e.message)
  }
}

let undoBarTimer = null

function showUndo(opName, errorMsg) {
  slotDeleteUndo = null
  const bar = $('undo-bar')
  const msg = $('undo-msg')
  const btn = $('btn-undo')
  clearTimeout(undoBarTimer)
  bar.classList.remove('hidden')
  if (errorMsg) {
    msg.textContent = errorMsg
    btn.classList.add('hidden')
    undoBarTimer = setTimeout(hideUndo, 4000)
  } else {
    msg.textContent = `已应用：${opName}（可按 Ctrl+Z 撤销）`
    btn.classList.remove('hidden')
    undoBarTimer = setTimeout(hideUndo, 2500)
  }
}

function hideUndo() {
  clearTimeout(undoBarTimer)
  $('undo-bar').classList.add('hidden')
}

// 简单提示条：复用撤销条样式，不带撤销按钮，短暂显示后自动消失
function showToast(msg) {
  slotDeleteUndo = null
  const bar = $('undo-bar')
  const msgEl = $('undo-msg')
  const btn = $('btn-undo')
  clearTimeout(undoBarTimer)
  bar.classList.remove('hidden')
  msgEl.textContent = msg
  btn.classList.add('hidden')
  undoBarTimer = setTimeout(hideUndo, 1500)
}

// ==================== 事件绑定 ====================

document.querySelectorAll('.btn-tool[data-op], .btn-basic-run[data-op]').forEach(btn => {
  btn.addEventListener('click', () => {
    const op = ops[btn.dataset.op]
    if (op) applyOp(btn.dataset.label || btn.textContent, op)
  })
})

$('btn-add-slot').addEventListener('click', addSlot)

$('btn-pin-slot').addEventListener('click', () => {
  const slot = getActiveSlot()
  if (!slot) return
  togglePin(slot.id)
})

document.querySelectorAll('.split-btn').forEach(btn => {
  btn.addEventListener('click', () => setSplitCols(parseInt(btn.dataset.cols, 10)))
})

// 连续打字归并为一个撤销步骤（参考主流编辑器：停顿后才作为新的撤销节点）
$('editor').addEventListener('beforeinput', () => {
  if (!typingActive) {
    beforeTypingState = currentState()
  }
})

$('editor').addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !$('editor').value.trim()) {
    if (removeEmptyActiveSlot('已删除空文本槽')) e.preventDefault()
  }
})

$('editor').addEventListener('input', () => {
  if (!typingActive && beforeTypingState) {
    pushUndo(beforeTypingState)
    typingActive = true
  }
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => { typingActive = false; beforeTypingState = null }, 600)
  updateCount()
  persistCurrent()
  if ($('lang-select').value === 'markdown') {
    clearTimeout(mdTimer)
    mdTimer = setTimeout(renderMarkdown, 150)
  }
  if ($('lang-select').value === 'csv') {
    clearTimeout(csvTimer)
    csvTimer = setTimeout(renderCsv, 150)
  }
  if ($('lang-select').value === 'html') {
    clearTimeout(htmlTimer)
    htmlTimer = setTimeout(renderHtml, 250)
  }
  if (frActive()) scheduleFindRun(true)
})

window.addEventListener('beforeunload', flushSlotsSave)

document.addEventListener('keydown', e => {
  if (e.key !== 'Delete') return
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (deleteSlotWithUndo(activeId, '已删除文本槽')) e.preventDefault()
})

$('editor').addEventListener('scroll', () => {
  $('line-numbers').scrollTop = $('editor').scrollTop
  if (frActive()) frSyncHighlight()
})

// 选中范围变化时更新状态栏中的选中字符数
;['mouseup', 'keyup', 'select'].forEach(evt => {
  $('editor').addEventListener(evt, updateCount)
})

$('editor').addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return
  const key = e.key.toLowerCase()
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault()
    redo()
  }
})

function applyTextareaTabKey(ta, shiftKey) {
  const before = ta.value
  const start = ta.selectionStart || 0
  const end = ta.selectionEnd || 0
  const hasSelection = end > start

  if (!shiftKey && !hasSelection) {
    ta.value = before.slice(0, start) + '\t' + before.slice(end)
    ta.setSelectionRange(start + 1, start + 1)
  } else {
    const effectiveEnd = hasSelection && before[end - 1] === '\n' ? end - 1 : end
    const lineStart = before.lastIndexOf('\n', start - 1) + 1
    const nextBreak = before.indexOf('\n', effectiveEnd)
    const lineEnd = nextBreak === -1 ? before.length : nextBreak
    const block = before.slice(lineStart, lineEnd)
    let changed = block
    let selectionStart = start
    let selectionEnd = end

    if (shiftKey) {
      let removedBeforeStart = 0
      let removedBeforeEnd = 0
      let pos = lineStart
      changed = block.split('\n').map(line => {
        const remove = line.startsWith('\t') ? 1 : (line.startsWith('  ') ? 2 : (line.startsWith(' ') ? 1 : 0))
        if (remove && pos < start) removedBeforeStart += Math.min(remove, start - pos)
        if (remove && pos < end) removedBeforeEnd += Math.min(remove, end - pos)
        pos += line.length + 1
        return remove ? line.slice(remove) : line
      }).join('\n')
      selectionStart = Math.max(lineStart, start - removedBeforeStart)
      selectionEnd = Math.max(selectionStart, end - removedBeforeEnd)
    } else {
      changed = block.split('\n').map(line => '\t' + line).join('\n')
      selectionStart = start === lineStart ? start : start + 1
      const lineCount = block.split('\n').length
      selectionEnd = end + lineCount
    }

    if (changed === block) return false
    ta.value = before.slice(0, lineStart) + changed + before.slice(lineEnd)
    ta.setSelectionRange(selectionStart, selectionEnd)
  }

  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return
  const ta = e.target && e.target.closest && e.target.closest('textarea')
  if (!ta || ta.readOnly || ta.disabled) return
  e.preventDefault()
  let undoState = null
  if (ta === $('editor')) {
    flushTyping()
    undoState = currentState()
  }
  if (applyTextareaTabKey(ta, e.shiftKey) && undoState) pushUndo(undoState)
})

function insertAtCursor(value) {
  const editor = $('editor')
  const start = editor.selectionStart
  const end = editor.selectionEnd
  editor.value = editor.value.substring(0, start) + value + editor.value.substring(end)
  editor.selectionStart = editor.selectionEnd = start + value.length
  editor.focus()
  persistCurrent()
  updateCount()
}

document.querySelectorAll('.btn-emoji, .btn-emoticon').forEach(btn => {
  btn.addEventListener('click', () => insertAtCursor(btn.dataset.v))
})

$('btn-undo').addEventListener('click', () => {
  if (restoreDeletedSlot()) return
  undo()
})
$('btn-undo-status').addEventListener('click', undo)
$('btn-redo-status').addEventListener('click', redo)

// ==================== 自动换行 ====================

const WRAP_KEY = 'ideadock.wrap'

function applyWrapMode(enabled) {
  $('app').querySelector('.editor-wrap').classList.toggle('nowrap', !enabled)
  $('btn-wrap-toggle').textContent = enabled ? '自动换行：开' : '自动换行：关'
  requestAnimationFrame(updateCount)
  if (splitCols > 1) requestAnimationFrame(() => renderEditorPanes(false))
}

$('btn-reset-layout').addEventListener('click', () => {
  storeRemove(CMP_W_KEY)
  storeRemove(CMP_W_RATIO_KEY)
  $('compare-left').style.flex = ''
  $('compare-edit-left').style.flex = ''
  storeRemove(EDITOR_WIDTH_KEY)
  storeRemove(EDITOR_WIDTH_RATIO_KEY)
  editorWidthPrefsLoaded = true
  editorWidthSaved = 0
  editorWidthRatio = 0
  $('editor-grid').style.flex = ''
})

$('btn-wrap-toggle').addEventListener('click', () => {
  const enabled = !$('app').querySelector('.editor-wrap').classList.contains('nowrap')
  const next = !enabled
  storeSet(WRAP_KEY, next ? 'on' : 'off')
  applyWrapMode(next)
})

// 查找/替换模块已抽至 find-replace.js（在 app.js 之后加载）


// 工作流 + 自定义脚本模块已抽至 workflow.js（在 app.js 之后加载）

// 文本工具面板（md格式化/代码/JSON/YAML）已抽至 text-tools.js（在 app.js 之后加载）

// uTools 桥接（快捷输入/入口/跨窗口同步）已抽至 utools-bridge.js（在 app.js 之后加载）

// ==================== 语言类型 ====================


ops.htmlFormat = text => {
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
  let indent = 0
  const tab = '  '
  const lines = []
  const tokens = text
    .replace(/>\s*</g, '>\n<')
    .replace(/^\s+|\s+$/gm, '')
    .split('\n')
    .filter(Boolean)

  for (const raw of tokens) {
    const line = raw.trim()
    const isClose = /^<\//.test(line)
    const isSelfClose = /\/>$/.test(line) || VOID.has((line.match(/^<(\w+)/) || [])[1] || '')
    const isOpen = /^<[^/!]/.test(line) && !isSelfClose

    if (isClose) indent = Math.max(0, indent - 1)
    lines.push(tab.repeat(indent) + line)
    if (isOpen) indent++
  }
  return lines.join('\n')
}

function applyLang(lang) {
  $('lang-select').value = lang
  if (typeof updateLangPicker === 'function') updateLangPicker()

  const isPython = lang === 'python'
  const isJs = lang === 'js'
  const isJson = lang === 'json'
  const isMd = lang === 'markdown'
  const isCsv = lang === 'csv'
  const isHtml = lang === 'html'
  const isYaml = lang === 'yaml'
  const isCode = isPython || isJs
  const hasLangBtn = isMd || isHtml || isPython || isJs
  const show = el => { el.style.display = '' }
  const hide = el => { el.style.display = 'none' }

  $('md-tools').style.display = isMd ? '' : 'none'
  $('lang-tools-code').style.display = isCode ? '' : 'none'
  $('lang-tools-json').style.display = isJson ? '' : 'none'
  $('lang-tools-yaml').style.display = isYaml ? '' : 'none'
  $('lang-tools-html').style.display = isHtml ? '' : 'none'
  // 格式化按钮在代码面板中只对 Python 有效
  $('code-tools-format').style.display = isPython ? '' : 'none'

  isPython ? show($('btn-run-python')) : hide($('btn-run-python'))
  isJs ? show($('btn-run-js')) : hide($('btn-run-js'))
  isMd ? show($('btn-run-md')) : hide($('btn-run-md'))
  isHtml ? show($('btn-run-html')) : hide($('btn-run-html'))
  hasLangBtn ? show($('python-sep')) : hide($('python-sep'))
  hide($('btn-kill-python'))
  hide($('btn-kill-js'))
  hide($('btn-format-lang'))  // 已移至各语言工具面板
  hide($('btn-json-minify'))  // 已移至 JSON 工具面板
  ;(isPython || isJs) ? show($('btn-clear-output')) : hide($('btn-clear-output'))
  isMd ? show($('btn-copy-html')) : hide($('btn-copy-html'))
  if (!compareOpen) setLangPanel(lang)
  else updateSplitHandle()
}

function saveLang(lang) {
  const slot = getActiveSlot()
  if (slot) {
    slot.lang = lang
    saveSlots()
  }
}

function updateLangPicker() {
  const select = $('lang-select')
  const current = $('lang-picker-current')
  const menu = $('lang-picker-menu')
  if (!select || !current) return
  const selected = select.options[select.selectedIndex]
  current.textContent = selected ? selected.textContent : '纯文本'
  if (menu) {
    menu.querySelectorAll('.lang-picker-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === select.value)
    })
  }
}

function initLangPicker() {
  const select = $('lang-select')
  const menu = $('lang-picker-menu')
  if (!select || !menu) return
  menu.innerHTML = ''
  Array.from(select.options).forEach(option => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'lang-picker-item'
    btn.dataset.lang = option.value
    btn.textContent = option.textContent
    btn.addEventListener('click', () => {
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    menu.appendChild(btn)
  })
  updateLangPicker()
}

$('lang-select').addEventListener('change', () => {
  const lang = $('lang-select').value
  saveLang(lang)
  applyLang(lang)
  updateLangPicker()
})

// ==================== 共享文本阈值 + 编辑区粘贴/语言切换 ====================

// 这些尺寸阈值被 app.js 导入逻辑、HTML 预览、csv.js、markdown.js 共用，
// 故保留于此（在 markdown.js / csv.js 之前定义，保证可见）
const PREVIEW_TEXT_LIMIT = 200000
const LARGE_TEXT_FILE_BYTES = 2 * 1024 * 1024
const LARGE_TEXT_LENGTH = 700000
const CSV_PREVIEW_TEXT_LIMIT = 120000

// Markdown 渲染与图片查看器已抽至 markdown.js（在 app.js 之后加载）；下方为编辑区粘贴/语言切换等通用逻辑


// 粘贴图片：压缩缩放后存入附件，编辑区只插 img://id 短链
function compressImage(blob, maxEdge = 1600, type = 'image/webp', quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      const longest = Math.max(width, height)
      if (longest > maxEdge) {
        const s = maxEdge / longest
        width = Math.round(width * s)
        height = Math.round(height * s)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), type, quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')) }
    img.src = url
  })
}

// 用 execCommand 插入，保留 textarea 原生撤销栈，并触发 input 监听持久化
function insertViaExec(str) {
  $('editor').focus()
  document.execCommand('insertText', false, str)
}

// 图片（Blob/File）→ 压缩存附件，编辑区自动切 Markdown 并插入 img:// 短链
async function insertImageBlob(blob) {
  if (!window.textTool || !window.textTool.saveImage) {
    showToast('图片存储不可用（需在 uTools 环境中运行）')
    return
  }
  try {
    const compressed = await compressImage(blob)
    const bytes = new Uint8Array(await compressed.arrayBuffer())
    const id = window.textTool.saveImage(bytes, compressed.type || 'image/webp')
    if (!id) { showToast('图片保存失败'); return }
    switchLang('markdown')
    insertViaExec(`![图片](img://${id})\n`)
    showToast(`已插入图片（约 ${Math.max(1, Math.round(bytes.length / 1024))}KB）`)
    renderMarkdown()
  } catch (err) {
    showToast('图片处理失败：' + (err && err.message ? err.message : err))
  }
}

function switchLang(lang) {
  if ($('lang-select').value === lang) return
  saveLang(lang)
  $('lang-select').value = lang
  applyLang(lang)
  updateLangPicker()
}

// 仅在粘贴时跑一次的类型探测，只认误报极低的几类，其余返回 null 走默认粘贴
function detectPasteType(text) {
  const t = text.trim()
  if (!t) return null
  // JSON：以 { 或 [ 开头且能解析
  if (t[0] === '{' || t[0] === '[') {
    try { JSON.parse(t); return 'json' } catch {}
  }
  // Mermaid 源码：首个非空行是图表关键字
  const firstLine = t.split(/\r?\n/)[0].trim()
  if (/^(graph\s|flowchart\s|sequenceDiagram\b|classDiagram\b|stateDiagram(-v2)?\b|erDiagram\b|gantt\b|pie\b|journey\b|mindmap\b|timeline\b|gitGraph\b|quadrantChart\b|requirementDiagram\b)/i.test(firstLine)) {
    return 'mermaid'
  }
  // 含围栏代码块 ``` → 当作 Markdown
  if (/(^|\n)```/.test(text)) return 'markdown'
  // CSV：≥3 行、每行逗号数一致且 ≥1
  const lines = t.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length >= 3) {
    const counts = lines.map(l => (l.match(/,/g) || []).length)
    if (counts[0] >= 1 && counts.every(c => c === counts[0])) return 'csv'
  }
  return null
}

// 剪贴板图文都有时弹窗询问，返回 'image' | 'text' | null（取消）
function askPasteKind() {
  return new Promise(resolve => {
    const modal = $('paste-kind-modal')
    const done = (v) => {
      modal.style.display = 'none'
      $('paste-as-image').removeEventListener('click', onImg)
      $('paste-as-text').removeEventListener('click', onTxt)
      $('paste-kind-cancel').removeEventListener('click', onCancel)
      $('paste-kind-overlay').removeEventListener('click', onCancel)
      resolve(v)
    }
    const onImg = () => done('image')
    const onTxt = () => done('text')
    const onCancel = () => done(null)
    $('paste-as-image').addEventListener('click', onImg)
    $('paste-as-text').addEventListener('click', onTxt)
    $('paste-kind-cancel').addEventListener('click', onCancel)
    $('paste-kind-overlay').addEventListener('click', onCancel)
    modal.style.display = ''
  })
}

$('editor').addEventListener('paste', async (e) => {
  const cd = e.clipboardData
  if (!cd) return

  const imgItem = Array.from(cd.items || []).find(it => it.kind === 'file' && it.type.startsWith('image/'))
  const text = cd.getData('text/plain')
  const hasText = !!(text && text.trim())

  // 1) 纯图片（无文字兜底）：直接当图片，必要时自动切 Markdown
  if (imgItem && !hasText) {
    e.preventDefault()
    const file = imgItem.getAsFile()
    if (file) await insertImageBlob(file)
    return
  }

  // 2) 图文都有（PPT/Excel/Word 复制）：交给用户判断
  if (imgItem && hasText) {
    e.preventDefault()
    const file = imgItem.getAsFile()   // 必须同步取，await 后 clipboard 项即失效
    const choice = await askPasteKind()
    if (choice === 'image') {
      if (file) await insertImageBlob(file)
    } else if (choice === 'text') {
      insertViaExec(text)              // 显式选文字：按纯文本插入，不做类型探测
    }
    return   // 取消：什么都不做
  }

  // 3) 复制的磁盘文件（非图片）：插入绝对路径。粘贴的位图数据 File.path 为空，不会命中；
  //    图片文件已被上面的图片分支接管，这里只剩 pdf/zip/txt 等
  const filePaths = Array.from(cd.files || [])
    .filter(f => f.path && !f.type.startsWith('image/'))
    .map(f => f.path)
  if (filePaths.length) {
    e.preventDefault()
    insertViaExec(filePaths.join('\n'))
    return
  }

  // 4) 纯文本：仅在「纯文本」模式下探测（已选模式则尊重），只做一次
  if (!hasText) return
  if ($('lang-select').value !== '') return
  const kind = detectPasteType(text)
  if (!kind) return   // 普通文本，交给默认粘贴，不干预
  e.preventDefault()
  if (kind === 'mermaid') {
    switchLang('markdown')
    insertViaExec('```mermaid\n' + text.trim() + '\n```\n')
    showToast('已识别流程图，切换到 Markdown')
  } else if (kind === 'markdown') {
    switchLang('markdown')
    insertViaExec(text)
    showToast('已识别 Markdown，已切换')
  } else if (kind === 'json') {
    switchLang('json')
    insertViaExec(text)
    showToast('已识别 JSON，已切换')
  } else if (kind === 'csv') {
    switchLang('csv')
    insertViaExec(text)
    showToast('已识别 CSV，已切换')
  }
})

// ==================== HTML 预览 ====================

let htmlTimer = null

// 用 iframe + srcdoc 渲染，sandbox 隔离脚本，避免污染插件主页面；
// 开启 allow-scripts 后动态页面（JS/canvas/CDN 框架）可正常运行
function renderHtml() {
  const text = $('editor').value
  $('html-preview').srcdoc = text.length > PREVIEW_TEXT_LIMIT
    ? '<p style="font-family:sans-serif;color:#f28b82">内容较大，已跳过自动预览</p>'
    : text
}


// 复制时把 CSS 内联进完整文档，粘到邮件/飞书/Word 里能保留排版。
// 直接序列化已渲染的预览 DOM，连带 MathJax / mermaid 生成的 SVG 一起带走。
const MD_EXPORT_CSS = `
body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7;color:#24292f;max-width:820px;margin:0 auto;padding:16px}
h1,h2,h3,h4,h5,h6{font-weight:700;line-height:1.3;margin:1em 0 .5em}
h1{font-size:1.8em}h2{font-size:1.4em;border-bottom:1px solid #d0d7de;padding-bottom:.3em}h3{font-size:1.2em}
p{margin:.6em 0}
code{font-family:Consolas,monospace;font-size:.88em;background:rgba(175,184,193,.2);padding:.15em .4em;border-radius:4px}
pre{background:#282c34;border-radius:6px;padding:12px 14px;overflow-x:auto}
pre code{background:none;padding:0;color:#abb2bf}
blockquote{border-left:4px solid #d0d7de;margin:.6em 0;padding:.2em 1em;color:#57606a}
ul,ol{padding-left:1.6em}
table{border-collapse:collapse;margin:.6em 0}
th,td{border:1px solid #d0d7de;padding:6px 12px}
th{background:#f6f8fa;font-weight:700}
img,svg{max-width:100%}
a{color:#0969da}hr{border:none;border-top:1px solid #d0d7de;margin:1em 0}
.hljs-comment,.hljs-quote{color:#7f848e;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag,.hljs-name{color:#c678dd}
.hljs-string,.hljs-regexp,.hljs-addition{color:#98c379}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-meta{color:#d19a66}
.hljs-title,.hljs-title.function_,.hljs-section{color:#61afef}
.hljs-attr,.hljs-attribute,.hljs-type,.hljs-title.class_{color:#e5c07b}
.hljs-variable,.hljs-template-variable,.hljs-tag,.hljs-deletion{color:#e06c75}
.hljs-built_in,.hljs-class .hljs-title{color:#56b6c2}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}`

$('btn-copy-html').addEventListener('click', async () => {
  const fragment = $('md-preview').innerHTML
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${MD_EXPORT_CSS}</style></head><body>${fragment}</body></html>`
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([doc], { type: 'text/html' }),
        'text/plain': new Blob([fragment], { type: 'text/plain' })
      })])
    } else if (window.ideadockHost.supports('copyText')) {
      window.ideadockHost.copyText(doc)
    }
    showToast('已复制 HTML')
  } catch {
    if (window.ideadockHost.supports('copyText')) window.ideadockHost.copyText(doc)
    showToast('已复制 HTML')
  }
})

// 运行环境配置与 Python/JS 执行面板已抽至 run-panels.js（在 app.js 之后加载）

// ==================== 工具区高度拖拽 ====================

const TOOL_HEIGHT_RATIO_KEY = 'ideadock.toolHeightRatio'
let toolHeightRatio = parseFloat(storeGet(TOOL_HEIGHT_RATIO_KEY)) || 0
const MIN_TOOL_HEIGHT = 120

function getDefaultToolHeight() {
  return fitToolHeightToContent()
}

function getMaxToolHeight() {
  return Math.floor(window.innerHeight * 0.5)
}

function clampToolHeight(h) {
  const max = getMaxToolHeight()
  const min = Math.min(MIN_TOOL_HEIGHT, max)
  return Math.max(min, Math.min(max, h))
}

function applyToolHeight(h) {
  const clamped = clampToolHeight(h)
  $('app').style.setProperty('--tools-height', clamped + 'px')
}

function saveToolHeight(h) {
  toolHeightRatio = clampToolHeight(h) / window.innerHeight
  storeSet(TOOL_HEIGHT_RATIO_KEY, String(toolHeightRatio))
}

function getActiveToolPane() {
  return Array.from(document.querySelectorAll('.tool-tab-pane')).find(pane => pane.style.display !== 'none') ||
    document.getElementById('tab-' + activeToolTab)
}

function fitToolHeightToContent() {
  const pane = getActiveToolPane()
  const contentHeight = pane ? pane.scrollHeight : MIN_TOOL_HEIGHT
  const h = Math.ceil(contentHeight)
  applyToolHeight(h)
  return clampToolHeight(h)
}

function scheduleToolHeightFit() {
  requestAnimationFrame(() => {
    fitToolHeightToContent()
    if (window.refreshCalcPlotLayout) window.refreshCalcPlotLayout()
  })
}

function restoreToolHeight() {
  getDefaultToolHeight()
}

;(() => {
  const handle = $('resize-handle')
  const tools = $('tools-panel')
  let startY = 0, startH = 0

  restoreToolHeight()

  handle.addEventListener('mousedown', e => {
    if (!isToolPanelOpen()) return
    e.preventDefault()
    startY = e.clientY
    startH = tools.getBoundingClientRect().height
    handle.classList.add('dragging')
    $('app').classList.add('tool-resizing')
    document.body.classList.add('tool-resizing')

    function onMove(e) {
      const h = startH - (e.clientY - startY)
      applyToolHeight(h)
      if (window.refreshCalcPlotLayout) window.refreshCalcPlotLayout()
    }
    function onUp() {
      handle.classList.remove('dragging')
      $('app').classList.remove('tool-resizing')
      document.body.classList.remove('tool-resizing')
      saveToolHeight(tools.getBoundingClientRect().height)
      if (window.refreshCalcPlotLayout) window.refreshCalcPlotLayout()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
})()

// ==================== 编辑区左右宽度拖拽（分栏模式） ====================

const EDITOR_WIDTH_KEY = 'ideadock.editorWidth'
const EDITOR_WIDTH_RATIO_KEY = 'ideadock.editorWidthRatio'
let editorWidthPrefsLoaded = false
let editorWidthSaved = 0
let editorWidthRatio = 0

function loadEditorWidthPrefs() {
  if (editorWidthPrefsLoaded) return
  editorWidthPrefsLoaded = true
  editorWidthRatio = parseFloat(storeGet(EDITOR_WIDTH_RATIO_KEY)) || 0
  editorWidthSaved = parseInt(storeGet(EDITOR_WIDTH_KEY), 10) || 0
}

function splitWidthFromRatio(areaW) {
  loadEditorWidthPrefs()
  if (editorWidthRatio > 0) return Math.round(areaW * Math.max(0.2, Math.min(0.8, editorWidthRatio)))
  return editorWidthSaved > 0 ? editorWidthSaved : 0
}

function applyEditorSplitWidth() {
  const panels = ['python-output-panel', 'js-output-panel', 'md-preview-panel', 'csv-preview-panel', 'html-preview-panel', 'ai-panel']
  const split = panels.some(id => $(id).style.display !== 'none')
  const wrap = $('editor-grid')
  if (!split) {
    wrap.style.flex = ''
    return
  }
  const areaW = $('edit-area').getBoundingClientRect().width
  const raw = splitWidthFromRatio(areaW)
  if (raw > 0) {
    const w = Math.max(120, Math.min(areaW - 120, raw))
    wrap.style.flex = `0 0 ${w}px`
  } else {
    wrap.style.flex = ''
  }
}

// 根据是否有右侧面板显示，切换分隔条的显隐并应用/重置宽度
function updateSplitHandle() {
  const panels = ['python-output-panel', 'js-output-panel', 'md-preview-panel', 'csv-preview-panel', 'html-preview-panel', 'ai-panel']
  const split = panels.some(id => $(id).style.display !== 'none')
  const handle = $('col-resize-handle')
  handle.style.display = split ? '' : 'none'
  updateEditorGridLayout()
  applyEditorSplitWidth()
}

;(() => {
  const handle = $('col-resize-handle')
  const area = $('edit-area')
  const wrap = $('editor-grid')
  let startX = 0, startW = 0

  handle.addEventListener('mousedown', e => {
    e.preventDefault()
    startX = e.clientX
    startW = wrap.getBoundingClientRect().width
    handle.classList.add('dragging')
    beginEditorLayoutResize()

    function onMove(e) {
      const areaW = area.getBoundingClientRect().width
      const w = Math.max(120, Math.min(areaW - 120, startW + e.clientX - startX))
      wrap.style.flex = `0 0 ${w}px`
    }
    function onUp() {
      handle.classList.remove('dragging')
      const w = Math.round(wrap.getBoundingClientRect().width)
      const areaW = area.getBoundingClientRect().width
      editorWidthPrefsLoaded = true
      editorWidthSaved = w
      editorWidthRatio = w / areaW
      storeSet(EDITOR_WIDTH_KEY, w)
      storeSet(EDITOR_WIDTH_RATIO_KEY, String(editorWidthRatio))
      endEditorLayoutResize()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
})()

// 剪贴板历史（文本/图片/文件三类卡片）已抽至 clipboard.js（在 app.js 之后加载）
// 文本对比（diff）模块已抽至 compare.js（在 app.js 之后加载）

// ==================== 深/浅色主题 ====================

const THEME_KEY = 'ideadock.theme'

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.dataset.theme = 'light'
  } else {
    delete document.documentElement.dataset.theme
  }
  $('btn-theme').innerHTML = ICON_SETTINGS
  $('btn-theme').title = '设置'
  $('btn-theme').setAttribute('aria-label', '设置')
  storeSet(THEME_KEY, theme)
}

// 内容导出已抽至 export.js（在 app.js 之后加载）

// 归档模块已抽至 archive.js（在 app.js 之后加载）

// ==================== 工具面板 Tab ====================

const TAB_KEY = 'ideadock.toolTab'
let activeToolTab = storeGet(TAB_KEY) === 'archive' ? 'basic' : (storeGet(TAB_KEY) || 'basic')

function isToolPanelOpen() {
  return $('app').classList.contains('tool-open')
}

function setToolPanelOpen(open) {
  $('app').classList.toggle('tool-open', open)
  document.querySelectorAll('.tool-tab-btn').forEach(btn => {
    btn.classList.toggle('active', open && btn.dataset.tab === activeToolTab)
  })
  if (open) scheduleToolHeightFit()
  if (open && window.refreshCalcPlotLayout) {
    window.refreshCalcPlotLayout()
    setTimeout(window.refreshCalcPlotLayout, 220)
  }
  if (!open) frClearHighlights()
}

function switchToolTab(tabId, opts = {}) {
  if (tabId === 'archive') tabId = 'basic'
  activeToolTab = tabId
  document.querySelectorAll('.tool-tab-btn').forEach(btn => {
    btn.classList.toggle('active', isToolPanelOpen() && btn.dataset.tab === tabId)
  })
  document.querySelectorAll('.tool-tab-pane').forEach(pane => {
    pane.style.display = pane.id === 'tab-' + tabId ? '' : 'none'
  })
  if (tabId === 'workflow') renderWorkflowOpsPool()
  if (tabId === 'find-replace' && (opts.open || isToolPanelOpen())) frUpdateUI()
  else frClearHighlights()
  storeSet(TAB_KEY, tabId)
  if (opts.open || isToolPanelOpen()) scheduleToolHeightFit()
  if ('open' in opts) setToolPanelOpen(!!opts.open)
}

document.querySelectorAll('.tool-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab
    const shouldOpen = !(isToolPanelOpen() && activeToolTab === tabId)
    switchToolTab(tabId, { open: shouldOpen })
  })
})

// 编解码工具已抽至 codec.js（在 app.js 之后加载）

// ==================== 初始化 ====================

// 拆分后 csv.js / sketch.js 在本文件之后加载；applyLang 可能触发 renderCsv，
// 故把引导延到全部脚本解析完（DOMContentLoaded）再跑，确保相关函数已定义。
function bootstrap() {
  loadSlots()
  loadPinned()
  loadArchive()
  renderSlots()
  initSlotsScroll()
  $('editor').value = getActiveSlot().text
  loadSplitLayout()
  renderEditorPanes()
  updateCount()
  applyWrapMode(storeGet(WRAP_KEY) !== 'off')
  applyLang(getActiveSlot().lang || '')
  initLangPicker()
  applyTheme(storeGet(THEME_KEY) || 'light')
  restorePinnedNotes()
  switchToolTab(activeToolTab, { open: false })
  setTimeout(gcOrphanImages, 2000)   // 延后清扫无引用的图片附件，不阻塞启动
}

// 收集所有槽位 + 归档文本里在用的图片 id
function collectUsedImageIds() {
  const ids = new Set()
  const scan = t => {
    if (!t) return
    String(t).replace(/img:\/\/(imgatt_[0-9a-z]+_[0-9a-z]+)/gi, (_, id) => { ids.add(id); return _ })
  }
  slots.forEach(s => scan(s.text))
  if (Array.isArray(archiveList)) archiveList.forEach(a => scan(a.text))
  return Array.from(ids)
}

// 标记-清扫孤儿图片：只删超过 1 天、且无任何文本引用的附件
function gcOrphanImages() {
  if (!window.textTool || !window.textTool.cleanupOrphanImages) return
  try { window.textTool.cleanupOrphanImages(collectUsedImageIds(), 86400000) } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}

// ==================== 右键菜单 ====================
;(function () {
  const menu = $('ctx-menu')
  let lastTarget = null

  function pasteAtCursor(el, text) {
    if (!text) return
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const s = el.selectionStart, e = el.selectionEnd
      el.value = el.value.slice(0, s) + text + el.value.slice(e)
      el.selectionStart = el.selectionEnd = s + text.length
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (el.isContentEditable) {
      document.execCommand('insertText', false, text)
    }
  }

  document.addEventListener('contextmenu', e => {
    e.preventDefault()
    lastTarget = e.target
    // 仅文本区域响应
    if (!lastTarget.closest('#edit-area')) return
    const isEditable = lastTarget.tagName === 'TEXTAREA' || lastTarget.tagName === 'INPUT'
    const hasSel = !!window.getSelection().toString()

    menu.querySelector('[data-action="cut"]').classList.toggle('disabled', !(isEditable && hasSel))
    menu.querySelector('[data-action="copy"]').classList.toggle('disabled', !hasSel)
    menu.querySelector('[data-action="paste"]').classList.toggle('disabled', !isEditable)
    menu.querySelector('[data-action="selectAll"]').classList.toggle('disabled', !isEditable)

    // 定位，防止超出视口
    menu.style.display = 'block'
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    const x = Math.min(e.clientX, window.innerWidth - mw - 4)
    const y = Math.min(e.clientY, window.innerHeight - mh - 4)
    menu.style.left = x + 'px'
    menu.style.top = y + 'px'
  })

  menu.addEventListener('click', e => {
    const action = e.target.dataset.action
    if (!action || e.target.classList.contains('disabled')) return
    menu.style.display = 'none'
    if (action === 'paste') {
      const text = window.textTool ? window.textTool.readClipboard() : ''
      pasteAtCursor(lastTarget, text)
    } else {
      document.execCommand(action)
    }
  })

  document.addEventListener('click', () => { menu.style.display = 'none' })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.style.display = 'none' })
})()
