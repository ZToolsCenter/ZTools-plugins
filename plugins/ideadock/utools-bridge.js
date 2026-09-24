// ==================== uTools 桥接：快捷输入 + 入口 + 跨窗口同步 ====================
// 从 app.js 抽出：主页面浮层快捷输入选择器、uTools onPluginEnter 入口
// 分发、悬浮便签跨窗口同步。依赖 app.js 全局：$ / slots / renderSlots /
// getActiveSlot / addSlot / persistCurrent / importSelectedTextFiles 等，
// 及 workflow.js 的 execWorkflowAt（运行期）。必须在 app.js 之后加载。
// 顶层通过宿主适配层注册 onPluginEnter，于同步加载阶段完成（时机同原先）。

// uTools list 模式无法与 main 界面共存，故在主页面内做一个浮层选择器：
// 自动聚焦输入框 + 快捷项列表，上下键选择、回车粘贴。

let qiItems = []
let qiIndex = 0

function allSlotsForQuick() {
  let all = slots
  try {
    const raw = storeGet(SLOTS_KEY)
    if (raw) all = JSON.parse(raw)
  } catch {}
  return Array.isArray(all) ? all : []
}

function archiveItemsForQuick() {
  let all = archiveList
  try {
    const raw = storeGet(ARCHIVE_KEY)
    if (raw) all = JSON.parse(raw)
  } catch {}
  return Array.isArray(all) ? all : []
}

function namedSlotsForQuick() {
  return allSlotsForQuick().filter(s => s.named && s.name && (s.text || '').length)
}

function quickItems() {
  const slotItems = allSlotsForQuick()
    .filter(s => (s.text || '').length)
    .map(s => ({ name: slotTitle(s), text: s.text || '', lang: s.lang || '', source: 'slot' }))
    .filter(item => item.name)
  const archivedItems = archiveItemsForQuick()
    .filter(item => (item.text || '').length && item.name)
    .map(item => ({ name: item.name, text: item.text || '', lang: item.lang || '', source: 'archive' }))
  return [...slotItems, ...archivedItems]
}

function quickPasteAndExit(text) {
  window.ideadockHost.pasteTextAndExit(text)
}

// 入口：仅当标题与输入完全相等才直接粘贴，其余一律弹浮层让用户选
function openQuickInput(payload) {
  let q = (payload || '').toString()
  // 只有手敲 =xxx 才把 xxx 当查询；其它入口（= 关键词 / 全局快捷键）一律开空白面板
  if (q.startsWith('=')) {
    q = q.slice(1).trim()
  } else {
    q = ''
  }
  if (q) {
    const exact = quickItems().find(s => s.name.toLowerCase() === q.toLowerCase())
    if (exact) { quickPasteAndExit(exact.text); return }
  }
  showQuickInput(q)
}

function showQuickInput(initialQuery) {
  $('quick-input-modal').style.display = 'block'
  const input = $('quick-input-search')
  input.value = initialQuery || ''
  renderQuickList(input.value)
  setTimeout(() => { input.focus(); input.select() }, 0)
}

function closeQuickInput() {
  $('quick-input-modal').style.display = 'none'
}

function quickAddArchiveTitle(text) {
  const first = String(text || '').trim().split(/\r?\n/)[0]?.trim() || '临时文本'
  return first.length > 24 ? first.slice(0, 24) + '…' : first
}

function quickAddToArchive() {
  const titleEl = $('quick-add-title')
  const contentEl = $('quick-add-content')
  const text = (contentEl.value || '').trim()
  if (!text) {
    showToast('请输入归档内容')
    contentEl.focus()
    return
  }
  const name = (titleEl.value || '').trim() || quickAddArchiveTitle(text)
  const item = { id: Date.now(), name, text, lang: '', filename: '', time: Date.now() }
  archiveList.unshift(item)
  if (archiveList.length > 50) archiveList.pop()
  saveArchive()
  titleEl.value = ''
  contentEl.value = ''
  renderQuickList($('quick-input-search').value)
  if (typeof isResourceOpen === 'function' && isResourceOpen() && storeGet(RESOURCE_TAB_KEY) === 'archive') renderArchive()
  showToast('已新增到归档：' + name)
  contentEl.focus()
}

