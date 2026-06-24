<script setup lang="ts">
import { inject, ref, computed, unref } from 'vue'
import { storage } from '../../utils/storage'
import { useSettings } from '../../composables/useSettings'
import { useProjectState } from '../../composables/useProjectState'
import { normalizePath } from '../../utils/path'
import type { Skill, SkillScanResult, PlatformInfo } from '../../types'
import { getPlatformPath } from '../../data/platforms'
import DeployModal from '../../components/DeployModal.vue'
import QuickSwitcher from '../../components/QuickSwitcher.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import { loadRegistry, registerSkillFromProject, removeFromRegistry } from '../../utils/skill-registry'
import { getAvatarColor } from '../../utils/color'

const emit = defineEmits(['navigate', 'edit-project', 'delete-project'])

const selectedProject = inject<any>('selectedProject', null)
const scanProject = inject<any>('scanProject', () => {})
const projectScanning = inject<any>('projectScanning', false)
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})
const { registeredProjects } = useProjectState()
const selectProject = inject<(p: import('../../types').RegisteredProject) => void>('selectProject', () => {})
const openAddProjectModal = inject<() => void>('openAddProjectModal', () => {})
const detectedPlatforms = inject<PlatformInfo[]>('detectedPlatforms', [])

const importing = ref<Record<string, boolean>>({})
const removing = ref<Record<string, boolean>>({})
const confirmDeleteSkillDir = ref<string | null>(null)
const confirmDeleteSkillName = ref('')
const confirmDeleteProjectId = ref<string | null>(null)
const confirmDeleteProjectName = ref('')

const downloadedIds = ref<string[]>(storage.getDownloadedIds())

function refreshDownloaded() { downloadedIds.value = storage.getDownloadedIds() }

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

const skillFilter = ref<string>('')
const viewMode = ref<'grid' | 'list'>('grid')

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
    return 'local'
  }
  return 'managed'
}

function getBadge(skill: any): { text: string; type: string } {
  const t = getBadgeType(skill)
  const labels: Record<string, string> = { local: '本地', managed: '已管理', source: '源文件' }
  return { text: labels[t] || t, type: t }
}

const projectItems = computed(() =>
  unref(registeredProjects).map((p: any) => ({
    id: p.id,
    label: p.name,
    count: p.skills?.length || 0,
  })),
)

function getSkillId(skill: any): string {
  return skill.manifest?.name || skill.name
}

