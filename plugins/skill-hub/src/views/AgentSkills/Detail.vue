<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { defaultPlatforms, getPlatformPath } from '../../data/platforms'
import { storage } from '../../utils/storage'
import { normalizePath } from '../../utils/path'
import SkillDetailBase from '../../components/SkillDetailBase.vue'
import PlatformIcon from '../../components/PlatformIcon.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import type { SkillScanResult, PlatformInfo, Skill } from '../../types'


const props = defineProps<{ skill: SkillScanResult | null; platformId: string }>()
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

const installRecords = computed(() => {
  if (!props.skill || !props.platformId) return []
  const skillDir = normalizePath(props.skill.dir || '')
  return storage.getInstalledForPlatform(props.platformId).filter((r) =>
    normalizePath(r.targetPath) === skillDir
  )
})

const platform = computed(() => {
  if (!props.platformId) return null
  return defaultPlatforms.find((p) => p.id === props.platformId)
})

// Convert SkillScanResult to Skill type for SkillDetailBase
const skill = computed<Skill | null>(() => {
  if (!props.skill) return null
  const manifest = props.skill.manifest
  return {
    id: props.platformId ? `${props.platformId}/${props.skill.name}` : (manifest?.name || props.skill.name),
    name: manifest?.name || props.skill.name,
    description: manifest?.description || '',
    author: manifest?.author || '未知',
    tags: manifest?.tags || [],
    format: (manifest?.format as any) || 'generic',
    language: manifest?.language || 'en',
    source: 'local',
    path: props.skill.dir,
    storeSourceId: props.platformId ? `agent:${props.platformId}` : undefined,
  }
})

const isFavorited = ref(false)
const favorites = ref<string[]>([])