function renderQuickList(query) {
  const items = quickItems()
  const q = (query || '').trim().toLowerCase()
  qiItems = q ? items.filter(s => s.name.toLowerCase().includes(q)) : items
  qiIndex = 0
  const list = $('quick-input-list')
  list.innerHTML = ''
  if (!qiItems.length) {
    list.innerHTML = '<div class="quick-input-empty">无匹配的快捷输入项</div>'
    return
  }
  qiItems.forEach((s, i) => {
    const row = document.createElement('div')
    row.className = 'quick-input-item' + (i === qiIndex ? ' active' : '')
    const titleEl = document.createElement('span')
    titleEl.className = 'qi-title'
    titleEl.textContent = s.name
    const previewEl = document.createElement('span')
    previewEl.className = 'qi-preview'
    previewEl.textContent = (s.text || '').replace(/\s+/g, ' ').trim().slice(0, 50)
    row.append(titleEl, previewEl)
    row.addEventListener('click', () => quickPasteAndExit(s.text))
    row.addEventListener('mouseenter', () => { qiIndex = i; updateQuickActive() })
    list.appendChild(row)
  })
}

function updateQuickActive() {
  const rows = $('quick-input-list').querySelectorAll('.quick-input-item')
  rows.forEach((r, i) => r.classList.toggle('active', i === qiIndex))
  if (rows[qiIndex]) rows[qiIndex].scrollIntoView({ block: 'nearest' })
}

$('quick-input-search').addEventListener('input', e => renderQuickList(e.target.value))
$('quick-input-search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (qiItems.length) { qiIndex = (qiIndex + 1) % qiItems.length; updateQuickActive() }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (qiItems.length) { qiIndex = (qiIndex - 1 + qiItems.length) % qiItems.length; updateQuickActive() }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const s = qiItems[qiIndex]
    if (s) quickPasteAndExit(s.text)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeQuickInput()
  }
})
$('quick-input-overlay').addEventListener('click', closeQuickInput)
$('quick-add-save').addEventListener('click', quickAddToArchive)
$('quick-add-title').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault()
    $('quick-add-content').focus()
  }
})
$('quick-add-content').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    quickAddToArchive()
  }
})

// ==================== 宿主入口 ====================