function getMatchedLibrarySkill(skill: any): any | null {
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

function skillToSkill(skill: SkillScanResult): any {
  const matched = getMatchedLibrarySkill(skill)
  if (matched) {
    return {
      ...matched,
      skillDir: skill.dir || '',
      readme: skill.content || matched.readme || '',
    }
  }
  return {
    id: skill.manifest?.name || skill.name,
    name: skill.manifest?.name || skill.name,
    description: skill.manifest?.description || '',
    author: skill.manifest?.author || '',
    tags: skill.manifest?.tags || [],
    format: skill.manifest?.format || 'opencode',
    source: 'local',
    readme: skill.content || '',
    skillDir: skill.dir || '',
  }
}

function viewDetail(skill: SkillScanResult) {
  emit('navigate', 'agent-skill-detail', { skill, platformId: '' })
}

async function importSkill(skill: SkillScanResult) {
  const id = getSkillId(skill)
  importing.value[id] = true
  try {
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', id)
    window.services.mkdir(targetDir)
    window.services.copyFile(skill.dir, targetDir)
    try {
      const cached = storage.getCachedSkills()
      if (!cached.some((s) => s.id === id)) {
        const manifest = skill.manifest || { name: id, description: '', author: '', tags: [], format: 'opencode', language: 'en' }
        cached.push({
          id, name: manifest.name || id, description: manifest.description || '',
          author: manifest.author || '',
          tags: manifest.tags || [], format: (manifest.format as any) || 'opencode',
          source: 'local',
          path: skill.dir || '',
        })
        storage.saveCachedSkills(cached)
      }
    } catch {}
    storage.addDownloadedId(id)
    const registry = loadRegistry()
    registerSkillFromProject(registry, skill, selectedProject.value?.id || '')
    refreshDownloaded()
  } catch (err: any) {
    showToast(err?.message || `导入「${skill.manifest?.name || skill.name}」失败`, 'error')
  }
  importing.value[id] = false
}

async function removeSkill(skill: SkillScanResult) {
  const id = getSkillId(skill)
  removing.value[id] = true
  try {
    if (storage.getDownloadedIds().includes(id)) {
      storage.removeDownloadedId(id)
      storage.removeAllForSkill(id)
      storage.removeSkillFromCache(id)
      const registry = loadRegistry()
      removeFromRegistry(registry, skill.manifest.name || skill.name)
      const dir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', id)
      try { window.services.removeFile(dir) } catch {}
    }
    if (selectedProject.value) {
      selectedProject.value.skills = selectedProject.value.skills.filter(
        (s: SkillScanResult) => s.dir !== skill.dir
      )
      storage.updateRegisteredProject(selectedProject.value.id, {
        skills: selectedProject.value.skills,
      })
    }
    const projectInstalls = storage.getInstallRecords().filter(
      (r) => r.targetPath.replace(/\\/g, '/') === skill.dir.replace(/\\/g, '/') && r.scope === 'project'
    )
    for (const r of projectInstalls) {
      storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
    }
    refreshDownloaded()
    confirmDeleteSkillDir.value = null
  } catch (err: any) { }
  removing.value[id] = false
}

function openFolder(skill: any) {
  window.services.openFolder(skill.dir || skill.skillFile)
}

function doDeleteProject() {
  const pid = confirmDeleteProjectId.value
  confirmDeleteProjectId.value = null
  if (pid) emit('delete-project', pid)
}

function openProjectFolder() {
  if (selectedProject.value?.rootDir) {
    window.services.openFolder(selectedProject.value.rootDir)
  }
}



function openImportModal() {
  showImportModal.value = true
}

// === Batch mode ===
const batchMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  selectedIds.value.clear()
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  const list = filteredProjectSkills.value
  if (selectedIds.value.size === list.length) {
    selectedIds.value.clear()
  } else {
    selectedIds.value = new Set(list.map((s: any) => s.dir))
  }
}

const isAllSelected = computed(() => {
  const list = filteredProjectSkills.value
  return list.length > 0 && selectedIds.value.size === list.length
})

async function batchImportToMySkills() {
  let successCount = 0
  let failCount = 0
  for (const dir of selectedIds.value) {
    const skill = filteredProjectSkills.value.find((s: any) => s.dir === dir)
    if (!skill || isInMySkills(skill)) continue
    const id = getSkillId(skill)
    try {
      const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', id)
      window.services.mkdir(targetDir)
      window.services.copyFile(skill.dir, targetDir)
      const cached = storage.getCachedSkills()
      if (!cached.some((s) => s.id === id)) {
        cached.push({ id, name: skill.manifest?.name || id, description: skill.manifest?.description || '', author: '', tags: [], format: 'opencode', source: 'local' })
        storage.saveCachedSkills(cached)
      }
      storage.addDownloadedId(id)
      successCount++
    } catch { failCount++ }
  }
  refreshDownloaded()
  selectedIds.value.clear()
  if (failCount > 0) {
    showToast(`导入完成：${successCount} 成功，${failCount} 失败`, 'warning')
  } else if (successCount > 0) {
    showToast(`已导入 ${successCount} 个技能`, 'success')
  }
}

