<script setup lang="ts">
import { onMounted, ref, computed, provide } from 'vue'
import { useProjectState } from './composables/useProjectState'

import SkillStore from './views/SkillStore/index.vue'
import SkillDetail from './views/SkillStore/Detail.vue'
import MySkills from './views/MySkills/index.vue'
import ProjectSkills from './views/ProjectSkills/index.vue'
import AgentSkills from './views/AgentSkills/index.vue'
import AgentSkillDetail from './views/AgentSkills/Detail.vue'
import Sources from './views/Sources/index.vue'
import Settings from './views/Settings/index.vue'
import AddProjectModal from './components/AddProjectModal.vue'
import NewSkillModal from './components/NewSkillModal.vue'
import AppToast from './components/AppToast.vue'
import DownloadIndicator from './components/DownloadIndicator.vue'
import { storage } from './utils/storage'
import { applyTheme } from './utils/theme'
import { useSettings } from './composables/useSettings'
import { detectPlatforms, getPlatformPath, defaultPlatforms } from './data/platforms'
import type { Skill, AppSettings, PlatformInfo, RegisteredProject } from './types'

const { settings, updateSettings } = useSettings()

const route = ref('my')
const subRoute = ref('')
const selectedSkill = ref<Skill | null>(null)
const detailContext = ref<'my' | 'store' | 'project' | 'agent'>('my')
const selectedAgentSkill = ref<any>(null)
const selectedAgentPlatformId = ref('')
const settingsAnchor = ref('')
const appToast = ref<InstanceType<typeof AppToast> | null>(null)
function showToast(message: string, type?: 'success' | 'error' | 'info' | 'warning') { appToast.value?.showToast(message, type) }
provide('showToast', showToast)

const projectSkillsRef = ref()
const agentSkillsRef = ref()

const storeSubId = ref('claude')

const downloadedCount = ref(0)
const agentCount = ref(0)
const detectedPlatforms = ref<PlatformInfo[]>([])
const platformSkillCounts = ref<Record<string, number>>({})

// Project skills state
const { registeredProjects, selectedProject, selectedProjectSkill, persistSelectedProject } = useProjectState()
registeredProjects.value = storage.getRegisteredProjects()
const showAddProjectModal = ref(false)
const showEditProjectModal = ref(false)
const editingProject = ref<RegisteredProject | null>(null)
const showImportModal = ref(false)
const projectScanning = ref(false)
const addProjectError = ref('')

function handleProjectSubmit(data: { name: string; rootDir: string; scanPaths: string[]; id?: string }) {
  addProjectError.value = ''
  if (data.id) {
    updateProject(data.id, data)
  } else {
    addProject(data)
  }
}

function addProject(project: { name: string; rootDir: string; scanPaths: string[] }) {
  try {
    const root = project.rootDir.trim()
    const name = project.name.trim()
    if (!root || !name) return

    const hasConflict = registeredProjects.value.some(
      (p) => p.rootDir.toLowerCase() === root.toLowerCase(),
    )
    if (hasConflict) {
      const conflict = registeredProjects.value.find(
        (p) => p.rootDir.toLowerCase() === root.toLowerCase(),
      )
      addProjectError.value = conflict
        ? `根目录已存在，与项目「${conflict.name}」冲突（${conflict.rootDir}）`
        : '该项目根目录已存在，请选择其他目录或删除已有项目'
      return
    }

    const newProject: RegisteredProject = {
      id: `project-${Date.now()}`,
      name,
      rootDir: root,
      scanPaths: project.scanPaths.filter((p) => p.trim()),
      skills: [],
      createdAt: new Date().toISOString(),
    }
    registeredProjects.value = [...registeredProjects.value, newProject]
    storage.saveRegisteredProjects(registeredProjects.value)
    selectedProject.value = newProject
    showAddProjectModal.value = false
    addProjectError.value = ''
    scanProject(newProject)
  } catch (err: any) {
    addProjectError.value = err.message || '添加项目时发生未知错误'
  }
}

function editProject(project: RegisteredProject) {
  editingProject.value = project
  showEditProjectModal.value = true
}

