<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, unref } from 'vue'
import { detectPlatforms, getPlatformPath, defaultPlatforms } from '../../data/platforms'
import { storage } from '../../utils/storage'
import { useSettings } from '../../composables/useSettings'
import { getSourceInfo } from '../../utils/source-info'
import { normalizePath } from '../../utils/path'
import type { PlatformInfo, Skill, SkillScanResult } from '../../types'
import PlatformIcon from '../../components/PlatformIcon.vue'
import QuickSwitcher from '../../components/QuickSwitcher.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'

const props = defineProps<{ initialPlatformId?: string }>()
const emit = defineEmits(['navigate'])
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})
const allPlatforms = inject<import('../../types').PlatformInfo[]>('detectedPlatforms', [])
const platformSkillCounts = inject<Record<string, number>>('platformSkillCounts', {})

const detectedPlatforms = ref<PlatformInfo[]>([])
const selectedId = ref(props.initialPlatformId || '')
const platformSkills = ref<Record<string, SkillScanResult[]>>({})
const loading = ref(false)
const skillFilter = ref<string>('')
const viewMode = ref<'grid' | 'list'>('grid')
const downloadedIds = ref<string[]>(storage.getDownloadedIds())
function refreshDownloaded() { downloadedIds.value = storage.getDownloadedIds() }

function getSkillId(skill: SkillScanResult): string {
  return skill.manifest?.name || skill.name
}

function findCachedSkill(skill: any): Skill | null {
  const id = getSkillId(skill)
  if (downloadedIds.value.includes(id)) {
    const cached = storage.getCachedSkills()
    const found = cached.find((s) => s.id === id && downloadedIds.value.includes(s.id))
    if (found) return found
  }
  const dirName = (skill.dir || '').split(/[\\/]/).pop() || ''
  if (!dirName) return null
  const cached = storage.getCachedSkills()
  return cached.find((s) => {
    if (!downloadedIds.value.includes(s.id)) return false
    const cachedPathLast = (s.path || '').split('/').pop() || ''
    if (cachedPathLast && cachedPathLast === dirName) return true
    if (s.name && s.name.toLowerCase() === (skill.manifest?.name || skill.name || '').toLowerCase()) return true
    return false
  }) || null
}

function isInMySkills(skill: any): boolean {
  return findCachedSkill(skill) !== null
}

function getBadgeType(skill: any): string {
  if (!isInMySkills(skill)) return 'local'
  const cached = findCachedSkill(skill)
  if (cached && cached.source === 'local') {
    const cachedPath = normalizePath(cached.path || '')
    const skillDir = normalizePath(skill.dir || '')
    if (cachedPath && skillDir && cachedPath === skillDir) {
      return 'source'
    }
  }
  if (selectedPlatform.value) {
    const normalizedDir = normalizePath(skill.dir || '')
    const installed = storage.getInstalledForPlatform(selectedPlatform.value.id)
    const isInstalled = installed.some((r) => normalizePath(r.targetPath) === normalizedDir)
    if (!isInstalled) return 'local'
  }
  return 'managed'
}

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

const agentColors: Record<string, string> = { 'claude': '#f97316', 'codex': '#3b82f6', 'gemini': '#8b5cf6', 'opencode': '#1a1a2e', 'cherry-studio': '#ec4899', 'cursor': '#64748b', 'windsurf': '#06b6d4', 'trae': '#3b82f6', 'trae-cn': '#3b82f6', 'copilot': '#238636', 'kiro': '#f59e0b', 'cline': '#10b981', 'openclaw': '#8b5cf6', 'kilo': '#6366f1', 'hermes': '#ec4899', 'codebuddy': '#14b8a6', 'qoder': '#ef4444', 'antigravity': '#8b5cf6', 'mimo': '#ff6d00' }

const platformItems = computed(() =>
  unref(allPlatforms).map((p: any) => ({
    id: p.id,
    label: p.name,
    count: unref(platformSkillCounts)[p.id] ?? 0,
  })),
)

