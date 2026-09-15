<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentUnit } from '@codemirror/language'

// 唯一内容载体：所有操作都原地修改这个文本
const textContent = ref('')
const viewMode = ref<'edit' | 'tree'>('edit')
const errorMsg = ref('')
const statusMsg = ref('')

// === 类型工具 ===
function getType(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function formatValue(v: unknown, type: string): string {
  switch (type) {
    case 'string': {
      const s = v as string
      return `"${s.length > 60 ? s.slice(0, 60) + '…' : s}"`
    }
    case 'number':
    case 'boolean': return String(v)
    case 'null': return 'null'
    case 'undefined': return 'undefined'
    case 'array': return `Array(${(v as unknown[]).length})`
    case 'object': return `{${Object.keys(v as object).length}}`
    default: return String(v)
  }
}

// === 智能解析（自动去转义）===
function smartParse(text: string): { obj: unknown; error: string; unescaped: boolean } {
  const trimmed = text.trim()
  if (!trimmed) return { obj: undefined, error: '', unescaped: false }
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch (e) {
    return { obj: undefined, error: (e as Error).message, unescaped: false }
  }
  // 若结果仍是字符串，尝试再 parse 一次（处理被转义的 JSON 字符串）
  if (typeof obj === 'string') {
    const inner = obj.trim()
    if (inner.startsWith('{') || inner.startsWith('[')) {
      try {
        const obj2 = JSON.parse(inner)
        return { obj: obj2, error: '', unescaped: true }
      } catch {
        // 内层非 JSON，返回字符串本身
      }
    }
    return { obj, error: '', unescaped: false }
  }
  return { obj, error: '', unescaped: false }
}

const parseResult = computed(() => {
  const t = textContent.value.trim()
  if (!t) return { obj: undefined as unknown, error: '', empty: true, unescaped: false }
  const r = smartParse(t)
  return { ...r, empty: false }
})

const hasContent = computed(() => !!textContent.value.trim())
const isValid = computed(() => !parseResult.value.empty && !parseResult.value.error)

// === 引号保护（删除注释时避免误伤字符串字面量）===
const SEP_Q = '\x00__Q'
function protectQuotes(text: string): { result: string; store: string[] } {
  const store: string[] = []
  const result = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => { store.push(m); return SEP_Q + (store.length - 1) + '\x00' })
  return { result, store }
}
function restoreQuotes(text: string, store: string[]): string {
  return text.replace(/\x00__Q(\d+)\x00/g, (_, i) => store[+i])
}

// === 状态辅助 ===
function setStatus(msg: string) { statusMsg.value = msg; errorMsg.value = '' }
function setError(msg: string) { errorMsg.value = msg; statusMsg.value = '' }

// === 操作（全部原地修改 textContent，编辑器通过 watch 同步）===
function format() {
  const { obj, error, unescaped } = parseResult.value
  if (error) { setError(error); return }
  if (obj === undefined) { setError('内容为空'); return }
  textContent.value = JSON.stringify(obj, null, 2)
  setStatus(unescaped ? '已自动去除转义并格式化' : '格式化成功')
}

function minify() {
  const { obj, error, unescaped } = parseResult.value
  if (error) { setError(error); return }
  if (obj === undefined) { setError('内容为空'); return }
  textContent.value = JSON.stringify(obj)
  setStatus(unescaped ? '已自动去转义并压缩' : '压缩成功')
}

function escapeJson() {
  if (!textContent.value) { setError('内容为空'); return }
  textContent.value = JSON.stringify(textContent.value)
  setStatus('已转义为字符串字面量')
}

function unescapeJson() {
  const t = textContent.value.trim()
  if (!t) { setError('内容为空'); return }
  try {
    const result = JSON.parse(t)
    if (typeof result === 'string') {
      const inner = result.trim()
      if (inner.startsWith('{') || inner.startsWith('[')) {
        try {
          const obj = JSON.parse(inner)
          textContent.value = JSON.stringify(obj, null, 2)
          setStatus('已去除转义并格式化')
          return
        } catch {
          // 内层非 JSON，直接输出字符串
        }
      }
      textContent.value = result
      setStatus('已去除转义')
    } else {
      textContent.value = JSON.stringify(result, null, 2)
      setStatus('已格式化')
    }
  } catch (e) {
    setError((e as Error).message)
  }
}

