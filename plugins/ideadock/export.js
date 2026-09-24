// ==================== 内容导出 ====================
// 从 app.js 抽出：导出弹窗、导出为文件、整体备份。依赖 app.js 全局：
// $ / getActiveSlot / slots / showToast，运行期读 archive.js 的 archiveList，
// 及 window.textTool。必须在 app.js（及 archive.js）之后加载。

$('btn-export').addEventListener('click', () => {
  const text = $('editor').value
  if (!text.trim()) { showToast('内容为空，无法导出'); return }
  if (!window.textTool || !window.textTool.saveFile) {
    showToast('当前环境不支持文件导出')
    return
  }
  // 类型走 lang-select，文件名自动生成；CSV 默认带 BOM 方便 Excel
  const lang = $('lang-select').value
  $('export-dir').value = window.textTool.getDocumentsPath()
  $('export-encoding').value = lang === 'csv' ? 'utf8bom' : 'utf8'
  $('export-eol').value = 'keep'
  $('export-modal').style.display = ''
})

function closeExportModal() { $('export-modal').style.display = 'none' }
$('export-overlay').addEventListener('click', closeExportModal)
$('export-cancel').addEventListener('click', closeExportModal)

$('export-browse').addEventListener('click', () => {
  const dir = window.textTool.pickDirectory && window.textTool.pickDirectory()
  if (dir) $('export-dir').value = dir
})

// 导出时间戳：年月日时分，无分隔符
function exportTimestamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

// 导出文件名基名：用户命名了槽位就用槽名，否则取内容首行前若干字符；再拼时间戳
function exportBaseName(text) {
  const slot = getActiveSlot()
  let name = (slot && slot.named && slot.name) ? slot.name : ''
  if (!name) {
    const first = (text || '').trim().split(/\r?\n/)[0].trim()
    name = first.slice(0, 16)
  }
  // 去掉 Windows 非法字符与控制符、首尾点和空白
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
  if (!name) name = 'ideadock'
  return `${name}_${exportTimestamp()}`
}

$('export-confirm').addEventListener('click', () => {
  const text = $('editor').value
  if (!text.trim()) { showToast('内容为空，无法导出'); return }
  const dir = $('export-dir').value.trim()
  if (!dir) { showToast('请先选择导出目录'); return }
  const lang = $('lang-select').value
  const extMap = { json: 'json', yaml: 'yaml', python: 'py', js: 'js', html: 'html', markdown: 'md', csv: 'csv' }
  const ext = extMap[lang] || 'txt'
  const encoding = $('export-encoding').value
  const eol = $('export-eol').value
  const cleanDir = dir.replace(/[\\/]+$/, '')
  const base = exportBaseName(text)
  // 含本地图片的 Markdown：整体放进一个独立文件夹（md + assets 子目录），确保图文在一起、可整体移动
  const hasLocalImg = lang === 'markdown' && /img:\/\//.test(text)
  let result
  if (hasLocalImg && window.textTool.exportMarkdown) {
    result = window.textTool.exportMarkdown(text, cleanDir, base, { encoding, eol })
  } else {
    // 普通单文件；同名已存在则自动加 (1)(2)…，不打扰用户
    const savePath = window.textTool.uniqueSavePath
      ? window.textTool.uniqueSavePath(cleanDir, base, ext)
      : cleanDir + '\\' + base + '.' + ext
    result = window.textTool.saveFile(text, savePath, { encoding, eol })
  }
  if (result.ok) {
    closeExportModal()
    showToast('已导出：' + result.path + (result.images ? `（含 ${result.images} 张图片）` : ''))
  } else {
    showToast('导出失败：' + (result.error || '未知错误'))
  }
})

function collectBackupItems() {
  flushTyping()
  const current = getActiveSlot()
  if (current) current.text = $('editor').value
  const slotItems = slots
    .filter(s => String(s.text || '').trim() !== '')
    .map((s, i) => ({
      name: (s.named && s.name) ? s.name : `暂存${i + 1}`,
      filename: s.filename || '',
      text: s.text || '',
      lang: s.lang || ''
    }))
  const archivedItems = archiveList
    .filter(a => String(a.text || '').trim() !== '')
    .map((a, i) => ({
      name: a.name || `归档${i + 1}`,
      filename: a.filename || '',
      text: a.text || '',
      lang: a.lang || ''
    }))
  return [...slotItems, ...archivedItems]
}

function performBackup() {
  if (!window.textTool?.exportBackup || !window.textTool?.pickDirectory) {
    showToast('当前环境不支持整体备份')
    return
  }
  const items = collectBackupItems()
  if (!items.length) {
    showToast('没有可备份的文本')
    return
  }
  const dir = window.textTool.pickDirectory({
    title: '选择整体备份导出位置',
    defaultPath: window.textTool.getDocumentsPath ? window.textTool.getDocumentsPath() : ''
  })
  if (!dir) return
  const result = window.textTool.exportBackup(items, dir, { encoding: 'utf8', eol: 'keep' })
  if (result.ok) {
    showToast(`已备份：${result.path}`)
  } else {
    showToast('备份失败：' + (result.error || '未知错误'))
  }
}
