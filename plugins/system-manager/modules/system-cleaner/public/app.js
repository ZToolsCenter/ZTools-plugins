'use strict'

const CATEGORY_LABELS = { cache: '缓存', logs: '日志', temporary: '临时' }
const state = { snapshotId: '', candidates: [], busy: false }
const elements = {
  scanButton: document.querySelector('#scanButton'),
  cleanButton: document.querySelector('#cleanButton'),
  themeButton: document.querySelector('#themeButton'),
  statusPanel: document.querySelector('#statusPanel'),
  resultPanel: document.querySelector('#resultPanel'),
  totalSize: document.querySelector('#totalSize'),
  scanMeta: document.querySelector('#scanMeta'),
  candidateList: document.querySelector('#candidateList'),
  selectedSize: document.querySelector('#selectedSize'),
  selectedCount: document.querySelector('#selectedCount'),
  warnings: document.querySelector('#warnings'),
  template: document.querySelector('#candidateTemplate'),
  dialog: document.querySelector('#confirmDialog'),
  dialogCount: document.querySelector('#dialogCount'),
  dialogSize: document.querySelector('#dialogSize'),
  confirmInput: document.querySelector('#confirmInput'),
  confirmCleanButton: document.querySelector('#confirmCleanButton')
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit > 2 ? 1 : 0 })} ${units[unit]}`
}

const api = window.systemCleaner || null

function selectedCandidates() {
  const selected = new Set([...document.querySelectorAll('.candidate-check:checked')].map((input) => input.dataset.id))
  return state.candidates.filter((item) => selected.has(item.id))
}

function updateSelection() {
  const selected = selectedCandidates()
  const bytes = selected.reduce((sum, item) => sum + item.sizeBytes, 0)
  elements.selectedSize.textContent = formatBytes(bytes)
  elements.selectedCount.textContent = `已选 ${selected.length} 项`
  elements.cleanButton.disabled = state.busy || selected.length === 0
}

function setBusy(busy) {
  state.busy = busy
  elements.scanButton.disabled = busy
  elements.cleanButton.disabled = busy || selectedCandidates().length === 0
  document.querySelectorAll('.candidate-check').forEach((input) => { input.disabled = busy })
  document.querySelectorAll('input[name=category]').forEach((input) => { input.disabled = busy })
}

function render(result) {
  state.snapshotId = result.snapshotId
  state.candidates = result.candidates || []
  elements.candidateList.replaceChildren()
  elements.totalSize.textContent = formatBytes(result.totalBytes)
  elements.scanMeta.textContent = `${state.candidates.length} 项 · ${new Date(result.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  elements.warnings.hidden = !result.warnings?.length
  elements.warnings.textContent = (result.warnings || []).map((warning) => warning.message || warning.code).join('；')

  if (!state.candidates.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = '所选分类中没有可安全清理的项目。'
    elements.candidateList.append(empty)
  }
  for (const candidate of state.candidates) {
    const fragment = elements.template.content.cloneNode(true)
    const article = fragment.querySelector('.candidate')
    const checkbox = fragment.querySelector('.candidate-check')
    checkbox.dataset.id = candidate.id
    checkbox.setAttribute('aria-label', `选择 ${candidate.label}`)
    checkbox.checked = candidate.selectedByDefault
    checkbox.addEventListener('change', updateSelection)
    fragment.querySelector('.candidate-label').textContent = candidate.label
    fragment.querySelector('.candidate-badge').textContent = CATEGORY_LABELS[candidate.category] || candidate.category
    fragment.querySelector('.candidate-location').textContent = candidate.location
    fragment.querySelector('.candidate-size').textContent = formatBytes(candidate.sizeBytes)
    fragment.querySelector('.candidate-age').textContent = candidate.ageDays ? `${candidate.ageDays} 天未更新` : '近期项目'
    const revealButton = fragment.querySelector('.reveal-button')
    revealButton.setAttribute('aria-label', `在文件管理器中定位 ${candidate.label}`)
    revealButton.addEventListener('click', () => api.reveal({ snapshotId: state.snapshotId, candidateId: candidate.id }))
    article.dataset.candidateId = candidate.id
    elements.candidateList.append(fragment)
  }
  elements.statusPanel.hidden = true
  elements.resultPanel.hidden = false
  updateSelection()
}

async function scan() {
  setBusy(true)
  elements.resultPanel.hidden = true
  elements.statusPanel.hidden = false
  elements.statusPanel.classList.remove('is-error')
  elements.statusPanel.querySelector('strong').textContent = '正在读取安全清理范围'
  elements.statusPanel.querySelector('p').textContent = '不会扫描文档、照片或其他个人内容目录。'
  try {
    if (!api || typeof api.scan !== 'function') throw new Error('本地清理能力未加载，请在 ZTools 中重新打开插件。')
    const categories = [...document.querySelectorAll('input[name=category]:checked')].map((input) => input.value)
    render(await api.scan({ categories }))
  } catch (error) {
    elements.statusPanel.classList.add('is-error')
    elements.statusPanel.querySelector('strong').textContent = '扫描未完成'
    elements.statusPanel.querySelector('p').textContent = error?.message || '请稍后重试。'
  } finally {
    setBusy(false)
  }
}

function openConfirm() {
  const selected = selectedCandidates()
  elements.dialogCount.textContent = String(selected.length)
  elements.dialogSize.textContent = formatBytes(selected.reduce((sum, item) => sum + item.sizeBytes, 0))
  elements.confirmInput.value = ''
  elements.confirmCleanButton.disabled = true
  elements.dialog.showModal()
  elements.confirmInput.focus()
}

async function executeClean() {
  const selected = selectedCandidates()
  if (!selected.length || elements.confirmInput.value !== '移到废纸篓') return
  setBusy(true)
  elements.confirmCleanButton.disabled = true
  try {
    const result = await api.clean({ snapshotId: state.snapshotId, candidateIds: selected.map((item) => item.id), confirmation: '移到废纸篓' })
    const failedResults = (result.results || []).filter((item) => item.status === 'failed')
    const failed = new Set(failedResults.map((item) => item.candidateId))
    state.candidates = state.candidates.filter((item) => failed.has(item.id) || !selected.some((chosen) => chosen.id === item.id))
    elements.dialog.close()
    await scan()
    if (failedResults.length) {
      elements.warnings.hidden = false
      elements.warnings.textContent = `${failedResults.length} 项未能移到废纸篓，已安全跳过；请查看权限或重新扫描。`
    }
  } catch (error) {
    elements.confirmInput.setCustomValidity(error?.message || '清理失败，请重新扫描')
    elements.confirmInput.reportValidity()
  } finally {
    setBusy(false)
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('system-cleaner-theme', theme) } catch {}
}

elements.scanButton.addEventListener('click', scan)
elements.cleanButton.addEventListener('click', openConfirm)
elements.confirmInput.addEventListener('input', () => { elements.confirmInput.setCustomValidity(''); elements.confirmCleanButton.disabled = elements.confirmInput.value !== '移到废纸篓' })
elements.confirmCleanButton.addEventListener('click', executeClean)
elements.themeButton.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
document.querySelectorAll('input[name=category]').forEach((input) => input.addEventListener('change', scan))
let initialTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
try { initialTheme = localStorage.getItem('system-cleaner-theme') || initialTheme } catch {}
applyTheme(initialTheme)
scan()
