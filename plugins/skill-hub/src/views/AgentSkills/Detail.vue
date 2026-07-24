<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, watch } from 'vue'
import { defaultPlatforms, getPlatformPath } from '../../data/platforms'
import { storage } from '../../utils/storage'
import { normalizePath } from '../../utils/path'
import SkillDetailBase from '../../components/SkillDetailBase.vue'
import PlatformIcon from '../../components/PlatformIcon.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import type { SkillScanResult, PlatformInfo, Skill } from '../../types'


const props = defineProps<{ skill: SkillScanResult | null; platformId: string; duplicateSkills?: SkillScanResult[] | null }>()
const emit = defineEmits(['navigate'])
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})

const activeTab = ref<'preview' | 'source' | 'files'>('preview')
const skillContent = ref('')
const skillDesc = ref('')
const skillName = ref('')
const isEditing = ref(false)
const editedInstructions = ref('')
const copyStatus = ref<Record<string, boolean>>({})
let copyTimers: Record<string, ReturnType<typeof setTimeout>> = {}

onUnmounted(() => { Object.values(copyTimers).forEach(clearTimeout) })

// Selected skill among duplicates
const selectedDuplicateIndex = ref(0)
const selectedDir = ref('')

const activeSkill = computed<SkillScanResult | null>(() => {
  if (!props.skill) return null
  const idx = selectedDuplicateIndex.value
  const sorted = duplicatesForDropdown.value
  if (sorted.length > 1 && idx >= 0 && idx < sorted.length) {
    return sorted[idx]
  }
  if (sorted.length > 0) {
    return sorted[0]
  }
  return props.skill
})

const duplicatesForDropdown = computed(() => {
  const duplicates = props.duplicateSkills
  if (!duplicates) return [props.skill].filter(Boolean) as SkillScanResult[]
  return [...duplicates].sort((a, b) => {
    const aGeneric = (a.dir || '').replace(/\\/g, '/').toLowerCase().includes('.agents/skills') ? 0 : 1
    const bGeneric = (b.dir || '').replace(/\\/g, '/').toLowerCase().includes('.agents/skills') ? 0 : 1
    return aGeneric - bGeneric
  })
})

function getPlatformIdFromDir(dir: string): string {
  if (props.platformId) return props.platformId
  const normalized = dir.replace(/\\/g, '/').toLowerCase()
  if (!normalized) return '_generic'
  for (const p of defaultPlatforms) {
    const pp = (p.projectPath || '').replace(/\\/g, '/').toLowerCase()
    if (pp && normalized.includes(pp)) return p.id
  }
  return '_generic'
}

const detectedPlatformId = computed(() => getPlatformIdFromDir(activeSkill.value?.dir || ''))

watch(duplicatesForDropdown, (list) => {
  if (!selectedDir.value) {
    selectedDuplicateIndex.value = 0
    return
  }
  const idx = list.findIndex((d) => d.dir === selectedDir.value)
  selectedDuplicateIndex.value = idx >= 0 ? idx : 0
}, { immediate: true })

const duplicateCount = computed(() => duplicatesForDropdown.value.length)

function getDirLabel(s: SkillScanResult, index: number): string {
  const dir = s.dir || ''
  const normalized = dir.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts.slice(-4).join('/') || `路径 ${index + 1}`
}

function switchDuplicate(index: number) {
  if (index === selectedDuplicateIndex.value) return
  selectedDuplicateIndex.value = index
  selectedDir.value = duplicatesForDropdown.value[index]?.dir || ''
  loadSkillContentForActive()
  checkImported()
}

function loadSkillContentForActive() {
  const s = activeSkill.value
  if (!s) return
  skillContent.value = s.content || ''
  skillDesc.value = s.manifest?.description || ''
  skillName.value = s.manifest?.name || s.name
  editedInstructions.value = skillContent.value
}

const installRecords = computed(() => {
  if (!activeSkill.value || !props.platformId) return []
  const skillDir = normalizePath(activeSkill.value.dir || '')
  return storage.getInstalledForPlatform(props.platformId).filter((r) =>
    normalizePath(r.targetPath) === skillDir
  )
})

const platform = computed(() => {
  if (!props.platformId) return null
  return defaultPlatforms.find((p) => p.id === props.platformId)
})