function batchRemoveFromLibrary() {
  const registry = loadRegistry()
  const removedDirs = new Set<string>()
  for (const dir of selectedIds.value) {
    const skill = filteredProjectSkills.value.find((s: any) => s.dir === dir)
    if (!skill) continue
    const id = getSkillId(skill)
    if (storage.getDownloadedIds().includes(id)) {
      storage.removeDownloadedId(id)
      storage.removeAllForSkill(id)
      storage.removeSkillFromCache(id)
      removeFromRegistry(registry, skill.manifest.name || skill.name)
      const libDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', id)
      try { window.services.removeFile(libDir) } catch {}
    }
    const projectInstalls = storage.getInstallRecords().filter(
      (r) => r.targetPath.replace(/\\/g, '/') === dir.replace(/\\/g, '/') && r.scope === 'project'
    )
    for (const r of projectInstalls) {
      storage.removeInstallRecord(r.skillId, r.platformId, r.scope)
    }
    removedDirs.add(dir)
  }
  if (selectedProject.value && removedDirs.size > 0) {
    selectedProject.value.skills = selectedProject.value.skills.filter(
      (s: SkillScanResult) => !removedDirs.has(s.dir)
    )
    storage.updateRegisteredProject(selectedProject.value.id, {
      skills: selectedProject.value.skills,
    })
  }
  refreshDownloaded()
  selectedIds.value.clear()
}

const allProjectSkills = computed(() => selectedProject.value?.skills || [])

const localCount = computed(() => allProjectSkills.value.filter((s: any) => getBadgeType(s) === 'local').length)
const managedCount = computed(() => allProjectSkills.value.filter((s: any) => getBadgeType(s) === 'managed').length)
const sourceCount = computed(() => allProjectSkills.value.filter((s: any) => getBadgeType(s) === 'source').length)

const filteredProjectSkills = computed(() => {
  const skills = allProjectSkills.value
  if (!skillFilter.value) return skills
  return skills.filter((s: any) => getBadgeType(s) === skillFilter.value)
})

// === Deploy modal ===
const showDeployModal = ref(false)
const deploySkill = ref<Skill | null>(null)

function openDeploy(skill: SkillScanResult) {
  deploySkill.value = skillToSkill(skill)
  showDeployModal.value = true
}

function onDeployed() {
  showDeployModal.value = false
  deploySkill.value = null
  scanProject(selectedProject.value)
}

// === Import from My Skills modal ===
const showImportModal = ref(false)
const showAdvanced = ref(false)
const importMode = ref<'copy' | 'symlink'>(settings.defaultInstallMode === 'symlink' ? 'symlink' : 'copy')
const importSearch = ref('')
const selectedImportIds = ref<Set<string>>(new Set())
const importingFromMy = ref(false)
const importTargetDirs = ref<string[]>(['.agents/skills'])

const availableProjectDirs = computed(() => {
  const dirs = [{ path: '.agents/skills', label: '.agents/skills（通用）', agentName: '' }]
  const platforms = unref(detectedPlatforms)
  for (const p of platforms) {
    if (!p.enabled || !p.detected) continue
    const projectDir = getPlatformPath(p, 'project')
    if (projectDir && projectDir !== '.agents/skills' && !dirs.some(d => d.path === projectDir)) {
      dirs.push({ path: projectDir, label: projectDir, agentName: p.name })
    }
  }
  return dirs
})

const mySkills = computed(() => {
  const cached = storage.getCachedSkills()
  const downloaded = storage.getDownloadedIds()
  return cached.filter((s) => downloaded.includes(s.id))
})

const filteredMySkills = computed(() => {
  const q = importSearch.value.toLowerCase()
  if (!q) return mySkills.value
  return mySkills.value.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
})

const projectSkillNames = computed(() => {
  if (!selectedProject.value?.skills) return new Set<string>()
  return new Set(selectedProject.value.skills.map((s: SkillScanResult) => (s.manifest?.name || s.name).toLowerCase()))
})

function isAlreadyInProject(skill: Skill): boolean {
  return projectSkillNames.value.has(skill.name.toLowerCase())
}

function toggleImportSelect(skill: Skill) {
  if (selectedImportIds.value.has(skill.id)) {
    selectedImportIds.value.delete(skill.id)
  } else {
    selectedImportIds.value.add(skill.id)
  }
  selectedImportIds.value = new Set(selectedImportIds.value)
}

function selectAllMySkills() {
  const available = filteredMySkills.value.filter((s) => !isAlreadyInProject(s))
  if (selectedImportIds.value.size === available.length) {
    selectedImportIds.value = new Set()
  } else {
    selectedImportIds.value = new Set(available.map((s) => s.id))
  }
}

