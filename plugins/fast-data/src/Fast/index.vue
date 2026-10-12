<script setup lang="ts">
import { ref, watch } from 'vue'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

type OperationKey =
  | 'lineBreakRemove'
  | 'lineBreakAdd'
  | 'linesToComma'
  | 'dedupe'
  | 'commaRemove'
  | 'commaAdd'
  | 'commaToLines'
  | 'quoteRemove'
  | 'quoteSingle'
  | 'quoteDouble'
  | 'trimEdges'
  | 'removeWhitespace'
  | 'removeComments'
  | 'toLower'
  | 'toUpper'

type ReplacementMatcher = string | RegExp

const inputText = ref('')
const outputText = ref('')
const findText = ref('')
const replacementText = ref('')
const prefixText = ref('')
const suffixText = ref('')
const useRegexReplace = ref(false)
const regexError = ref('')
const toastMessage = ref('')
const toastVisible = ref(false)
const selectedOperations = ref<OperationKey[]>([])

let toastTimer: number | undefined

const operationGroups: OperationKey[][] = [
  ['lineBreakRemove', 'lineBreakAdd', 'linesToComma', 'dedupe'],
  ['commaRemove', 'commaAdd', 'commaToLines'],
  ['quoteRemove', 'quoteSingle', 'quoteDouble'],
  ['trimEdges', 'removeWhitespace', 'removeComments'],
  ['toLower', 'toUpper']
]

const showMessage = (message: string) => {
  toastMessage.value = message
  toastVisible.value = true

  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 2000)
}

const isActive = (operation: OperationKey) => selectedOperations.value.includes(operation)

const splitLines = (text: string) => text.split(/\r\n|\n|\r/)

const getOperationGroup = (operation: OperationKey) =>
  operationGroups.find((group) => group.includes(operation)) || [operation]

const toggleOperation = (operation: OperationKey) => {
  if (isActive(operation)) {
    selectedOperations.value = selectedOperations.value.filter((item) => item !== operation)
    return
  }

  const group = getOperationGroup(operation)
  selectedOperations.value = [
    ...selectedOperations.value.filter((item) => !group.includes(item)),
    operation
  ]
}

const createRegexMatcher = (patternText: string) => {
  const lastSlashIndex = patternText.lastIndexOf('/')
  const isRegexLiteral = patternText.startsWith('/') && lastSlashIndex > 0
  const source = isRegexLiteral ? patternText.slice(1, lastSlashIndex) : patternText
  const inputFlags = isRegexLiteral ? patternText.slice(lastSlashIndex + 1) : ''
  const flags = inputFlags.includes('g') ? inputFlags : `${inputFlags}g`

  if (!source) {
    regexError.value = '请输入正则内容'
    return null
  }

  try {
    return new RegExp(source, flags)
  } catch (error) {
    regexError.value = error instanceof Error ? error.message : '正则表达式无效'
    return null
  }
}

const getReplacementMatcher = (): ReplacementMatcher | null => {
  regexError.value = ''

  if (!findText.value) return null
  if (!useRegexReplace.value) return findText.value

  return createRegexMatcher(findText.value)
}

const applyReplacement = (value: string, matcher: ReplacementMatcher | null) => {
  if (!matcher) return value

  return typeof matcher === 'string'
    ? value.split(matcher).join(replacementText.value)
    : value.replace(matcher, replacementText.value)
}

const hasConfiguredOperation = () =>
  selectedOperations.value.length > 0 || Boolean(findText.value || prefixText.value || suffixText.value)