// Convert active SkillScanResult to Skill type for SkillDetailBase
const skill = computed<Skill | null>(() => {
  const s = activeSkill.value
  if (!s) return null
  const manifest = s.manifest
  return {
    id: props.platformId ? `${props.platformId}/${s.name}` : (manifest?.name || s.name),
    name: manifest?.name || s.name,
    description: manifest?.description || '',
    author: manifest?.author || '未知',
    tags: manifest?.tags || [],
    format: (manifest?.format as any) || 'generic',
    language: manifest?.language || 'en',
    source: 'local',
    path: s.dir,
    storeSourceId: props.platformId ? `agent:${props.platformId}` : undefined,
  }
})

const isFavorited = ref(false)
const favorites = ref<string[]>([])

onMounted(() => {
  loadSkillContentForActive()
  loadFavorites()
  checkImported()
})

watch(() => props.skill, () => {
  selectedDuplicateIndex.value = 0
  selectedDir.value = ''
  loadSkillContentForActive()
  checkImported()
})

function loadFavorites() {
  favorites.value = storage.getFavoriteIds()
}

function toggleFavorite() {
  if (!skill.value) return
  storage.toggleFavorite(skill.value.id)
  loadFavorites()
}

const getSkillDirPath = computed(() => {
  const s = activeSkill.value
  if (!s) return ''
  const dir = getSkillDir()
  return dir ? window.services.pathJoin(dir, s.name) : ''
})

function getSkillDir(): string {
  if (platform.value) {
    return (getPlatformPath(platform.value, 'global') || getPlatformPath(platform.value, 'project') || '').replace(/^~/, window.services.homeDir())
  }
  const s = activeSkill.value
  if (s?.dir) {
    const parts = s.dir.replace(/\\/g, '/').split('/')
    parts.pop()
    return parts.join('/')
  }
  return ''
}

function getSourceLabel(): string {
  if (platform.value) return platform.value?.name || '外部'
  return '项目'
}

function openLocalFolder() {
  const dir = getSkillDir()
  const s = activeSkill.value
  const name = s?.name || ''
  if (dir) window.services.openFolder(window.services.pathJoin(dir, name))
}

function uninstallSkill() {
  const s = activeSkill.value
  if (!s) return
  const targetPath = window.services.pathJoin(getSkillDir(), s.name)
  try {
    window.services.removeFile(targetPath)
    const records = storage.getInstallRecords().filter(
      (r) => r.targetPath.replace(/\\/g, '/') === targetPath.replace(/\\/g, '/')
    )
    for (const r of records) storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
    emit('navigate', props.platformId ? 'agent-skills' : 'project-skills',
      props.platformId ? { platformId: props.platformId } : undefined)
    showToast('已删除', 'success')
  } catch (err: any) {
    showToast('删除失败: ' + err.message, 'error')
  }
}

const importing = ref(false)
const confirmDelete = ref(false)
const isInMySkills = ref(false)
const isSourceFile = ref(false)

