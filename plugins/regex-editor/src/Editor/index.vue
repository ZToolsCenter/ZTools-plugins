<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRegexEditor } from '../composables/useRegexEditor'
import { useAiRegex } from '../composables/useAiRegex'
import VisualRegex from './components/VisualRegex.vue'
import MatchPreview from './components/MatchPreview.vue'
import ExamplesPanel from './components/ExamplesPanel.vue'
import './visual-regex.css'

const props = defineProps<{
  enterAction?: Record<string, unknown>
}>()

const {
  pattern,
  flags,
  testText,
  regexError,
  explanation,
  matchSegments,
  matchCount,
  captureGroups,
  activeCategory,
  flagOptions,
  loadExample,
  toggleFlag,
  copyPattern
} = useRegexEditor()

const {
  available: aiAvailable,
  models: aiModels,
  selectedModelId,
  openAiSettings,
  aiExplanation,
  aiLoading,
  aiError,
  requirement,
  explainPattern,
  generateFromRequirement
} = useAiRegex(
  () => pattern.value,
  () => flags.value,
  (p, f) => {
    pattern.value = p
    flags.value = f
  }
)

const copyTip = ref('')

watch(
  () => props.enterAction,
  (action) => {
    if (!action || !Object.keys(action).length) return
    const payload = action.payload
    if (typeof payload === 'string' && payload.trim()) {
      testText.value = payload
    }
  },
  { immediate: true }
)

const hasError = computed(() => !!regexError.value || explanation.value.errors.length > 0)
const errorMessage = computed(() => regexError.value || explanation.value.errors.join('；'))

const displayExplanation = computed(() => {
  if (aiExplanation.value) return aiExplanation.value
  return explanation.value.summary
})

async function handleCopy() {
  await copyPattern()
  copyTip.value = '已复制'
  window.setTimeout(() => {
    copyTip.value = ''
  }, 1500)
}
</script>

<template>
  <div class="editor">
    <div class="editor-layout">
      <section class="left-panel">
        <div class="section">
          <label class="section-label">正则表达式</label>
          <div class="pattern-row">
            <div class="pattern-input-wrap">
              <span class="pattern-slash">/</span>
              <input
                v-model="pattern"
                class="pattern-input"
                type="text"
                placeholder="输入正则，如 \d+ 或 [a-zA-Z]+"
                spellcheck="false"
              />
              <span class="pattern-slash">/</span>
              <div class="flags-bar">
                <button
                  v-for="f in flagOptions"
                  :key="f.key"
                  class="flag-btn"
                  :class="{ active: flags.includes(f.key) }"
                  :title="f.title"
                  @click="toggleFlag(f.key)"
                >
                  {{ f.label }}
                </button>
              </div>
            </div>
            <button
              class="copy-btn"
              :disabled="!pattern"
              :title="copyTip || '复制正则'"
              @click="handleCopy"
            >
              {{ copyTip || '复制' }}
            </button>
          </div>
          <p v-if="hasError" class="error-msg">{{ errorMessage }}</p>
        </div>

        <div class="section">
          <label class="section-label">可视化</label>
          <VisualRegex :pattern="pattern" :flags="flags" />
        </div>

        <div class="test-row">
          <div class="section test-col">
            <label class="section-label">测试文本</label>
            <textarea
              v-model="testText"
              class="test-textarea"
              placeholder="粘贴要测试的文本..."
              spellcheck="false"
            />
          </div>

          <div class="section match-col">
            <label class="section-label">
              匹配结果
              <span v-if="pattern && !hasError" class="match-badge">{{ matchCount }} 处</span>
            </label>
            <MatchPreview :segments="matchSegments" />
            <div v-if="captureGroups.length" class="capture-groups">
              <div v-for="g in captureGroups" :key="g.index" class="capture-item">
                <span class="capture-label">第 {{ g.index }} 组</span>
                <code>{{ g.value || '(空)' }}</code>
              </div>
            </div>
          </div>
        </div>

        <div class="section ai-section">
          <label class="section-label">中文说明</label>
          <div class="ai-toolbar">
            <select
              v-if="aiModels.length"
              v-model="selectedModelId"
              class="ai-model-select"
              title="AI 模型"
            >
              <option v-for="m in aiModels" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <button
              v-if="aiAvailable"
              class="ai-btn"
              :disabled="!pattern || aiLoading"
              @click="explainPattern(true)"
            >
              {{ aiLoading ? '解释中…' : 'AI 解释' }}
            </button>
            <button v-else class="ai-btn ai-btn-muted" @click="openAiSettings">配置 AI</button>
          </div>
          <div class="explanation-summary" :class="{ loading: aiLoading && !aiExplanation }">
            {{ displayExplanation }}
          </div>
          <p v-if="aiError" class="ai-error">{{ aiError }}</p>
          <p v-if="!aiAvailable && pattern" class="ai-hint">
            未配置 AI 时使用本地规则解释；在 ZTools 设置中配置模型后可启用 AI 大白话说明。
          </p>

          <div class="ai-generate">
            <input
              v-model="requirement"
              class="requirement-input"
              type="text"
              placeholder="用大白话描述需求，如：匹配 11 位手机号"
              @keydown.enter="generateFromRequirement"
            />
            <button
              class="ai-btn"
              :disabled="aiLoading || !requirement.trim()"
              @click="generateFromRequirement"
            >
              AI 生成
            </button>
          </div>
        </div>
      </section>

      <aside class="right-panel">
        <ExamplesPanel
          :active-category="activeCategory"
          @update:active-category="activeCategory = $event"
          @select="loadExample"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor {
  --accent: rgb(88, 164, 246);
  --panel-bg: rgba(128, 128, 128, 0.08);
  --border-color: rgba(128, 128, 128, 0.25);
  --text-muted: rgba(128, 128, 128, 0.85);
  --hover-bg: rgba(128, 128, 128, 0.12);

  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: inherit;
  box-sizing: border-box;
}

