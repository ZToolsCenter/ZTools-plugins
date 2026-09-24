<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, CircleAlert, Copy, FileSearch, FileText, Globe2, ListTodo, Search, SquareTerminal, Wrench, X } from '@lucide/vue'
import ImageGallery from './ImageGallery.vue'
import { isShellToolName } from '../tools.js'

const props = defineProps({ call: { type: Object, required: true } })
const emit = defineEmits(['approve', 'reject'])
const expanded = ref(false)
const copied = ref(false)
const fileContentExpanded = ref(false)
const fileCopied = ref(false)
const highlightedReadHtml = ref('')
let copyResetTimer = 0
let readHighlightGeneration = 0
const statusLabel = computed(() => ({ waiting: '等待确认', running: '执行中', completed: '已完成', rejected: '已拒绝', cancelled: '已取消', error: '失败' })[props.call.status] || '准备中')

const TOOL_PRESENTATION = {
  grep: { title: '搜索', icon: Search, keys: ['pattern', 'path'] },
  find: { title: '查找', icon: FileSearch, keys: ['pattern', 'path'] },
  ls: { title: '目录', icon: FileSearch, keys: ['path'] },
  read: { title: '读取', icon: FileText, keys: ['path'] },
  write: { title: '写入', icon: FileText, keys: ['path'] },
  edit: { title: '编辑', icon: FileText, keys: ['path'] },
  bash: { title: 'Bash', icon: SquareTerminal, keys: ['description', 'command'] },
  powershell: { title: 'PowerShell', icon: SquareTerminal, keys: ['description', 'command'] },
  list_background_shells: { title: 'Shell', icon: SquareTerminal, keys: [] },
  read_background_shell_output: { title: 'Shell', icon: SquareTerminal, keys: ['shell_id'] },
  kill_background_shell: { title: 'Shell', icon: SquareTerminal, keys: ['shell_id'] },
  task_read: { title: '任务', icon: ListTodo, keys: [] },
  task_write: { title: '任务', icon: ListTodo, keys: ['description'] },
  builtin_web_search: { title: '网页搜索', icon: Globe2, keys: ['query'] },
  builtin_web_fetch: { title: '读取网页', icon: Globe2, keys: ['url'] },
  Skill: { title: 'Skill', icon: Wrench, keys: ['skill', 'task'] },
}

/**
 * 获取当前工具的中文标题、图标和摘要参数优先级。
 * @returns {{title: string, icon: object, keys: string[]}} 工具展示配置。
 */
function resolvePresentation() {
  return TOOL_PRESENTATION[props.call.name] || { title: '工具', icon: Wrench, keys: [] }
}

/**
 * 根据执行结果选择工具类型图标或错误状态图标。
 * @returns {object} 当前工具行使用的 Lucide 图标组件。
 */
function resolveToolIcon() {
  if (props.call.status === 'error' || (isShellExecution.value && shellTerminalState.value === 'error')) return CircleAlert
  if (props.call.status === 'rejected' || props.call.status === 'cancelled') return X
  return presentation.value.icon
}

/**
 * 从关键参数或错误结果中提取工具折叠行摘要。
 * @returns {string} 当前工具调用的一行摘要。
 */
function buildToolSummary() {
  if (props.call.status === 'error' && props.call.result) return firstLine(props.call.result)
  const args = props.call.args && typeof props.call.args === 'object' ? props.call.args : {}
  for (const key of presentation.value.keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return firstLine(value.trim())
  }
  const fallback = Object.values(args).find((value) => typeof value === 'string' && value.trim())
  if (typeof fallback === 'string') return firstLine(fallback.trim())
  return statusLabel.value
}

const presentation = computed(resolvePresentation)
const toolIcon = computed(resolveToolIcon)
const summary = computed(buildToolSummary)
const isShellExecution = computed(isShellExecutionCall)
const shellCommand = computed(buildShellCommand)
const shellResult = computed(parseShellResult)
const shellOutput = computed(buildShellOutput)
const shellTerminalState = computed(resolveShellTerminalState)
const shellSettled = computed(isShellSettled)
const shellExitLabel = computed(buildShellExitLabel)
const readCard = computed(resolveReadCard)
const diffCard = computed(resolveDiffCard)
const readRows = computed(buildReadRows)
const visibleReadRows = computed(() => buildVisibleRows(readRows.value, 8))
const diffModel = computed(buildDiffModel)
const visibleDiffRows = computed(() => buildVisibleRows(diffModel.value.rows, 8))
const imageCard = computed(resolveImageCard)