function removeComments() {
  if (!textContent.value.trim()) { setError('内容为空'); return }
  const { result, store } = protectQuotes(textContent.value)
  let cleaned = result
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '')          // 行注释
  cleaned = restoreQuotes(cleaned, store)
  const { obj, error } = smartParse(cleaned)
  if (error) {
    textContent.value = cleaned
    setStatus('已删除注释（结果非标准 JSON）')
  } else {
    textContent.value = JSON.stringify(obj, null, 2)
    setStatus('已删除注释并格式化')
  }
}

function sortObject(obj: unknown, asc: boolean): unknown {
  if (Array.isArray(obj)) return obj.map((i) => sortObject(i, asc))
  if (obj !== null && typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
    entries.sort((a, b) => asc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))
    const out: Record<string, unknown> = {}
    for (const [k, v] of entries) out[k] = sortObject(v, asc)
    return out
  }
  return obj
}

function sortFields(asc: boolean) {
  const { obj, error } = parseResult.value
  if (error) { setError(error); return }
  if (obj === undefined) { setError('内容为空'); return }
  const sorted = sortObject(obj, asc)
  textContent.value = JSON.stringify(sorted, null, 2)
  setStatus(`字段已按${asc ? '升' : '降'}序排序`)
}

// === 树形视图 ===
interface TreeNode {
  path: string
  level: number
  label: string
  type: string
  value: string
  hasChildren: boolean
  childCount: number
  isRoot: boolean
}

const SEP = '\x01'
const flatNodes = ref<TreeNode[]>([])
const expandedSet = ref<Set<string>>(new Set())
const MAX_TREE_NODES = 5000
const treeTruncated = ref(false)

function buildFlatNodes(obj: unknown) {
  const nodes: TreeNode[] = []
  const expanded = new Set<string>()
  treeTruncated.value = false
  let truncated = false
  function walk(val: unknown, path: string, level: number, label: string, isRoot: boolean) {
    if (truncated) return
    if (nodes.length >= MAX_TREE_NODES) {
      truncated = true
      treeTruncated.value = true
      return
    }
    const type = getType(val)
    let hasChildren = false
    let childCount = 0
    if (type === 'array') {
      childCount = (val as unknown[]).length
      hasChildren = childCount > 0
    } else if (type === 'object') {
      childCount = Object.keys(val as object).length
      hasChildren = childCount > 0
    }
    nodes.push({ path, level, label, type, value: formatValue(val, type), hasChildren, childCount, isRoot })
    if (hasChildren && level < 2) expanded.add(path)
    if (type === 'array') {
      ;(val as unknown[]).forEach((item, i) => walk(item, `${path}${SEP}${i}`, level + 1, String(i), false))
    } else if (type === 'object' && val !== null) {
      Object.entries(val as object).forEach(([k, v]) => walk(v, `${path}${SEP}${k}`, level + 1, k, false))
    }
  }
  walk(obj, 'root', 0, '', true)
  flatNodes.value = nodes
  expandedSet.value = expanded
}

function toggleNode(path: string) {
  const s = new Set(expandedSet.value)
  if (s.has(path)) s.delete(path); else s.add(path)
  expandedSet.value = s
}
function isExpanded(path: string): boolean {
  return expandedSet.value.has(path)
}
function expandAll() {
  const s = new Set<string>()
  for (const n of flatNodes.value) if (n.hasChildren) s.add(n.path)
  expandedSet.value = s
}
function collapseAll() {
  expandedSet.value = new Set()
}

const visibleNodes = computed(() => {
  const result: TreeNode[] = []
  let hiddenLevel: number | null = null
  for (const node of flatNodes.value) {
    if (hiddenLevel !== null) {
      if (node.level > hiddenLevel) continue
      hiddenLevel = null
    }
    result.push(node)
    if (node.hasChildren && !expandedSet.value.has(node.path)) {
      hiddenLevel = node.level
    }
  }
  return result
})

// 切到树形视图或内容变化时，重建树
watch([textContent, viewMode], () => {
  if (viewMode.value === 'tree') {
    if (isValid.value) {
      buildFlatNodes(parseResult.value.obj)
    } else {
      flatNodes.value = []
      expandedSet.value = new Set()
    }
  }
}, { immediate: true })