function checkImported() {
  const s = activeSkill.value
  if (!s) return
  isInMySkills.value = false
  isSourceFile.value = false

  const importId = (s.manifest?.name || s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.name
  const downloadedIds = storage.getDownloadedIds()

  if (downloadedIds.includes(importId)) {
    isInMySkills.value = true
    const cached = storage.getCachedSkills().find((s) => s.id === importId)
    if (cached && cached.source === 'local') {
      const cachedPath = normalizePath(cached.path || '')
      const skillDir = normalizePath(s.dir || '')
      if (cachedPath && skillDir && cachedPath === skillDir) {
        isSourceFile.value = true
      }
    }
    return
  }

  const skillNameStr = (s.manifest?.name || s.name || '').toLowerCase()
  const cached = storage.getCachedSkills().find((c) =>
    downloadedIds.includes(c.id) &&
    (c.name || '').toLowerCase() === skillNameStr
  )
  if (cached) {
    isInMySkills.value = true
    if (cached.source === 'local') {
      const cachedPath = normalizePath(cached.path || '')
      const skillDir = normalizePath(s.dir || '')
      if (cachedPath && skillDir && cachedPath === skillDir) {
        isSourceFile.value = true
      }
    }
  }
}

async function importToMySkills() {
  const s = activeSkill.value
  if (!s || !skill.value) return
  importing.value = true
  const importId = (s.manifest?.name || s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.name
  try {
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', importId)
    window.services.mkdir(targetDir)
    const sourceDir = getSkillDirPath.value
    if (sourceDir) window.services.copyFile(sourceDir, targetDir)
    const cached = storage.getCachedSkills()
    const existIdx = cached.findIndex((c: any) => c.id === importId)
    if (existIdx >= 0) {
      cached[existIdx] = { ...cached[existIdx], ...skill.value, id: importId, storeSourceId: (s as any)?.storeSourceId, source: 'local' }
    } else {
      cached.push({ ...skill.value, id: importId, source: 'local', storeSourceId: (s as any)?.storeSourceId })
    }
    storage.saveCachedSkills(cached)
    storage.addDownloadedId(importId)
    isInMySkills.value = true
    isSourceFile.value = true
    showToast(`已将 ${skill.value.name} 导入到我的 Skill`, 'success')
  } catch (err: any) {
    showToast(err.message, 'error')
  }
  importing.value = false
}

function handleCopy(text: string, key: string) {
  navigator.clipboard.writeText(text).catch(() => {})
  copyStatus.value[key] = true
  if (copyTimers[key]) clearTimeout(copyTimers[key])
  copyTimers[key] = setTimeout(() => { copyStatus.value[key] = false }, 2000)
}

function toggleEdit() {
  isEditing.value = true
  editedInstructions.value = skillContent.value
}

function saveContent() {
  skillContent.value = editedInstructions.value
  isEditing.value = false
}

function getActiveDir(): string {
  const s = activeSkill.value
  return s?.dir || ''
}

// Custom path dropdown
const showPathDropdown = ref(false)
const pathBtnRef = ref<HTMLButtonElement>()
const pathDropdownStyle = ref<Record<string, string>>({})

function togglePathDropdown() {
  if (showPathDropdown.value) {
    showPathDropdown.value = false
    return
  }
  const btn = pathBtnRef.value
  if (btn) {
    const rect = btn.getBoundingClientRect()
    pathDropdownStyle.value = {
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
      minWidth: `${Math.max(rect.width, 200)}px`,
    }
  }
  showPathDropdown.value = true
}

function selectPath(index: number) {
  switchDuplicate(index)
  showPathDropdown.value = false
}

</script>

<template>
  <div v-if="!skill" class="empty">未选择技能</div>
  <template v-else>
    <SkillDetailBase
      :skill="skill"
      :context="props.platformId ? 'agent' : 'project'"
      :skill-name="skillName"
      :skill-desc="skillDesc"
      :skill-content="skillContent"
      :is-favorited="isFavorited"
      :is-editing="isEditing"
      :edited-content="editedInstructions"
      :copy-status="copyStatus"
      :skill-dir="getSkillDirPath"
      v-model:active-tab="activeTab"
      @navigate="emit('navigate', $event)"
      @toggle-favorite="toggleFavorite"
      @copy-content="handleCopy"
      @toggle-edit="toggleEdit"
      @save-content="saveContent"
      @update:edited-content="editedInstructions = $event"
    >
      <template #tab-bar-actions>
        <div v-if="duplicateCount > 1" class="dup-switcher">
          <button ref="pathBtnRef" class="dup-trigger" @click="togglePathDropdown">
            <PlatformIcon :platform-id="detectedPlatformId" :size="14" />
            <span class="dup-trigger-label">{{ getDirLabel(duplicatesForDropdown[selectedDuplicateIndex], selectedDuplicateIndex) }}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      </template>
      <template #header-actions>
        <button class="action-btn" @click="openLocalFolder" title="打开文件夹">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="action-btn danger" @click="confirmDelete = true" title="删除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        <button class="action-btn close-btn" title="关闭" @click="emit('navigate', props.platformId ? 'agent-skills' : 'project-skills', props.platformId ? { platformId: props.platformId } : undefined)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </template>

      <template #context-panel>
        <div class="platform-panel">
          <div class="section-heading-row">
            <h3 class="section-heading">来源信息</h3>
            <span class="section-badge">{{ getSourceLabel() }}</span>
          </div>

          <div class="agent-source-card" :class="{ source: isSourceFile }">
            <div class="agent-source-icon">
              <PlatformIcon :platform-id="props.platformId" :size="24" />
            </div>
            <div class="agent-source-info">
              <div class="agent-source-name">{{ platform?.name || '未知' }}</div>
              <div class="agent-source-type">复制</div>
            </div>
          </div>

          <div class="project-actions">
            <button v-if="isSourceFile" class="project-action-btn imported-tag" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              源文件
            </button>
            <button v-else-if="isInMySkills" class="project-action-btn managed-tag" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              已管理
            </button>
            <button v-else class="project-action-btn primary" :disabled="importing" @click="importToMySkills">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {{ importing ? '导入中...' : '导入到我的 Skill' }}
            </button>
            <button class="project-action-btn" @click="openLocalFolder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              打开本地文件夹
            </button>
          </div>



        </div>
      </template>
    </SkillDetailBase>

    <Teleport to="body">
      <div v-if="showPathDropdown" class="dup-overlay" @click="showPathDropdown = false"></div>
      <div v-if="showPathDropdown" class="dup-dropdown" :style="pathDropdownStyle">
        <button
          v-for="(d, i) in duplicatesForDropdown"
          :key="d.dir"
          class="dup-dropdown-item"
          :class="{ active: i === selectedDuplicateIndex }"
          @click="selectPath(i)"
        >
          <PlatformIcon :platform-id="getPlatformIdFromDir(d.dir || '')" :size="16" />
          <span class="dup-dropdown-label">{{ getDirLabel(d, i) }}</span>
          <svg v-if="i === selectedDuplicateIndex" class="dup-dropdown-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </Teleport>
  </template>

  <ConfirmModal v-if="confirmDelete" title="删除 Skill" :message="`确定要删除 <strong>${activeSkill?.name}</strong> 吗？此操作不可撤销。`" @confirm="uninstallSkill" @cancel="confirmDelete = false" />
</template>

<style scoped>
.empty { text-align: center; padding: 60px; color: hsl(var(--muted-foreground)); }

.action-btn {
  display: inline-flex;
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
.action-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.action-btn.danger:hover {
  color: hsl(var(--destructive));
  border-color: hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.06);
}
.action-btn.close-btn:hover {
  color: hsl(var(--destructive));
  border-color: hsl(var(--destructive) / 0.3);
  background: hsl(var(--destructive) / 0.06);
}

.platform-panel { padding: 16px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 14px; }
.section-heading { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; }
.section-heading-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-heading-row .section-heading { margin-bottom: 0; }
.section-badge { font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

.agent-source-card { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 10px; margin-bottom: 12px; }
.agent-source-icon { width: 40px; height: 40px; border-radius: 10px; background: hsl(var(--muted)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; }
.agent-source-info { flex: 1; }
.agent-source-name { font-size: 14px; font-weight: 600; color: hsl(var(--foreground)); }
.agent-source-type { font-size: 12px; color: hsl(var(--muted-foreground)); }

.project-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; align-items: center; }
.project-action-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; font-size: 13px; font-weight: 600; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); width: 100%; }
.project-action-btn:hover { background: hsl(var(--muted)); }
.project-action-btn:disabled { opacity: 0.5; cursor: default; }
.project-action-btn.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }
.project-action-btn.primary:hover { opacity: 0.9; }
.project-action-btn.managed-tag { background: hsl(142 40% 92%); color: hsl(142 50% 35%); border-color: transparent; cursor: default; opacity: 1; }
.project-action-btn.imported-tag { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); border-color: transparent; cursor: default; opacity: 1; }

.agent-source-card.source { border-color: hsl(var(--primary) / 0.3); }
.agent-source-card.source .agent-source-name,
.agent-source-card.source .agent-source-type { display: inline-block; width: auto; background: hsl(var(--primary) / 0.08); border-radius: 4px; padding: 1px 6px; }



/* ═══ Duplicate path switcher ═══ */
.dup-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.dup-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-base) var(--ease-standard);
}
.dup-trigger:hover {
  border-color: hsl(var(--primary) / 0.4);
  background: hsl(var(--accent));
}
.dup-trigger-label {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Dropdown */
.dup-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}
.dup-dropdown {
  position: fixed;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  z-index: 100;
  padding: 4px;
}
.dup-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-quick) var(--ease-standard);
}
.dup-dropdown-item:hover {
  background: hsl(var(--accent));
}
.dup-dropdown-item.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
.dup-dropdown-check {
  margin-left: auto;
  flex-shrink: 0;
  color: hsl(var(--primary));
}

</style>