async function confirmImportFromMy() {
  if (!selectedProject.value || !selectedImportIds.value.size || !importTargetDirs.value.length) return
  importingFromMy.value = true
  let importedCount = 0
  try {
    for (const skillId of selectedImportIds.value) {
      const skill = mySkills.value.find((s) => s.id === skillId)
      if (!skill) continue
      const skillDirName = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || skill.id
      const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skillId)
      if (!window.services.pathExists(sourceDir)) continue
      for (const targetRel of importTargetDirs.value) {
        const targetDir = window.services.pathJoin(selectedProject.value.rootDir, targetRel, skillDirName)
        try {
          if (importMode.value === 'symlink') {
            window.services.createSymlink(sourceDir, targetDir)
          } else {
            window.services.mkdir(targetDir)
            window.services.copyFile(sourceDir, targetDir)
          }
          storage.saveInstallRecord({
            skillId: skill.id,
            platformId: selectedProject.value.id,
            mode: importMode.value,
            scope: 'project',
            targetPath: targetDir,
            sourceDir,
            installedAt: new Date().toISOString(),
          })
          importedCount++
        } catch (err: any) {
              showToast(`导入「${skill.name}」到 ${targetRel} 失败：${err?.message || '未知错误'}`, 'error')
            }
      }
    }
    if (importedCount > 0) {
      showToast(`已导入 ${importedCount} 个技能到项目`, 'success')
      scanProject(selectedProject.value)
    }
  } catch (err: any) { showToast(err.message, 'error') }
  importingFromMy.value = false
  selectedImportIds.value = new Set()
  importTargetDirs.value = ['.agents/skills']
  showImportModal.value = false
}
</script>