onMounted(() => {
  loadSkillContent()
  loadFavorites()
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

function loadSkillContent() {
  if (!props.skill) return
  skillContent.value = props.skill.content || ''
  skillDesc.value = props.skill.manifest?.description || ''
  skillName.value = props.skill.manifest?.name || props.skill.name
  editedInstructions.value = skillContent.value
}

const getSkillDirPath = computed(() => {
  if (!props.skill) return ''
  const dir = getSkillDir()
  return dir ? window.services.pathJoin(dir, props.skill.name) : ''
})

function getSkillDir(): string {
  if (platform.value) {
    return (getPlatformPath(platform.value, 'global') || getPlatformPath(platform.value, 'project') || '').replace(/^~/, window.services.homeDir())
  }
  if (props.skill?.dir) {
    const parts = props.skill.dir.replace(/\\/g, '/').split('/')
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
  const name = props.skill?.name || ''
  if (dir) window.services.openFolder(window.services.pathJoin(dir, name))
}

function uninstallSkill() {
  if (!props.skill) return
  try {
    window.services.removeFile(window.services.pathJoin(getSkillDir(), props.skill.name))
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
  if (!props.skill) return
  isInMySkills.value = false
  isSourceFile.value = false

  const importId = (props.skill.manifest?.name || props.skill.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || props.skill.name
  const downloadedIds = storage.getDownloadedIds()

  if (downloadedIds.includes(importId)) {
    isInMySkills.value = true
    const cached = storage.getCachedSkills().find((s) => s.id === importId)
    if (cached && cached.source === 'local') {
      const cachedPath = normalizePath(cached.path || '')
      const skillDir = normalizePath(props.skill.dir || '')
      if (cachedPath && skillDir && cachedPath === skillDir) {
        isSourceFile.value = true
      }
    }
    return
  }

  const skillName = (props.skill.manifest?.name || props.skill.name || '').toLowerCase()
  const cached = storage.getCachedSkills().find((s) =>
    downloadedIds.includes(s.id) &&
    (s.name || '').toLowerCase() === skillName
  )
  if (cached) {
    isInMySkills.value = true
    if (cached.source === 'local') {
      const cachedPath = normalizePath(cached.path || '')
      const skillDir = normalizePath(props.skill.dir || '')
      if (cachedPath && skillDir && cachedPath === skillDir) {
        isSourceFile.value = true
      }
    }
  }
}

async function importToMySkills() {
  if (!props.skill || !skill.value) return
  importing.value = true
  const importId = (props.skill.manifest?.name || props.skill.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || props.skill.name
  try {
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', importId)
    window.services.mkdir(targetDir)
    const sourceDir = getSkillDirPath.value
    if (sourceDir) window.services.copyFile(sourceDir, targetDir)
    const cached = storage.getCachedSkills()
    const existIdx = cached.findIndex((s: any) => s.id === importId)
    if (existIdx >= 0) {
      cached[existIdx] = { ...cached[existIdx], ...skill.value, id: importId, storeSourceId: (props.skill as any)?.storeSourceId, source: 'local' }
    } else {
      cached.push({ ...skill.value, id: importId, source: 'local', storeSourceId: (props.skill as any)?.storeSourceId })
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

</script>

<template>
  <div v-if="!skill" class="empty">未选择技能</div>
  <SkillDetailBase
    v-else
    :skill="skill"
    :context="'agent'"
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

        <div class="local-folder-card" @click="openLocalFolder">
          <div class="folder-icon">📁</div>
          <div>
            <div class="folder-title">本地路径</div>
            <div class="folder-path">{{ getSkillDir() }}\{{ props.skill?.name }}</div>
          </div>
        </div>

        <div class="debug-section" style="margin-top: 16px;" v-if="props.platformId">
          <h3 class="section-heading">安装记录</h3>
          <div class="debug-content">
            <div v-if="!installRecords.length" class="debug-empty">无安装记录</div>
            <div v-for="r in installRecords" :key="r.skillId + r.platformId" class="debug-item">
              <div><span class="debug-label">skillId:</span> {{ r.skillId }}</div>
              <div><span class="debug-label">platformId:</span> {{ r.platformId }}</div>
              <div><span class="debug-label">mode:</span> {{ r.mode }}</div>
              <div><span class="debug-label">targetPath:</span> <code>{{ r.targetPath }}</code></div>
              <div><span class="debug-label">sourceDir:</span> <code>{{ r.sourceDir }}</code></div>
              <div><span class="debug-label">installedAt:</span> {{ r.installedAt }}</div>
            </div>
          </div>
        </div>

      </div>
    </template>
  </SkillDetailBase>

  <ConfirmModal v-if="confirmDelete" title="删除 Skill" :message="`确定要删除 <strong>${props.skill?.name}</strong> 吗？此操作不可撤销。`" @confirm="uninstallSkill" @cancel="confirmDelete = false" />
</template>

<style scoped>
.empty { text-align: center; padding: 60px; color: hsl(var(--muted-foreground)); }

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
.project-action-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; font-size: 13px; font-weight: 600; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.project-action-btn:hover { background: hsl(var(--muted)); }
.project-action-btn:disabled { opacity: 0.5; cursor: default; }
.project-action-btn.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }
.project-action-btn.primary:hover { opacity: 0.9; }
.project-action-btn.managed-tag { background: hsl(142 40% 92%); color: hsl(142 50% 35%); border-color: transparent; cursor: default; opacity: 1; }
.project-action-btn.imported-tag { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); border-color: transparent; cursor: default; opacity: 1; }

.agent-source-card.source { border-color: hsl(var(--primary) / 0.3); }
.agent-source-card.source .agent-source-name,
.agent-source-card.source .agent-source-type { display: inline-block; width: auto; background: hsl(var(--primary) / 0.08); border-radius: 4px; padding: 1px 6px; }

.local-folder-card { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 10px; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.local-folder-card:hover { border-color: hsl(var(--primary)); }
.folder-icon { font-size: 18px; flex-shrink: 0; margin-top: 2px; }
.folder-title { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); margin-bottom: 4px; }
.folder-path { font-size: 11px; color: hsl(var(--muted-foreground)); font-family: monospace; word-break: break-all; }

.action-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; display: flex; align-items: center; justify-content: center; color: hsl(var(--muted-foreground)); transition: all var(--duration-base) var(--ease-standard); }
.action-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.action-btn:disabled { opacity: 0.5; cursor: default; }
.action-btn.danger:hover { color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.3); background: hsl(var(--destructive) / 0.06); }
.close-btn:hover { color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.3); background: hsl(var(--destructive) / 0.06); }

.debug-section { padding: 0; }
.debug-content { background: hsl(var(--muted) / 0.3); border-radius: 10px; padding: 12px; font-size: 11px; font-family: monospace; margin-top: 8px; overflow-x: auto; }
.debug-empty { color: hsl(var(--muted-foreground)); font-family: inherit; }
.debug-item { margin-bottom: 8px; line-height: 1.6; }
.debug-item:last-child { margin-bottom: 0; }
.debug-label { color: hsl(var(--muted-foreground)); }
.debug-item code { color: hsl(var(--primary)); word-break: break-all; background: hsl(var(--accent)); padding: 1px 4px; border-radius: 3px; }

</style>
