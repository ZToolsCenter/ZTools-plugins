// ==================== 归档 ====================
// 从 app.js 抽出：归档列表 / 备份导入导出 / 资源抽屉（归档+工作区）。
// 依赖 app.js 全局：$ / storeGet / storeSet / getActiveSlot / slots /
// activePaneIndex / createSlotForPane / persistCurrent / updateCount /
// showToast 及文件导入相关函数，以及 window.textTool。必须在 app.js 之后加载。
// loadArchive() 由 app.js bootstrap（DOMContentLoaded）调用；顶层注册
// 抽屉/备份按钮事件，依赖 DOM 元素已在 body 中。

function archiveNameFromFilename(filename) {
  const name = String(filename || '').split(/[\\/]/).filter(Boolean).pop() || 'document'
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function uniqueArchiveName(baseName, usedNames) {
  const clean = String(baseName || 'document').trim() || 'document'
  const used = usedNames || new Set(archiveList.map(item => item.name))
  if (!used.has(clean)) return clean
  let i = 1
  let next = `${clean}(${i})`
  while (used.has(next)) {
    i++
    next = `${clean}(${i})`
  }
  return next
}

function archiveFilenameForName(filename, name) {
  const original = String(filename || '').split(/[\\/]/).filter(Boolean).pop()
  const dot = original.lastIndexOf('.')
  return dot > 0 ? `${name}${original.slice(dot)}` : name
}

function restoreBackupToArchive() {
  if (!window.textTool?.importBackup || !window.textTool?.pickDirectory) {
    showToast('当前环境不支持恢复文档')
    return
  }
  const dir = window.textTool.pickDirectory({
    title: '选择要恢复的备份文件夹',
    defaultPath: window.textTool.getDocumentsPath ? window.textTool.getDocumentsPath() : ''
  })
  if (!dir) return
  const result = window.textTool.importBackup(dir)
  if (!result || !result.ok) {
    showToast('恢复失败：' + (result?.error || '未知错误'))
    return
  }
  const items = Array.isArray(result.items) ? result.items : []
  if (!items.length) {
    showToast('没有可恢复的文档')
    return
  }
  const now = Date.now()
  const usedArchiveNames = new Set(archiveList.map(item => item.name))
  const restored = items.map((item, i) => {
    const name = uniqueArchiveName(item.name || archiveNameFromFilename(item.filename), usedArchiveNames)
    usedArchiveNames.add(name)
    return {
      id: now + i,
      name,
      text: String(item.text || ''),
      lang: item.lang || '',
      filename: archiveFilenameForName(item.filename || name, name),
      time: now
    }
  })
  archiveList.unshift(...restored)
  saveArchive()
  if (isResourceOpen() && storeGet(RESOURCE_TAB_KEY) === 'archive') renderArchive()
  showToast(`已恢复 ${restored.length} 个文档到归档`)
}

// performBackup 定义在 export.js（在 archive.js 之后加载），故用箭头包裹，
// 把符号解析推迟到点击时（运行期），避免解析期 ReferenceError 中断本文件
const backupBtn = $('btn-backup')
if (backupBtn) backupBtn.addEventListener('click', () => performBackup())
const archiveBackupBtn = $('btn-archive-backup')
if (archiveBackupBtn) archiveBackupBtn.addEventListener('click', () => performBackup())
const restoreBackupBtn = $('btn-restore-backup')
if (restoreBackupBtn) restoreBackupBtn.addEventListener('click', restoreBackupToArchive)

const ARCHIVE_KEY = 'ideadock.archive'
let archiveList = []

function loadArchive() {
  try {
    const raw = storeGet(ARCHIVE_KEY)
    if (raw) archiveList = JSON.parse(raw)
  } catch {}
  if (!Array.isArray(archiveList)) archiveList = []
}

function saveArchive() {
  storeSet(ARCHIVE_KEY, JSON.stringify(archiveList))
}

function archiveItemName(text) {
  const first = text.trim().split(/\r?\n/)[0].trim()
  const s = first || '（空）'
  return s.length > 24 ? s.slice(0, 24) + '…' : s
}

function archiveTimestamp(ts) {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function renderArchive() {
  const container = $('archive-items')
  if (!container) return
  container.innerHTML = ''
  if (archiveList.length === 0) {
    container.innerHTML = '<div class="archive-empty">暂无归档记录<br>点击状态栏"归档"按钮保存当前内容</div>'
    return
  }
  archiveList.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'archive-item'

    row.title = item.text.slice(0, 300)

    const header = document.createElement('div')
    header.className = 'archive-header'

    const langBadge = document.createElement('span')
    langBadge.className = 'archive-lang'
    const langLabel = { '': 'TXT', json: 'JSON', python: 'Python', js: 'JS', html: 'HTML', markdown: 'MD', csv: 'CSV' }
    langBadge.textContent = langLabel[item.lang ?? ''] ?? item.lang

    const name = document.createElement('span')
    name.className = 'archive-name'
    name.textContent = item.name

    header.append(langBadge, name)

    const preview = document.createElement('div')
    preview.className = 'archive-preview'
    preview.textContent = item.text.replace(/\s+/g, ' ').trim() || '（空）'

    const meta = document.createElement('span')
    meta.className = 'archive-meta'
    meta.textContent = archiveTimestamp(item.time) + ' · ' + item.text.length + ' 字'

    const actions = document.createElement('div')
    actions.className = 'archive-actions'

    const restoreBtn = document.createElement('button')
    restoreBtn.className = 'btn-mini'
    restoreBtn.textContent = '恢复'
    restoreBtn.addEventListener('click', () => {
      createSlotForPane(activePaneIndex, { name: item.name, named: true, text: item.text, lang: item.lang || '' })
      archiveList.splice(i, 1)
      saveArchive()
      renderArchive()
    })

    const delBtn = document.createElement('button')
    delBtn.className = 'archive-del'
    delBtn.textContent = '×'
    delBtn.addEventListener('click', () => {
      archiveList.splice(i, 1)
      saveArchive()
      renderArchive()
    })

    actions.append(restoreBtn, delBtn)
    header.append(actions)
    row.append(header, preview, meta)
    container.appendChild(row)
  })
}