<template>
  <div class="project-skills">
    <div class="page-header">
      <div class="header-left">
        <div class="header-title-row">
          <h2>项目 Skill</h2>
          <span class="count-badge">{{ allProjectSkills.length }}</span>
        </div>
        <p class="page-subtitle">登记项目 Skill 目录并管理其中的本地 Skill。</p>
      </div>
      <div class="header-toolbar-wrapper">
        <div class="header-toolbar">
          <button class="toolbar-btn import-btn" @click="showImportModal = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导入
          </button>
          <button class="toolbar-btn" :class="{ 'batch-active': batchMode }" @click="toggleBatchMode">
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
          <button class="toolbar-icon-btn" title="刷新" :disabled="!selectedProject || projectScanning" @click="selectedProject && scanProject(selectedProject)">
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
        <div class="add-project-bar">
          <button class="toolbar-btn add-project-btn" @click="openAddProjectModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            添加项目
          </button>
        </div>
      </div>
    </div>

    <div class="ps-filter-row">
      <QuickSwitcher
        :items="projectItems"
        :selected-id="selectedProject?.id || null"
        placeholder="搜索项目..."
        add-label="添加项目"
        :show-add="true"
        @select="selectProject(registeredProjects.find(p => p.id === $event)!)"
        @add="openAddProjectModal()"
      >
        <template #item-prefix="{ item }">
          <span class="qs-item-avatar" :style="{ background: getAvatarColor(registeredProjects.find(p => p.id === item.id)?.name || item.label) }">{{ (registeredProjects.find(p => p.id === item.id)?.name || item.label).charAt(0).toUpperCase() }}</span>
        </template>
      </QuickSwitcher>
      <div class="ps-filter-actions">
        <button class="toolbar-icon-btn" title="打开项目文件夹" :disabled="!selectedProject" @click="openProjectFolder()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="toolbar-icon-btn" title="编辑项目" :disabled="!selectedProject" @click="selectedProject && emit('edit-project', selectedProject)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="toolbar-icon-btn danger" title="删除项目" :disabled="!selectedProject" @click="selectedProject && (confirmDeleteProjectId = selectedProject.id, confirmDeleteProjectName = selectedProject.name)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <div v-if="allProjectSkills.length" class="filter-tabs">
      <button class="tab-btn" :class="{ active: skillFilter === '' }" @click="skillFilter = ''">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        全部
        <span class="tab-count">{{ allProjectSkills.length }}</span>
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
      <button class="tab-btn" :class="{ active: skillFilter === 'source' }" @click="skillFilter = skillFilter === 'source' ? '' : 'source'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        源文件
        <span class="tab-count">{{ sourceCount }}</span>
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
        <button class="batch-action-btn primary" :disabled="selectedIds.size === 0" @click="batchImportToMySkills">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          导入到我的 Skill
        </button>
        <button class="batch-action-btn danger" :disabled="selectedIds.size === 0" @click="batchRemoveFromLibrary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
          移除
        </button>
      </div>
    </div>

    <template v-if="selectedProject">
      <div class="ps-scroll">
        <div v-if="!filteredProjectSkills.length" class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <h3 class="empty-title">{{ skillFilter ? '没有匹配的 Skill' : '暂无 Skill' }}</h3>
          <p class="empty-desc">{{ skillFilter ? '尝试切换筛选条件。' : '该项目中未扫描到 SKILL.md 文件。点击重新扫描或检查项目目录结构。' }}</p>
        </div>
        <div v-else class="skill-grid" :class="viewMode">
          <div
            v-for="skill in filteredProjectSkills"
            :key="skill.dir"
            class="skill-card"
            :class="{ selected: selectedIds.has(skill.dir) }"
            @click="batchMode ? toggleSelect(skill.dir) : viewDetail(skill)"
          >
            <div v-if="batchMode" class="card-checkbox" @click.stop="toggleSelect(skill.dir)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" :fill="selectedIds.has(skill.dir) ? 'currentColor' : 'none'"/>
                <polyline v-if="selectedIds.has(skill.dir)" points="9 11 12 14 22 4"/>
              </svg>
            </div>
            <div class="card-top-row">
              <div class="card-avatar" :style="{ background: getAvatarColor(skill.name) }">{{ skill.name.charAt(0).toUpperCase() }}</div>
              <div class="card-top-right">
                <div class="card-badges-row">
                  <span v-if="skill.isSymlink" class="badge symlink">软链接</span>
                  <span class="badge" :class="getBadge(skill).type">{{ getBadge(skill).text }}</span>
                </div>
                <div v-if="!batchMode" class="card-actions">
                  <button class="card-action-btn" title="打开文件夹" @click.stop="openFolder(skill)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  </button>
                  <button
                    v-if="isInMySkills(skill)"
                    class="card-action-btn primary"
                    title="分发到平台"
                    @click.stop="openDeploy(skill)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                  <button
                    v-else
                    class="card-action-btn primary"
                    :disabled="importing[getSkillId(skill)]"
                    @click.stop="importSkill(skill)"
                    title="导入到我的 Skill"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                  <button class="card-action-btn danger" :disabled="removing[getSkillId(skill)]" @click.stop="confirmDeleteSkillDir = skill.dir; confirmDeleteSkillName = skill.manifest?.name || skill.name" title="移除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <h3 class="card-name">{{ skill.manifest?.name || skill.name }}</h3>
            <p class="card-desc">{{ skill.manifest?.description || '暂无描述' }}</p>
            <div v-if="skill.manifest?.tags?.length" class="card-tags">
              <span v-for="tag in skill.manifest.tags.slice(0, 5)" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state center">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3 class="empty-title">还没有项目</h3>
      <p class="empty-desc">添加项目根目录后，即可扫描并管理项目内的本地 Skill。</p>
      <button class="empty-add-btn" @click="openAddProjectModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        添加项目
      </button>
    </div>

    <!-- Import from My Skills modal -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">从我的 Skill 导入</h3>
          <button class="modal-close" @click="showImportModal = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-desc">选择要导入到项目 <strong>{{ selectedProject?.name }}</strong> 的技能</p>

          <div class="modal-advanced-toggle" @click="showAdvanced = !showAdvanced">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: showAdvanced }"><polyline points="9 18 15 12 9 6"/></svg>
            高级
          </div>

          <div v-if="showAdvanced" class="modal-advanced-body">
            <div class="import-targets">
              <label class="import-targets-label">导入到：</label>
              <div class="import-target-options">
                <label v-for="dir in availableProjectDirs" :key="dir.path" class="import-target-option">
                  <input type="checkbox" :value="dir.path" v-model="importTargetDirs" />
                  <span class="import-target-path">{{ dir.label }}</span>
                  <span v-if="dir.agentName" class="import-target-agent">{{ dir.agentName }}</span>
                </label>
              </div>
            </div>

            <div class="import-mode">
              <label class="import-mode-label">导入方式：</label>
              <div class="import-mode-options">
                <label class="import-mode-option" :class="{ active: importMode === 'copy' }">
                  <input type="radio" value="copy" v-model="importMode" />
                  <span>复制</span>
                </label>
                <label class="import-mode-option" :class="{ active: importMode === 'symlink' }">
                  <input type="radio" value="symlink" v-model="importMode" />
                  <span>软链接</span>
                </label>
              </div>
            </div>
          </div>

          <div class="modal-toolbar">
            <input v-model="importSearch" type="text" placeholder="搜索技能..." class="modal-search" />
            <button class="modal-select-all" @click="selectAllMySkills">
              {{ selectedImportIds.size === filteredMySkills.filter(s => !isAlreadyInProject(s)).length ? '取消全选' : '全选' }}
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
                :class="{ selected: selectedImportIds.has(skill.id), disabled: isAlreadyInProject(skill) }"
                @click="!isAlreadyInProject(skill) && toggleImportSelect(skill)"
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
                  <span v-if="isAlreadyInProject(skill)" class="badge-already">已在项目中</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="modal-btn cancel" @click="showImportModal = false">取消</button>
          <button class="modal-btn confirm" :disabled="!selectedImportIds.size || !importTargetDirs.length || importingFromMy" @click="confirmImportFromMy">
            <svg v-if="importingFromMy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ importingFromMy ? '导入中...' : `导入 ${selectedImportIds.size} 个技能` }}
          </button>
        </div>
      </div>
    </div>

    <!-- Deploy modal -->
    <DeployModal
      v-if="showDeployModal && deploySkill"
      :skill="deploySkill"
      :project-root="selectedProject?.rootDir"
      @close="showDeployModal = false"
      @deployed="onDeployed"
    />

    <ConfirmModal v-if="confirmDeleteSkillDir" title="移除 Skill" :message="`确定要从项目中移除 <strong>${confirmDeleteSkillName}</strong> 吗？`" @confirm="removeSkill({ dir: confirmDeleteSkillDir!, manifest: { name: confirmDeleteSkillName } } as any)" @cancel="confirmDeleteSkillDir = null" />
    <ConfirmModal v-if="confirmDeleteProjectId" title="删除项目" :message="`确定要删除项目 <strong>${confirmDeleteProjectName}</strong> 吗？此操作不可撤销。`" confirm-text="删除项目" @confirm="doDeleteProject" @cancel="confirmDeleteProjectId = null" />
  </div>