if (window.ideadockHost.supports('onPluginEnter')) {
  window.ideadockHost.onPluginEnter(({ code, type, payload }) => {
    // single 模式下窗口复用、脚本不会重新执行，每次进入时重新读取暂存槽数据，
    // 这样 MCP 工具在窗口隐藏期间写入的内容也能反映到界面上
    flushTyping()
    loadSlots()
    loadPinned()
    renderSlots()
    $('editor').value = getActiveSlot().text
    updateCount()
    hideUndo()
    closeQuickInput() // 清掉可能残留的快捷输入浮层

    // 每次进入插件时补一次剪贴板同步，防止隐藏期间限流漏捕
    if (window.syncClipboardOnce) window.syncClipboardOnce()

    // 快捷输入：匹配命名槽标题粘贴，不落入下面的通用 over 处理
    if (window.checkDueTodos) window.checkDueTodos()

    if (code === 'quick-input') {
      const raw = typeof payload === 'string' ? payload : (payload && payload.data) || ''
      openQuickInput(raw)
      return
    }

    if (code === 'stash-file' && (type === 'files' || type === 'file') && payload) {
      importSelectedTextFiles(payload)
      return
    }

    // 执行默认工作流：用选中文字过当前工作流，结果填入新槽。
    // 必须先于下面的通用 over 处理并 return，否则会先建一个塞原文的槽、再建一个塞结果的槽（重复建槽）
    if (code === 'copy-plain-text' && type === 'over' && payload) {
      const text = typeof payload === 'string' ? payload : payload.data
      if (text) {
        if (window.textTool && typeof window.textTool.writePlainClipboard === 'function') {
          window.textTool.writePlainClipboard(text)
        } else if (window.ideadockHost.supports('copyText')) {
          window.ideadockHost.copyText(String(text))
        } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(String(text)).catch(() => {})
        }
        showToast('已复制为纯文本')
        setTimeout(() => {
          if (window.ideadockHost.supports('outPlugin')) window.ideadockHost.outPlugin()
        }, 180)
      }
      return
    }

    if (code === 'run-workflow' && type === 'over' && payload) {
      const text = typeof payload === 'string' ? payload : payload.data
      if (text) {
        loadWorkflows()
        execWorkflowAt(wfActive, text).then(result => {
          addSlot()
          $('editor').value = result
          persistCurrent()
          updateCount()
        }).catch(e => showToast(e.message))
      }
      return
    }

    // 选中文字存入新槽并钉到桌面
    if (code === 'pin-text' && type === 'over' && payload) {
      const text = typeof payload === 'string' ? payload : payload.data
      if (text) {
        addSlot()
        $('editor').value = text
        persistCurrent()
        updateCount()
        togglePin(activeId)
      }
      return
    }

    // 处理选中文本：把选中文字塞进新槽
    if (type === 'over' && payload) {
      const text = typeof payload === 'string' ? payload : payload.data
      if (text) {
        addSlot()
        $('editor').value = text
        persistCurrent()
        updateCount()
      }
    }

  })
}

// ==================== 跨窗口同步（悬浮便签） ====================

// createBrowserWindow 打开的子窗口与主窗口之间不会互相触发 storage 事件，
// 所以这里用轮询方式同步：定期读取持久化存储中的最新数据，与内存状态做差异合并
const SYNC_POLL_INTERVAL = 500

setInterval(() => {
  if (pinnedRecords.size === 0) return
  syncSlotsFromStorage()
  syncPinnedFromStorage()
}, SYNC_POLL_INTERVAL)

// 悬浮便签编辑后会直接写 ideadock.slots，这里把变化同步回内存，
// 避免主窗口下次 saveSlots() 时用旧数据把便签的修改覆盖掉
function syncSlotsFromStorage() {
  let stored
  try {
    stored = JSON.parse(storeGet(SLOTS_KEY))
  } catch { return }
  if (!Array.isArray(stored)) return

  let changed = false
  stored.forEach(storedSlot => {
    if (!pinnedRecords.has(storedSlot.id)) return
    const local = slots.find(s => s.id === storedSlot.id)
    if (!local || local.text === storedSlot.text) return
    if (storedSlot.id === activeId && document.activeElement === $('editor')) return
    local.text = storedSlot.text
    changed = true
    if (storedSlot.id === activeId) {
      $('editor').value = storedSlot.text
      updateCount()
    }
  })
  if (changed) {
    saveSlots()
    renderSlots()
    renderEditorPanes()
  }
}

// 悬浮便签的"取消固定"按钮、置顶开关、颜色都直接写 ideadock.pinned，
// 这里把这些变化同步回主窗口（更新图标状态、应用 setAlwaysOnTop）
function syncPinnedFromStorage() {
  let stored
  try {
    stored = JSON.parse(storeGet(PINNED_KEY)) || {}
  } catch { return }

  let removed = false
  pinnedRecords.forEach((bounds, id) => {
    const newBounds = stored[id]
    if (!newBounds) {
      pinnedRecords.delete(id)
      pinnedWindows.delete(id)
      removed = true
      return
    }
    const wasOnTop = bounds.alwaysOnTop !== false
    const isOnTop = newBounds.alwaysOnTop !== false
    if (wasOnTop !== isOnTop) {
      const win = pinnedWindows.get(id)
      if (win) {
        try { win.setAlwaysOnTop(isOnTop) } catch {}
      }
    }
    pinnedRecords.set(id, newBounds)
  })
  if (removed) renderSlots()
}