onMounted(() => {
  storage.cleanStaleCachedSkills()
  const allPlatforms = detectPlatforms()
  const savedConfigs = storage.getPlatformConfigs()
  const installedPlatforms = allPlatforms.filter((p) => {
    if (!p.detected) return false
    const savedConfig = savedConfigs.find((c) => c.id === p.id)
    return savedConfig ? savedConfig.enabled : p.enabled
  })
  const platformOrder = storage.getPlatformOrder()
  const orderToUse = platformOrder.length ? platformOrder : defaultPlatforms.map(p => p.id)
  const orderMap = new Map(orderToUse.map((id, idx) => [id, idx]))
  installedPlatforms.sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity))
  for (const p of installedPlatforms) {
    const dir = getPlatformPath(p, 'global') || getPlatformPath(p, 'project')
    if (dir) {
      try {
        platformSkills.value[p.id] = window.services.scanForSkillFiles([dir])
      } catch { platformSkills.value[p.id] = [] }
    }
  }
  detectedPlatforms.value = installedPlatforms
  const savedState = storage.getPageState('agent-skills')
  if (savedState?.platformId && detectedPlatforms.value.some((p) => p.id === savedState.platformId)) selectedId.value = savedState.platformId
  else if (props.initialPlatformId && detectedPlatforms.value.some((p) => p.id === props.initialPlatformId)) selectedId.value = props.initialPlatformId
  else if (detectedPlatforms.value.length) selectedId.value = detectedPlatforms.value[0].id
})

watch(() => props.initialPlatformId, (id) => { if (id && detectedPlatforms.value.some((p) => p.id === id)) selectedId.value = id })

function refreshCurrent() {
  loading.value = true
  setTimeout(() => {
    const p = detectedPlatforms.value.find((p) => p.id === selectedId.value)
    if (p) {
      const dir = getPlatformPath(p, 'global') || getPlatformPath(p, 'project')
      if (dir) {
        try {
          platformSkills.value[p.id] = window.services.scanForSkillFiles([dir])
        } catch { platformSkills.value[p.id] = [] }
      }
    }
    loading.value = false
  }, 300)
}

function selectPlatform(p: PlatformInfo) { selectedId.value = p.id; skillFilter.value = ''; storage.savePageState('agent-skills', { platformId: p.id }) }

const selectedPlatform = computed(() => detectedPlatforms.value.find((p) => p.id === selectedId.value))
const selectedSkills = computed(() => selectedId.value ? (platformSkills.value[selectedId.value] || []) : [])

const filteredSkills = computed(() => {
  const skills = selectedSkills.value
  if (!skillFilter.value) return skills
  return skills.filter((s) => {
    const t = getBadgeType(s)
    if (skillFilter.value === 'local') return t === 'local'
    if (skillFilter.value === 'managed') return t === 'managed' || t === 'source'
    return true
  })
})

const localCount = computed(() => selectedSkills.value.filter((s) => getBadgeType(s) === 'local').length)
const managedCount = computed(() => selectedSkills.value.filter((s) => getBadgeType(s) !== 'local').length)

function getBadge(skill: any): { text: string; type: string } {
  const t = getBadgeType(skill)
  const labels: Record<string, string> = { local: '本地', managed: '已管理', source: '源文件' }
  return { text: labels[t] || t, type: t }
}

function getAvatarColor(name: string): string {
  if (!name) return 'hsl(0 0% 60%)'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i)
  const h = Math.abs(hash) % 360
  return `hsl(${h} 45% 50%)`
}

function findDuplicateSkills(skill: any): any[] {
  const name = skill.manifest?.name || skill.name || ''
  if (!name) return [skill]
  const all = selectedSkills.value
  return all.filter((s: any) => (s.manifest?.name || s.name || '') === name)
}

function openSkillDetail(skill: any) {
  const duplicates = findDuplicateSkills(skill)
  emit('navigate', 'agent-skill-detail', { skill, platformId: selectedId.value, duplicateSkills: duplicates.length > 1 ? duplicates : null, context: 'agent' })
}