const getProcessedLines = (replacementMatcher: ReplacementMatcher | null) => {
  let text = inputText.value

  if (isActive('commaToLines')) {
    text = text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join('\n')
  }

  if (isActive('lineBreakRemove')) {
    text = text.replace(/\r\n|\n|\r/g, '')
  }

  let lines = splitLines(text)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (isActive('removeComments')) {
    lines = lines.filter((line) => !/^\s*(\/\/|#|--)/.test(line))
  }

  lines = lines.map((line) => {
    let value = isActive('trimEdges') ? line.trim() : line

    if (isActive('removeWhitespace')) value = value.replace(/\s/g, '')
    if (isActive('commaRemove')) value = value.replace(/,/g, '')
    if (isActive('quoteRemove')) value = value.replace(/['"]/g, '')
    value = applyReplacement(value, replacementMatcher)
    if (isActive('toLower')) value = value.toLowerCase()
    if (isActive('toUpper')) value = value.toUpperCase()

    return value
  })

  if (isActive('dedupe')) {
    const seen = new Set<string>()
    lines = lines.filter((line) => {
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })
  }

  return lines.map((line) => {
    let value = line

    if (isActive('quoteSingle')) value = `'${value}'`
    if (isActive('quoteDouble')) value = `"${value}"`
    if (prefixText.value || suffixText.value) value = `${prefixText.value}${value}${suffixText.value}`
    if (isActive('commaAdd')) value = `${value},`

    return value
  })
}

const recomputeOutput = () => {
  if (!inputText.value.trim() || !hasConfiguredOperation()) {
    outputText.value = ''
    regexError.value = ''
    return
  }

  const replacementMatcher = getReplacementMatcher()

  if (regexError.value) {
    outputText.value = ''
    return
  }

  const lines = getProcessedLines(replacementMatcher)

  if (isActive('linesToComma')) {
    outputText.value = lines.join(',')
    return
  }

  if (isActive('lineBreakAdd')) {
    outputText.value = lines.join('\n\n')
    return
  }

  outputText.value = lines.join('\n')
}

const resetAll = () => {
  inputText.value = ''
  outputText.value = ''
  findText.value = ''
  replacementText.value = ''
  prefixText.value = ''
  suffixText.value = ''
  useRegexReplace.value = false
  regexError.value = ''
  selectedOperations.value = []
}

const fallbackCopy = (text: string) => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}

const copyWithFallbacks = async (text: string) => {
  if (window.ztools?.copyText) {
    try {
      if (window.ztools.copyText(text)) return true
    } catch (_err) {}
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_err) {}
  }

  try {
    return fallbackCopy(text)
  } catch (_err) {
    return false
  }
}

const copyOutput = async () => {
  if (regexError.value) {
    showMessage('请检查正则表达式')
    return
  }

  if (!outputText.value) {
    showMessage('请先选择处理规则')
    return
  }

  if (await copyWithFallbacks(outputText.value)) {
    showMessage('操作成功，数据已放置到剪切板!')
    return
  }

  showMessage('复制失败，请手动复制')
}

watch(
  [inputText, findText, replacementText, prefixText, suffixText, useRegexReplace, selectedOperations],
  recomputeOutput,
  { deep: true }
)
</script>

<template>
  <main class="fast-data">
    <transition name="toast">
      <div v-if="toastVisible" class="toast-message">{{ toastMessage }}</div>
    </transition>

    <textarea v-model="inputText" class="text-input" placeholder="请输入或粘贴要处理的数据"></textarea>

    <section class="operations" aria-label="数据处理操作">
      <div class="operation-row">
        <span class="operation-label">换行符:</span>
        <div class="button-group">
          <button type="button" :class="{ 'is-active': isActive('lineBreakRemove') }" @click="toggleOperation('lineBreakRemove')">-删除</button>
          <button type="button" :class="{ 'is-active': isActive('lineBreakAdd') }" @click="toggleOperation('lineBreakAdd')">+增加</button>
          <button type="button" :class="{ 'is-active': isActive('linesToComma') }" @click="toggleOperation('linesToComma')">转逗号</button>
          <button type="button" :class="{ 'is-active': isActive('dedupe') }" @click="toggleOperation('dedupe')">去重</button>
        </div>
      </div>

      <div class="operation-row">
        <span class="operation-label">逗号:</span>
        <div class="button-group">
          <button type="button" :class="{ 'is-active': isActive('commaRemove') }" @click="toggleOperation('commaRemove')">-删除</button>
          <button type="button" :class="{ 'is-active': isActive('commaAdd') }" @click="toggleOperation('commaAdd')">+增加</button>
          <button type="button" :class="{ 'is-active': isActive('commaToLines') }" @click="toggleOperation('commaToLines')">转换行</button>
        </div>
      </div>

      <div class="operation-row">
        <span class="operation-label">引号:</span>
        <div class="button-group">
          <button type="button" :class="{ 'is-active': isActive('quoteRemove') }" @click="toggleOperation('quoteRemove')">-删除</button>
          <button type="button" :class="{ 'is-active': isActive('quoteSingle') }" @click="toggleOperation('quoteSingle')">+加单</button>
          <button type="button" :class="{ 'is-active': isActive('quoteDouble') }" @click="toggleOperation('quoteDouble')">+加双</button>
        </div>
      </div>

      <div class="operation-row">
        <span class="operation-label">去除:</span>
        <div class="button-group">
          <button type="button" :class="{ 'is-active': isActive('trimEdges') }" @click="toggleOperation('trimEdges')">两边空</button>
          <button type="button" :class="{ 'is-active': isActive('removeWhitespace') }" @click="toggleOperation('removeWhitespace')">所有空</button>
          <button type="button" :class="{ 'is-active': isActive('removeComments') }" @click="toggleOperation('removeComments')">注释</button>
        </div>
      </div>

      <div class="operation-row">
        <span class="operation-label">转换:</span>
        <div class="button-group">
          <button type="button" :class="{ 'is-active': isActive('toLower') }" @click="toggleOperation('toLower')">小写</button>
          <button type="button" :class="{ 'is-active': isActive('toUpper') }" @click="toggleOperation('toUpper')">大写</button>
        </div>
      </div>

      <div class="operation-row replace-row">
        <span class="operation-label">替换:</span>
        <div class="inline-controls replace-controls">
          <input
            v-model="findText"
            class="mini-input"
            :class="{ 'is-invalid': regexError }"
            :title="regexError || undefined"
            placeholder="查找..."
            aria-label="查找内容"
          />
          <input v-model="replacementText" class="mini-input" placeholder="替换..." aria-label="替换内容" />
          <button
            type="button"
            class="regex-toggle"
            :class="{ 'is-active': useRegexReplace }"
            :aria-pressed="useRegexReplace"
            title="按正则表达式查找"
            aria-label="正则替换"
            @click="useRegexReplace = !useRegexReplace"
          >
            .*
          </button>
        </div>
      </div>

      <div class="operation-row join-row">
        <span class="operation-label">两边拼:</span>
        <div class="inline-controls join-controls">
          <input v-model="prefixText" class="affix-input" placeholder="前拼..." aria-label="前拼内容" />
          <span class="join-hint">+ value +</span>
          <input v-model="suffixText" class="affix-input" placeholder="后拼..." aria-label="后拼内容" />
        </div>
      </div>
    </section>

    <textarea v-model="outputText" class="text-output" placeholder="处理结果将在这里显示" readonly></textarea>

    <footer class="actions">
      <button type="button" class="reset-button" @click="resetAll">重置设置</button>
      <button type="button" class="process-button" @click="copyOutput">处理数据</button>
    </footer>
  </main>
</template>

<style scoped>
.fast-data {
  position: relative;
  display: flex;
  min-height: 100vh;
  padding: 12px 20px 10px;
  box-sizing: border-box;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  font-size: 15px;
}

.toast-message {
  position: fixed;
  top: 46%;
  left: 50%;
  z-index: 20;
  max-width: 82vw;
  padding: 12px 18px;
  border-radius: 7px;
  color: #fff;
  background: #49ad50;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  transform: translate(-50%, -50%);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -44%);
}

.text-input,
.text-output {
  width: 100%;
  min-height: 118px;
  padding: 10px 12px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #cfcfcf;
  border-radius: 4px;
  color: inherit;
  background: #fff;
  font-size: 20px;
  line-height: 1.35;
  outline: none;
}

.text-input {
  font-family: Consolas, 'Courier New', monospace;
}

.text-output {
  flex: 1;
  min-height: 126px;
  font-family: Consolas, 'Courier New', monospace;
  cursor: default;
}

.text-output:read-only {
  background: #fff;
}

.operations {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr);
  column-gap: 24px;
  row-gap: 7px;
  padding: 0 6px;
}

.operation-row {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
  gap: 8px;
}

.operation-label {
  width: 64px;
  flex: none;
  color: #ff5a2a;
  font-weight: 700;
  text-align: right;
}

.button-group,
.inline-controls {
  display: inline-flex;
  min-width: 0;
  align-items: center;
}

.button-group {
  overflow: hidden;
  border: 1px solid #bfc4ca;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.button-group button,
.regex-toggle {
  min-width: 52px;
  height: 28px;
  padding: 0 9px;
  border-right: 1px solid #d4d8dd;
  color: #111;
  background: linear-gradient(#fff, #eef1f5);
  font-size: 14px;
  line-height: 28px;
}

.button-group button.is-active,
.regex-toggle.is-active {
  color: #fff;
  background: #49ad50;
}

.button-group button:last-child {
  border-right: none;
}

.replace-row {
  grid-column: 2;
}

.join-row {
  grid-column: 1 / -1;
}

.inline-controls {
  gap: 6px;
}

.join-controls {
  flex: 1;
}

.mini-input,
.affix-input {
  height: 28px;
  padding: 0 8px;
  border: none;
  border-bottom: 2px solid #8f8f8f;
  box-sizing: border-box;
  color: inherit;
  background: transparent;
  font-size: 15px;
  outline: none;
}

.mini-input {
  width: 112px;
}

.mini-input.is-invalid {
  border-bottom-color: #d33;
}

.affix-input {
  min-width: 0;
  flex: 1;
  text-align: center;
}

.regex-toggle {
  min-width: 34px;
  width: 34px;
  padding: 0;
  border: 1px solid #bfc4ca;
  border-radius: 3px;
  color: #0c4da2;
  font-weight: 700;
  line-height: 26px;
}

.join-hint {
  color: #0c4da2;
  font-size: 15px;
  white-space: nowrap;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.actions button {
  height: 34px;
  border-radius: 3px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.reset-button {
  background: #8a8787;
}

.process-button {
  background: #49ad50;
}

@media (max-width: 680px) {
  .operations {
    grid-template-columns: 1fr;
  }

  .replace-row,
  .join-row {
    grid-column: 1;
  }

  .operation-row {
    align-items: flex-start;
  }

  .operation-label {
    padding-top: 5px;
  }

  .button-group,
  .inline-controls {
    flex-wrap: wrap;
  }
}

@media (prefers-color-scheme: dark) {
  .text-input,
  .text-output,
  .text-output:read-only {
    border-color: #555;
    background: #424242;
  }

  .button-group button,
  .regex-toggle {
    color: #f5f5f5;
    background: linear-gradient(#666, #4a4a4a);
    border-right-color: #555;
  }

  .button-group button.is-active,
  .regex-toggle.is-active {
    color: #fff;
    background: #49ad50;
  }

  .mini-input,
  .affix-input {
    border-bottom-color: #aaa;
  }
}
</style>