/**
 * 校验并返回图片读取工具的结构化展示卡片。
 * @returns {{card: string, path: string, attachment: Record<string, unknown>}|null} 有效图片卡片；不适用时返回空值。
 */
function resolveImageCard() {
  const card = props.call.presentation
  return card?.card === 'image' && card.attachment?.attachmentId ? card : null
}

/**
 * 截取文本首行作为折叠状态摘要，避免长参数撑开工具行。
 * @param {string} text 待摘要的工具参数或结果文本。
 * @returns {string} 去除首尾空白后的首行文本。
 */
function firstLine(text) {
  return String(text).split('\n')[0].trim()
}

/**
 * 校验并返回读取工具的结构化卡片数据。
 * @returns {{card: string, path: string, lang: string, lines: Array<{number: number, text: string}>, totalLines: number}|null} 有效读取卡片；不适用时返回空值。
 */
function resolveReadCard() {
  const card = props.call.presentation
  if (card?.card !== 'read' || typeof card.path !== 'string' || !Array.isArray(card.lines)) return null
  if (!card.lines.every((line) => Number.isInteger(line?.number) && typeof line?.text === 'string')) return null
  return {
    card: 'read',
    path: card.path,
    lang: typeof card.lang === 'string' ? card.lang : '',
    lines: card.lines,
    totalLines: Number(card.totalLines) || card.lines.length,
  }
}

/**
 * 校验并返回文件写入工具的结构化差异卡片。
 * @returns {{card: string, path: string, diffs: Array<{path: string, oldText: string|null, newText: string}>}|null} 有效差异卡片；不适用时返回空值。
 */
function resolveDiffCard() {
  const card = props.call.presentation
  if (card?.card !== 'diff' || typeof card.path !== 'string' || !Array.isArray(card.diffs) || !card.diffs.length) return null
  const valid = card.diffs.every((diff) => (
    diff && typeof diff.path === 'string' && (diff.oldText === null || typeof diff.oldText === 'string') && typeof diff.newText === 'string'
  ))
  return valid ? { card: 'diff', path: card.path, diffs: card.diffs } : null
}

/**
 * 转义未知语言的源码文本，使其可以安全交给 v-html 渲染。
 * @param {unknown} value 原始源码文本。
 * @returns {string} 已转义的 HTML 文本。
 */
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

/**
 * 为读取卡片生成带原文件行号和语法高亮的展示行。
 * @returns {Array<{kind: string, number: number, html: string}>} 读取卡片展示行。
 */
function buildReadRows() {
  if (!readCard.value) return []
  const raw = readCard.value.lines.map((line) => line.text).join('\n')
  const htmlLines = (highlightedReadHtml.value || escapeHtml(raw)).split('\n')
  return readCard.value.lines.map((line, index) => ({ kind: 'read', number: line.number, html: htmlLines[index] || '' }))
}

/**
 * 展开读取卡片前准备纯文本，并在卡片存在时异步补充语法高亮。
 * @returns {Promise<void>} 当前读取卡片完成高亮或回退后结束的 Promise。
 */
async function renderReadHighlight() {
  const generation = ++readHighlightGeneration
  const card = readCard.value
  if (!card) {
    highlightedReadHtml.value = ''
    return
  }
  const raw = card.lines.map((line) => line.text).join('\n')
  highlightedReadHtml.value = escapeHtml(raw)
  if (!card.lang) return
  try {
    // 文件读取卡片出现后才加载语言定义，普通工具调用不承担高亮成本。
    const { highlightCode } = await import('../utils/code-highlighter.js')
    if (generation !== readHighlightGeneration) return
    highlightedReadHtml.value = highlightCode(raw, card.lang) || escapeHtml(raw)
  } catch {
    if (generation === readHighlightGeneration) highlightedReadHtml.value = escapeHtml(raw)
  }
}

watch(readCard, () => { void renderReadHighlight() }, { immediate: true })

/**
 * 按文件正文规则拆分差异一侧的行，忽略单个末尾换行符。
 * @param {string} text 差异一侧的文本。
 * @returns {string[]} 不含末尾行终止符的正文行。
 */