// === CodeMirror 编辑器 ===
const editorHost = ref<HTMLDivElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const themeCompartment = new Compartment()

function isDarkTheme(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}
function themeExtension() {
  return isDarkTheme() ? oneDark : []
}

let mediaCleanup: (() => void) | null = null

onMounted(() => {
  if (!editorHost.value) return
  const v = new EditorView({
    state: EditorState.create({
      doc: textContent.value,
      extensions: [
        basicSetup,
        json(),
        linter(jsonParseLinter()),
        indentUnit.of('  '),
        EditorView.lineWrapping,
        themeCompartment.of(themeExtension()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc.toString()
            if (doc !== textContent.value) {
              textContent.value = doc
            }
          }
        }),
      ],
    }),
    parent: editorHost.value,
  })
  view.value = v

  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    v.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) })
  }
  mql.addEventListener('change', onChange)
  mediaCleanup = () => mql.removeEventListener('change', onChange)
})

onUnmounted(() => {
  view.value?.destroy()
  view.value = null
  mediaCleanup?.()
  mediaCleanup = null
})

// 操作修改 textContent 时同步到编辑器（避免与 updateListener 形成循环）
watch(textContent, (newVal) => {
  const v = view.value
  if (!v) return
  const current = v.state.doc.toString()
  if (newVal !== current) {
    v.dispatch({
      changes: { from: 0, to: current.length, insert: newVal },
    })
  }
})

// === 统计 ===
const stats = computed(() => {
  if (!textContent.value) return null
  return {
    chars: textContent.value.length,
    lines: textContent.value.split('\n').length,
  }
})

// === 复制 ===
function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function clearAll() {
  textContent.value = ''
  errorMsg.value = ''
  statusMsg.value = ''
}

if ((window as any).ztools?.onPluginEnter) {
  ;(window as any).ztools.onPluginEnter(() => {
    try { (window as any).ztools.setExpendHeight(600) } catch (_) {}
  })
}
</script>

<template>
  <div class="json-tool">
    <h2>JSON工具</h2>
    <p class="desc">编辑、格式化、压缩、转义与去转义、删除注释、字段排序，粘贴即用，支持语法高亮和树形查看</p>

    <!-- 视图切换 + 操作按钮（link 样式）：所有操作直接作用于编辑器内容 -->
    <div class="view-bar">
      <div class="view-tabs">
        <el-button link size="small" :class="{ active: viewMode === 'edit' }" @click="viewMode = 'edit'">编辑</el-button>
        <el-button link size="small" :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'">树形视图</el-button>
      </div>
      <div class="ops">
        <el-button link type="primary" size="small" @click="format" :disabled="!hasContent">格式化</el-button>
        <el-button link type="primary" size="small" @click="minify" :disabled="!hasContent">压缩</el-button>
        <el-button link type="primary" size="small" @click="escapeJson" :disabled="!hasContent">转义</el-button>
        <el-button link type="primary" size="small" @click="unescapeJson" :disabled="!hasContent">去转义</el-button>
        <el-button link type="primary" size="small" @click="removeComments" :disabled="!hasContent">删除注释</el-button>
        <el-button link type="primary" size="small" @click="sortFields(true)" :disabled="!hasContent">字段升序</el-button>
        <el-button link type="primary" size="small" @click="sortFields(false)" :disabled="!hasContent">字段降序</el-button>
      </div>
      <div class="view-actions">
        <el-button link type="primary" size="small" @click="copyText(textContent)" :disabled="!hasContent">复制</el-button>
        <el-button link type="primary" size="small" @click="clearAll" :disabled="!textContent">清空</el-button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="content-area">
      <!-- 编辑视图：CodeMirror 6 -->
      <div v-show="viewMode === 'edit'" ref="editorHost" class="cm-editor-host"></div>

      <!-- 树形视图：只读结构展示 -->
      <div v-show="viewMode === 'tree'" class="readonly-view">
        <template v-if="visibleNodes.length">
          <div class="tree-controls">
            <el-button size="small" link @click="expandAll">全部展开</el-button>
            <el-button size="small" link @click="collapseAll">全部折叠</el-button>
          </div>
          <div
            v-for="node in visibleNodes"
            :key="node.path"
            class="tree-row"
            :class="{ clickable: node.hasChildren }"
            :style="{ paddingLeft: 8 + node.level * 16 + 'px' }"
            @click="node.hasChildren && toggleNode(node.path)"
          >
            <span class="tree-toggle" :class="{ 'no-child': !node.hasChildren }">
              {{ node.hasChildren ? (isExpanded(node.path) ? '▾' : '▸') : '' }}
            </span>
            <span v-if="!node.isRoot && node.label !== ''" class="tree-key">{{ node.label }}:</span>
            <span class="tree-type" :class="'tv-' + node.type">{{ node.type }}</span>
            <span class="tree-value" :class="'tv-' + node.type">{{ node.value }}</span>
          </div>
          <div v-if="treeTruncated" class="truncated-hint">节点超过 {{ MAX_TREE_NODES }} 个，已截断显示，建议切换到「编辑」查看完整内容</div>
        </template>
        <div v-else class="empty-hint">内容非有效 JSON，无法生成树形视图</div>
      </div>
    </div>

    <div v-if="statusMsg || errorMsg" class="status-bar" :class="{ error: !!errorMsg, success: !errorMsg }">
      <el-icon v-if="errorMsg" class="status-icon"><Warning /></el-icon>
      <span>{{ errorMsg || statusMsg }}</span>
    </div>

    <div v-if="stats" class="stats-bar">
      <span>{{ stats.chars }} 字符 · {{ stats.lines }} 行</span>
      <span v-if="isValid" class="valid-tag">✓ 有效 JSON</span>
      <span v-else-if="hasContent" class="invalid-tag">✗ 无效 JSON</span>
    </div>
  </div>
