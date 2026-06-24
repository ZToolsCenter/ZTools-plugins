<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storage } from '../utils/storage'
import type { StoreSource, StoreSourceType } from '../types'
import { getDefaultStoreIcon, getStoreIconFromSource, ICON_GITHUB, ICON_MARKETPLACE, ICON_FOLDER, ICON_STORE } from '../data/store-icons'

const props = defineProps<{
  editSource?: StoreSource | null
}>()

const emit = defineEmits(['close', 'saved'])

const editingId = ref<string | null>(props.editSource?.id || null)
const sourceType = ref<StoreSourceType>((props.editSource?.type as StoreSourceType) || 'git-repo')
const sourceName = ref(props.editSource?.name || '')
const sourceUrl = ref(props.editSource?.url || '')
const sourceBranch = ref(props.editSource?.branch || '')
const sourceDirectory = ref(props.editSource?.directory || '')
const sourceIcon = ref(props.editSource?.icon || '')

const isEditing = computed(() => !!editingId.value)

const typeOptions: { value: StoreSourceType; icon: string; label: string; hint: string }[] = [
  { value: 'marketplace-json', icon: ICON_MARKETPLACE, label: 'Marketplace JSON', hint: 'Marketplace 索引 URL' },
  { value: 'git-repo', icon: ICON_GITHUB, label: 'Git 仓库', hint: 'GitHub / Git 仓库 URL' },
  { value: 'local-dir', icon: ICON_FOLDER, label: '本地目录', hint: '本地文件夹路径' },
]

const examples: Record<StoreSourceType, { label: string; lines: string[] }> = {
  'marketplace-json': { label: 'Example', lines: ['https://raw.githubusercontent.com/docker/claude-code-plugin-manager/main/marketplace.json'] },
  'git-repo': { label: 'Examples', lines: ['https://github.com/anthropics/skills', 'Branch: main | Dir: skills/.curated', '~/Projects/my-skill-repo'] },
  'local-dir': { label: 'Example', lines: ['~/Documents/my-skills'] },
}

watch(() => props.editSource, (src) => {
  if (src) {
    editingId.value = src.id
    sourceType.value = src.type as StoreSourceType
    sourceName.value = src.name
    sourceUrl.value = src.url || ''
    sourceBranch.value = src.branch || ''
    sourceDirectory.value = src.directory || ''
    sourceIcon.value = src.icon || ''
  }
})

function canAdd(): boolean { return !!(sourceName.value.trim() && sourceUrl.value.trim()) }

function handleSave() {
  if (!canAdd()) return
  const data = {
    type: sourceType.value,
    name: sourceName.value.trim(),
    url: sourceUrl.value.trim(),
    branch: sourceType.value === 'git-repo' ? sourceBranch.value.trim() || undefined : undefined,
    directory: sourceType.value === 'git-repo' ? sourceDirectory.value.trim() || undefined : undefined,
    icon: sourceIcon.value.trim() || undefined,
    enabled: true,
  }
  if (editingId.value) {
    const source: StoreSource = { id: editingId.value, ...data }
    storage.saveStoreSource(source)
  } else {
    const newId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const source: StoreSource = { id: newId, ...data }
    storage.saveStoreSource(source)
  }
  emit('saved')
  emit('close')
}
</script>

<template>
  <div class="store-config-overlay" @click.self="emit('close')">
    <div class="store-config-modal">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <h3 class="modal-title">{{ isEditing ? '编辑商店' : '添加商店' }}</h3>
        </div>
        <button class="modal-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="form-section">
          <div class="section-label">商店类型</div>
          <div class="type-grid">
            <button v-for="option in typeOptions" :key="option.value" :class="['type-card', { active: sourceType === option.value }]" :disabled="isEditing" @click="sourceType = option.value">
              <div class="type-card-header">
                <span class="type-icon" v-html="option.icon"></span>
                <span class="type-label">{{ option.label }}</span>
              </div>
              <div class="type-hint">{{ option.hint }}</div>
            </button>
          </div>
        </div>
        <div class="form-row">
          <input v-model="sourceName" type="text" placeholder="商店名称" class="form-input" />
          <input v-model="sourceUrl" type="text" :placeholder="sourceType === 'local-dir' ? '本地路径' : 'URL / manifest'" class="form-input url-input" />
        </div>
        <div v-if="sourceType === 'git-repo'" class="form-row">
          <input v-model="sourceBranch" type="text" placeholder="分支（可选）" class="form-input" />
          <input v-model="sourceDirectory" type="text" placeholder="目录（可选）" class="form-input" />
        </div>
        <div class="form-row">
          <input v-model="sourceIcon" type="text" placeholder="图标 URL（可选，默认根据类型自动选择）" class="form-input" />
        </div>
        <div class="examples-box">
          <div class="examples-label">{{ examples[sourceType].label }}</div>
          <div v-for="(line, i) in examples[sourceType].lines" :key="i" class="examples-line">{{ line }}</div>
          <div class="icon-preview">
            <span class="icon-preview-label">默认图标：</span>
            <span class="icon-preview-svg" v-html="getDefaultStoreIcon(sourceType)"></span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="modal-btn cancel" @click="emit('close')">取消</button>
        <button class="modal-btn save" :disabled="!canAdd()" @click="handleSave">{{ isEditing ? '保存' : '添加' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.store-config-overlay {
  position: fixed;
  inset: 0;
  background: hsl(0 0% 0% / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.store-config-modal {
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border));
}

.modal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.modal-close:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.form-section { margin-bottom: 18px; }

.section-label {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.type-card {
  padding: 14px;
  border: 1.5px solid hsl(var(--border));
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all var(--duration-base) var(--ease-standard);
}

.type-card:hover:not(:disabled) {
  border-color: hsl(var(--primary) / 0.4);
  background: hsl(var(--primary) / 0.04);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px hsl(0 0% 0% / 0.06);
}

.type-card.active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.06);
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.type-card:disabled { opacity: 0.5; cursor: not-allowed; }

.type-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.type-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
  transition: all var(--duration-base) var(--ease-standard);
}

.type-card.active .type-icon {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.type-icon :deep(svg) { width: 16px; height: 16px; }
.type-label { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.type-hint { font-size: 11px; color: hsl(var(--muted-foreground)); line-height: 1.4; padding-left: 40px; }

.form-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.form-input {
  flex: 1;
  padding: 9px 12px;
  font-size: 13px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  outline: none;
  transition: all var(--duration-base) var(--ease-standard);
}

.form-input:focus {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
  background: hsl(var(--card));
}

.form-input::placeholder { color: hsl(var(--muted-foreground) / 0.7); }
.url-input { flex: 1.4; }

.examples-box {
  padding: 12px 14px;
  background: hsl(var(--muted));
  border-radius: 10px;
  min-width: 0;
  border: 1px solid hsl(var(--border) / 0.5);
}

.examples-label {
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.examples-line {
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.8;
  word-break: break-all;
}

.icon-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid hsl(var(--border) / 0.5);
}

.icon-preview-label { font-size: 11px; color: hsl(var(--muted-foreground)); }
.icon-preview-svg {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
}

.icon-preview-svg :deep(svg) { width: 16px; height: 16px; }

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid hsl(var(--border));
}

.modal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.modal-btn.cancel {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.modal-btn.cancel:hover {
  background: hsl(var(--muted) / 0.8);
}

.modal-btn.save {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.modal-btn.save:hover:not(:disabled) {
  box-shadow: 0 4px 12px hsl(var(--primary) / 0.3);
  transform: translateY(-1px);
}

.modal-btn.save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
