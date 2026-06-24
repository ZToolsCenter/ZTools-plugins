<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storage } from '../../utils/storage'
import { useSettings } from '../../composables/useSettings'
import type { StoreSource, StoreSourceType } from '../../types'
import { getDefaultStoreIcon, getStoreIconFromSource, ICON_GITHUB, ICON_MARKETPLACE, ICON_FOLDER, ICON_STORE } from '../../data/store-icons'
import ConfirmModal from '../../components/ConfirmModal.vue'

const emit = defineEmits(['navigate'])

const { settings, updateSettings } = useSettings()

const isDarkMode = computed(() => {
  if (settings.themeMode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return settings.themeMode === 'dark'
})

function toggleTheme() {
  const next = isDarkMode.value ? 'light' : 'dark'
  updateSettings({ themeMode: next })
}

const sources = ref<StoreSource[]>([])
const editingId = ref<string | null>(null)
const sourceType = ref<StoreSourceType>('git-repo')
const sourceName = ref('')
const sourceUrl = ref('')
const sourceBranch = ref('')
const sourceDirectory = ref('')
const sourceIcon = ref('')

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

onMounted(() => { sources.value = storage.getStoreSources().filter((s) => s.type !== 'builtin') })

function canAdd(): boolean { return !!(sourceName.value.trim() && sourceUrl.value.trim()) }

function startEdit(source: StoreSource) {
  editingId.value = source.id
  sourceType.value = source.type as StoreSourceType
  sourceName.value = source.name
  sourceUrl.value = source.url || ''
  sourceBranch.value = source.branch || ''
  sourceDirectory.value = source.directory || ''
  sourceIcon.value = source.icon || ''
}

function cancelEdit() {
  editingId.value = null
  sourceName.value = ''; sourceUrl.value = ''; sourceBranch.value = ''; sourceDirectory.value = ''; sourceIcon.value = ''
}

function handleAddOrSave() {
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
    editingId.value = null
  } else {
    const newId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const source: StoreSource = { id: newId, ...data }
    storage.saveStoreSource(source)
  }
  sources.value = storage.getStoreSources().filter((s) => s.type !== 'builtin')
  sourceName.value = ''; sourceUrl.value = ''; sourceBranch.value = ''; sourceDirectory.value = ''; sourceIcon.value = ''
}

const confirmDeleteSourceId = ref<string | null>(null)
const confirmDeleteSourceName = ref('')
function removeSource(id: string) { storage.removeStoreSource(id); sources.value = storage.getStoreSources().filter((s) => s.type !== 'builtin'); confirmDeleteSourceId.value = null }
function toggleEnabled(source: StoreSource) { source.enabled = !source.enabled; storage.saveStoreSource(source) }
function getSourceIcon(type: string): string { return { 'marketplace-json': ICON_MARKETPLACE, 'git-repo': ICON_GITHUB, 'local-dir': ICON_FOLDER, 'github': ICON_GITHUB, 'skills-sh': '📦' }[type] || ICON_STORE }
function getSourceLabel(type: string): string { return { 'marketplace-json': 'Marketplace JSON', 'git-repo': 'Git Repository', 'local-dir': 'Local Directory', 'github': 'GitHub', 'skills-sh': 'skills.sh' }[type] || type }
</script>

<template>
  <div class="sources">
    <div class="page-header">
      <div class="header-left">
        <div class="header-title-row">
          <button class="back-btn" @click="emit('navigate', 'store')" title="返回商店">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2>{{ editingId ? '编辑商店' : '添加商店' }}</h2>
        </div>
        <p class="page-subtitle">{{ editingId ? '修改自定义商店配置' : '连接自定义技能仓库或本地目录' }}</p>
      </div>
      <div class="header-toolbar">
        <button class="toolbar-icon-btn" @click="toggleTheme" :title="isDarkMode ? '切换亮色模式' : '切换暗色模式'">
          <svg v-if="isDarkMode" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="add-form">
      <div class="form-section">
        <div class="section-label">商店类型</div>
        <div class="type-grid">
          <button v-for="option in typeOptions" :key="option.value" :class="['type-card', { active: sourceType === option.value }]" :disabled="!!editingId" @click="sourceType = option.value">
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
      <div class="form-actions">
        <div class="examples-box">
          <div class="examples-label">{{ examples[sourceType].label }}</div>
          <div v-for="(line, i) in examples[sourceType].lines" :key="i" class="examples-line">{{ line }}</div>
          <div class="icon-preview">
            <span class="icon-preview-label">默认图标：</span>
            <span class="icon-preview-svg" v-html="getDefaultStoreIcon(sourceType)"></span>
          </div>
        </div>
        <div class="form-btn-group">
          <button v-if="editingId" class="cancel-btn" @click="cancelEdit">取消</button>
          <button class="add-btn" :disabled="!canAdd()" @click="handleAddOrSave">{{ editingId ? '保存' : '添加' }}</button>
        </div>
      </div>
    </div>

    <div v-if="sources.length" class="source-list">
      <div v-for="s in sources" :key="s.id" class="source-card">
        <div class="source-info">
          <span class="source-icon" v-html="getStoreIconFromSource(s)"></span>
          <div>
            <div class="source-name">{{ s.name }}</div>
            <div class="source-meta">
              <span class="source-type-badge">{{ getSourceLabel(s.type) }}</span>
              <span v-if="s.url" class="source-url">{{ s.url }}</span>
            </div>
          </div>
        </div>
        <div class="source-actions">
          <button class="toggle-switch" :class="{ on: s.enabled }" @click="toggleEnabled(s)"><span class="toggle-thumb"></span></button>
          <button class="edit-btn" @click="startEdit(s)">编辑</button>
          <button class="remove-btn" @click="confirmDeleteSourceId = s.id; confirmDeleteSourceName = s.name">删除</button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon" v-html="ICON_STORE"></div>
      <div class="empty-title">暂无自定义商店</div>
      <div class="empty-desc">使用上方表单添加商店。</div>
    </div>

    <ConfirmModal v-if="confirmDeleteSourceId" title="删除商店" :message="`确定要删除商店 <strong>${confirmDeleteSourceName}</strong> 吗？`" @confirm="removeSource(confirmDeleteSourceId!)" @cancel="confirmDeleteSourceId = null" />
  </div>
