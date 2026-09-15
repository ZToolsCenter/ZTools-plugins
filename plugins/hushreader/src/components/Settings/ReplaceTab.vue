<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useReplaceStore } from '../../stores/replace'
import { validateReplaceRule, type ReplaceRule } from '../../utils/replaceRules'
import Toast from '../Bookshelf/Toast.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'

const replaceStore = useReplaceStore()

const toastMsg = ref('')
const toastType = ref<'info' | 'success' | 'error'>('info')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  toastMsg.value = msg
  toastType.value = type
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
}

onMounted(() => {
  replaceStore.load()
})

const activeGroup = ref('全部')
const searchText = ref('')

const groupOptions = computed(() => ['全部', '未分组', ...replaceStore.groups])

const filteredRules = computed(() => {
  let list = [...replaceStore.rules]
  if (activeGroup.value === '未分组') {
    list = list.filter(r => !r.group.trim())
  } else if (activeGroup.value !== '全部') {
    list = list.filter(r => r.group === activeGroup.value)
  }
  if (searchText.value.trim()) {
    const q = searchText.value.trim().toLowerCase()
    list = list.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.pattern.toLowerCase().includes(q) ||
      r.replacement.toLowerCase().includes(q)
    )
  }
  list.sort((a, b) => a.order - b.order)
  return list
})

// ---------- 编辑 ----------

const editing = ref<ReplaceRule | null>(null)
const isNew = ref(false)

function startAdd() {
  editing.value = {
    id: '',
    name: '',
    group: activeGroup.value === '全部' || activeGroup.value === '未分组' ? '' : activeGroup.value,
    pattern: '',
    replacement: '',
    scope: '',
    excludeScope: '',
    scopeTitle: false,
    scopeContent: true,
    isEnabled: true,
    isRegex: true,
    order: 0
  }
  isNew.value = true
}

function startEdit(rule: ReplaceRule) {
  editing.value = { ...rule }
  isNew.value = false
}

function cancelEdit() {
  editing.value = null
}

function confirmEdit() {
  if (!editing.value) return
  const error = validateReplaceRule(editing.value)
  if (error) {
    showToast(error, 'error')
    return
  }
  if (isNew.value) {
    const { id: _id, ...rest } = editing.value
    replaceStore.addRule({ ...rest, name: editing.value.name })
    showToast('净化规则已添加', 'success')
  } else {
    replaceStore.updateRule(editing.value.id, { ...editing.value })
    showToast('净化规则已更新', 'success')
  }
  editing.value = null
}

const showRemoveConfirm = ref(false)
const pendingRemoveRule = ref<ReplaceRule | null>(null)

function removeRuleConfirm(rule: ReplaceRule) {
  pendingRemoveRule.value = rule
  showRemoveConfirm.value = true
}

function confirmRemoveRule() {
  showRemoveConfirm.value = false
  const rule = pendingRemoveRule.value
  if (!rule) return
  replaceStore.removeRule(rule.id)
  showToast('净化规则已删除', 'info')
}

// ---------- 导入导出 ----------

const showImport = ref(false)
const importText = ref('')

function confirmImport() {
  if (!importText.value.trim()) return
  const result = replaceStore.importRulesText(importText.value)
  if (result.error) showToast(result.error, 'error')
  else showToast(`导入成功：新增 ${result.added} 条，跳过 ${result.skipped} 条`, 'success')
  importText.value = ''
  showImport.value = false
}

