<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { extractVariables, inferTitle, generateId, detectDuplicate } from '../utils/index'
import type { PromptItem } from '../types'
import { showNotification } from '../utils/platform'

const router = useRouter()
const promptStore = usePromptStore()
const projectStore = useProjectStore()
const content = computed(() => router.quickSaveContent.value || '')
const source = computed(() => router.quickSaveSource.value === 'selected' ? '选中文本' : '剪贴板')
const detectedVars = computed(() => extractVariables(content.value))
const title = ref('')
const tags = ref<string[]>([])
const tagInput = ref('')
const dupPhase = ref<'normal' | 'exact' | 'similar'>('normal')
const selectedProjectId = ref('')

onMounted(async () => {
  await promptStore.ensureReady()
  await projectStore.ensureReady()
  title.value = inferTitle(content.value)
  // 如果路由携带了项目上下文，默认选中该项目
  const ctxProjectId = router.quickSaveProjectId.value
  if (ctxProjectId) selectedProjectId.value = ctxProjectId
  try {
    const r = await detectDuplicate(promptStore.rawItems.value.map(i => ({ content: i.content, id: i.id })), content.value, '')
    dupPhase.value = r.phase
  } catch {}
  window.addEventListener('keydown', handleKey)
})
onUnmounted(() => window.removeEventListener('keydown', handleKey))
function handleKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNew() }
  if (e.key === 'Escape') { e.preventDefault(); router.navigateTo('space') }
}
function addTag() { const t = tagInput.value.trim(); if (t && !tags.value.includes(t)) tags.value.push(t); tagInput.value = '' }
function removeTag(t: string) { tags.value = tags.value.filter(x => x !== t) }

async function saveNew() {
  if (dupPhase.value === 'exact' || !title.value.trim()) return
  await promptStore.ensureReady()
  const now = Date.now()
  promptStore.addItem({
    id: generateId(), title: title.value.trim(), content: content.value,
    type: 'prompt', tags: tags.value, variables: detectedVars.value,
    favorite: false, usageCount: 0, version: 1, snapshots: [],
    projectId: selectedProjectId.value || undefined,
    createdAt: now, updatedAt: now,
  })
  const projName = selectedProjectId.value
    ? projectStore.items.value.find(p => p.id === selectedProjectId.value)?.name || '项目'
    : '资产'
  showNotification(`✓ 已保存至${projName}`)
  setTimeout(() => router.navigateTo('space'), 300)
}
</script>

<template>
  <div class="qsv">
    <div class="qsv-body">
      <div class="preview-card">
        <div class="preview-head"><span class="src-tag">{{ source }}</span><span>{{ detectedVars.length }} 变量 · {{ content.length }} 字符</span></div>
        <div class="preview-body">{{ content }}</div>
      </div>
      <div v-if="dupPhase === 'exact'" class="dup-banner">⚠ 完全相同的内容已存在</div>
      <div class="qsv-form">
        <div class="ff span-2"><label>标题 *</label><input v-model="title" :disabled="dupPhase === 'exact'" /></div>
        <div class="ff"><label>归属项目</label>
          <select v-model="selectedProjectId" class="proj-select">
            <option value="">无项目（资产）</option>
            <option v-for="p in projectStore.items.value" :key="p.id" :value="p.id">{{ p.group }} / {{ p.name }}</option>
          </select>
        </div>
        <div class="ff"><label>标签</label><div class="tags-input"><span v-for="t in tags" :key="t" class="chip">{{ t }} <span class="x" @click="removeTag(t)">×</span></span><input v-model="tagInput" @keydown.enter.prevent="addTag" placeholder="添加…" /></div></div>
      </div>
    </div>
    <div class="qsv-footer">
      <button class="btn primary" @click="saveNew">保存</button>
      <span class="spacer"></span>
      <span class="hint-t"><kbd>Esc</kbd> 取消 <kbd>Ctrl+S</kbd> 保存</span>
    </div>
  </div>
</template>

<style scoped>
.qsv { width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--pf-bg); overflow: hidden; }
.qsv-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.preview-card { background: var(--pf-surface); border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md); max-height: 200px; overflow-y: auto; }
.preview-head { padding: 8px 14px; border-bottom: 1px solid var(--pf-border); background: var(--pf-bg-elevated); display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--pf-text-muted); }
.src-tag { background: var(--pf-success-soft); color: var(--pf-success); padding: 2px 8px; border-radius: var(--pf-radius-xs); font-size: 11px; font-weight: 600; }
.preview-body { padding: 12px 14px; font-family: var(--pf-font-mono); font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; color: var(--pf-text-secondary); }
.dup-banner { padding: 10px 14px; border-radius: var(--pf-radius-sm); background: var(--pf-danger-soft); color: var(--pf-danger); border: 1px solid var(--pf-danger); font-size: 12.5px; }
.qsv-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.ff { display: flex; flex-direction: column; gap: 4px; }
.ff.span-2 { grid-column: 1 / -1; }
.ff label { font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
.ff input { height: 34px; padding: 0 12px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 13px; }
.ff input:focus { border-color: var(--pf-accent); outline: none; }
.tags-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); min-height: 34px; align-items: center; }
.chip { background: var(--pf-surface-raised); padding: 2px 8px; border-radius: var(--pf-radius-pill); font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; }
.chip .x { cursor: pointer; opacity: 0.5; }
.chip .x:hover { opacity: 1; color: var(--pf-danger); }
.tags-input input { flex: 1; min-width: 50px; height: 24px !important; padding: 0 !important; border: 0 !important; }
.proj-select { height: 34px; padding: 0 12px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 13px; color: var(--pf-text); cursor: pointer; }
.proj-select:focus { border-color: var(--pf-accent); outline: none; }
.qsv-footer { height: 48px; flex-shrink: 0; border-top: 1px solid var(--pf-border); background: var(--pf-bg-elevated); display: flex; align-items: center; gap: 10px; padding: 0 20px; }
.spacer { flex: 1; }
.hint-t { font-size: 11px; color: var(--pf-text-faint); display: flex; gap: 6px; align-items: center; }
</style>