function openFolder(skill: any) {
  try { window.services.openFolder(skill.dir) } catch {}
}

function executeUninstallByScope() {
  const dir = uninstallScopeDir.value
  if (!dir) return
  const selected = uninstallScopeOptions.value.filter((o) => o.checked).map((o) => o.scope)
  if (!selected.length) { showToast('请选择至少一个范围', 'warning'); return }

  const records = storage.getInstallRecords().filter(
    (r) => r.targetPath.replace(/\\/g, '/') === dir.replace(/\\/g, '/')
  )
  for (const r of records) {
    const scope = r.scope || 'global'
    if (!selected.includes(scope)) continue
    storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
  }

  if (selected.includes('global')) {
    try { window.services.removeFile(dir); refreshCurrent() } catch {}
  }
  if (selected.includes('project')) {
    try { window.services.removeFile(dir) } catch {}
    refreshCurrent()
  }
  showToast('已卸载', 'success')
  uninstallScopeDir.value = null
  confirmDeleteDir.value = null
}

function uninstallSkill(skill: any) {
  const dir = skill.dir
  const allRecords = storage.getInstallRecords().filter(
    (r) => r.targetPath.replace(/\\/g, '/') === dir.replace(/\\/g, '/')
  )
  const hasGlobal = allRecords.some((r) => r.scope !== 'project')
  const hasProject = allRecords.some((r) => r.scope === 'project')

  if (hasGlobal && hasProject) {
    showUninstallScopePicker(dir, skill.manifest?.name || skill.name)
    confirmDeleteDir.value = null
    return
  }

  try { window.services.removeFile(dir); refreshCurrent() } catch {}
  for (const r of allRecords) storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
  confirmDeleteDir.value = null
}

const batchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const confirmDeleteDir = ref<string | null>(null)
const confirmDeleteSkillName = ref('')

const uninstallScopeDir = ref<string | null>(null)
const uninstallScopeSkillName = ref('')
const uninstallScopeOptions = ref<{ scope: string; label: string; checked: boolean }[]>([])
function showUninstallScopePicker(dir: string, name: string) {
  const records = storage.getInstallRecords().filter(
    (r) => r.targetPath.replace(/\\/g, '/') === dir.replace(/\\/g, '/')
  )
  const hasGlobal = records.some((r) => r.scope !== 'project')
  const hasProject = records.some((r) => r.scope === 'project')
  uninstallScopeOptions.value = []
  if (hasGlobal) uninstallScopeOptions.value.push({ scope: 'global', label: 'Agent 平台目录', checked: true })
  if (hasProject) uninstallScopeOptions.value.push({ scope: 'project', label: '项目目录', checked: true })
  uninstallScopeDir.value = dir
  uninstallScopeSkillName.value = name
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  selectedIds.value.clear()
}

function toggleSelectAll() {
  if (selectedIds.value.size === filteredSkills.value.length) {
    selectedIds.value.clear()
  } else {
    selectedIds.value = new Set(filteredSkills.value.map((s) => s.dir))
  }
}

function toggleSelect(dir: string) {
  const s = new Set(selectedIds.value)
  if (s.has(dir)) s.delete(dir)
  else s.add(dir)
  selectedIds.value = s
}

const isAllSelected = computed(() => filteredSkills.value.length > 0 && selectedIds.value.size === filteredSkills.value.length)

function batchDelete() {
  for (const dir of selectedIds.value) {
    try { window.services.removeFile(dir) } catch {}
    const records = storage.getInstallRecords().filter(
      (r) => r.targetPath.replace(/\\/g, '/') === dir.replace(/\\/g, '/')
    )
    for (const r of records) storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
  }
  refreshCurrent()
  selectedIds.value.clear()
  batchMode.value = false
}