.editor-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.left-panel {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.right-panel {
  flex: 0 0 clamp(240px, 28vw, 300px);
  min-width: 220px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 12px;
  border-left: 1px solid var(--border-color);
  box-sizing: border-box;
}

.section {
  flex-shrink: 0;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.pattern-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.pattern-input-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
}

.pattern-slash {
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 15px;
  user-select: none;
  flex-shrink: 0;
}

.pattern-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 14px;
  outline: none;
}

.flags-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 4px;
  flex-shrink: 0;
}

.flag-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  line-height: 26px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
}

.flag-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.copy-btn {
  flex-shrink: 0;
  height: 40px;
  padding: 0 14px;
  line-height: 40px;
  font-size: 13px;
  border-radius: 8px;
  white-space: nowrap;
}

.error-msg {
  margin: 6px 0 0;
  font-size: 12px;
  color: #ef4444;
}

.test-row {
  display: flex;
  gap: 12px;
  flex: 0 0 auto;
  min-height: 140px;
}

.test-col,
.match-col {
  flex: 1 1 0;
  min-width: 0;
  max-height: 220px;
  display: flex;
  flex-direction: column;
}

.test-textarea {
  flex: 1;
  width: 100%;
  min-height: 120px;
  padding: 12px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  color: inherit;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}

.test-textarea:focus {
  border-color: var(--accent);
}

.match-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(88, 164, 246, 0.18);
  color: var(--accent);
}

.capture-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.capture-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  font-size: 12px;
}

.capture-label {
  color: var(--text-muted);
}

.capture-item code {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
}

.explanation-summary {
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(88, 164, 246, 0.08);
  border: 1px solid rgba(88, 164, 246, 0.22);
  font-size: 14px;
  line-height: 1.8;
  min-height: 48px;
}

.explanation-summary.loading {
  color: var(--text-muted);
}

.ai-section {
  flex-shrink: 0;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.ai-section > .section-label {
  margin-bottom: 6px;
}

.ai-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.ai-model-select {
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
}

.ai-btn {
  height: 32px;
  padding: 0 14px;
  line-height: 32px;
  font-size: 12px;
  border-radius: 6px;
  white-space: nowrap;
}

.ai-btn-muted {
  background: var(--panel-bg);
  color: inherit;
  border: 1px solid var(--border-color);
}

.ai-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #ef4444;
}

.ai-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.ai-generate {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.requirement-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  outline: none;
  box-sizing: border-box;
}

.requirement-input:focus {
  border-color: var(--accent);
}

/* 窄屏：范例移到底部 */
@media (max-width: 720px) {
  .editor-layout {
    flex-direction: column;
  }

  .right-panel {
    flex: 0 0 auto;
    max-width: none;
    min-width: 0;
    max-height: 38vh;
    border-left: none;
    border-top: 1px solid var(--border-color);
  }

  .test-row {
    flex-direction: column;
  }
}
</style>