</template>

<style scoped>
.project-skills { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; }

.ps-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px 0;
  flex-wrap: wrap;
}

.ps-filter-row .quick-switcher {
  width: 240px;
  flex-shrink: 0;
}

.ps-filter-actions {
  display: flex;
  align-items: center;
  gap: 4px;
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

.header-toolbar-wrapper {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
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

.add-project-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.toolbar-btn.add-project-btn {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: transparent;
}

.toolbar-btn.add-project-btn:hover {
  background: hsl(var(--primary) / 0.9);
}

.toolbar-btn.import-btn {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: transparent;
}

.toolbar-btn.import-btn:hover {
  background: hsl(var(--primary) / 0.9);
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

.toolbar-icon-btn.danger:hover {
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.08);
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

.batch-action-btn.primary {
  color: hsl(var(--primary));
  border-color: hsl(var(--primary) / 0.25);
  background: hsl(var(--primary) / 0.04);
}

.batch-action-btn.primary svg { color: hsl(var(--primary)); }

.batch-action-btn.primary:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.1);
  border-color: hsl(var(--primary) / 0.4);
}

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

.ps-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 20px 28px 28px; scrollbar-gutter: stable; }

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
  pointer-events: none;
  transition: opacity var(--duration-base) var(--ease-standard);
}