function exportRules() {
  const text = replaceStore.exportRulesText()
  const ztools = (window as any).ztools
  if (ztools?.showSaveDialog) {
    const filePath = ztools.showSaveDialog({
      title: '导出净化规则',
      defaultPath: 'hushreader-replace-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (filePath) window.services.writeFileToPath(filePath, text)
    showToast('净化规则已导出', 'success')
    return
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'hushreader-replace-rules.json'
  a.click()
  URL.revokeObjectURL(url)
  showToast('净化规则已导出', 'success')
}

function previewRule(rule: ReplaceRule): string {
  const scopeText = rule.scope.trim() ? rule.scope.trim() : '全部书籍'
  const target = [rule.scopeTitle ? '标题' : '', rule.scopeContent ? '正文' : ''].filter(Boolean).join('+') || '无'
  return `范围：${scopeText} · 作用于：${target}`
}
</script>

<template>
  <div class="replace-tab">
    <div class="section-label">净化规则</div>
    <p class="hint">
      阅读时按「书名 / 书源」匹配规则，对正文与章节标题进行正则或文本替换。可导入「开源阅读」导出的 replaceRule.json。
    </p>

    <div class="replace-actions">
      <button class="btn-secondary" @click="startAdd">＋ 新增规则</button>
      <button class="btn-secondary" @click="showImport = !showImport; importText = ''">导入</button>
      <button class="btn-secondary" :disabled="replaceStore.rules.length === 0" @click="exportRules">导出</button>
    </div>

    <div v-if="showImport" class="import-box">
      <textarea v-model="importText" class="import-textarea" placeholder="粘贴净化规则 JSON 文本（支持开源阅读 replaceRule.json）…"></textarea>
      <div class="import-actions">
        <button class="btn-secondary" @click="showImport = false; importText = ''">取消</button>
        <button class="btn-primary" :disabled="!importText.trim()" @click="confirmImport">导入</button>
      </div>
    </div>

    <div v-if="replaceStore.rules.length > 0" class="rule-filter">
      <select v-model="activeGroup" class="select rule-group-select">
        <option v-for="g in groupOptions" :key="g" :value="g">{{ g }}</option>
      </select>
      <input v-model="searchText" class="text-input rule-search-input" placeholder="搜索规则名称 / 内容…" />
    </div>

    <div v-if="replaceStore.rules.length === 0" class="empty-hint">尚未添加净化规则</div>

    <div v-else-if="filteredRules.length === 0" class="empty-hint">没有匹配的规则</div>

    <div v-else class="rule-list">
      <div v-for="rule in filteredRules" :key="rule.id" class="rule-item" :class="{ 'rule-disabled': !rule.isEnabled }">
        <div class="rule-item-info">
          <div class="rule-item-line">
            <span class="rule-name">{{ rule.name }}</span>
            <span v-if="rule.group" class="rule-group">{{ rule.group }}</span>
            <span class="rule-badge" :class="rule.isRegex ? 'regex' : 'text'">{{ rule.isRegex ? '正则' : '文本' }}</span>
            <span class="rule-badge" :class="{ title: rule.scopeTitle, content: rule.scopeContent }">
              {{ [rule.scopeTitle ? '标题' : '', rule.scopeContent ? '正文' : ''].filter(Boolean).join('+') || '无' }}
            </span>
          </div>
          <div class="rule-pattern">{{ rule.pattern }} <template v-if="rule.replacement !== ''">→ {{ rule.replacement }}</template></div>
          <div class="rule-scope">{{ previewRule(rule) }}</div>
        </div>
        <div class="rule-item-actions">
          <button class="icon-btn" title="上移" :disabled="rule.order === 0" @click="replaceStore.moveRule(rule.id, -1)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button class="icon-btn" title="下移" :disabled="rule.order === replaceStore.rules.length - 1" @click="replaceStore.moveRule(rule.id, 1)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <button class="icon-btn" title="编辑" @click="startEdit(rule)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
          </button>
          <label class="mini-toggle" :title="rule.isEnabled ? '停用' : '启用'">
            <input type="checkbox" :checked="rule.isEnabled" @change="replaceStore.toggleRule(rule.id)" />
            <span class="mini-toggle-track"></span>
          </label>
          <button class="icon-btn danger" title="删除" @click="removeRuleConfirm(rule)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="editing" class="editor-overlay" @click.self="cancelEdit">
      <div class="editor-box">
        <h3 class="editor-title">{{ isNew ? '新增净化规则' : '编辑净化规则' }}</h3>
        <div class="editor-form">
          <label class="form-label">规则名称 *</label>
          <input v-model="editing.name" class="text-input full-width" placeholder="如：去除章节页广告" />

          <label class="form-label">分组</label>
          <input v-model="editing.group" class="text-input full-width" placeholder="留空为未分组" />

          <label class="form-label">替换内容 *</label>
          <input v-model="editing.pattern" class="text-input full-width" placeholder="要匹配的内容（勾选正则时为正则表达式）" />

          <label class="form-label">替换为</label>
          <input v-model="editing.replacement" class="text-input full-width" placeholder="留空表示删除匹配内容；支持 $1 $2 等捕获组" />

          <label class="form-label">作用范围</label>
          <input v-model="editing.scope" class="text-input full-width" placeholder="留空作用于全部书籍；可填书名或书源URL，逗号分隔多个" />
          <p class="form-hint">范围匹配规则：包含书名或书源URL即生效</p>

          <label class="form-label">排除范围</label>
          <input v-model="editing.excludeScope" class="text-input full-width" placeholder="命中这些书名/书源URL 的书籍不应用本规则" />

          <div class="form-check-row">
            <label class="check-line">
              <input type="checkbox" v-model="editing.isEnabled" />
              <span>启用</span>
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="editing.isRegex" />
              <span>使用正则表达式</span>
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="editing.scopeTitle" />
              <span>作用于章节标题</span>
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="editing.scopeContent" />
              <span>作用于正文</span>
            </label>
          </div>
        </div>
        <div class="editor-actions">
          <button class="btn-secondary" @click="cancelEdit">取消</button>
          <button class="btn-primary" @click="confirmEdit">保存</button>
        </div>
      </div>
    </div>

    <Toast :message="toastMsg" :type="toastType" />

    <ConfirmDialog
      v-if="showRemoveConfirm"
      title="删除净化规则"
      :message="`确定删除净化规则「${pendingRemoveRule?.name || ''}」吗？此操作不可撤销。`"
      confirm-text="删除"
      @confirm="confirmRemoveRule"
      @cancel="showRemoveConfirm = false"
    />
  </div>
</template>

<style scoped>
.replace-tab {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 10px 0 6px;
}

.hint {
  font-size: 11px;
  color: var(--c-ink-tertiary);
  margin: 0 0 6px;
}

.replace-actions {
  display: flex;
  gap: 8px;
  margin: 4px 0 10px;
}

.btn-primary,
.btn-secondary {
  padding: 7px 16px;
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

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover {
  background: var(--c-border);
}

.btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.import-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.import-textarea {
  width: 100%;
  min-height: 120px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  color: var(--c-ink);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  resize: vertical;
}

.import-textarea:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.import-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.rule-filter {
  display: flex;
  gap: 8px;
  margin: 4px 0 8px;
}

.rule-group-select {
  flex-shrink: 0;
  max-width: 140px;
}

.rule-search-input {
  flex: 1;
  min-width: 0;
}

.select {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}

.text-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  font-size: 13px;
}

.text-input:focus,
.select:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.full-width {
  width: 100%;
  box-sizing: border-box;
}

.empty-hint {
  padding: 16px 0;
  text-align: center;
  color: var(--c-ink-tertiary);
  font-size: 13px;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  transition: border-color 0.15s var(--ease-out), opacity 0.15s var(--ease-out);
}

.rule-item:hover {
  border-color: var(--c-border-strong);
}

.rule-disabled {
  opacity: 0.5;
}

.rule-item-info {
  flex: 1;
  min-width: 0;
}

.rule-item-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.rule-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-ink);
}

.rule-group {
  font-size: 10px;
  color: var(--c-ink-tertiary);
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.rule-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  letter-spacing: 0.02em;
}

.rule-badge.regex {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}

.rule-badge.text {
  background: var(--c-surface-sunken);
  color: var(--c-ink-tertiary);
}

.rule-badge.title {
  background: var(--c-warning-soft, var(--c-accent-soft));
  color: var(--c-warning, var(--c-accent));
}

.rule-badge.content {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.rule-pattern {
  margin-top: 3px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--c-ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-scope {
  margin-top: 2px;
  font-size: 10px;
  color: var(--c-ink-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  transition: all 0.12s var(--ease-out);
}

.icon-btn:hover:not(:disabled) {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.icon-btn.danger:hover {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mini-toggle {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  margin: 0 2px;
}

.mini-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.mini-toggle-track {
  width: 30px;
  height: 17px;
  background: var(--c-border-strong);
  border-radius: var(--radius-full);
  transition: background 0.2s var(--ease-out);
  position: relative;
}

.mini-toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  background: var(--c-ink-inverse);
  border-radius: 50%;
  transition: transform 0.2s var(--ease-out);
  box-shadow: 0 1px 3px rgba(28, 25, 23, 0.15);
}

.mini-toggle input:checked + .mini-toggle-track {
  background: var(--c-accent);
}

.mini-toggle input:checked + .mini-toggle-track::after {
  transform: translateX(13px);
}

.editor-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  animation: fade-in 0.12s var(--ease-out);
}

.editor-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: 440px;
  max-width: 94vw;
  max-height: 88vh;
  overflow-y: auto;
  padding: 20px 22px;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.15s var(--ease-out);
}

.editor-title {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 700;
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  color: var(--c-ink-secondary);
  margin-top: 6px;
}

.form-hint {
  margin: 0;
  font-size: 11px;
  color: var(--c-ink-tertiary);
}

.form-check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
}

.check-line {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--c-ink-secondary);
  cursor: pointer;
}

.editor-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