</template>

<style scoped>
.json-tool { padding: 12px; max-width: 820px; margin: 0 auto; font-size: 13px; }
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.desc { color: #909399; margin: 0 0 12px; font-size: 13px; }

.view-bar { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; margin-bottom: 8px; }
.view-bar .view-tabs { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.view-bar .view-tabs :deep(.el-button) { color: #909399; }
.view-bar .view-tabs :deep(.el-button.active) { color: #667eea; font-weight: 600; }
.view-bar .ops { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
.view-bar .view-actions { display: flex; gap: 4px; flex-shrink: 0; }

.content-area { margin-bottom: 10px; }

/* === CodeMirror 编辑器容器 === */
.cm-editor-host { height: 440px; border: 1px solid var(--border-color, #dcdfe6); border-radius: 6px; overflow: hidden; background: var(--bg-main, #fff); }
.cm-editor-host :deep(.cm-editor) { height: 100%; font-size: 13px; }
.cm-editor-host :deep(.cm-editor.cm-focused) { outline: none; }
.cm-editor-host :deep(.cm-scroller) { font-family: 'Consolas', 'Courier New', monospace; line-height: 1.6; }
.cm-editor-host :deep(.cm-content) { caret-color: #667eea; padding: 10px 0; }
.cm-editor-host :deep(.cm-gutters) { background: var(--bg-card, #f5f7fa); border-right: 1px solid var(--border-color, #e5e5e5); color: #909399; }
.cm-editor-host :deep(.cm-activeLine) { background: rgba(102, 126, 234, 0.06); }
.cm-editor-host :deep(.cm-activeLineGutter) { background: rgba(102, 126, 234, 0.1); }
/* 语法错误提示（lint tooltip）层级提升，避免被容器裁剪 */
.cm-editor-host :deep(.cm-tooltip) { z-index: 100; }

.readonly-view { border: 1px solid var(--border-color, #dcdfe6); border-radius: 6px; background: var(--bg-main, #fff); max-height: 440px; overflow-y: auto; }
.empty-hint { padding: 32px 14px; text-align: center; color: #909399; font-size: 12px; }
.truncated-hint { padding: 8px 12px; text-align: center; color: #e6a23c; font-size: 12px; border-top: 1px solid var(--border-color, #eee); }

.tree-controls { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border-color, #eee); position: sticky; top: 0; background: var(--bg-main, #fff); }
.tree-row { display: flex; align-items: center; gap: 4px; padding: 2px 6px; font-family: 'Consolas','Courier New',monospace; font-size: 13px; line-height: 1.6; border-radius: 3px; }
.tree-row.clickable { cursor: pointer; }
.tree-row.clickable:hover { background: rgba(102, 126, 234, 0.08); }
.tree-toggle { display: inline-block; width: 14px; text-align: center; color: #909399; flex-shrink: 0; user-select: none; }
.tree-toggle.no-child { visibility: hidden; }
.tree-key { color: #6f42c1; }
.tree-type { font-size: 11px; padding: 0 5px; border-radius: 3px; background: #f0f0f0; color: #909399; flex-shrink: 0; }
.tree-value { word-break: break-all; }
.tree-value.tv-string { color: #22863a; }
.tree-value.tv-number { color: #b08800; }
.tree-value.tv-boolean { color: #005cc5; }
.tree-value.tv-null { color: #cb2431; }
.tree-value.tv-array, .tree-value.tv-object { color: #606266; }
.tree-type.tv-string { background: #e6f4ea; color: #1e7e34; }
.tree-type.tv-number { background: #fff7e6; color: #b08800; }
.tree-type.tv-boolean { background: #e7f0ff; color: #005cc5; }
.tree-type.tv-null { background: #ffeaea; color: #cb2431; }
.tree-type.tv-array { background: #f0e6ff; color: #6f42c1; }
.tree-type.tv-object { background: #f0f0f0; color: #606266; }

.status-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; }
.status-bar.success { background: #f0f9eb; color: #67c23a; }
.status-bar.error { background: #fef0f0; color: #f56c6c; }
.status-icon { font-size: 14px; }

.stats-bar { display: flex; gap: 16px; padding: 6px 12px; font-size: 12px; color: #909399; }
.valid-tag { color: #67c23a; }
.invalid-tag { color: #f56c6c; }

@media (prefers-color-scheme: dark) {
  .desc { color: #8a8a8a; }
  .view-bar :deep(.el-button.is-link) { color: #8ba4f7; }
  .view-bar .view-tabs :deep(.el-button) { color: #8a8a8a; }
  .view-bar .view-tabs :deep(.el-button.active) { color: #8ba4f7; }
  .cm-editor-host { background: #1e1e1e; border-color: #444; }
  .cm-editor-host :deep(.cm-gutters) { background: #252526; border-right-color: #444; color: #8a8a8a; }
  .cm-editor-host :deep(.cm-activeLine) { background: rgba(139, 164, 247, 0.08); }
  .cm-editor-host :deep(.cm-activeLineGutter) { background: rgba(139, 164, 247, 0.12); }
  .readonly-view { background: #1e1e1e; border-color: #444; }
  .empty-hint { color: #8a8a8a; }
  .truncated-hint { color: #d19a66; border-top-color: #444; }
  .tree-controls { background: #1e1e1e; border-color: #444; }
  .tree-row.clickable:hover { background: rgba(139, 164, 247, 0.12); }
  .tree-key { color: #c678dd; }
  .tree-type { background: #3a3a3a; color: #aaa; }
  .tree-value.tv-string { color: #98c379; }
  .tree-value.tv-number { color: #d19a66; }
  .tree-value.tv-boolean { color: #56b6c2; }
  .tree-value.tv-null { color: #e06c75; }
  .tree-value.tv-array, .tree-value.tv-object { color: #aaa; }
  .tree-type.tv-string { background: #1e3a1e; color: #98c379; }
  .tree-type.tv-number { background: #3a2e1a; color: #d19a66; }
  .tree-type.tv-boolean { background: #1a2e3a; color: #56b6c2; }
  .tree-type.tv-null { background: #3a1e1e; color: #e06c75; }
  .tree-type.tv-array { background: #2e1a3a; color: #c678dd; }
  .tree-type.tv-object { background: #3a3a3a; color: #aaa; }
  .tree-toggle { color: #8a8a8a; }
  .status-bar.success { background: #1a2e1a; color: #67c23a; }
  .status-bar.error { background: #2e1a1a; color: #f56c6c; }
  .stats-bar { color: #8a8a8a; }
  h2 { color: #e0e0e0; }
}
</style>