function updateProject(id: string, data: { name: string; rootDir: string; scanPaths: string[] }) {
  try {
    const root = data.rootDir.trim()
    const name = data.name.trim()
    if (!root || !name) return

    const hasConflict = registeredProjects.value.some(
      (p) => p.id !== id && p.rootDir.toLowerCase() === root.toLowerCase(),
    )
    if (hasConflict) {
      showEditProjectModal.value = false
      return
    }

    const patch = { name, rootDir: root, scanPaths: data.scanPaths.filter((p) => p.trim()) }
    storage.updateRegisteredProject(id, patch)
    const idx = registeredProjects.value.findIndex((p) => p.id === id)
    if (idx >= 0) {
      const newList = [...registeredProjects.value]
      newList[idx] = { ...newList[idx], ...patch }
      registeredProjects.value = newList
      selectedProject.value = newList[idx]
    }
    showEditProjectModal.value = false
    editingProject.value = null
    if (selectedProject.value) {
      scanProject(selectedProject.value)
    }
  } catch (err: any) {
    console.error('[App] editProject failed:', err)
  }
}

function removeProject(id: string) {
  registeredProjects.value = registeredProjects.value.filter((p) => p.id !== id)
  storage.saveRegisteredProjects(registeredProjects.value)
  if (selectedProject.value?.id === id) {
    if (registeredProjects.value.length > 0) {
      selectProject(registeredProjects.value[0])
    } else {
      selectedProject.value = null
      selectedProjectSkill.value = null
      navigate('my')
    }
  }
  showEditProjectModal.value = false
  editingProject.value = null
}

const DEFAULT_PROJECT_SCAN_SUBDIRS = ['.claude/skills', '.agents/skills', 'skills', '.gemini/skills', '.cursor/skills', '.windsurf/skills']
let projectScanTimer: ReturnType<typeof setTimeout> | null = null

async function scanProject(project: RegisteredProject) {
  projectScanning.value = true
  if (projectScanTimer) clearTimeout(projectScanTimer)
  projectScanTimer = setTimeout(async () => {
    try {
      const dirs = [
        project.rootDir,
        ...DEFAULT_PROJECT_SCAN_SUBDIRS.map((d) => window.services.pathJoin(project.rootDir, d)),
        ...project.scanPaths,
      ]
      const skills = window.services.scanForSkillFiles(dirs)
      const idx = registeredProjects.value.findIndex((p) => p.id === project.id)
      if (idx >= 0) {
        const newList = [...registeredProjects.value]
        newList[idx] = { ...newList[idx], skills }
        registeredProjects.value = newList
        storage.saveRegisteredProjects(newList)
        selectedProject.value = newList[idx]
        if (!selectedProjectSkill.value || !skills?.some((s) => s.dir === selectedProjectSkill.value?.dir)) {
          selectedProjectSkill.value = skills?.[0] || null
        }
      }
    } catch (err: any) { }
    projectScanning.value = false
  }, 300)
}

function selectProject(project: RegisteredProject) {
  selectedProject.value = project
  selectedProjectSkill.value = project.skills?.[0] || null
  persistSelectedProject()
}

function selectProjectSkill(skill: any) {
  selectedProjectSkill.value = skill
}

provide('selectedProject', selectedProject)
provide('selectedProjectSkill', selectedProjectSkill)
provide('selectProjectSkill', selectProjectSkill)
provide('selectProject', selectProject)
provide('openAddProjectModal', () => { showAddProjectModal.value = true })
provide('detectedPlatforms', detectedPlatforms)
provide('platformSkillCounts', platformSkillCounts)
provide('scanProject', scanProject)
provide('projectScanning', projectScanning)