const showImportModal = ref(false)
const importingFromMy = ref(false)
const importSearch = ref('')
const selectedImportIds = ref<Set<string>>(new Set())
const myAllSkills = ref<Skill[]>([])

const filteredMySkills = computed(() => {
  const q = importSearch.value.toLowerCase().trim()
  const skills = myAllSkills.value.filter((s) => storage.getDownloadedIds().includes(s.id))
  if (!q) return skills
  return skills.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
})

function openImportModal() {
  myAllSkills.value = storage.getCachedSkills()
  selectedImportIds.value = new Set()
  importSearch.value = ''
  refreshPlatformSkillsForImport()
  showImportModal.value = true
}

function refreshPlatformSkillsForImport() {
  if (!selectedPlatform.value) return
  const dir = getPlatformPath(selectedPlatform.value, 'global') || getPlatformPath(selectedPlatform.value, 'project')
  if (dir) {
    try {
      platformSkills.value[selectedPlatform.value.id] = window.services.scanForSkillFiles([dir])
    } catch {}
  }
}

function isAlreadyInAgent(skill: Skill): boolean {
  if (!selectedPlatform.value) return false
  const platformPath = getPlatformPath(selectedPlatform.value, 'global') || getPlatformPath(selectedPlatform.value, 'project')
  if (!platformPath) return false
  const existingSkills = platformSkills.value[selectedPlatform.value.id] || []
  return existingSkills.some((s: any) => {
    const skillName = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return s.dir.includes(skillName) || (s.manifest?.name || s.name).toLowerCase() === skill.name.toLowerCase()
  })
}

function toggleImportSelect(skill: Skill) {
  const s = new Set(selectedImportIds.value)
  if (s.has(skill.id)) s.delete(skill.id)
  else s.add(skill.id)
  selectedImportIds.value = s
}

function selectAllMySkills() {
  const selectable = filteredMySkills.value.filter((s) => !isAlreadyInAgent(s))
  if (selectedImportIds.value.size === selectable.length) {
    selectedImportIds.value = new Set()
  } else {
    selectedImportIds.value = new Set(selectable.map((s) => s.id))
  }
}

function confirmImportFromMy() {
  if (importingFromMy.value) return
  importingFromMy.value = true
  try {
    const targetPlatform = selectedPlatform.value
    if (!targetPlatform) { showToast('请先选择 Agent', 'error'); importingFromMy.value = false; return }
    const targetDir = getPlatformPath(targetPlatform, 'global') || getPlatformPath(targetPlatform, 'project')
    if (!targetDir) { showToast('未找到 Agent 路径', 'error'); importingFromMy.value = false; return }
    let importedCount = 0
    for (const skillId of selectedImportIds.value) {
      const skill = myAllSkills.value.find((s) => s.id === skillId)
      if (!skill) continue
      const skillDirName = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || skill.id
      const dest = window.services.pathJoin(targetDir, skillDirName)
      const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skillId)
      try {
        if (!window.services.pathExists(sourceDir)) continue
        window.services.mkdir(dest)
        window.services.copyFile(sourceDir, dest)
        storage.saveInstallRecord({
          skillId: skill.id,
          platformId: targetPlatform.id,
          mode: 'copy',
          scope: 'global',
          targetPath: dest,
          sourceDir,
          installedAt: new Date().toISOString(),
        })
        importedCount++
      } catch {}
    }
    if (importedCount > 0) {
      showToast(`已导入 ${importedCount} 个技能到 ${targetPlatform.name}`, 'success')
      refreshCurrent()
    }
  } catch (err: any) { showToast(err.message, 'error') }
  importingFromMy.value = false
  selectedImportIds.value = new Set()
  showImportModal.value = false
}
</script>