const RESOURCE_TAB_KEY = 'ideadock.resourceTab'
const RESOURCE_TABS = new Set(['archive', 'todo', 'workspace'])
const WORKSPACE_PATH_KEY = 'ideadock.workspacePath'
const WORKSPACE_TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'py', 'js', 'mjs', 'cjs', 'html', 'htm', 'css', 'csv', 'xml', 'log'])
let currentResourceTab = storeGet(RESOURCE_TAB_KEY) || 'archive'

function isResourceOpen() {
  return $('app').classList.contains('resource-open')
}

function switchResourceTab(tabId) {
  if (!RESOURCE_TABS.has(tabId)) tabId = 'archive'
  currentResourceTab = tabId
  document.querySelectorAll('.resource-pane').forEach(pane => {
    pane.style.display = pane.id === 'resource-' + tabId ? '' : 'none'
  })
  if (tabId === 'archive') renderArchive()
  if (tabId === 'todo' && window.renderTodo) renderTodo()
  if (tabId === 'workspace') renderWorkspaceRoot()
  storeSet(RESOURCE_TAB_KEY, tabId)
  $('btn-archive-drawer').classList.toggle('active', isResourceOpen() && tabId === 'archive')
  $('btn-todo-drawer').classList.toggle('active', isResourceOpen() && tabId === 'todo')
  $('btn-resource-drawer').classList.toggle('active', isResourceOpen() && tabId === 'workspace')
}

function openResourceDrawer(tabId) {
  $('app').classList.add('resource-open')
  switchResourceTab(tabId || currentResourceTab || 'archive')
}

function closeResourceDrawer() {
  $('app').classList.remove('resource-open')
  $('btn-archive-drawer').classList.remove('active')
  $('btn-todo-drawer').classList.remove('active')
  $('btn-resource-drawer').classList.remove('active')
}

$('btn-archive-drawer').addEventListener('click', () => {
  isResourceOpen() && currentResourceTab === 'archive' ? closeResourceDrawer() : openResourceDrawer('archive')
})

$('btn-todo-drawer').addEventListener('click', () => {
  isResourceOpen() && currentResourceTab === 'todo' ? closeResourceDrawer() : openResourceDrawer('todo')
})

$('btn-resource-drawer').addEventListener('click', () => {
  isResourceOpen() && currentResourceTab === 'workspace' ? closeResourceDrawer() : openResourceDrawer('workspace')
})