.skill-card:hover .card-actions {
  opacity: 1;
  pointer-events: auto;
}

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
.card-action-btn.primary:hover { color: hsl(var(--primary)); }
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

.card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.tag { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 28px;
  color: hsl(var(--muted-foreground));
  text-align: center;
}

.empty-state.center {
  flex: 1;
  min-height: 0;
}

.empty-icon { margin-bottom: 16px; color: hsl(var(--muted-foreground) / 0.5); }
.empty-title { font-size: 16px; font-weight: 600; color: hsl(var(--foreground)); margin: 0 0 8px; }
.empty-desc { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0 0 20px; max-width: 360px; line-height: 1.5; }

.empty-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 10px;
  border: none;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
  font-family: inherit;
  transition: all var(--duration-base) var(--ease-standard);
}

.empty-add-btn:hover { opacity: 0.9; }

.qs-item-avatar {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.modal { width: 560px; max-width: 90vw; max-height: 80vh; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 20px; display: flex; flex-direction: column; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); }
.modal-body { flex: 1; overflow-y: auto; min-height: 0; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.modal-title { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); margin: 0; }
.modal-close { width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--duration-base) var(--ease-standard); }
.modal-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.modal-desc { font-size: 13px; color: hsl(var(--muted-foreground)); padding: 8px 24px 0; margin: 0; }
.modal-desc strong { color: hsl(var(--foreground)); }
.modal-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 24px 0;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  user-select: none;
  border-radius: 8px;
  transition: all var(--duration-base) var(--ease-standard);
  border: 1px solid transparent;
}
.modal-advanced-toggle:hover { color: hsl(var(--foreground)); background: hsl(var(--muted)); }
.modal-advanced-toggle svg { transition: transform var(--duration-base); flex-shrink: 0; }
.modal-advanced-toggle svg.rotated { transform: rotate(90deg); }
.modal-advanced-body {
  margin: 8px 24px 0;
  padding: 12px;
  border-radius: 10px;
  background: hsl(var(--muted) / 0.3);
  border: 1px solid hsl(var(--border));
}
.import-targets { margin-bottom: 12px; }
.import-targets-label { font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground)); display: block; margin-bottom: 8px; }
.import-target-options { display: flex; flex-wrap: wrap; gap: 6px; }
.import-target-option { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; font-size: 12px; color: hsl(var(--foreground)); transition: all var(--duration-base) var(--ease-standard); user-select: none; }
.import-target-option:hover { border-color: hsl(var(--primary) / 0.4); }
.import-target-option:has(input:checked) { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.06); }
.import-target-option input[type="checkbox"] { width: 14px; height: 14px; accent-color: hsl(var(--primary)); cursor: pointer; }
.import-target-path { font-family: monospace; font-size: 11px; }
.import-target-agent { font-size: 10px; color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); padding: 1px 6px; border-radius: 4px; }
.import-mode { }
.import-mode-label { font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground)); display: block; margin-bottom: 8px; }
.import-mode-options { display: flex; gap: 6px; }
.import-mode-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  cursor: pointer;
  font-size: 12px;
  color: hsl(var(--foreground));
  transition: all var(--duration-base) var(--ease-standard);
  user-select: none;
}
.import-mode-option:hover { border-color: hsl(var(--primary) / 0.4); }
.import-mode-option.active { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.06); }
.import-mode-option input { display: none; }
.import-mode-option span { display: flex; align-items: center; gap: 6px; }
.import-mode-option span::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid hsl(var(--border));
  transition: all var(--duration-base) var(--ease-standard);
  flex-shrink: 0;
}
.import-mode-option.active span::before { border-color: hsl(var(--primary)); background: hsl(var(--primary)); box-shadow: inset 0 0 0 3px hsl(var(--card)); }
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
</style>