<template>
  <div class="agent-skills">
    <div class="page-header">
      <div class="header-left">
        <div class="header-title-row">
          <h2>Agent Skill</h2>
          <span class="count-badge">{{ selectedSkills.length }}</span>
        </div>
        <p class="page-subtitle">浏览每个 Agent 的 Skill 目录，并管理复制或软链接安装。</p>
      </div>
      <div class="header-toolbar">
        <button class="toolbar-btn import-btn" :disabled="!selectedPlatform" @click="openImportModal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          导入
        </button>
        <button class="toolbar-btn" :class="{ 'batch-active': batchMode }" :disabled="!filteredSkills.length" @click="toggleBatchMode">
          <svg v-if="!batchMode" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          批量管理
        </button>
        <div class="view-toggle">
          <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'" title="网格视图">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'" title="列表视图">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
        </div>
        <button class="toolbar-icon-btn" title="刷新" :disabled="loading" @click="refreshCurrent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
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

    <div class="as-filter-row">
      <QuickSwitcher
        :items="platformItems"
        :selected-id="selectedId"
        placeholder="搜索 Agent..."
        @select="selectPlatform(detectedPlatforms.find(p => p.id === $event)!)"
      >
        <template #trigger-prefix="{ item }">
          <PlatformIcon v-if="item" :platform-id="item.id" :size="22" />
        </template>
        <template #item-prefix="{ item }">
          <PlatformIcon :platform-id="item.id" :size="18" />
        </template>
      </QuickSwitcher>
    </div>

    <div class="filter-tabs">
      <button class="tab-btn" :class="{ active: skillFilter === '' }" @click="skillFilter = ''">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        全部
        <span class="tab-count">{{ selectedSkills.length }}</span>
      </button>
      <button class="tab-btn" :class="{ active: skillFilter === 'local' }" @click="skillFilter = skillFilter === 'local' ? '' : 'local'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        本地
        <span class="tab-count">{{ localCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: skillFilter === 'managed' }" @click="skillFilter = skillFilter === 'managed' ? '' : 'managed'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        已管理
        <span class="tab-count">{{ managedCount }}</span>
      </button>

    </div>

    <div v-if="batchMode" class="batch-bar">
      <div class="batch-left">
        <span class="batch-label">批量模式</span>
        <span class="batch-count">已选 {{ selectedIds.size }} 项</span>
      </div>
      <div class="batch-actions">
        <button class="batch-action-btn" @click="toggleSelectAll">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" :fill="isAllSelected ? 'currentColor' : 'none'"/>
            <polyline v-if="isAllSelected" points="9 11 12 14 22 4"/>
          </svg>
          全选
        </button>
        <button class="batch-action-btn danger" :disabled="selectedIds.size === 0" @click="batchDelete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
          删除
        </button>
      </div>
    </div>

    <template v-if="selectedPlatform">
      <div class="as-scroll">
        <div v-if="loading" class="loading">扫描中...</div>
        <div v-else-if="!filteredSkills.length" class="empty-state">未找到技能</div>
        <div v-else class="skill-grid" :class="viewMode">
          <div
            v-for="s in filteredSkills"
            :key="s.dir"
            class="skill-card"
            :class="{ selected: selectedIds.has(s.dir) }"
            @click="batchMode ? toggleSelect(s.dir) : openSkillDetail(s)"
          >
            <div v-if="batchMode" class="card-checkbox" @click.stop="toggleSelect(s.dir)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" :fill="selectedIds.has(s.dir) ? 'currentColor' : 'none'"/>
                <polyline v-if="selectedIds.has(s.dir)" points="9 11 12 14 22 4"/>
              </svg>
            </div>
            <div class="card-top-row">
              <div class="card-avatar" :style="{ background: getAvatarColor(s.manifest?.name || s.name) }">{{ (s.manifest?.name || s.name || '?').charAt(0).toUpperCase() }}</div>
              <div class="card-top-right">
                <div class="card-badges-row">
                  <span v-if="s.isSymlink" class="badge symlink">软链接</span>
                  <span class="badge" :class="getBadge(s).type">{{ getBadge(s).text }}</span>
                </div>
                <div v-if="!batchMode" class="card-actions">
                  <button class="card-action-btn" title="打开文件夹" @click.stop="openFolder(s)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  </button>
                  <button class="card-action-btn danger" title="删除" @click.stop="confirmDeleteDir = s.dir; confirmDeleteSkillName = s.manifest?.name || s.name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <h3 class="card-name">{{ s.manifest?.name || s.name }}</h3>
            <p class="card-desc">{{ s.manifest?.description || '暂无描述' }}</p>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty-right">选择 Agent 查看技能</div>

    <!-- Import from My Skills modal -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">从我的 Skill 导入</h3>
          <button class="modal-close" @click="showImportModal = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <p class="modal-desc">选择要导入到 <strong>{{ selectedPlatform?.name }}</strong> 的技能</p>

        <div class="modal-toolbar">
          <input v-model="importSearch" type="text" placeholder="搜索技能..." class="modal-search" />
          <button class="modal-select-all" @click="selectAllMySkills">
            {{ selectedImportIds.size === filteredMySkills.filter(s => !isAlreadyInAgent(s)).length ? '取消全选' : '全选' }}
          </button>
        </div>

        <div class="modal-skill-list">
          <div v-if="!filteredMySkills.length" class="modal-empty">
            <p>暂无已下载的技能</p>
          </div>
          <div v-else class="modal-skill-grid">
            <div
              v-for="skill in filteredMySkills"
              :key="skill.id"
              class="modal-skill-card"
              :class="{ selected: selectedImportIds.has(skill.id), disabled: isAlreadyInAgent(skill) }"
              @click="!isAlreadyInAgent(skill) && toggleImportSelect(skill)"
            >
              <div class="modal-skill-top">
                <div class="modal-skill-avatar" :style="{ background: getAvatarColor(skill.name) }">{{ skill.name.charAt(0).toUpperCase() }}</div>
                <div class="modal-skill-check" :class="{ checked: selectedImportIds.has(skill.id) }">
                  <svg v-if="selectedImportIds.has(skill.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
              <div class="modal-skill-info">
                <div class="modal-skill-name">{{ skill.name }}</div>
                <div class="modal-skill-desc">{{ skill.description || '暂无描述' }}</div>
                <span v-if="isAlreadyInAgent(skill)" class="badge-already">已在 Agent 中</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="modal-btn cancel" @click="showImportModal = false">取消</button>
          <button class="modal-btn confirm" :disabled="!selectedImportIds.size || importingFromMy" @click="confirmImportFromMy">
            <svg v-if="importingFromMy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ importingFromMy ? '导入中...' : `导入 ${selectedImportIds.size} 个技能` }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmModal v-if="confirmDeleteDir" title="删除 Skill" :message="`确定要删除 <strong>${confirmDeleteSkillName}</strong> 吗？此操作不可撤销。`" @confirm="uninstallSkill({ dir: confirmDeleteDir, manifest: { name: confirmDeleteSkillName } })" @cancel="confirmDeleteDir = null" />

    <div v-if="uninstallScopeDir" class="confirm-overlay" @click.self="uninstallScopeDir = null">
      <div class="confirm-modal">
        <div class="confirm-header">
          <div class="confirm-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </div>
          <h3 class="confirm-title">卸载 Skill</h3>
          <button class="confirm-close" @click="uninstallScopeDir = null">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="confirm-body">
          <p class="confirm-desc"><strong>{{ uninstallScopeSkillName }}</strong> 同时存在于以下位置，请选择要卸载的范围：</p>
          <div class="scope-list">
            <label v-for="opt in uninstallScopeOptions" :key="opt.scope" class="scope-item" :class="{ checked: opt.checked }">
              <input type="checkbox" v-model="opt.checked" class="scope-checkbox" />
              <span class="scope-label">{{ opt.label }}</span>
            </label>
          </div>
        </div>
        <div class="confirm-footer">
          <button class="confirm-btn cancel" @click="uninstallScopeDir = null">取消</button>
          <button class="confirm-btn delete" @click="executeUninstallByScope">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            确认卸载
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-skills { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; }

.as-filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px 0;
  flex-wrap: wrap;
}