$('btn-resource-collapse').addEventListener('click', closeResourceDrawer)

document.addEventListener('mousedown', e => {
  if (!isResourceOpen()) return
  if (e.target.closest('#resource-drawer, .resource-rail')) return
  closeResourceDrawer()
})


function isWorkspaceTextFile(filename) {
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''
  return WORKSPACE_TEXT_EXTS.has(ext)
}

function renderWorkspaceRoot() {
  const input = $('workspace-path')
  const saved = storeGet(WORKSPACE_PATH_KEY) || (window.textTool?.getDocumentsPath?.() || '')
  input.value = saved
  const tree = $('workspace-tree')
  if (!saved) {
    tree.innerHTML = '<div class="archive-empty">选择工作区后显示文件树</div>'
    return
  }
  renderWorkspaceDir(saved, tree, 0)
}

function workspaceNode(entry, depth) {
  const row = document.createElement('div')
  row.className = 'workspace-node'
  row.style.paddingLeft = (6 + depth * 14) + 'px'
  row.dataset.path = entry.path
  row.dataset.dir = entry.isDir ? '1' : '0'

  const icon = document.createElement('span')
  icon.className = 'workspace-node-icon'
  icon.textContent = entry.isDir ? '▸' : '•'

  const name = document.createElement('span')
  name.className = 'workspace-node-name'
  name.textContent = entry.name

  row.append(icon, name)
  return row
}

function renderWorkspaceDir(dir, container, depth) {
  container.innerHTML = '<div class="archive-empty">读取中...</div>'
  if (!window.textTool?.listDirectory) {
    container.innerHTML = '<div class="archive-empty">当前环境不支持读取工作区</div>'
    return
  }
  const res = window.textTool.listDirectory(dir)
  if (res.error) {
    container.innerHTML = `<div class="archive-empty">${res.error}</div>`
    return
  }
  container.innerHTML = ''
  if (!res.entries.length) {
    container.innerHTML = '<div class="archive-empty">空工作区</div>'
    return
  }
  res.entries.forEach(entry => {
    const row = workspaceNode(entry, depth)
    const children = document.createElement('div')
    children.className = 'workspace-children'
    children.style.display = 'none'

    row.addEventListener('click', () => {
      if (entry.isDir) {
        const opening = children.style.display === 'none'
        children.style.display = opening ? '' : 'none'
        row.querySelector('.workspace-node-icon').textContent = opening ? '▾' : '▸'
        if (opening && !children.dataset.loaded) {
          renderWorkspaceDir(entry.path, children, depth + 1)
          children.dataset.loaded = '1'
        }
        return
      }
      if (!isWorkspaceTextFile(entry.name)) {
        showToast('暂不直接打开该类型文件')
        return
      }
      const file = window.textTool?.readTextFile?.(entry.path)
      if (!file || file.error) {
        showToast(file?.error || '读取文件失败')
        return
      }
      applyImportedText(file.name, file.content, { size: file.size || 0 })
    })

    container.append(row, children)
  })
}

$('btn-workspace-pick').addEventListener('click', () => {
  if (!window.textTool?.pickDirectory) {
    showToast('当前环境不支持选择工作区')
    return
  }
  const dir = window.textTool.pickDirectory()
  if (!dir) return
  storeSet(WORKSPACE_PATH_KEY, dir)
  $('workspace-path').value = dir
  renderWorkspaceRoot()
})

$('btn-archive').addEventListener('click', () => {
  const text = $('editor').value
  if (!text.trim()) { showToast('内容为空，无法归档'); return }
  const slot = getActiveSlot()
  const title = (slot.named && slot.name) ? slot.name : archiveItemName(text)
  const item = { id: Date.now(), name: title, text, lang: $('lang-select').value, filename: slot.filename || '', time: Date.now() }
  archiveList.unshift(item)
  if (archiveList.length > 50) archiveList.pop()
  saveArchive()
  if (isResourceOpen() && storeGet(RESOURCE_TAB_KEY) === 'archive') renderArchive()
  if (slots.length > 1) {
    closeSlot(activeId)
  } else {
    flushTyping()
    $('editor').value = ''
    persistCurrent()
    updateCount()
  }
  showToast('已归档：' + item.name)
})
