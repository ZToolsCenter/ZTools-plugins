import './styles.css'
import {
  extractJsonFromAction,
  formatJson,
  formatJsonPath,
  getJsonType,
  parseJson,
  replaceValueAtPath,
  valueToClipboardText,
  valueToEditorText
} from './json-utils.js'
import { renderJsonTree, setAllTreeNodesOpen } from './tree-view.js'


const SETTINGS_KEY = 'ztools-json-formatter-settings-v1'
const AUTO_FORMAT_DELAY = 320
const SAMPLE_JSON = `{
  // 支持 JSON5 注释、尾逗号与未加引号的 key
  project: "JSON Formatter",
  version: 1,
  localOnly: true,
  features: ["格式化", "树形浏览", "节点编辑", "错误定位"],
  author: { name: "hulin", tool: "ZTools" },
}`

let currentValue
let currentText = ''
let selectedPath = null
let autoFormatTimer

const elements = {
  input: document.querySelector('#inputJson'),
  output: document.querySelector('#outputJson'),
  tree: document.querySelector('#jsonTree'),
  treeEmpty: document.querySelector('#treeEmpty'),
  inspector: document.querySelector('#nodeInspector'),
  nodeType: document.querySelector('#nodeType'),
  nodePath: document.querySelector('#nodePath'),
  nodeValue: document.querySelector('#nodeValue'),
  allowJson5: document.querySelector('#json5Input'),
  sortKeys: document.querySelector('#sortKeysInput'),
  formatButton: document.querySelector('#formatButton'),
  pasteButton: document.querySelector('#pasteButton'),
  sampleButton: document.querySelector('#sampleButton'),
  clearButton: document.querySelector('#clearButton'),
  copyButton: document.querySelector('#copyButton'),
  copyPathButton: document.querySelector('#copyPathButton'),
  copyValueButton: document.querySelector('#copyValueButton'),
  saveNodeButton: document.querySelector('#saveNodeButton'),
  expandButton: document.querySelector('#expandButton'),
  collapseButton: document.querySelector('#collapseButton'),
  treeActions: document.querySelector('#treeActions'),
  inputStats: document.querySelector('#inputStats'),
  outputStats: document.querySelector('#outputStats'),
  status: document.querySelector('#statusText'),
  parseMode: document.querySelector('#parseMode'),
  lineNumbers: document.querySelector('#lineNumbers'),
  tabs: [...document.querySelectorAll('.view-tab')],
  views: {
    tree: document.querySelector('#treeView'),
    text: document.querySelector('#textView')
  }
}

function getSettings() {
  return {
    allowJson5: elements.allowJson5.checked,
    sortKeys: elements.sortKeys.checked
  }
}

function loadSettings() {
  try {
    return { allowJson5: true, sortKeys: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { allowJson5: true, sortKeys: false }
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(getSettings()))
}

function setStatus(message, tone = 'normal') {
  elements.status.textContent = message
  elements.status.dataset.tone = tone
}

function updateLineNumbers() {
  const lineCount = Math.max(1, elements.input.value.split('\n').length)
  elements.lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')
  elements.inputStats.textContent = `${elements.input.value.length.toLocaleString()} 字符${elements.input.value ? ` · ${lineCount.toLocaleString()} 行` : ''}`
}

function updateResultStats() {
  const count = countNodes(currentValue)
  elements.outputStats.textContent = currentText
    ? `${count.toLocaleString()} 节点 · ${currentText.length.toLocaleString()} 字符`
    : '等待格式化'
  elements.copyButton.disabled = !currentText
}

function countNodes(value) {
  if (!value || typeof value !== 'object') return value === undefined ? 0 : 1
  return 1 + Object.values(value).reduce((total, child) => total + countNodes(child), 0)
}

function renderResult({ quiet = false } = {}) {
  try {
    const result = formatJson(elements.input.value, getSettings())
    currentValue = result.value
    currentText = result.text
    selectedPath = null
    elements.output.value = currentText
    elements.inspector.hidden = true
    elements.treeEmpty.hidden = true
    elements.tree.hidden = false
    const treeResult = renderJsonTree(elements.tree, currentValue, { onSelect: selectNode })
    elements.parseMode.textContent = result.mode === 'json5' ? '已按 JSON5 解析' : '标准 JSON'
    elements.parseMode.dataset.mode = result.mode
    updateResultStats()
    if (!quiet) setStatus(treeResult.limited ? '格式化完成；树形视图已限制节点数量' : '格式化完成', 'success')
    return true
  } catch (error) {
    currentValue = undefined
    currentText = ''
    selectedPath = null
    elements.output.value = ''
    elements.tree.replaceChildren()
    elements.tree.hidden = true
    elements.treeEmpty.hidden = false
    elements.inspector.hidden = true
    elements.parseMode.textContent = '解析失败'
    elements.parseMode.dataset.mode = 'error'
    updateResultStats()
    setStatus(error instanceof Error ? error.message : 'JSON 解析失败', 'error')
    return false
  }
}

function scheduleFormat() {
  clearTimeout(autoFormatTimer)
  updateLineNumbers()
  if (!elements.input.value.trim()) {
    clearResult()
    setStatus('等待输入 JSON')
    return
  }
  autoFormatTimer = setTimeout(() => renderResult({ quiet: true }), AUTO_FORMAT_DELAY)
}

function clearResult() {
  currentValue = undefined
  currentText = ''
  selectedPath = null
  elements.output.value = ''
  elements.tree.replaceChildren()
  elements.tree.hidden = true
  elements.treeEmpty.hidden = false
  elements.inspector.hidden = true
  elements.parseMode.textContent = 'JSON / JSON5'
  delete elements.parseMode.dataset.mode
  updateResultStats()
}

function selectNode({ path, value }) {
  selectedPath = path
  elements.inspector.hidden = false
  elements.nodeType.textContent = getJsonType(value)
  elements.nodeType.dataset.type = getJsonType(value)
  elements.nodePath.textContent = formatJsonPath(path)
  elements.nodeValue.value = valueToEditorText(value)
}

async function writeClipboard(text, successMessage) {
  try {
    if (window.ztools?.copyText) window.ztools.copyText(text)
    else await navigator.clipboard.writeText(text)
    setStatus(successMessage, 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '复制失败', 'error')
  }
}

async function pasteInput() {
  try {
    const text = window.jsonFormatterBridge?.readClipboardText
      ? window.jsonFormatterBridge.readClipboardText()
      : await navigator.clipboard.readText()
    elements.input.value = text
    updateLineNumbers()
    if (text.trim()) renderResult()
    elements.input.focus()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '无法读取剪贴板', 'error')
  }
}