function refreshCounts() {
  downloadedCount.value = storage.getDownloadedIds().length
  try {
    const allPlatforms = detectPlatforms()
    const savedConfigs = storage.getPlatformConfigs()
    // Filter by installed (detected) and enabled status
    const installedPlatforms = allPlatforms.filter((p) => {
      if (!p.detected) return false
      const savedConfig = savedConfigs.find((c) => c.id === p.id)
      return savedConfig ? savedConfig.enabled : p.enabled
    })
    // Sort by platform order from storage (use default order if none saved)
    const platformOrder = storage.getPlatformOrder()
    const orderToUse = platformOrder.length ? platformOrder : defaultPlatforms.map(p => p.id)
    const orderMap = new Map(orderToUse.map((id, idx) => [id, idx]))
    installedPlatforms.sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity))
    agentCount.value = installedPlatforms.length
    detectedPlatforms.value = installedPlatforms
    const counts: Record<string, number> = {}
    for (const p of installedPlatforms) {
      try {
        const dir = getPlatformPath(p, 'global') || getPlatformPath(p, 'project')
        if (dir) counts[p.id] = window.services.scanForSkillFiles([dir]).length
      } catch { counts[p.id] = 0 }
    }
    platformSkillCounts.value = counts
  } catch {
    agentCount.value = 0
    detectedPlatforms.value = []
  }
  refreshMySkills()
  refreshKey.value++
}

provide('refreshCounts', refreshCounts)
provide('currentRoute', route)

const activeRoute = computed(() => {
  if (route.value === 'sources') return 'store'
  if (route.value === 'detail') {
    if (detailContext.value === 'store') return 'store'
    if (detailContext.value === 'project') return 'project-skills'
    if (detailContext.value === 'agent') return 'agent-skills'
    return 'my'
  }
  if (route.value === 'agent-skill-detail') return 'agent-skills'
  return route.value
})