.as-filter-row .quick-switcher {
  width: 240px;
  flex-shrink: 0;
}

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

.count-badge {
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--accent));
  padding: 2px 8px;
  border-radius: 10px;
}

.header-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: hsl(var(--accent));
  border-color: hsl(var(--primary) / 0.3);
}

.toolbar-btn.batch-active {
  background: hsl(var(--destructive) / 0.08);
  border-color: hsl(var(--destructive) / 0.3);
  color: hsl(var(--destructive));
}

.toolbar-btn.batch-active:hover {
  background: hsl(var(--destructive) / 0.15);
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}

.toolbar-btn.import-btn {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}
.toolbar-btn.import-btn:hover {
  background: hsl(var(--primary) / 0.85);
  border-color: hsl(var(--primary) / 0.85);
}
.toolbar-btn.import-btn:disabled {
  opacity: 0.5;
  cursor: default;
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

.toolbar-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.view-toggle {
  display: flex;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  overflow: hidden;
}

.view-toggle button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.view-toggle button + button {
  border-left: 1px solid hsl(var(--border));
}

.view-toggle button:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.view-toggle button.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.filter-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 12px 28px 0;
  flex-wrap: wrap;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  white-space: nowrap;
}

.tab-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.tab-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 600;
}

.tab-count {
  font-size: 11px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.6);
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
}

