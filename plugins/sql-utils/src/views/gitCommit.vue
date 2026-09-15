<template>
  <div class="app git-commit" :style="cssVars">
    <div class="gc-form-area">
      <!-- 类型选择 -->
      <div class="gc-section">
        <div class="gc-label">
          <span>类型</span>
          <span class="gc-required">*</span>
        </div>
        <div class="gc-type-grid">
          <div
            v-for="item in commitTypes"
            :key="item.value"
            class="gc-type-card"
            :class="{ active: form.type === item.value }"
            @click="form.type = item.value"
          >
            <span class="gc-type-value">{{ item.value }}</span>
            <span class="gc-type-desc">{{ item.label }}</span>
          </div>
        </div>
      </div>

      <!-- 范围 + 简短描述 -->
      <div class="gc-row">
        <div class="gc-field gc-field-scope">
          <div class="gc-label">
            <span>范围</span>
            <span class="gc-optional">选填</span>
          </div>
          <n-input
            v-model:value="form.scope"
            size="small"
            placeholder="如：用户管理"
          />
        </div>
        <div class="gc-field gc-field-subject">
          <div class="gc-label">
            <span>简短描述</span>
            <span class="gc-required">*</span>
          </div>
          <n-input
            v-model:value="form.subject"
            size="small"
            placeholder="如：新增导出功能"
            :status="subjectError ? 'error' : undefined"
            @blur="subjectError = !form.subject.trim()"
          />
        </div>
      </div>

      <!-- 具体内容 -->
      <div class="gc-section">
        <div class="gc-label">
          <span>具体内容</span>
          <span class="gc-optional">选填</span>
        </div>
        <n-input
          v-model:value="form.body"
          type="textarea"
          size="small"
          placeholder="详细描述变更内容、动机等，支持多行"
          :autosize="{ minRows: 4, maxRows: 8 }"
        />
      </div>

      <!-- 操作按钮 -->
      <div class="gc-actions">
        <n-button type="primary" size="small" @click="generateAndCopy">
          复制
        </n-button>
        <n-button size="small" @click="resetForm">重置</n-button>
        <span class="gc-hint">格式：type(scope): subject</span>
      </div>
    </div>

    <!-- 预览 -->
    <div class="gc-preview">
      <div class="gc-preview-header">
        <span class="gc-preview-title">预览</span>
        <n-button text size="small" :disabled="!generatedText" @click="copyResult">
          <template #icon>
            <n-icon><Icon icon="icon-park-outline:copy" /></n-icon>
          </template>
          复制
        </n-button>
      </div>
      <div class="gc-preview-body">
        <pre v-if="generatedText">{{ generatedText }}</pre>
        <span v-else class="gc-empty">填写类型和简短描述后自动生成预览</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useThemeVars } from 'naive-ui'
import { Icon } from '@iconify/vue'
import NotifyUtil from '@/utils/notifyUtil.js'

const themeVars = useThemeVars()

/** Commit 类型选项 */
const commitTypes = [
  { value: 'feat', label: '新功能' },
  { value: 'fix', label: 'Bug修复' },
  { value: 'docs', label: '文档变更' },
  { value: 'style', label: '格式调整' },
  { value: 'refactor', label: '重构' },
  { value: 'perf', label: '性能优化' },
  { value: 'test', label: '测试相关' },
  { value: 'chore', label: '杂项' },
  { value: 'build', label: '构建' },
  { value: 'ci', label: 'CI配置' }
]

const form = reactive({
  type: 'feat',
  scope: '',
  subject: '',
  body: ''
})

const subjectError = ref(false)

/** 根据表单实时生成 commit 信息 */
const generatedText = computed(() => {
  if (!form.type || !form.subject.trim()) return ''
  let header = form.type
  if (form.scope.trim()) {
    header += `(${form.scope.trim()})`
  }
  header += `: ${form.subject.trim()}`
  if (form.body.trim()) {
    return `${header}\n\n${form.body.trim()}`
  }
  return header
})

const cssVars = computed(() => ({
  '--gc-border': themeVars.value.borderColor,
  '--gc-border-hover': themeVars.value.primaryColor,
  '--gc-card-color': themeVars.value.cardColor,
  '--gc-text-3': themeVars.value.textColor3,
  '--gc-primary': themeVars.value.primaryColor,
  '--gc-primary-hover': themeVars.value.primaryColorHover,
  '--gc-primary-pressed': themeVars.value.primaryColorPressed,
  '--gc-action-color': themeVars.value.actionColor,
  '--gc-divider': themeVars.value.dividerColor
}))

/** 校验并复制生成的 commit 信息到剪贴板 */
function generateAndCopy() {
  if (!form.subject.trim()) {
    subjectError.value = true
    NotifyUtil.warning('提示', '请填写简短描述')
    return
  }
  if (!generatedText.value) return
  copyToClipboard(generatedText.value)
}

function copyResult() {
  if (!generatedText.value) return
  copyToClipboard(generatedText.value)
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    NotifyUtil.success('已复制', 'Commit 信息已复制到剪贴板')
  }).catch(() => {
    NotifyUtil.error('复制失败', '请手动复制预览内容')
  })
}

function resetForm() {
  form.type = 'feat'
  form.scope = ''
  form.subject = ''
  form.body = ''
  subjectError.value = false
}
</script>

<style scoped>
.git-commit {
  gap: 10px;
}

.gc-form-area {
  flex-shrink: 0;
}

.gc-section {
  margin-bottom: 10px;
}

.gc-label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 5px;
  font-size: 12px;
  color: var(--gc-text-3);
}

.gc-required {
  color: #d03050;
}

.gc-optional {
  color: var(--gc-text-3);
  font-size: 11px;
}

/* 类型选择网格 */
.gc-type-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.gc-type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 5px 4px;
  border: 1px solid var(--gc-border);
  border-radius: 5px;
  background-color: var(--gc-card-color);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.gc-type-card:hover {
  border-color: var(--gc-border-hover);
}

.gc-type-card.active {
  border-color: var(--gc-primary);
  background-color: rgba(32, 128, 240, 0.08);
}

.gc-type-value {
  font-weight: 600;
  font-size: 13px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  color: var(--gc-primary);
}

.gc-type-card.active .gc-type-value {
  color: var(--gc-primary);
}

.gc-type-desc {
  font-size: 11px;
  color: var(--gc-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* 范围 + 描述行 */
.gc-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.gc-field {
  display: flex;
  flex-direction: column;
}

.gc-field-scope {
  width: 160px;
  flex-shrink: 0;
}

.gc-field-subject {
  flex: 1;
  min-width: 0;
}

/* 操作按钮 */
.gc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gc-hint {
  font-size: 11px;
  color: var(--gc-text-3);
  margin-left: 4px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}

/* 预览区 */
.gc-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--gc-border);
  border-radius: 5px;
  background-color: var(--gc-card-color);
  overflow: hidden;
}

.gc-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  border-bottom: 1px solid var(--gc-divider);
  background-color: var(--gc-action-color);
}

.gc-preview-title {
  font-size: 12px;
  font-weight: 600;
}

.gc-preview-body {
  flex: 1;
  overflow: auto;
  padding: 10px 12px;
}

.gc-preview-body pre {
  margin: 0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.gc-empty {
  font-size: 12px;
  color: var(--gc-text-3);
}
</style>