const navItems = computed(() => [
  { code: 'my', label: '我的 Skill', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', count: downloadedCount.value },
  { code: 'project-skills', label: '项目 Skill', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', count: registeredProjects.value.length },
  { code: 'agent-skills', label: 'Agent Skill', icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5m-4.25-11.396c.251.023.501.05.75.082M12 21a8.966 8.966 0 005.982-2.275M12 21a8.966 8.966 0 01-5.982-2.275M15.75 3.186a24.284 24.284 0 011.957.967M15.75 3.186c-.376.056-.75.118-1.12.185m1.12-.185a24.284 24.284 0 00-1.957.967M6.258 5.526a24.284 24.284 0 011.957-.967m0 0A24.234 24.234 0 0112 3.493', count: agentCount.value },
  { code: 'store', label: 'Skill 商店', icon: 'M13.5 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z', count: 0 },
])

function navigate(code: string, params?: any) {
  route.value = code
  if (code === 'agent-skills') refreshCounts()
  refreshMySkills()
  settingsAnchor.value = ''
  if (params) {
    subRoute.value = params.sub || ''
    if (params.skill) selectedSkill.value = params.skill
    if (params.sub) storeSubId.value = params.sub
    if ('platformId' in params) selectedAgentPlatformId.value = params.platformId || ''
    if (params.context) detailContext.value = params.context
    if (params.anchor) settingsAnchor.value = params.anchor
    if (code === 'agent-skill-detail' && params.skill) {
      selectedAgentSkill.value = params.skill
    }
  }
  if (code === 'project-skills' && !selectedProject.value && registeredProjects.value.length) {
    selectProject(registeredProjects.value[0])
  }
}

onMounted(() => {
  storage.cleanStaleCachedSkills()
  refreshCounts()
  refreshMySkills()
  applyTheme(settings)
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    if (settings.themeMode === 'auto') applyTheme(settings)
  })
  window.ztools.onPluginEnter((action) => {
    if (!route.value) {
      route.value = 'my'
    }
  })
  window.ztools.onPluginOut(() => { /* 不清理 route，保持当前页面 */ })
})

const storePresets = [
  { id: 'claude', name: 'Claude Code', icon: '' },
  { id: 'codex', name: 'OpenAI Codex', icon: '' },
  { id: 'skills-sh', name: 'skills.sh', icon: '' },
]

const filterCategory = ref('all')
const filterSource = ref('')

const myAllSkills = ref<Skill[]>([])
const myDownloadedIds = ref<string[]>([])
const myInstallRecords = ref<any[]>([])
const myFavoriteIds = ref<string[]>([])
const myInstalledIds = computed(() => new Set(myInstallRecords.value.map((r: any) => r.skillId)))
const myDownloadedSkills = computed(() => myAllSkills.value.filter((s: Skill) => myDownloadedIds.value.includes(s.id)))
const myCategories = computed(() => [
  { id: 'all', label: '全部', count: myDownloadedSkills.value.length },
  { id: 'favorites', label: '收藏', count: myDownloadedSkills.value.filter((s: Skill) => myFavoriteIds.value.includes(s.id)).length },
  { id: 'distributed', label: '已分发', count: myDownloadedSkills.value.filter((s: Skill) => myInstalledIds.value.has(s.id)).length },
  { id: 'pending', label: '待分发', count: myDownloadedSkills.value.filter((s: Skill) => !myInstalledIds.value.has(s.id)).length },
])
const mySources = computed(() => {
  const map = new Map<string, number>()
  for (const s of myDownloadedSkills.value) {
    const src = getSkillSourceLabel(s)
    map.set(src, (map.get(src) || 0) + 1)
  }
  return Array.from(map.entries())
})
function getSkillSourceLabel(skill: Skill): string {
  if (skill.source === 'skills-sh') return 'skills.sh'
  if (skill.repo) {
    if (skill.repo === 'anthropics/skills') return 'Claude Code'
    if (skill.repo === 'openai/skills') return 'Codex'
    return 'GitHub'
  }
  return 'Local'
}
function refreshMySkills() {
  myAllSkills.value = storage.getCachedSkills()
  myDownloadedIds.value = storage.getDownloadedIds()
  myInstallRecords.value = storage.getInstallRecords()
  myFavoriteIds.value = storage.getFavoriteIds()
}
provide('filterCategory', filterCategory)
provide('filterSource', filterSource)
provide('refreshMySkills', refreshMySkills)
provide('openImportModal', () => { showImportModal.value = true })

const refreshKey = ref(0)
provide('refreshKey', refreshKey)
provide('triggerRefresh', () => { refreshKey.value++ })

const isSettings = computed(() => route.value === 'settings')
const isFullHeight = computed(() => ['settings', 'detail', 'agent-skill-detail'].includes(route.value))
const isMySkills = computed(() => route.value === 'my')

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


</script>

<template>
  <div class="app-shell">
    <div class="app-background"></div>
    <AddProjectModal v-if="showAddProjectModal" :submit-error="addProjectError" @close="showAddProjectModal = false; addProjectError = ''" @submit="handleProjectSubmit" />
    <AddProjectModal v-if="showEditProjectModal" :project="editingProject" @close="showEditProjectModal = false; editingProject = null" @submit="handleProjectSubmit" />
    <NewSkillModal v-if="showImportModal" @close="showImportModal = false" @imported="refreshCounts" @navigate="(route) => { showImportModal = false; navigate(route) }" />
    <AppToast ref="appToast" />
    <DownloadIndicator />
    <div class="app-content">
      <aside class="rail-sidebar">
        <div class="rail-logo" title="技能管理器" @click="navigate('my')" style="cursor:pointer">
          <img src="/app-icon.png" alt="技能管理器" class="rail-logo-img" />
        </div>
        <nav class="rail-nav">
          <button
            v-for="item in navItems"
            :key="item.code"
            class="rail-btn"
            :class="{ active: activeRoute === item.code }"
            @click="navigate(item.code)"
            :title="item.label"
          >
            <span class="rail-btn-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="item.icon" />
              </svg>
            </span>
            <span class="rail-btn-label">{{ item.label }}</span>
          </button>
        </nav>
        <div class="rail-footer">
          <button
            class="rail-btn"
            :class="{ active: route === 'settings' }"
            @click="navigate('settings')"
            title="设置"
          >
            <span class="rail-btn-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
          </button>
        </div>
      </aside>

      <div class="main-area">
        <!-- ===== ALL VIEWS — SINGLE COLUMN ===== -->
        <main class="main-content" :class="{ 'full-height': isFullHeight, 'no-padding': isMySkills || ['store', 'project-skills', 'agent-skills', 'sources'].includes(route) }">
          <MySkills v-if="route === 'my'" @navigate="navigate" />
          <SkillDetail v-else-if="route === 'detail'" :skill="selectedSkill" :context="detailContext" @navigate="navigate" />
          <AgentSkillDetail v-else-if="route === 'agent-skill-detail'" :skill="selectedAgentSkill" :platform-id="selectedAgentPlatformId" @navigate="navigate" />
          <Sources v-else-if="route === 'sources'" @navigate="navigate" />
          <Settings v-else-if="route === 'settings'" :anchor="settingsAnchor" />
          <SkillStore v-else-if="route === 'store'" :store-id="storeSubId" @navigate="navigate" />
          <ProjectSkills ref="projectSkillsRef" v-else-if="route === 'project-skills'" @navigate="navigate" @edit-project="editProject" @delete-project="removeProject" />
          <AgentSkills ref="agentSkillsRef" v-else-if="route === 'agent-skills'" :initial-platform-id="selectedAgentPlatformId" @navigate="navigate" />
        </main>
      </div>
    </div>
  </div>
</template>

<style>
/* ===== RESET ===== */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

/* ===== DESIGN TOKENS: LIGHT ===== */
:root,
[data-theme="light"] {
  --theme-hue: 250;
  --theme-saturation: 48%;
  --base-font-size: 16px;
  --app-zoom: 1;

  --background: 255 20% 97%;
  --foreground: 250 20% 22%;
  --card: 0 0% 100%;
  --card-foreground: 250 20% 22%;
  --popover: 0 0% 100%;
  --popover-foreground: 250 20% 22%;
  --primary: var(--theme-hue) var(--theme-saturation) 55%;
  --primary-foreground: 0 0% 100%;
  --secondary: 250 14% 95%;
  --secondary-foreground: 250 20% 22%;
  --muted: 250 12% 93%;
  --muted-foreground: 250 10% 48%;
  --accent: var(--theme-hue) var(--theme-saturation) 93%;
  --accent-foreground: var(--theme-hue) var(--theme-saturation) 40%;
  --destructive: 0 72% 52%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 60% 44%;
  --success-foreground: 0 0% 100%;
  --warning: 38 90% 50%;
  --warning-foreground: 0 0% 100%;
  --border: 250 12% 87%;
  --input: 250 12% 87%;
  --ring: var(--theme-hue) var(--theme-saturation) 55%;
  --radius: 0.75rem;

  --sidebar: 255 25% 98%;
  --sidebar-foreground: 250 20% 22%;
  --sidebar-accent: 250 14% 93%;
  --sidebar-border: 250 12% 88%;

  --app-ui-shell-bg: 255 20% 97%;
  --app-ui-panel-bg: 0 0% 100%;
  --app-ui-panel-border: 250 12% 87%;
  --app-ui-section-bg: 0 0% 100%;
  --app-ui-section-border: 250 12% 87%;
  --app-ui-toolbar-bg: 0 0% 100%;
  --app-ui-toolbar-border: 250 12% 87%;
  --app-ui-search-bg: 250 12% 93%;
  --app-ui-search-border: 250 12% 87%;

  --app-settings-card-bg: 0 0% 100%;
  --app-settings-card-border: 250 12% 87%;
  --app-settings-card-shadow: 0 2px 8px rgba(80,40,120,0.06);
  --app-settings-subtle-bg: 250 12% 93%;
  --app-settings-subtle-border: 250 12% 87%;
  --app-settings-segment-active-bg: 0 0% 100%;
  --app-settings-segment-active-color: var(--theme-hue) var(--theme-saturation) 40%;
  --app-settings-segment-active-shadow: 0 2px 8px rgba(80,40,120,0.1);

  --shadow-sm: 0 1px 3px rgba(80,40,120,0.06);
  --shadow: 0 4px 14px rgba(80,40,120,0.08);
  --shadow-lg: 0 12px 36px rgba(80,40,120,0.1);

  color-scheme: light;
}

/* ===== DESIGN TOKENS: DARK ===== */
[data-theme="dark"] {
  --background: 250 20% 5%;
  --foreground: 250 15% 90%;
  --card: 250 18% 8%;
  --card-foreground: 250 15% 90%;
  --popover: 250 18% 8%;
  --popover-foreground: 250 15% 90%;
  --primary: var(--theme-hue) var(--theme-saturation) 58%;
  --primary-foreground: 0 0% 100%;
  --secondary: 250 16% 11%;
  --secondary-foreground: 250 15% 90%;
  --muted: 250 16% 10%;
  --muted-foreground: 250 10% 55%;
  --accent: var(--theme-hue) 16% 13%;
  --accent-foreground: var(--theme-hue) var(--theme-saturation) 85%;
  --destructive: 0 75% 55%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 55% 44%;
  --success-foreground: 0 0% 100%;
  --warning: 38 90% 52%;
  --warning-foreground: 0 0% 100%;
  --border: 250 15% 14%;
  --input: 250 15% 14%;
  --ring: var(--theme-hue) var(--theme-saturation) 58%;

  --sidebar: 250 20% 4%;
  --sidebar-foreground: 250 15% 90%;
  --sidebar-accent: 250 16% 9%;
  --sidebar-border: 250 15% 11%;

  --app-ui-shell-bg: 250 20% 5%;
  --app-ui-panel-bg: 250 18% 8%;
  --app-ui-panel-border: 250 15% 14%;
  --app-ui-section-bg: 250 18% 8%;
  --app-ui-section-border: 250 15% 14%;
  --app-ui-toolbar-bg: 250 18% 8%;
  --app-ui-toolbar-border: 250 15% 14%;
  --app-ui-search-bg: 250 16% 10%;
  --app-ui-search-border: 250 15% 14%;

  --app-settings-card-bg: 250 18% 8%;
  --app-settings-card-border: 250 15% 14%;
  --app-settings-card-shadow: 0 8px 24px rgba(0,0,0,0.4);
  --app-settings-subtle-bg: 250 16% 10%;
  --app-settings-subtle-border: 250 15% 14%;
  --app-settings-segment-active-bg: 250 16% 14%;
  --app-settings-segment-active-color: var(--theme-hue) var(--theme-saturation) 85%;
  --app-settings-segment-active-shadow: 0 2px 8px rgba(0,0,0,0.4);

  --shadow-sm: 0 2px 6px rgba(0,0,0,0.35);
  --shadow: 0 8px 20px rgba(0,0,0,0.45);
  --shadow-lg: 0 16px 48px rgba(0,0,0,0.55);

  color-scheme: dark;
}

/* ===== MOTION TOKENS ===== */
:root, [data-motion="standard"] {
  --duration-instant: 80ms;
  --duration-quick: 120ms;
  --duration-base: 180ms;
  --duration-smooth: 280ms;
  --duration-slow: 420ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
[data-motion="reduced"] {
  --duration-instant: 50ms;
  --duration-quick: 70ms;
  --duration-base: 110ms;
  --duration-smooth: 170ms;
  --duration-slow: 250ms;
}
[data-motion="off"] {
  --duration-instant: 0.01ms;
  --duration-quick: 0.01ms;
  --duration-base: 0.01ms;
  --duration-smooth: 0.01ms;
  --duration-slow: 0.01ms;
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion="standard"]) {
    --duration-instant: 0.01ms;
    --duration-quick: 0.01ms;
    --duration-base: 0.01ms;
    --duration-smooth: 0.01ms;
    --duration-slow: 0.01ms;
  }
}

