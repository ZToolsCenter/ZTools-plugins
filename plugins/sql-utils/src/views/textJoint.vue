<template>
  <div class="app">
    <n-space :size="8" :wrap="true" align="center" style="margin-bottom: 10px">
      <n-button type="primary" size="small" @click="removeDuplicates">去重</n-button>
      <n-button type="primary" size="small" @click="removeEmptyLines">去空行</n-button>
      <n-button type="primary" size="small" @click="addQuotes('single')">前后加'单引号'</n-button>
      <n-button type="primary" size="small" @click="addQuotes('double')">前后加"双引号"</n-button>
      <n-popover
        trigger="manual"
        :show="popoverVisible"
        :on-clickoutside="handlePopoverClickOutside"
        placement="bottom-start"
        :width="220"
      >
        <template #trigger>
          <n-button
            type="primary"
            size="small"
            class="join-separator-btn"
            :style="{
              '--primary-color': themeVars.primaryColor,
              '--primary-color-hover': themeVars.primaryColorHover,
              '--primary-color-pressed': themeVars.primaryColorPressed,
              '--border-color': themeVars.borderColor,
              '--card-color': themeVars.cardColor,
            }"
            @click="joinWithSeparator"
          >
            <n-tooltip trigger="hover" placement="top">
              <template #trigger>
                <span class="separator-icon" @click.stop="togglePopover">
                  {{ getSeparatorSymbol() }}
                </span>
              </template>
              点击选择分隔符
            </n-tooltip>
            {{ getSeparatorDisplayName() }}拼接
          </n-button>
        </template>
        <div class="separator-selector" :style="{
          '--primary-color': themeVars.primaryColor,
          '--primary-color-hover': themeVars.primaryColorHover,
          '--primary-color-pressed': themeVars.primaryColorPressed,
          '--border-color': themeVars.borderColor,
          '--text-color': themeVars.textColorBase,
          '--card-color': themeVars.cardColor,
          '--action-color': themeVars.actionColor,
        }">
          <div class="separator-options">
            <div
              v-for="option in separatorOptions"
              :key="option.value"
              class="separator-option"
              :class="{ active: selectedSeparator === option.value, custom: option.isCustom }"
              @click="selectSeparator(option.value)"
            >
              <span class="option-text">{{ option.label }}</span>
              <span class="option-symbol">{{ option.symbol }}</span>
            </div>
          </div>
          <n-input
            v-if="selectedSeparator === 'custom'"
            v-model:value="customSeparator"
            placeholder="输入自定义分隔符"
            size="small"
            class="custom-input"
            @update:value="handleCustomSeparatorChange"
          />
          <div v-if="selectedSeparator === 'custom'" class="custom-confirm">
            <n-button type="primary" size="small" @click="confirmCustomSeparator">确认</n-button>
          </div>
        </div>
      </n-popover>
      <n-button type="primary" size="small" @click="convertToJson">转JSON</n-button>
      <n-button type="primary" size="small" @click="mergeToSingleLine">合一行</n-button>
    </n-space>

    <div class="textArea">
      <CodeEditor
        ref="codeEditorRef"
        v-model="text"
        :autofocus="true"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useThemeVars } from 'naive-ui'
import CodeEditor from '@/components/CodeEditor.vue'
import NotifyUtil from '@/utils/notifyUtil.js'

const themeVars = useThemeVars()

const SEPARATOR_OPTIONS = [
  { value: ',', label: '英文逗号', symbol: ',', isCustom: false },
  { value: '，', label: '中文逗号', symbol: '，', isCustom: false },
  { value: '|', label: '竖线', symbol: '|', isCustom: false },
  { value: '、', label: '顿号', symbol: '、', isCustom: false },
  { value: ';', label: '分号', symbol: ';', isCustom: false },
  { value: ':', label: '冒号', symbol: ':', isCustom: false },
  { value: ' ', label: '空格', symbol: '空格', isCustom: false },
  { value: '\\t', label: '制表符', symbol: 'Tab', isCustom: false },
  { value: 'custom', label: '自定义', symbol: '...', isCustom: true }
]

const text = ref('')
const selectedSeparator = ref(',')
const customSeparator = ref('')
const popoverVisible = ref(false)
const separatorOptions = SEPARATOR_OPTIONS
const codeEditorRef = ref(null)

const joinWithCommaConfig = reactive({
  separator: localStorage.getItem('separator') || ','
})

watch(() => joinWithCommaConfig.separator, (newVal) => {
  localStorage.setItem('separator', newVal)
})

function handleUtoolsRegexPayload(event) {
  text.value = event.detail
}

function initSelectedSeparator() {
  const separator = joinWithCommaConfig.separator
  const presetSeparators = SEPARATOR_OPTIONS.filter(option => !option.isCustom).map(option => option.value)
  if (presetSeparators.includes(separator)) {
    selectedSeparator.value = separator
  } else {
    selectedSeparator.value = 'custom'
    customSeparator.value = separator
  }
}

function togglePopover() {
  popoverVisible.value = !popoverVisible.value
}

function mergeToSingleLine() {
  if (!text.value) return
  text.value = text.value.replace(/\n/g, '')
  copyText()
}

function removeDuplicates() {
  const lines = text.value.split('\n')
  const uniqueLines = [...new Set(lines)]
  text.value = uniqueLines.join('\n')
  copyText()
}

function addQuotes(type) {
  if (!text.value) return
  const quote = type === 'single' ? "'" : '"'
  const lines = text.value.split('\n')
  const updatedLines = lines.map(line =>
    line !== '' ? `${quote}${line}${quote},` : `${quote}${quote},`
  )
  text.value = updatedLines.join('\n').replace(/,\s*$/, '')
  copyText()
}

