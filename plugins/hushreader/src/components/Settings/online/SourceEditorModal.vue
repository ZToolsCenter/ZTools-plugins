<script setup lang="ts">
import { ref, computed } from 'vue'
import type { BookSource } from '../../../utils/onlineBook'
import type { SourceGroup } from '../../../stores/online'

const props = defineProps<{
  source: BookSource
  groupId: string
  groups: SourceGroup[]
}>()

const emit = defineEmits<{
  save: [patch: Partial<BookSource>, toGroupId?: string]
  close: []
}>()

const isNew = computed(() => !!(props.source.bookSourceUrl || props.source.ruleSearch || props.source.searchUrl))

const nameField = computed<'bookSourceName' | 'source_name'>(() => isNew.value ? 'bookSourceName' : 'source_name')
const urlField = computed<'bookSourceUrl' | 'source_url'>(() => isNew.value ? 'bookSourceUrl' : 'source_url')
const searchUrlField = computed<'searchUrl' | 'search_url'>(() => isNew.value ? 'searchUrl' : 'search_url')

const name = ref(props.source[nameField.value] || '')
const url = ref(props.source[urlField.value] || '')
const groupId = ref(props.groupId)
const enabled = ref(props.source.enabled !== false)
const searchUrl = ref(props.source[searchUrlField.value] || '')
const headerText = ref(
  typeof props.source.header === 'string' ? props.source.header
  : props.source.header ? JSON.stringify(props.source.header, null, 2)
  : ''
)
const cookie = ref(props.source.cookie || '')
const useCookieJar = ref(props.source.enabledCookieJar !== false)
const loginUrl = ref(props.source.loginUrl || '')
const loginUi = ref(props.source.loginUi || '')
const loginCheckJs = ref(props.source.loginCheckJs || '')
const rulesJson = ref(
  isNew.value
    ? JSON.stringify({
        ruleSearch: props.source.ruleSearch,
        ruleBookInfo: props.source.ruleBookInfo,
        ruleToc: props.source.ruleToc,
        ruleContent: props.source.ruleContent,
        bookUrlPattern: props.source.bookUrlPattern
      }, null, 2)
    : ''
)

const errorMsg = ref('')
const formatError = ref('')

function formatRulesJson() {
  try {
    rulesJson.value = JSON.stringify(JSON.parse(rulesJson.value || '{}'), null, 2)
    errorMsg.value = ''
  } catch {
    errorMsg.value = '规则 JSON 格式错误，无法格式化'
  }
}

function doSave() {
  errorMsg.value = ''
  const patch: Partial<BookSource> = {
    [nameField.value]: name.value.trim() || undefined,
    [urlField.value]: url.value.trim() || undefined,
    [searchUrlField.value]: searchUrl.value.trim() || undefined,
    enabled: enabled.value,
    cookie: cookie.value.trim() || undefined,
    enabledCookieJar: useCookieJar.value,
    loginUrl: loginUrl.value.trim() || undefined,
    loginUi: loginUi.value.trim() || undefined,
    loginCheckJs: loginCheckJs.value.trim() || undefined
  }

  // header：合法 JSON 字符串保留；为空则移除
  if (headerText.value.trim()) {
    try {
      JSON.parse(headerText.value)
      patch.header = headerText.value.trim()
    } catch {
      errorMsg.value = '请求头不是合法 JSON'
      return
    }
  } else {
    patch.header = undefined
  }

  if (loginUi.value.trim()) {
    try {
      JSON.parse(loginUi.value)
    } catch {
      errorMsg.value = 'loginUi 不是合法 JSON（应为数组）'
      return
    }
  }

  if (isNew.value && rulesJson.value.trim()) {
    try {
      const rules = JSON.parse(rulesJson.value)
      if (rules && typeof rules === 'object') {
        patch.ruleSearch = rules.ruleSearch
        patch.ruleBookInfo = rules.ruleBookInfo
        patch.ruleToc = rules.ruleToc
        patch.ruleContent = rules.ruleContent
        patch.bookUrlPattern = rules.bookUrlPattern
      }
    } catch {
      errorMsg.value = '规则 JSON 格式错误'
      return
    }
  }

  emit('save', patch, groupId.value !== props.groupId ? groupId.value : undefined)
}
</script>