function splitDiffLines(text) {
  if (!text) return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * 将差异片段压平成可渲染行并统计增删数量与文件数。
 * @returns {{rows: Array<{kind: string, text: string}>, added: number, removed: number, files: number}} 差异展示模型。
 */
function buildDiffModel() {
  if (!diffCard.value) return { rows: [], added: 0, removed: 0, files: 0 }
  const rows = []
  const paths = new Set()
  let previousPath = ''
  let added = 0
  let removed = 0
  for (const diff of diffCard.value.diffs) {
    paths.add(diff.path)
    rows.push({ kind: diff.path === previousPath ? 'gap' : 'path', text: diff.path === previousPath ? '⋯' : diff.path })
    previousPath = diff.path
    for (const text of splitDiffLines(diff.oldText || '')) {
      rows.push({ kind: 'del', text })
      removed += 1
    }
    for (const text of splitDiffLines(diff.newText)) {
      rows.push({ kind: 'add', text })
      added += 1
    }
  }
  return { rows, added, removed, files: paths.size }
}

/**
 * 将过长的文件卡片截为头尾两段，并在中间插入展开控制行。
 * @param {Array<Record<string, unknown>>} rows 完整展示行。
 * @param {number} maxLines 折叠时最多保留的正文行数。
 * @returns {Array<Record<string, unknown>>} 当前展开状态下的可见行。
 */
function buildVisibleRows(rows, maxLines) {
  if (fileContentExpanded.value || rows.length <= maxLines) return rows
  const headCount = Math.ceil(maxLines / 2)
  const tailCount = maxLines - headCount
  return [
    ...rows.slice(0, headCount),
    { kind: 'collapse', hidden: rows.length - maxLines },
    ...rows.slice(rows.length - tailCount),
  ]
}

/**
 * 判断当前工具调用是否为平台专属的前台 Shell 命令执行。
 * @returns {boolean} 是否使用专用终端视图。
 */
function isShellExecutionCall() {
  return isShellToolName(props.call.name)
}

/**
 * 提取模型请求执行的原始命令。
 * @returns {string} Shell 命令文本。
 */
function buildShellCommand() {
  return typeof props.call.args?.command === 'string' ? props.call.args.command : ''
}

/**
 * 将 Shell 工具结果解析为终端需要的退出码和输出流。
 * @returns {{code: number|null, output: string, stdout: string, stderr: string}|null} 终端结果；尚无结果时返回空值。
 */
function parseShellResult() {
  if (props.call.status === 'running' && props.call.liveOutput && typeof props.call.liveOutput === 'object') {
    return {
      code: null,
      output: String(props.call.liveOutput.output || ''),
      stdout: String(props.call.liveOutput.stdout || ''),
      stderr: String(props.call.liveOutput.stderr || ''),
    }
  }
  const raw = props.call.result
  if (raw == null || raw === '') return null
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 非 JSON 错误直接作为标准错误展示，避免用户只看到解析失败。
      return { code: null, output: raw, stdout: '', stderr: raw }
    }
  }
  if (!parsed || typeof parsed !== 'object') return { code: null, output: String(parsed), stdout: String(parsed), stderr: '' }
  if ('stdout' in parsed || 'stderr' in parsed || 'output' in parsed || 'code' in parsed) {
    return {
      code: typeof parsed.code === 'number' ? parsed.code : null,
      output: String(parsed.output || ''),
      stdout: String(parsed.stdout || ''),
      stderr: String(parsed.stderr || ''),
    }
  }
  // 后台启动等非标准 Shell 结果仍需完整显示给用户。
  return { code: null, output: JSON.stringify(parsed, null, 2), stdout: JSON.stringify(parsed, null, 2), stderr: '' }
}

/**
 * 清除终端文本中的 ANSI 控制序列，防止原始转义字符污染界面。
 * @param {unknown} text 原始终端文本。
 * @returns {string} 可直接展示的终端文本。
 */