</template>

<style scoped>
.sources { padding: 0; }

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 28px 16px;
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-left h2 {
  font-size: 22px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
}

.page-subtitle {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  flex-shrink: 0;
}

.back-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.header-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.toolbar-icon-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.add-form { margin: 20px 28px; padding: 20px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); margin-bottom: 24px; }
.form-section { margin-bottom: 16px; }
.section-label { font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

.type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.type-card { padding: 14px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: transparent; cursor: pointer; text-align: left; transition: all var(--duration-base) var(--ease-standard); }
.type-card:hover:not(:disabled) { border-color: hsl(var(--primary) / 0.4); background: hsl(var(--primary) / 0.04); }
.type-card.active { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.08); box-shadow: 0 0 0 1px hsl(var(--primary)); }
.type-card:disabled { opacity: 0.6; cursor: not-allowed; }
.type-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.type-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; color: hsl(var(--foreground)); }
.type-icon :deep(svg) { width: 18px; height: 18px; }
.type-label { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.type-hint { font-size: 11px; color: hsl(var(--muted-foreground)); line-height: 1.4; }

.form-row { display: flex; gap: 10px; margin-bottom: 12px; }
.form-input { flex: 1; padding: 10px 14px; font-size: 13px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--muted)); color: hsl(var(--foreground)); outline: none; transition: all var(--duration-base) var(--ease-standard); }
.form-input:focus { border-color: hsl(var(--ring)); box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12); background: hsl(var(--card)); }
.form-input::placeholder { color: hsl(var(--muted-foreground)); }
.url-input { flex: 1.4; }

.form-actions { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.form-btn-group { display: flex; gap: 8px; flex-shrink: 0; }

.add-btn { padding: 10px 24px; font-size: 13px; font-weight: 600; border-radius: 10px; border: none; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); cursor: pointer; white-space: nowrap; transition: all var(--duration-base) var(--ease-standard); }
.add-btn:hover:not(:disabled) { box-shadow: 0 4px 16px hsl(var(--primary) / 0.3); }
.add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.cancel-btn { padding: 10px 24px; font-size: 13px; font-weight: 600; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground)); cursor: pointer; white-space: nowrap; transition: all var(--duration-base) var(--ease-standard); }
.cancel-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }

.examples-box { flex: 1; padding: 14px; background: hsl(var(--muted)); border-radius: 10px; min-width: 0; }
.examples-label { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); margin-bottom: 6px; }
.examples-line { font-family: 'SF Mono', Consolas, monospace; font-size: 11px; color: hsl(var(--muted-foreground)); line-height: 1.8; }
.icon-preview { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.icon-preview-label { font-size: 11px; color: hsl(var(--muted-foreground)); }
.icon-preview-svg { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: hsl(var(--muted-foreground)); }
.icon-preview-svg :deep(svg) { width: 16px; height: 16px; }

.source-list { display: flex; flex-direction: column; gap: 8px; margin: 0 28px 28px; }
.source-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); }
.source-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
.source-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: hsl(var(--foreground)); }
.source-icon :deep(svg) { width: 20px; height: 20px; }
.source-icon :deep(img) { width: 20px; height: 20px; object-fit: contain; }
.source-name { font-weight: 600; font-size: 14px; color: hsl(var(--foreground)); margin-bottom: 2px; }
.source-meta { display: flex; align-items: center; gap: 8px; }
.source-type-badge { font-size: 10px; padding: 2px 8px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.source-url { font-size: 11px; color: hsl(var(--muted-foreground)); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.source-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.toggle-switch { position: relative; width: 44px; height: 26px; border-radius: 13px; border: 2px solid hsl(var(--border)); background: hsl(var(--muted)); cursor: pointer; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.toggle-switch.on { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.toggle-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); transition: transform var(--duration-base) var(--ease-standard); }
.toggle-switch.on .toggle-thumb { transform: translateX(18px); }

.edit-btn { padding: 5px 14px; font-size: 11px; border-radius: 8px; background: transparent; color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.3); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.edit-btn:hover { background: hsl(var(--primary) / 0.1); }

.remove-btn { padding: 5px 14px; font-size: 11px; border-radius: 8px; background: transparent; color: hsl(var(--destructive)); border: 1px solid hsl(var(--destructive) / 0.3); transition: all var(--duration-base) var(--ease-standard); }
.remove-btn:hover { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }

.empty-state { text-align: center; padding: 60px 20px; margin: 0 28px 28px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); }
.empty-icon { width: 48px; height: 48px; margin: 0 auto 16px; opacity: 0.3; color: hsl(var(--muted-foreground)); }
.empty-icon :deep(svg) { width: 48px; height: 48px; }
.empty-title { font-size: 16px; font-weight: 600; color: hsl(var(--foreground)); margin-bottom: 8px; }
.empty-desc { font-size: 13px; color: hsl(var(--muted-foreground)); }
</style>