<template>
  <div class="editor-overlay" @click.self="emit('close')">
    <div class="editor-box">
      <div class="editor-header">
        <h3 class="editor-title">编辑书源</h3>
        <button class="editor-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="editor-body">
        <div v-if="errorMsg" class="form-error">{{ errorMsg }}</div>

        <!-- 基本信息 -->
        <div class="form-section">基本信息</div>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">名称</span>
            <input v-model="name" class="text-input" placeholder="书源名称" />
          </label>
          <label class="field">
            <span class="field-label">分组</span>
            <select v-model="groupId" class="select">
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </label>
          <label class="field full">
            <span class="field-label">书源地址</span>
            <input v-model="url" class="text-input" placeholder="https://www.example.com" />
          </label>
        </div>
        <label class="toggle-row">
          <span>启用书源（参与搜索）</span>
          <label class="toggle">
            <input v-model="enabled" type="checkbox" />
            <span class="toggle-track"></span>
          </label>
        </label>

        <!-- 网络 -->
        <div class="form-section">网络</div>
        <div class="form-grid">
          <label class="field full">
            <span class="field-label">搜索地址</span>
            <input v-model="searchUrl" class="text-input" placeholder="https://www.example.com/search?q={{key}}" />
          </label>
          <label class="field full">
            <span class="field-label">请求头（JSON）</span>
            <textarea v-model="headerText" class="text-area mono" rows="3"
              placeholder='{"User-Agent":"Mozilla/5.0 ..."}'></textarea>
          </label>
          <label class="field full">
            <span class="field-label">Cookie</span>
            <textarea v-model="cookie" class="text-area mono" rows="2"
              placeholder="手动填写的 Cookie（登录获取后自动填入）"></textarea>
          </label>
        </div>
        <label class="toggle-row">
          <span>启用 Cookie Jar（自动保存并附加本域名 Cookie）</span>
          <label class="toggle">
            <input v-model="useCookieJar" type="checkbox" />
            <span class="toggle-track"></span>
          </label>
        </label>

        <!-- 登录 -->
        <div class="form-section">登录（可选）</div>
        <div class="form-grid">
          <label class="field full">
            <span class="field-label">登录地址 loginUrl</span>
            <input v-model="loginUrl" class="text-input mono" placeholder="https://www.example.com/login 或 @js: 代码" />
          </label>
          <label class="field full">
            <span class="field-label">登录状态检测 loginCheckJs</span>
            <input v-model="loginCheckJs" class="text-input mono" placeholder='cookie.contains("token")' />
          </label>
          <label class="field full">
            <span class="field-label">登录表单 loginUi（JSON）</span>
            <textarea v-model="loginUi" class="text-area mono" rows="3"
              placeholder='[{"name":"username","type":"text"},{"name":"password","type":"password"}]'></textarea>
          </label>
        </div>

        <!-- 规则（新格式） -->
        <template v-if="isNew">
          <div class="form-section">
            规则（ruleSearch / ruleToc / ruleContent / ruleBookInfo / bookUrlPattern）
            <button class="mini-btn" @click="formatRulesJson">格式化</button>
          </div>
          <textarea v-model="rulesJson" class="text-area mono rules-area" rows="9"></textarea>
        </template>
        <div v-else class="old-format-note">旧格式书源请通过「书源 JSON」整体编辑规则（可在书源管理中重新导入修改后的 JSON）。</div>
      </div>

      <div class="editor-footer">
        <button class="btn-secondary" @click="emit('close')">取消</button>
        <button class="btn-primary" @click="doSave">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: fade-in 0.15s var(--ease-out);
}

.editor-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: min(640px, 94vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.2s var(--ease-out);
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.editor-title {
  font-size: 15px;
  font-weight: 700;
}

.editor-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.editor-close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.editor-body {
  padding: 12px 18px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-error {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--c-danger-soft);
  color: var(--c-danger);
  font-size: 12px;
}

.form-section {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 10px 0 2px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field.full {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 11px;
  color: var(--c-ink-secondary);
}

.text-input,
.select,
.text-area {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 12px;
  width: 100%;
}

.text-input:focus,
.select:focus,
.text-area:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

.text-area {
  resize: vertical;
  min-height: 40px;
}

.mono {
  font-family: var(--font-mono);
}

.rules-area {
  min-height: 140px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 12px;
  color: var(--c-ink);
}

.toggle {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  width: 34px;
  height: 19px;
  background: var(--c-border-strong);
  border-radius: var(--radius-full);
  transition: background 0.2s var(--ease-out);
  position: relative;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  background: var(--c-ink-inverse);
  border-radius: 50%;
  transition: transform 0.2s var(--ease-out);
  box-shadow: 0 1px 3px rgba(28, 25, 23, 0.15);
}

.toggle input:checked + .toggle-track {
  background: var(--c-accent);
}

.toggle input:checked + .toggle-track::after {
  transform: translateX(15px);
}

.old-format-note {
  font-size: 11px;
  color: var(--c-ink-tertiary);
  padding: 6px 0;
}

.mini-btn {
  padding: 2px 10px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
  color: var(--c-ink-secondary);
  transition: all 0.12s var(--ease-out);
}

.mini-btn:hover {
  color: var(--c-ink);
  border-color: var(--c-border-strong);
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 14px;
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

.btn-primary,
.btn-secondary {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover {
  border-color: var(--c-border-strong);
}
</style>