function saveSelectedNode() {
  if (!selectedPath) return
  try {
    const path = selectedPath
    const nextValue = parseJson(elements.nodeValue.value, { allowJson5: elements.allowJson5.checked }).value
    currentValue = replaceValueAtPath(currentValue, path, nextValue)
    currentText = JSON.stringify(currentValue, null, 2)
    elements.input.value = currentText
    updateLineNumbers()
    renderResult({ quiet: true })
    setStatus(`已更新 ${formatJsonPath(path)}`, 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '节点值无效', 'error')
  }
}

function switchView(name) {
  for (const tab of elements.tabs) tab.classList.toggle('active', tab.dataset.view === name)
  for (const [viewName, view] of Object.entries(elements.views)) view.classList.toggle('active', viewName === name)
  elements.treeActions.hidden = name !== 'tree'
}

function handlePluginEnter(action) {
  const json = extractJsonFromAction(action)
  if (json) {
    elements.input.value = json
    updateLineNumbers()
    renderResult({ quiet: true })
  }
  requestAnimationFrame(() => elements.input.focus())
}

const settings = loadSettings()
elements.allowJson5.checked = Boolean(settings.allowJson5)
elements.sortKeys.checked = Boolean(settings.sortKeys)

for (const control of [elements.allowJson5, elements.sortKeys]) {
  control.addEventListener('change', () => {
    saveSettings()
    if (elements.input.value.trim()) renderResult({ quiet: true })
  })
}

elements.input.addEventListener('input', scheduleFormat)
elements.input.addEventListener('scroll', () => { elements.lineNumbers.scrollTop = elements.input.scrollTop })
elements.formatButton.addEventListener('click', () => { clearTimeout(autoFormatTimer); renderResult() })
elements.pasteButton.addEventListener('click', pasteInput)
elements.sampleButton.addEventListener('click', () => {
  elements.input.value = SAMPLE_JSON
  updateLineNumbers()
  renderResult()
})
elements.clearButton.addEventListener('click', () => {
  clearTimeout(autoFormatTimer)
  elements.input.value = ''
  updateLineNumbers()
  clearResult()
  setStatus('已清空')
  elements.input.focus()
})
elements.copyButton.addEventListener('click', () => writeClipboard(currentText, '已复制格式化结果'))
elements.copyPathButton.addEventListener('click', () => writeClipboard(elements.nodePath.textContent, '已复制节点路径'))
elements.copyValueButton.addEventListener('click', () => {
  if (selectedPath) void writeClipboard(valueToClipboardText(selectedPath.length ? selectedPath.reduce((value, key) => value[key], currentValue) : currentValue), '已复制节点值')
})
elements.saveNodeButton.addEventListener('click', saveSelectedNode)
elements.expandButton.addEventListener('click', () => setAllTreeNodesOpen(elements.tree, true))
elements.collapseButton.addEventListener('click', () => setAllTreeNodesOpen(elements.tree, false))
for (const tab of elements.tabs) tab.addEventListener('click', () => switchView(tab.dataset.view))
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault()
    renderResult()
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    if (currentText) void writeClipboard(currentText, '已复制格式化结果')
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    void pasteInput()
  }
})

if (window.ztools?.onPluginEnter) {
  window.ztools.onPluginEnter(handlePluginEnter)
  void window.ztools.setExpendHeight?.(660)
}

updateLineNumbers()
updateResultStats()
elements.input.focus()
