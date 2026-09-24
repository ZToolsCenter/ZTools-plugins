<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const inputText = ref('')
const originalText = ref('')

const separator = ref(',')
const replaceSep = ref('|')
const lineWrapperLeft = ref('')
const lineWrapperRight = ref('')
const itemWrapperLeft = ref('')
const itemWrapperRight = ref('')
const replaceLineWrapperLeft = ref('')
const replaceLineWrapperRight = ref('')
const replaceItemWrapperLeft = ref('')
const replaceItemWrapperRight = ref('')
const showReplaceSep = ref(false)
const showReplaceLine = ref(false)
const showReplaceItem = ref(false)

const separatorPresets = [
  { label: ',', value: ',' },
  { label: '、', value: '、' },
  { label: '␣', value: ' ' },
  { label: ';', value: ';' },
  { label: '|', value: '|' },
  { label: '\\t', value: '\t' },
]

const wrapperPresets = [
  { label: '"', left: '"', right: '"' },
  { label: "'", left: "'", right: "'" },
  { label: '`', left: '`', right: '`' },
  { label: '()', left: '(', right: ')' },
  { label: '[]', left: '[', right: ']' },
  { label: '{}', left: '{', right: '}' },
  { label: '无', left: '', right: '' },
]

function parseEscape(s: string): string {
  return s.replace(/\\\\/g, '\x00__BS').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\x00__BS/g, '\\')
}

function isSepActive(p: { value: string }): boolean {
  return separator.value === p.value
}
function isReplaceSepActive(p: { value: string }): boolean {
  return replaceSep.value === p.value
}
function isLineWrapperActive(p: { left: string; right: string }): boolean {
  return lineWrapperLeft.value === p.left && lineWrapperRight.value === p.right
}
function isItemWrapperActive(p: { left: string; right: string }): boolean {
  return itemWrapperLeft.value === p.left && itemWrapperRight.value === p.right
}
function isReplaceLineActive(p: { left: string; right: string }): boolean {
  return replaceLineWrapperLeft.value === p.left && replaceLineWrapperRight.value === p.right
}
function isReplaceItemActive(p: { left: string; right: string }): boolean {
  return replaceItemWrapperLeft.value === p.left && replaceItemWrapperRight.value === p.right
}

function removeWrap(s: string, left: string, right: string): string {
  let r = s.trim()
  if (left && r.startsWith(left)) r = r.slice(left.length)
  if (right && r.endsWith(right)) r = r.slice(0, r.length - right.length)
  return r
}

function addWrap(s: string, left: string, right: string): string {
  return left + s + right
}

function saveOriginal() {
  if (!originalText.value && inputText.value.trim()) {
    originalText.value = inputText.value
  }
}

function withLines(fn: (lines: string[]) => string) {
  if (!inputText.value.trim()) return
  saveOriginal()
  inputText.value = fn(inputText.value.split(/\r?\n/).filter(l => l.trim() !== ''))
}

function withItems(fn: (items: string[]) => string) {
  if (!inputText.value.trim()) return
  saveOriginal()
  const items = inputText.value.split(parseEscape(separator.value)).filter(p => p.trim() !== '')
  inputText.value = fn(items)
}

function addLineWrapper() {
  withLines(lines => lines.map(l => addWrap(l, lineWrapperLeft.value, lineWrapperRight.value)).join('\n'))
}

function removeLineWrapper() {
  withLines(lines => lines.map(l => removeWrap(l, lineWrapperLeft.value, lineWrapperRight.value)).join('\n'))
}

function replaceLineWrapper() {
  withLines(lines => lines.map(l => addWrap(removeWrap(l, lineWrapperLeft.value, lineWrapperRight.value), replaceLineWrapperLeft.value, replaceLineWrapperRight.value)).join('\n'))
}

function addItemWrapper() {
  withItems(items => items.map(i => addWrap(i, itemWrapperLeft.value, itemWrapperRight.value)).join(parseEscape(separator.value)))
}

function removeItemWrapper() {
  withItems(items => items.map(i => removeWrap(i, itemWrapperLeft.value, itemWrapperRight.value)).join(parseEscape(separator.value)))
}

function replaceItemWrapper() {
  withItems(items => items.map(i => addWrap(removeWrap(i, itemWrapperLeft.value, itemWrapperRight.value), replaceItemWrapperLeft.value, replaceItemWrapperRight.value)).join(parseEscape(separator.value)))
}

function mergeBySeparator() {
  withLines(lines => lines.join(parseEscape(separator.value)))
}

function splitBySeparator() {
  withItems(items => items.join('\n'))
}