function stripTerminalControlSequences(text) {
  return String(text || '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

/**
 * 按标准输出、标准错误顺序拼接终端可见内容。
 * @returns {string} 保留原始换行和列对齐的输出文本。
 */
function buildShellOutput() {
  if (!shellResult.value) return ''
  const combined = stripTerminalControlSequences(shellResult.value.output)
  if (combined) return combined
  const stdout = stripTerminalControlSequences(shellResult.value.stdout)
  const stderr = stripTerminalControlSequences(shellResult.value.stderr)
  if (!stdout) return stderr
  if (!stderr) return stdout
  return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}${stderr}`
}

/**
 * 根据工具阶段和退出码决定终端状态点颜色。
 * @returns {'running'|'done'|'error'} 终端视觉状态。
 */
function resolveShellTerminalState() {
  if (['waiting', 'running', 'streaming', 'queued'].includes(props.call.status)) return 'running'
  if (['error', 'rejected', 'cancelled'].includes(props.call.status)) return 'error'
  return shellResult.value?.code != null && shellResult.value.code !== 0 ? 'error' : 'done'
}

/**
 * 判断 Shell 调用是否已经结束并可以展示输出区域。
 * @returns {boolean} 是否已结束。
 */
function isShellSettled() {
  return !['waiting', 'running', 'streaming', 'queued'].includes(props.call.status)
}

/**
 * 构建非正常结束时显示的退出状态。
 * @returns {string} 退出状态文案；正常完成时为空。
 */
function buildShellExitLabel() {
  if (props.call.status === 'rejected') return '已拒绝'
  if (props.call.status === 'cancelled') return '已取消'
  if (props.call.status === 'error') return '执行失败'
  return shellResult.value?.code != null && shellResult.value.code !== 0 ? `退出码 ${shellResult.value.code}` : ''
}

/**
 * 清除复制成功反馈的计时器和 Shell、文件卡片反馈状态。
 * @returns {void} 无返回值。
 */
function clearCopyFeedback() {
  if (copyResetTimer) window.clearTimeout(copyResetTimer)
  copyResetTimer = 0
  copied.value = false
  fileCopied.value = false
}

/**
 * 将当前命令输出复制到系统剪贴板并短暂显示成功反馈。
 * @returns {Promise<void>} 复制流程完成后结束的 Promise。
 */
async function copyShellOutput() {
  if (!shellOutput.value) return
  try {
    // 优先使用 ZTools 剪贴板能力，浏览器剪贴板作为开发环境回退。
    if (typeof window.ztools?.copyText === 'function') await Promise.resolve(window.ztools.copyText(shellOutput.value))
    else await navigator.clipboard.writeText(shellOutput.value)
    clearCopyFeedback()
    copied.value = true
    copyResetTimer = window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    copied.value = false
  }
}

/**
 * 将文本写入系统剪贴板，并发布文件卡片复制反馈。
 * @param {string} text 需要复制的源码或差异文本。
 * @returns {Promise<void>} 复制流程完成后结束的 Promise。
 */
async function copyFileText(text) {
  if (!text) return
  try {
    // 优先使用宿主剪贴板，浏览器环境仅作为开发预览回退。
    if (typeof window.ztools?.copyText === 'function') await Promise.resolve(window.ztools.copyText(text))
    else await navigator.clipboard.writeText(text)
    clearCopyFeedback()
    fileCopied.value = true
    copyResetTimer = window.setTimeout(clearCopyFeedback, 1600)
  } catch {
    fileCopied.value = false
  }
}

/**
 * 复制读取卡片中的原始文件窗口，不包含行号和界面文本。
 * @returns {Promise<void>} 复制流程完成后结束的 Promise。
 */
async function copyReadContent() {
  await copyFileText(readCard.value?.lines.map((line) => line.text).join('\n') || '')
}

/**
 * 复制当前差异卡片，保留文件路径以及增删前缀。
 * @returns {Promise<void>} 复制流程完成后结束的 Promise。
 */
async function copyDiffContent() {
  const text = diffModel.value.rows.map((row) => {
    if (row.kind === 'del') return `- ${row.text}`
    if (row.kind === 'add') return `+ ${row.text}`
    return row.text
  }).join('\n')
  await copyFileText(text)
}

/**
 * 使用宿主默认应用打开结构化卡片对应的本机文件。
 * @param {string} filePath 文件绝对路径。
 * @returns {Promise<void>} 打开请求完成后结束的 Promise。
 */
async function openPresentedFile(filePath) {
  if (!filePath || typeof window.zvcBridge?.openPath !== 'function') return
  await Promise.resolve(window.zvcBridge.openPath(filePath))
}

onBeforeUnmount(() => {
  // 组件销毁时释放反馈计时器，避免更新已经卸载的会话行。
  readHighlightGeneration += 1
  clearCopyFeedback()
})
</script>

<template>
  <div class="tool-call" :class="`is-${call.status}`">
    <button class="tool-summary" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="tool-leading"><ChevronDown :size="15" class="tool-chevron" /><component :is="toolIcon" :size="15" class="tool-icon" /></span>
      <span class="tool-name">{{ presentation.title }}</span>
      <span class="tool-separator" aria-hidden="true"></span>
      <span class="tool-description">{{ summary }}</span>
      <span v-if="call.status !== 'completed'" class="tool-status">{{ statusLabel }}</span>
    </button>
    <div v-if="expanded && isShellExecution" class="shell-terminal" :data-state="shellTerminalState">
      <div class="shell-terminal-header" :class="{ settled: shellSettled }">
        <span class="shell-terminal-dot" :class="shellTerminalState" :aria-label="statusLabel"></span>
        <pre class="shell-terminal-command">{{ shellCommand || '等待命令参数…' }}</pre>
        <span v-if="shellExitLabel" class="shell-terminal-exit">{{ shellExitLabel }}</span>
        <button v-if="shellSettled && shellOutput" class="shell-terminal-copy" type="button" v-tooltip.bottom.instant="copied ? '已复制命令输出' : '复制命令输出'" :aria-label="copied ? '已复制命令输出' : '复制命令输出'" @click="copyShellOutput">
          <Check v-if="copied" :size="14" />
          <Copy v-else :size="14" />
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </button>
      </div>
      <pre v-if="shellOutput" class="shell-terminal-output" :class="{ error: shellTerminalState === 'error' }">{{ shellOutput }}</pre>
      <div v-else-if="shellSettled" class="shell-terminal-empty">命令没有输出</div>
    </div>
    <div v-else-if="expanded && readCard" class="file-card file-read-card">
      <div class="file-card-header">
        <button class="file-card-path" type="button" v-tooltip="{ label: `打开 ${readCard.path}`, side: 'bottom', maxWidth: 480 }" @click="openPresentedFile(readCard.path)">{{ readCard.path }}</button>
        <span v-if="readCard.lines.length < readCard.totalLines" class="file-card-count">显示 {{ readCard.lines.length }} / {{ readCard.totalLines }} 行</span>
        <span class="file-card-language">{{ readCard.lang }}</span>
        <button v-if="readCard.lines.length" class="file-card-copy" type="button" @click="copyReadContent">{{ fileCopied ? '已复制' : '复制' }}</button>
      </div>
      <div class="file-read-body">
        <template v-for="(row, index) in visibleReadRows" :key="row.kind === 'collapse' ? 'collapse' : `${row.number}-${index}`">
          <button v-if="row.kind === 'collapse'" class="file-card-expand" type="button" @click="fileContentExpanded = true">… 其余 {{ row.hidden }} 行</button>
          <div v-else class="file-read-line"><span class="file-read-number">{{ row.number }}</span><code v-html="row.html"></code></div>
        </template>
        <button v-if="fileContentExpanded && readRows.length > 8" class="file-card-expand" type="button" @click="fileContentExpanded = false">收起</button>
      </div>
    </div>
    <div v-else-if="expanded && diffCard" class="file-card file-diff-card">
      <button class="file-card-copy file-diff-copy" type="button" @click="copyDiffContent">{{ fileCopied ? '已复制' : '复制' }}</button>
      <div class="file-diff-body">
        <template v-for="(row, index) in visibleDiffRows" :key="`${row.kind}-${index}`">
          <button v-if="row.kind === 'collapse'" class="file-card-expand" type="button" @click="fileContentExpanded = true">… 其余 {{ row.hidden }} 行</button>
          <div v-else class="file-diff-line" :class="`is-${row.kind}`">{{ row.text }}</div>
        </template>
        <button v-if="fileContentExpanded && diffModel.rows.length > 8" class="file-card-expand" type="button" @click="fileContentExpanded = false">收起</button>
      </div>
      <div class="file-diff-footer">└ +{{ diffModel.added }} -{{ diffModel.removed }} · {{ diffModel.files }} {{ diffModel.files === 1 ? 'file' : 'files' }}</div>
    </div>
    <div v-else-if="expanded && imageCard" class="file-card image-tool-card">
      <div class="file-card-header"><span class="file-card-path">{{ imageCard.path }}</span><span class="file-card-count">{{ imageCard.attachment.width }}×{{ imageCard.attachment.height }}</span></div>
      <ImageGallery :attachments="[imageCard.attachment]" />
    </div>
    <div v-else-if="expanded" class="tool-details">
      <div v-if="Object.keys(call.args || {}).length" class="tool-detail-section">
        <div class="tool-detail-label">输入</div>
        <pre>{{ JSON.stringify(call.args, null, 2) }}</pre>
      </div>
      <template v-if="call.result">
        <div class="tool-detail-section">
          <div class="tool-detail-label">输出</div>
          <pre :class="{ 'is-error-output': call.status === 'error' }">{{ call.result }}</pre>
        </div>
      </template>
    </div>
    <div v-if="call.status === 'waiting'" class="tool-actions">
      <button class="button-secondary" type="button" @click="emit('reject', call.id)"><X :size="15" />拒绝</button>
      <button class="button-primary" type="button" @click="emit('approve', call.id)"><Check :size="15" />执行</button>
    </div>
  </div>
</template>