/* ===== COMPACT MODE ===== */
[data-compact] { --compact-scale: 0.85; }
[data-compact] .app-main,
[data-compact] .main-content { padding: 10px 14px; }
[data-compact] .rail-sidebar { width: 56px; }
[data-compact] .rail-btn-label { display: none; }

/* ===== BASE ===== */
body {
  font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'kern' 1;
  line-height: 1.5;
  overflow: hidden;
}

/* ===== SCROLLBAR ===== */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.2); border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.35); }

/* ===== APP SHELL ===== */
.app-shell {
  height: 100vh;
  overflow: hidden;
  position: relative;
  zoom: var(--app-zoom, 1);
}

.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-size: cover;
  background-position: center;
  pointer-events: none;
  display: none;
}

.app-content {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== BACKGROUND IMAGE MODE ===== */
:root[data-has-bg] .app-content {
  background: transparent;
}
:root[data-has-bg] .main-content {
  background: transparent;
}
:root[data-has-bg] .rail-sidebar {
  background: hsl(var(--sidebar) / 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
:root[data-has-bg] .settings-sidebar {
  background: hsl(var(--app-ui-panel-bg) / 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
:root[data-has-bg] .settings-content {
  background: transparent;
}

/* ===== BACKGROUND IMAGE — SURFACE OVERRIDES ===== */

/* Card surfaces — unified glass with stronger blur to match outer panels */
:root[data-has-bg] .skill-card,
:root[data-has-bg] .stat-card,
:root[data-has-bg] .action-card,
:root[data-has-bg] .desc-card,
:root[data-has-bg] .content-card,
:root[data-has-bg] .sidebar-section,
:root[data-has-bg] .add-form,
:root[data-has-bg] .source-card,
:root[data-has-bg] .header-btn,
:root[data-has-bg] .back-btn,
:root[data-has-bg] .desc-text,
:root[data-has-bg] .icon-btn,
:root[data-has-bg] .skill-action,
:root[data-has-bg] .heading-btn,
:root[data-has-bg] .modal,
:root[data-has-bg] .confirm-dialog,
:root[data-has-bg] .confirm-cancel,
:root[data-has-bg] .action-btn {
  background: hsl(var(--card) / 0.3);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Muted surfaces — secondary backgrounds */
:root[data-has-bg] .filter-tabs button,
:root[data-has-bg] .form-input,
:root[data-has-bg] .examples-box,
:root[data-has-bg] .toggle-switch,
:root[data-has-bg] .source-code,
:root[data-has-bg] .install-log,
:root[data-has-bg] .stat-icon,
:root[data-has-bg] .action-icon {
  background: hsl(var(--muted) / 0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Settings card backgrounds */
:root[data-has-bg] .setting-card {
  background: hsl(var(--app-settings-card-bg) / 0.3);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Settings segmented control */
:root[data-has-bg] .segmented-control {
  background: hsl(var(--app-settings-subtle-bg) / 0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Primary button surfaces */
:root[data-has-bg] .rail-btn.active,
:root[data-has-bg] .filter-tabs button.active,
:root[data-has-bg] .download-btn,
:root[data-has-bg] .add-btn,
:root[data-has-bg] .import-btn,
:root[data-has-bg] .scan-btn,
:root[data-has-bg] .install-my-skill-btn {
  background: hsl(var(--primary) / 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* ===== RAIL SIDEBAR ===== */
.rail-sidebar {
  width: 72px;
  background: hsl(var(--sidebar));
  border-right: 1px solid hsl(var(--sidebar-border));
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width var(--duration-base) var(--ease-standard);
  overflow: hidden;
}

.rail-logo {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid hsl(var(--sidebar-border));
  flex-shrink: 0;
}

.rail-logo-img {
  width: 36px;
  height: 36px;
  border-radius: var(--radius);
  object-fit: cover;
}

.rail-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  overflow-y: auto;
}

.rail-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 56px;
  padding: 8px 0;
  border: none;
  background: none;
  color: hsl(var(--sidebar-foreground) / 0.55);
  cursor: pointer;
  border-radius: var(--radius);
  transition: all var(--duration-base) var(--ease-standard);
  text-decoration: none;
  outline: none;
}

.rail-btn:hover {
  background: hsl(var(--sidebar-accent));
  color: hsl(var(--sidebar-foreground));
}

.rail-btn.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 2px 10px hsl(var(--primary) / 0.25);
}

.rail-btn.active::before {
  content: '';
  position: absolute;
  top: 1px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: hsl(38 90% 55%);
  opacity: 0.85;
}

.rail-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 28px;
}

.rail-btn.active .rail-btn-icon {
  border-radius: 10px;
}

.rail-btn-label {
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}



.rail-footer {
  padding: 8px 0;
  border-top: 1px solid hsl(var(--sidebar-border));
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ===== MAIN AREA ===== */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ===== MAIN CONTENT ===== */
.main-content {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px;
  background: hsl(var(--background));
}

.main-content.full-height {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-content.no-padding {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0;
}
</style>