.tab-btn.active .tab-count {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 28px;
  margin: 12px 28px 0;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
}

.batch-left { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.batch-label { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.batch-count { font-size: 12px; color: hsl(var(--muted-foreground)); }
.batch-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.batch-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  white-space: nowrap;
}

.batch-action-btn svg { color: hsl(var(--muted-foreground)); flex-shrink: 0; }

.batch-action-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
  border-color: hsl(var(--primary) / 0.3);
  color: hsl(var(--foreground));
}

.batch-action-btn:hover:not(:disabled) svg { color: hsl(var(--primary)); }

.batch-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.batch-action-btn.danger {
  color: hsl(var(--destructive));
  border-color: hsl(var(--destructive) / 0.25);
  background: hsl(var(--destructive) / 0.04);
}

.batch-action-btn.danger svg { color: hsl(var(--destructive)); }

.batch-action-btn.danger:hover:not(:disabled) {
  background: hsl(var(--destructive) / 0.1);
  border-color: hsl(var(--destructive) / 0.4);
}

.as-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 20px 28px 28px; scrollbar-gutter: stable; }

.skill-grid { display: grid; }
.skill-grid.grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.skill-grid.list { grid-template-columns: 1fr; gap: 10px; }

.skill-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  position: relative;
}

.skill-card:hover {
  border-color: hsl(var(--primary) / 0.4);
  box-shadow: var(--shadow-sm);
}

.skill-card.selected { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.03); }

.card-checkbox {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: hsl(var(--card));
  border: 1.5px solid hsl(var(--border));
  color: hsl(var(--primary));
  transition: all var(--duration-base) var(--ease-standard);
  z-index: 2;
}

.card-checkbox:hover { border-color: hsl(var(--primary) / 0.5); }

.skill-card.selected .card-checkbox { border-color: hsl(var(--primary)); }

.card-top-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.card-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.card-top-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.badge { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.badge.local { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.badge.managed { background: hsl(142 40% 92%); color: hsl(142 50% 35%); }
.badge.source { background: hsl(var(--primary) / 0.12); color: hsl(var(--primary)); }
.badge.symlink { background: hsl(200 60% 90%); color: hsl(200 70% 30%); }

.card-badges-row { display: flex; flex-direction: row; align-items: center; gap: 4px; }

.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-standard);
}

.skill-card:hover .card-actions { opacity: 1; }

.card-action-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-base) var(--ease-standard);
}

.card-action-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.card-action-btn.danger:hover { background: hsl(var(--destructive) / 0.1); color: hsl(var(--destructive)); }