function joinWithSeparator() {
  const lines = text.value.split('\n')
  const nonEmptyIndices = lines
    .map((line, index) => line.trim() ? index : -1)
    .filter(index => index !== -1)

  const lastNonEmptyIdx = nonEmptyIndices.at(-1)
  let separator = joinWithCommaConfig.separator
  if (separator === '\\t') separator = '\t'

  let result = lines.map((line, idx) => {
    return line.trim() ? (idx !== lastNonEmptyIdx ? line + separator : line) : line
  }).join('\n')

  text.value = result
  copyText()
}

function selectSeparator(value) {
  selectedSeparator.value = value
  if (value !== 'custom') {
    nextTick(() => {
      joinWithCommaConfig.separator = value
      customSeparator.value = ''
    })
    popoverVisible.value = false
  }
}

function confirmCustomSeparator() {
  if (customSeparator.value) {
    nextTick(() => {
      joinWithCommaConfig.separator = customSeparator.value
    })
  }
  popoverVisible.value = false
}

function handleCustomSeparatorChange(value) {
  if (value) {
    nextTick(() => {
      joinWithCommaConfig.separator = value
    })
  }
}

function getSeparatorDisplayName() {
  const separator = joinWithCommaConfig.separator
  const option = SEPARATOR_OPTIONS.find(opt => opt.value === separator)
  return option ? option.label : `自定义(${separator})`
}

function getSeparatorSymbol() {
  const separator = joinWithCommaConfig.separator
  if (separator === '\t') return 'Tab'
  const option = SEPARATOR_OPTIONS.find(opt => opt.value === separator)
  return option ? option.symbol : separator
}

function convertToJson() {
  if (!text.value) return
  text.value = JSON.stringify(text.value.split('\n').filter(line => line !== ''))
  copyText()
}

function removeEmptyLines() {
  const lines = text.value.split('\n')
  const nonEmptyLines = lines.filter(line => line.trim() !== '')
  text.value = nonEmptyLines.join('\n')
  copyText()
}

function copyText() {
  if (!text.value) return
  codeEditorRef.value?.selectAll()
  navigator.clipboard.writeText(text.value)
  NotifyUtil.success('已自动复制')
}

function handleClickOutside(event) {
  if (!popoverVisible.value) return
  const isClickTrigger = event.target.closest('.separator-icon')
  const isInsidePopover = event.target.closest('.separator-selector')
  if (!isClickTrigger && !isInsidePopover) {
    popoverVisible.value = false
  }
}

function handlePopoverClickOutside() {
  popoverVisible.value = false
}

onMounted(() => {
  codeEditorRef.value?.focus()
  initSelectedSeparator()
  window.addEventListener('set-regex-payload', handleUtoolsRegexPayload)
})

onBeforeUnmount(() => {
  window.removeEventListener('set-regex-payload', handleUtoolsRegexPayload)
})
</script>

<style scoped>
.textArea {
  flex-grow: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.separator-selector {
  padding: 5px 0;
}

.separator-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.separator-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--card-color);
  min-height: 28px;
  white-space: nowrap;
  color: var(--text-color);
}

.separator-option:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background-color: color-mix(in srgb, var(--primary-color) 4%, var(--card-color));
}

.separator-option.active {
  background: color-mix(in srgb, var(--primary-color) 12%, var(--card-color));
  border-color: color-mix(in srgb, var(--primary-color) 58%, var(--border-color));
  color: var(--primary-color);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 20%, transparent);
}

.separator-option.custom {
  grid-column: span 2;
}

.option-text {
  font-size: 12px;
  font-weight: 500;
  flex: 1;
  margin-right: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.option-symbol {
  font-size: 12px;
  font-weight: bold;
  font-family: monospace;
  background-color: var(--action-color);
  padding: 1px 3px;
  border-radius: 3px;
  flex-shrink: 0;
  min-width: 20px;
  text-align: center;
}

.separator-option.active .option-symbol {
  background-color: color-mix(in srgb, var(--primary-color) 14%, transparent);
  color: var(--primary-color);
}

.custom-input {
  margin-top: 6px;
  width: 100%;
}

.custom-confirm {
  margin-top: 8px;
  text-align: right;
}

.join-separator-btn {
  height: 28px;
  padding-left: 5px;
  gap: 0;
}

.separator-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 26px;
  height: 17px;
  padding: 0 7px;
  margin-right: 5px;
  background: rgba(255, 255, 255, 0.16);
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
  font-weight: 700;
  color: currentColor;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.14);
  position: relative;
  top: 0;
  font-size: 12px;
  line-height: 1;
  margin-top: 0;
}

.separator-icon:hover {
  background: rgba(255, 255, 255, 0.24);
  color: currentColor;
  transform: translateY(-1px) scale(1.02);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.24),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08),
    0 3px 8px rgba(0, 0, 0, 0.2);
}

.separator-icon:active {
  transform: translateY(0) scale(0.98);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.14),
    0 1px 1px rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.12);
}

body.dark .separator-option:hover {
  background-color: color-mix(in srgb, var(--primary-color) 10%, var(--card-color));
}

body.dark .separator-option.active {
  background: color-mix(in srgb, var(--primary-color) 16%, var(--card-color));
  border-color: color-mix(in srgb, var(--primary-color) 52%, var(--border-color));
  color: color-mix(in srgb, var(--primary-color) 82%, #ffffff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

body.dark .separator-option.active .option-symbol {
  background-color: color-mix(in srgb, var(--primary-color) 18%, transparent);
  color: color-mix(in srgb, var(--primary-color) 82%, #ffffff);
}

body.dark .separator-icon {
  color: currentColor;
}

body.dark .separator-icon:hover {
  color: currentColor;
}

body.dark .separator-icon:active {
  color: currentColor;
}
</style>