function replaceSeparator() {
  withItems(items => items.join(parseEscape(replaceSep.value)))
}

function clearAll() {
  inputText.value = ''
  originalText.value = ''
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

if ((window as any).ztools?.onPluginEnter) {
  ;(window as any).ztools.onPluginEnter(() => {
    try { (window as any).ztools.setExpendHeight(600) } catch (_) {}
  })
}
</script>

<template>
  <div class="text-transform">
    <h2>文本转换</h2>
    <p class="desc">添加/去除/替换包裹符、按分隔符拆分/合并、替换分隔符，操作可叠加</p>

    <div class="input-section">
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="8"
        :autosize="{ minRows: 5, maxRows: 14 }"
        placeholder="在此粘贴文本..."
        resize="vertical"
        clearable
      />
    </div>

    <div class="action-bar">
      <el-button link size="small" @click="addLineWrapper" :disabled="!inputText.trim()">添加每行包裹</el-button>
      <el-button link size="small" @click="removeLineWrapper" :disabled="!inputText.trim()">去除每行包裹</el-button>
      <el-button link size="small" @click="replaceLineWrapper" :disabled="!inputText.trim()">替换每行包裹</el-button>
      <el-button link size="small" @click="addItemWrapper" :disabled="!inputText.trim()">添加每个包裹</el-button>
      <el-button link size="small" @click="removeItemWrapper" :disabled="!inputText.trim()">去除每个包裹</el-button>
      <el-button link size="small" @click="replaceItemWrapper" :disabled="!inputText.trim()">替换每个包裹</el-button>
      <el-button link size="small" @click="mergeBySeparator" :disabled="!inputText.trim()">按分隔符合并</el-button>
      <el-button link size="small" @click="splitBySeparator" :disabled="!inputText.trim()">按分隔符拆分</el-button>
      <el-button link size="small" @click="replaceSeparator" :disabled="!inputText.trim()">替换分隔符</el-button>
      <el-button link size="small" @click="clearAll" :disabled="!inputText && !originalText">清空</el-button>
      <el-button link size="small" @click="copyText(inputText)" :disabled="!inputText.trim()">复制</el-button>
    </div>

    <div class="preset-row">
      <span class="preset-label">分隔符</span>
      <span
        v-for="p in separatorPresets" :key="p.label"
        class="preset-tag" :class="{ active: isSepActive(p) }"
        @click="separator = p.value"
      >{{ p.label }}</span>
      <span class="custom-hint">自定义</span>
      <el-input v-model="separator" size="small" style="width:60px" placeholder="," />
      <el-button link size="small" style="margin-left:8px;color:#667eea" @click="showReplaceSep = !showReplaceSep">
        {{ showReplaceSep ? '收起替换' : '替换为 ▼' }}
      </el-button>
    </div>

    <div v-if="showReplaceSep" class="preset-row">
      <span class="preset-label">替换为</span>
      <span
        v-for="p in separatorPresets" :key="p.label"
        class="preset-tag" :class="{ active: isReplaceSepActive(p) }"
        @click="replaceSep = p.value"
      >{{ p.label }}</span>
      <span class="custom-hint">自定义</span>
      <el-input v-model="replaceSep" size="small" style="width:60px" placeholder="|" />
    </div>

    <div class="preset-row">
      <span class="preset-label">每行包裹</span>
      <span
        v-for="p in wrapperPresets" :key="p.label"
        class="preset-tag" :class="{ active: isLineWrapperActive(p) }"
        @click="lineWrapperLeft = p.left; lineWrapperRight = p.right"
      >{{ p.label }}</span>
      <span class="custom-hint">左</span>
      <el-input v-model="lineWrapperLeft" size="small" style="width:40px" placeholder='"' />
      <span class="custom-hint">右</span>
      <el-input v-model="lineWrapperRight" size="small" style="width:40px" placeholder='"' />
      <el-button link size="small" style="margin-left:8px;color:#667eea" @click="showReplaceLine = !showReplaceLine">
        {{ showReplaceLine ? '收起替换' : '替换为 ▼' }}
      </el-button>
    </div>

    <div v-if="showReplaceLine" class="preset-row">
      <span class="preset-label">替换为</span>
      <span
        v-for="p in wrapperPresets" :key="p.label"
        class="preset-tag" :class="{ active: isReplaceLineActive(p) }"
        @click="replaceLineWrapperLeft = p.left; replaceLineWrapperRight = p.right"
      >{{ p.label }}</span>
      <span class="custom-hint">左</span>
      <el-input v-model="replaceLineWrapperLeft" size="small" style="width:40px" placeholder='"' />
      <span class="custom-hint">右</span>
      <el-input v-model="replaceLineWrapperRight" size="small" style="width:40px" placeholder='"' />
    </div>

    <div class="preset-row">
      <span class="preset-label">每个包裹</span>
      <span
        v-for="p in wrapperPresets" :key="p.label"
        class="preset-tag" :class="{ active: isItemWrapperActive(p) }"
        @click="itemWrapperLeft = p.left; itemWrapperRight = p.right"
      >{{ p.label }}</span>
      <span class="custom-hint">左</span>
      <el-input v-model="itemWrapperLeft" size="small" style="width:40px" placeholder='"' />
      <span class="custom-hint">右</span>
      <el-input v-model="itemWrapperRight" size="small" style="width:40px" placeholder='"' />
      <el-button link size="small" style="margin-left:8px;color:#667eea" @click="showReplaceItem = !showReplaceItem">
        {{ showReplaceItem ? '收起替换' : '替换为 ▼' }}
      </el-button>
    </div>

    <div v-if="showReplaceItem" class="preset-row">
      <span class="preset-label">替换为</span>
      <span
        v-for="p in wrapperPresets" :key="p.label"
        class="preset-tag" :class="{ active: isReplaceItemActive(p) }"
        @click="replaceItemWrapperLeft = p.left; replaceItemWrapperRight = p.right"
      >{{ p.label }}</span>
      <span class="custom-hint">左</span>
      <el-input v-model="replaceItemWrapperLeft" size="small" style="width:40px" placeholder='"' />
      <span class="custom-hint">右</span>
      <el-input v-model="replaceItemWrapperRight" size="small" style="width:40px" placeholder='"' />
    </div>

    <div v-if="originalText" class="original-section">
      <span class="original-label">原始文本</span>
      <div class="original-box">{{ originalText }}</div>
    </div>
  </div>
</template>

<style scoped>
.text-transform { padding: 12px; max-width: 720px; margin: 0 auto; font-size: 13px; }
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.desc { color: #909399; margin: 0 0 12px; font-size: 13px; }

.action-bar { display: flex; align-items: center; gap: 2px; margin-bottom: 8px; flex-wrap: wrap; }
.action-bar :deep(.el-button.is-link) { color: #667eea; padding: 4px 8px; height: auto; font-size: 13px; }
.action-bar :deep(.el-button.is-link:hover) { color: #8ba4f7; }
.action-bar :deep(.el-button.is-link.is-disabled) { color: #909399; }

.preset-row { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.preset-label { font-size: 12px; color: #909399; white-space: nowrap; margin-right: 4px; }
.preset-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 5px; font-size: 12px; border-radius: 4px; cursor: pointer; border: 1px solid #dcdfe6; color: #606266; background: var(--bg-main, #fff); user-select: none; transition: all 0.15s; }
.preset-tag:hover { border-color: #667eea; color: #667eea; }
.preset-tag.active { border-color: #667eea; background: #667eea; color: #fff; }
.custom-hint { font-size: 11px; color: #909399; margin-left: 4px; }
.preset-row :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #dcdfe6 inset; }

.input-section { margin-bottom: 12px; }
.input-section :deep(.el-textarea__inner) { font-family: 'Consolas','Courier New',monospace; font-size: 13px; line-height: 1.5; }

.original-section { background: var(--bg-card, #f5f7fa); border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px; padding: 10px 12px; }
.original-label { font-size: 12px; font-weight: 500; color: #909399; margin-bottom: 6px; display: block; }
.original-box { font-family: 'Consolas','Courier New',monospace; font-size: 12px; line-height: 1.5; word-break: break-all; white-space: pre-wrap; color: #909399; max-height: 120px; overflow-y: auto; }

@media (prefers-color-scheme: dark) {
  h2 { color: #e0e0e0; }
  .desc { color: #8a8a8a; }
  .preset-label { color: #8a8a8a; }
  .custom-hint { color: #8a8a8a; }
  .preset-tag { border-color: #444; color: #aaa; background: #2c2c2c; }
  .preset-tag:hover { border-color: #8ba4f7; color: #8ba4f7; }
  .preset-tag.active { border-color: #8ba4f7; background: #8ba4f7; color: #fff; }
  .preset-row :deep(.el-input__wrapper) { background: #2c2c2c; box-shadow: 0 0 0 1px #444 inset; }
  .action-bar :deep(.el-button.is-link) { color: #8ba4f7; }
  .action-bar :deep(.el-button.is-link:hover) { color: #b0c4ff; }
  .action-bar :deep(.el-button.is-link.is-disabled) { color: #666; }
  .original-section { background: #2c2c2c; border-color: #444; }
  .original-box { color: #777; }
}
</style>