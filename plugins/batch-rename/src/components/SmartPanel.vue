<script setup lang="ts">
defineProps<{
  prompt: string; model: string; models: { value: string; label: string; providerLabel?: string }[]
  loadingModels: boolean; generating: boolean; canGenerate: boolean
}>()
const emit = defineEmits<{
  'update:prompt': [value: string]; 'update:model': [value: string]; generate: []; refreshModels: []
}>()

function modelLabel(item: { label: string; providerLabel?: string }): string {
  if (!item.providerLabel) return item.label
  if (item.label.startsWith(item.providerLabel)) return item.label
  return `${item.providerLabel} · ${item.label}`
}
</script>

<template>
  <section class="smart-panel" aria-label="智能重命名预览界面">
    <div class="smart-heading">
      <div><strong>描述重命名规则</strong><span>用自然语言说明你想要的文件名</span></div>
      <span class="smart-hint">由 ZTools 提供模型</span>
    </div>
    <div class="smart-composer">
      <textarea :value="prompt" aria-label="智能重命名描述" placeholder="例如：按拍摄日期排序，文件名改为「旅行照片_日期_序号」" @input="emit('update:prompt', ($event.target as HTMLTextAreaElement).value)"></textarea>
      <div class="smart-footer">
        <label class="model-picker">
          <span>模型</span>
          <select :value="model" aria-label="AI 模型" :disabled="loadingModels || !models.length" @change="emit('update:model', ($event.target as HTMLSelectElement).value)">
            <option v-if="!models.length" value="">{{ loadingModels ? '正在读取模型…' : '没有可用模型' }}</option>
            <option v-for="item in models" :key="item.value" :value="item.value">{{ modelLabel(item) }}</option>
          </select>
        </label>
        <div class="smart-actions">
          <button type="button" title="重新读取 ZTools 已配置的模型" :disabled="loadingModels || generating" @click="emit('refreshModels')">刷新模型</button>
          <button class="generate-button" type="button" :disabled="!canGenerate" @click="emit('generate')">{{ generating ? '生成中…' : '生成预览' }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.smart-panel { display: flex; flex-direction: column; gap: 10px; }
.smart-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.smart-heading div { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.smart-heading strong { color: var(--text); font-size: 13px; white-space: nowrap; }
.smart-heading div span { color: var(--muted); font-size: 12px; }
.smart-hint { flex: none; padding: 3px 8px; border-radius: 999px; color: var(--muted); background: var(--surface-subdued); font-size: 11px; }
.smart-composer { border: 1px solid var(--border-input); border-radius: 8px; background: var(--surface-card); overflow: hidden; }
.smart-composer:focus-within { border-color: var(--primary); }
textarea { display: block; width: 100%; height: 66px; padding: 11px 12px; border: 0; outline: 0; resize: none; color: var(--text); background: transparent; font: inherit; font-size: 13px; }
textarea:focus-visible { outline: none; }
textarea::placeholder { color: var(--muted); }
.smart-footer { min-height: 38px; padding: 4px 7px 4px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--border); }
.model-picker { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
select { max-width: 170px; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 12px; }
.smart-actions { display: flex; gap: 6px; }
button { height: 28px; padding: 0 12px; color: var(--text); background: var(--surface-subdued); font-size: 12px; }
.generate-button { color: white; background: var(--primary); }
.generate-button:hover:not(:disabled) { background: var(--primary-hover); }
@media (max-width: 620px) { .smart-heading div span { display: none; } }
</style>
