// 剪贴板历史：文本 / 图片 / 文件三类卡片。本机持久化（preload 落盘，不走同步库）。
// 采集经 preload.pollClipboard()，图片字节存本机目录、元数据存 history.json。
// 侧栏覆盖层范式（同画板/计算器）：靠 #app.clip-open 类显隐，开一个关其它。
// 依赖全局：$ / insertAtCursor / insertImageBlob / showToast / closeSketchBoard / closeCalcBoard。

const CLIP_MAX = 50

// clipboardOpen 供 compare.js 跨文件引用（打开对比时关掉本覆盖层），须置于全局词法作用域
let clipboardOpen = false
let clipHistory = (window.textTool && window.textTool.loadClipHistory)
  ? window.textTool.loadClipHistory()
  : []

function clipPersist() {
  if (window.textTool && window.textTool.saveClipHistory) window.textTool.saveClipHistory(clipHistory)
}

// ==================== 采集 ====================

function clipCaptureOnce() {
  if (!window.textTool || !window.textTool.pollClipboard) return
  let entry
  try { entry = window.textTool.pollClipboard() } catch { return }
  if (!entry) return
  // 去重：同内容已存在则移到最前
  const i = clipHistory.findIndex(e => e.sig === entry.sig)
  if (i >= 0) clipHistory.splice(i, 1)
  clipHistory.unshift(entry)
  // 淘汰：超出上限删最旧，图片一并删本机文件
  while (clipHistory.length > CLIP_MAX) {
    const gone = clipHistory.pop()
    if (gone && gone.type === 'image' && gone.file && window.textTool.deleteClipImage) {
      window.textTool.deleteClipImage(gone.file)
    }
  }
  clipPersist()
  if (clipboardOpen) clipRender()
}
// utools-bridge.js 在 onPluginEnter 时补捕一次（防隐藏期轮询限流漏捕）
window.syncClipboardOnce = clipCaptureOnce

// ==================== 卡片交互 ====================

async function clipPaste(entry) {
  if (entry.type === 'text') {
    insertAtCursor(entry.text)
    closeClipboard()
  } else if (entry.type === 'file') {
    insertAtCursor((entry.paths || []).join('\n'))
    closeClipboard()
  } else if (entry.type === 'image') {
    const url = window.textTool && window.textTool.loadClipImage(entry.file)
    if (!url) { showToast('图片已丢失'); return }
    const blob = await (await fetch(url)).blob()
    await insertImageBlob(blob)
    closeClipboard()
  }
}

function clipCopy(entry) {
  if (!window.textTool) return
  if (entry.type === 'text') {
    window.textTool.copyEntryText(entry.text)
  } else if (entry.type === 'image') {
    if (!window.textTool.copyEntryImage(entry.file)) { showToast('复制图片失败'); return }
  } else if (entry.type === 'file') {
    if (!window.textTool.copyEntryFiles(entry.paths)) { showToast('复制文件失败（需 uTools 环境）'); return }
  }
  showToast('已复制到剪贴板')
}

function clipOpen(entry) {
  if (!window.textTool) return
  ;(entry.paths || []).forEach(p => window.textTool.openPath(p))
}

// ==================== 渲染 ====================

function clipActBtn(label, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'clip-act'
  b.textContent = label
  b.addEventListener('click', e => { e.stopPropagation(); onClick() })
  return b
}

function clipTimeLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function clipCard(entry) {
  const item = document.createElement('div')
  item.className = 'clip-item clip-' + entry.type

  const body = document.createElement('div')
  body.className = 'clip-body'
  if (entry.type === 'text') {
    body.textContent = entry.text.replace(/\s+/g, ' ').trim()
    body.title = entry.text.slice(0, 300)
  } else if (entry.type === 'image') {
    const img = document.createElement('img')
    img.className = 'clip-thumb'
    img.alt = '图片'
    const url = window.textTool && window.textTool.loadClipImage(entry.file)
    if (url) img.src = url
    body.appendChild(img)
    if (entry.w && entry.h) {
      const dim = document.createElement('span')
      dim.className = 'clip-dim'
      dim.textContent = `${entry.w}×${entry.h}`
      body.appendChild(dim)
    }
  } else if (entry.type === 'file') {
    ;(entry.paths || []).forEach(p => {
      const row = document.createElement('div')
      row.className = 'clip-file-row'
      row.title = p
      const name = document.createElement('span')
      name.className = 'clip-file-name'
      name.textContent = p.split(/[\\/]/).pop()
      const full = document.createElement('span')
      full.className = 'clip-file-path'
      full.textContent = p
      row.appendChild(name)
      row.appendChild(full)
      body.appendChild(row)
    })
  }
  body.addEventListener('click', () => clipPaste(entry))
  item.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'clip-footer'
  const time = document.createElement('div')
  time.className = 'clip-time'
  time.textContent = clipTimeLabel(entry.ts)
  footer.appendChild(time)

  const actions = document.createElement('div')
  actions.className = 'clip-actions'
  if (entry.type === 'file') actions.appendChild(clipActBtn('打开', () => clipOpen(entry)))
  actions.appendChild(clipActBtn('复制', () => clipCopy(entry)))
  actions.appendChild(clipActBtn('粘贴', () => clipPaste(entry)))
  footer.appendChild(actions)
  item.appendChild(footer)

  return item
}

function clipRender() {
  const container = $('clipboard-items')
  container.innerHTML = ''
  if (clipHistory.length === 0) {
    container.innerHTML = '<div class="clip-empty">暂无记录（复制内容后自动出现）</div>'
    return
  }
  clipHistory.forEach(entry => container.appendChild(clipCard(entry)))
}

// ==================== 面板显隐 ====================

function openClipboard() {
  if (window.closeSketchBoard) window.closeSketchBoard()
  if (window.closeCalcBoard) window.closeCalcBoard()
  clipboardOpen = true
  $('app').classList.add('clip-open')
  $('btn-clip-board').classList.add('active')
  clipRender()
}

function closeClipboard() {
  clipboardOpen = false
  $('app').classList.remove('clip-open')
  $('btn-clip-board').classList.remove('active')
}

$('btn-clip-board').addEventListener('click', () => {
  clipboardOpen ? closeClipboard() : openClipboard()
})
$('btn-clip-collapse').addEventListener('click', closeClipboard)

// 轮询采集（首轮由 preload 记基线不入库）
;(() => {
  if (window.textTool) setInterval(clipCaptureOnce, 600)
})()