.card-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--duration-base) var(--ease-standard);
}

.skill-card:hover .card-name { color: hsl(var(--primary)); }

.card-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.loading, .empty-state, .empty-right {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.modal { width: 560px; max-width: 90vw; max-height: 80vh; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.modal-title { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); margin: 0; }
.modal-close { width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--duration-base) var(--ease-standard); }
.modal-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.modal-desc { font-size: 13px; color: hsl(var(--muted-foreground)); padding: 8px 24px 0; margin: 0; }
.modal-desc strong { color: hsl(var(--foreground)); }
.modal-toolbar { display: flex; align-items: center; gap: 8px; padding: 16px 24px 0; }
.modal-search { flex: 1; padding: 9px 14px; font-size: 13px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--card)); color: hsl(var(--foreground)); outline: none; transition: all var(--duration-base) var(--ease-standard); }
.modal-search:focus { border-color: hsl(var(--ring)); box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12); }
.modal-search::placeholder { color: hsl(var(--muted-foreground)); }
.modal-select-all { padding: 8px 14px; font-size: 12px; font-weight: 600; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer; white-space: nowrap; transition: all var(--duration-base) var(--ease-standard); }
.modal-select-all:hover { background: hsl(var(--muted)); }
.modal-skill-list { flex: 1; overflow-y: auto; padding: 12px 24px; min-height: 200px; }
.modal-empty { display: flex; align-items: center; justify-content: center; height: 120px; color: hsl(var(--muted-foreground)); font-size: 13px; }
.modal-skill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.modal-skill-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.modal-skill-card:hover:not(.disabled) { border-color: hsl(var(--primary) / 0.4); background: hsl(var(--primary) / 0.03); }
.modal-skill-card.selected { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.06); }
.modal-skill-card.disabled { opacity: 0.5; cursor: default; }
.modal-skill-top { display: flex; align-items: center; justify-content: space-between; }
.modal-skill-avatar { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; }
.modal-skill-check { width: 20px; height: 20px; border-radius: 6px; border: 2px solid hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.modal-skill-check.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: #fff; }
.modal-skill-info { min-width: 0; }
.modal-skill-name { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-skill-desc { font-size: 11px; color: hsl(var(--muted-foreground)); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge-already { display: inline-block; margin-top: 4px; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid hsl(var(--border)); }
.modal-btn { padding: 9px 20px; font-size: 13px; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); display: flex; align-items: center; gap: 6px; }
.modal-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.modal-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.modal-btn.confirm { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.modal-btn.confirm:hover { opacity: 0.9; }
.modal-btn.confirm:disabled { opacity: 0.5; cursor: default; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }

.confirm-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.confirm-modal { width: 420px; max-width: 90vw; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); }
.confirm-header { display: flex; align-items: center; gap: 10px; padding: 18px 20px; border-bottom: 1px solid hsl(var(--border)); }
.confirm-icon { width: 32px; height: 32px; border-radius: 8px; background: hsl(var(--destructive) / 0.1); color: hsl(var(--destructive)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.confirm-title { font-size: 15px; font-weight: 600; color: hsl(var(--foreground)); margin: 0; flex: 1; }
.confirm-close { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.confirm-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.confirm-body { padding: 18px 20px; }
.confirm-desc { font-size: 13px; line-height: 1.6; color: hsl(var(--muted-foreground)); margin: 0 0 14px; }
.confirm-desc strong { color: hsl(var(--foreground)); font-weight: 600; }
.scope-list { display: flex; flex-direction: column; gap: 6px; }
.scope-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; }
.scope-item.checked { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.06); }
.scope-checkbox { accent-color: hsl(var(--primary)); }
.scope-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); }
.confirm-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid hsl(var(--border)); }
.confirm-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; cursor: pointer; }
.confirm-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.confirm-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.confirm-btn.delete { background: hsl(var(--destructive)); color: #fff; }
.confirm-btn.delete:hover { opacity: 0.9; }
</style>
