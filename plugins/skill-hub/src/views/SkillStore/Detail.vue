<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue'
import { detectPlatforms } from '../../data/platforms'
import { storage } from '../../utils/storage'
import { normalizePath } from '../../utils/path'
import { parseFrontmatter } from '../../utils/frontmatter'
import { fetchSkillDetailFromSkill } from '../../utils/skills-sh'
import type { Skill, InstallMode, InstallRecord } from '../../types'
import PlatformIcon from '../../components/PlatformIcon.vue'
import SkillDetailBase from '../../components/SkillDetailBase.vue'
import { useDownloadQueue } from '../../composables/useDownloadQueue'
import { useProjectState } from '../../composables/useProjectState'

const props = defineProps<{ skill: Skill | null; context?: 'my' | 'store' | 'project' | 'agent' }>()
const emit = defineEmits(['navigate'])
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})
const selectedProject = inject<any>('selectedProject', null)
const { addInstall, updateItem } = useDownloadQueue()
const { registeredProjects } = useProjectState()

const activeTab = ref<'preview' | 'source' | 'files'>('preview')
const skillContent = ref('')
const skillDesc = ref('')
const skillName = ref('')
const selectedPlatforms = ref<string[]>([])
const installMode = ref<InstallMode>(storage.getSettings().defaultInstallMode)
const distScope = ref<'global' | 'project'>('global')
const selectedProjectsForDist = ref<string[]>([])
const selectedAgentDirs = ref<string[]>(['.agents/skills'])
const customDirInput = ref('')
const installing = ref(false)

const agentDirOptions = computed(() => {
  const dirs: { id: string; name: string; path: string; type: string }[] = [
    { id: '_generic', name: '通用位置', path: '.agents/skills', type: 'generic' },
  ]
  for (const p of platforms.value) {
    const path = p.customProjectPath || p.projectPath || ''
    if (path && !dirs.some(d => d.path === path)) {
      dirs.push({ id: p.id, name: p.name, path, type: 'agent' })
    }
  }
  return dirs
})
const installLog = ref<{ platform: string; status: 'ok' | 'error' | 'pending'; msg: string }[]>([])
const installRecords = ref<InstallRecord[]>([])
const confirmUninstall = ref<{ platformId: string; platformName: string } | null>(null)
const favorites = ref<string[]>([])
const isEditing = ref(false)
const editedInstructions = ref('')
const copyStatus = ref<Record<string, boolean>>({})
let copyTimers: Record<string, ReturnType<typeof setTimeout>> = {}

onUnmounted(() => { Object.values(copyTimers).forEach(clearTimeout) })

const isProjectContext = computed(() => props.context === 'project')
const isImported = computed(() => {
  if (!props.skill) return false
  return storage.getDownloadedIds().includes(props.skill.id)
})
const skillDir = computed(() => {
  if (!props.skill) return ''
  const skill = props.skill as any
  if (skill.skillDir) return skill.skillDir
  if (isImported.value) {
    return window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
  }
  return ''
})
const projectImporting = ref(false)
const projectRemoving = ref(false)

// === Update Check ===
const updateChecking = ref(false)
const updateAvailable = ref(false)
const updateStatus = ref<'idle' | 'checking' | 'updating' | 'done' | 'error'>('idle')
const updateMessage = ref('')

const canCheckUpdate = computed(() => {
  if (!props.skill) return false
  return !!props.skill.repo
})

async function checkForUpdate() {
  if (!props.skill?.repo || updateChecking.value) return
  updateChecking.value = true
  updateStatus.value = 'checking'
  updateMessage.value = ''
  try {
    const token = storage.getSettings().githubToken || undefined
    const remoteContent = await window.services.checkSkillUpdate(props.skill.repo, props.skill.path || '', token)
    const localDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill!.id)
    const files = window.services.readDir(localDir)
    const skillMd = files.find((f: any) => f.name === 'SKILL.md' || f.name === 'skill.md')
    let localContent = ''
    if (skillMd) {
      localContent = window.services.readFile(skillMd.path)
    }
    if (remoteContent && remoteContent !== localContent) {
      updateAvailable.value = true
      updateStatus.value = 'done'
      updateMessage.value = '有新内容可用'
      showToast('发现新内容，可点击更新', 'info')
    } else {
      updateAvailable.value = false
      updateStatus.value = 'done'
      updateMessage.value = '已是最新'
      showToast('已是最新版本', 'success')
    }
  } catch (err: any) {
    updateStatus.value = 'error'
    updateMessage.value = '检查失败: ' + (err.message || '未知错误')
    showToast('检查更新失败: ' + (err.message || '未知错误'), 'error')
  }
  updateChecking.value = false
}

async function updateSkill() {
  if (!props.skill?.repo || updateStatus.value === 'updating') return
  updateStatus.value = 'updating'
  updateMessage.value = ''
  try {
    const token = storage.getSettings().githubToken || undefined
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill!.id)
    const ok = await window.services.updateSkillFromGitHub(props.skill.repo, props.skill.path || '', targetDir, token)
    if (ok) {
      updateAvailable.value = false
      updateStatus.value = 'done'
      updateMessage.value = '更新完成'
      loadSkillContent()
      showToast('技能已更新', 'success')
    } else {
      updateStatus.value = 'error'
      updateMessage.value = '更新失败'
    }
  } catch (err: any) {
    updateStatus.value = 'error'
    updateMessage.value = '更新失败: ' + (err.message || '未知错误')
  }
}

async function projectImportSkill() {
  if (!props.skill) return
  projectImporting.value = true
  try {
    const id = props.skill.id
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', id)
    window.services.mkdir(targetDir)
    const sourceDir = (props.skill as any).skillDir
    if (sourceDir) window.services.copyFile(sourceDir, targetDir)
    const cached = storage.getCachedSkills()
    if (!cached.some((s) => s.id === id)) {
      cached.push({ ...props.skill, source: 'local', storeSourceId: props.skill.storeSourceId })
      storage.saveCachedSkills(cached)
    }
    storage.addDownloadedId(id)
    showToast(`已将 ${props.skill.name} 导入到我的 Skill`, 'success')
  } catch (err: any) { showToast(err.message, 'error') }
  projectImporting.value = false
}

async function projectRemoveFromMySkills() {
  if (!props.skill) return
  projectRemoving.value = true
  try {
    storage.removeDownloadedId(props.skill.id)
    storage.removeAllForSkill(props.skill.id)
    storage.removeSkillFromCache(props.skill.id)
    const dir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
    try { window.services.removeFile(dir) } catch {}
    showToast(`已从我的 Skill中移除 ${props.skill.name}`, 'success')
  } catch (err: any) { showToast(err.message, 'error') }
  projectRemoving.value = false
}

function projectOpenFolder() {
  const skill = props.skill as any
  if (skill?.skillDir) window.services.openFolder(skill.skillDir)
}

const platforms = computed(() => {
  const saved = storage.getPlatformConfigs()
  return detectPlatforms().filter((p) => p.detected && (p.defaultPath || p.projectPath)).map((p) => {
    const cfg = saved.find((s) => s.id === p.id)
    return cfg ? { ...p, customPath: cfg.customPath, customProjectPath: cfg.customProjectPath } : p
  })
})
const isFavorited = computed(() => props.skill && favorites.value.includes(props.skill.id))

const uninstalledPlatforms = computed(() => platforms.value.filter((p) => !isInstalled(p.id) && !sourcePlatformIds.value.has(p.id)))
const totalUninstalled = computed(() => uninstalledPlatforms.value.length)
const installProgressText = computed(() => {
  const total = selectedPlatforms.value.length
  const done = installLog.value.filter((l) => l.status === 'ok' || l.status === 'error').length
  return total > 0 ? `${done}/${total}` : ''
})

const physicallyInstalledPlatforms = computed(() => {
  const result = new Set<string>()
  if (!props.skill) return result
  const skillDir = props.skill.path ? props.skill.path.split('/').pop() || props.skill.name : props.skill.name
  for (const p of platforms.value) {
    const base = p.customPath || p.defaultPath
    if (!base) continue
    const expandedBase = base.replace(/^~/, window.services.homeDir())
    if (!window.services.pathExists(expandedBase)) continue
    const existingSkills = window.services.scanForSkillFiles([expandedBase])
    const exists = existingSkills.some(
      (s) => s.dir.includes(skillDir) || (s.manifest?.name || s.name).toLowerCase() === props.skill!.name.toLowerCase()
    )
    if (exists) result.add(p.id)
  }
  return result
})

const sourcePlatformIds = computed(() => {
  const result = new Set<string>()
  if (!props.skill || props.skill.source !== 'local' || !props.skill.path) return result
  const skillPath = normalizePath(props.skill.path)
  for (const p of platforms.value) {
    const base = (p.customPath || p.defaultPath || '').replace(/^~/, window.services.homeDir())
    if (!base) continue
    if (skillPath.startsWith(normalizePath(base))) {
      result.add(p.id)
    }
  }
  return result
})

onMounted(() => { loadFavorites(); loadSkillContent(); loadInstallStatus() })
watch(() => props.skill?.id, () => {
  loadFavorites(); loadSkillContent(); loadInstallStatus()
  isEditing.value = false
  copyStatus.value = {}
  Object.values(copyTimers).forEach(clearTimeout)
  copyTimers = {}
})

function loadFavorites() { favorites.value = storage.getFavoriteIds() }

function toggleFavorite() {
  if (!props.skill) return
  storage.toggleFavorite(props.skill.id)
  loadFavorites()
}

function loadInstallStatus() {
  if (!props.skill) return
  installRecords.value = storage.getInstalledForSkill(props.skill.id)
}

function isInstalled(platformId: string): boolean {
  return installRecords.value.some((r) => r.platformId === platformId && ((r as any).scope === distScope.value || ((r as any).scope === undefined && distScope.value === 'global')))
}

function getInstallRecord(platformId: string): InstallRecord | undefined {
  return installRecords.value.find((r) => r.platformId === platformId && ((r as any).scope === distScope.value || ((r as any).scope === undefined && distScope.value === 'global')))
}

async function loadSkillContent() {
  if (!props.skill) return
  skillContent.value = ''
  skillDesc.value = ''
  skillName.value = ''
  const skill = props.skill as any

  if (skill.readme) {
    const fm = parseFrontmatter(skill.readme)
    const normalized = skill.readme.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const bodyMatch = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
    skillName.value = fm.name || ''
    skillDesc.value = fm.description || skill.description || ''
    skillContent.value = bodyMatch ? bodyMatch[1].trim() : skill.readme
    editedInstructions.value = skillContent.value
    return
  }

  if (skill.skillDir) {
    try {
      const files = window.services.readDir(skill.skillDir)
      const skillMd = files.find((f: any) => f.name === 'SKILL.md' || f.name === 'skill.md')
      if (skillMd) {
        const raw = window.services.readFile(skillMd.path)
        const fm = parseFrontmatter(raw)
        const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const bodyMatch = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
        skillName.value = fm.name || ''
        skillDesc.value = fm.description || skill.description || ''
        skillContent.value = bodyMatch ? bodyMatch[1].trim() : raw
        editedInstructions.value = skillContent.value
        return
      }
    } catch { }
  }

  const downloadedIds = storage.getDownloadedIds()
  if (downloadedIds.includes(skill.id)) {
    try {
      const dir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skill.id)
      const files = window.services.readDir(dir)
      const skillMd = files.find((f: any) => f.name === 'SKILL.md')
      if (skillMd) {
        const raw = window.services.readFile(skillMd.path)
        const fm = parseFrontmatter(raw)
        const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const bodyMatch = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
        skillName.value = fm.name || ''
        skillDesc.value = fm.description || skill.description || ''
        skillContent.value = bodyMatch ? bodyMatch[1].trim() : raw
        editedInstructions.value = skillContent.value
        return
      }
    } catch { }
  }

  // Fetch from skills.sh detail page for skills.sh skills not yet downloaded locally
  if (skill.source === 'skills-sh' && skill.repo && !skill.readme) {
    const result = await fetchSkillDetailFromSkill(skill)
    if (result) {
      skillName.value = result.name
      skillDesc.value = result.description
      skillContent.value = result.content
      editedInstructions.value = result.content
      return
    }
  }
}

function togglePlatform(id: string) {
  const idx = selectedPlatforms.value.indexOf(id)
  if (idx >= 0) selectedPlatforms.value.splice(idx, 1)
  else selectedPlatforms.value.push(id)
}
function toggleAllPlatforms() {
  const available = platforms.value.filter((p) => !isInstalled(p.id) && !sourcePlatformIds.value.has(p.id))
  selectedPlatforms.value = selectedPlatforms.value.length === available.length ? [] : available.map((p) => p.id)
}

function toggleProjectDist(id: string) {
  const idx = selectedProjectsForDist.value.indexOf(id)
  if (idx >= 0) selectedProjectsForDist.value.splice(idx, 1)
  else selectedProjectsForDist.value.push(id)
}
function toggleAllProjects() {
  selectedProjectsForDist.value = selectedProjectsForDist.value.length === registeredProjects.value.length
    ? []
    : registeredProjects.value.map(p => p.id)
}
function toggleAgentDir(path: string) {
  const idx = selectedAgentDirs.value.indexOf(path)
  if (idx >= 0) selectedAgentDirs.value.splice(idx, 1)
  else selectedAgentDirs.value.push(path)
}
function toggleAllAgentDirs() {
  const allPaths = agentDirOptions.value.map(a => a.path)
  selectedAgentDirs.value = selectedAgentDirs.value.length === allPaths.length ? [] : [...allPaths]
}

function addLog(platform: string, status: 'ok' | 'error' | 'pending', msg: string) { installLog.value.push({ platform, status, msg }) }

async function install() {
  if (!props.skill) return
  installing.value = true; installLog.value = []
  const skill = props.skill
  if (!storage.getDownloadedIds().includes(skill.id)) { installing.value = false; return }
  const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skill.id)
  const skillDir = skill.path ? skill.path.split('/').pop()! : skill.name
  const installedNames: string[] = []

  if (distScope.value === 'project') {
    const projects = registeredProjects.value.filter(p => selectedProjectsForDist.value.includes(p.id))
    if (!projects.length) { showToast('请先选择项目', 'error'); installing.value = false; return }
    const agentPaths = [...selectedAgentDirs.value]
    if (customDirInput.value && !agentPaths.includes(customDirInput.value)) {
      agentPaths.push(customDirInput.value)
    }
    if (!agentPaths.length) { showToast('请指定保存位置', 'error'); installing.value = false; return }
    for (const project of projects) {
      for (const agentPath of agentPaths) {
        const targetDir = window.services.pathJoin(project.rootDir, agentPath, skillDir)
        try {
          window.services.mkdir(targetDir)
          if (installMode.value === 'symlink') { window.services.createSymlink(sourceDir, targetDir); addLog(agentPath, 'ok', `Symlink: ${targetDir}`) }
          else { window.services.copyFile(sourceDir, targetDir); addLog(agentPath, 'ok', `Copied: ${targetDir}`) }
          installedNames.push(`${project.name}/${agentPath}`)
        } catch (err: any) { addLog(agentPath, 'error', err.message) }
      }
    }
  } else {
    if (!selectedPlatforms.value.length) { showToast('请先选择平台', 'error'); installing.value = false; return }
    const platformNames = selectedPlatforms.value.map(pid => {
      const p = platforms.value.find(p => p.id === pid)
      return p?.name || pid
    })
    const queueItem = addInstall(skill.id, skill.name, platformNames)
    for (const pid of selectedPlatforms.value) {
      const platform = platforms.value.find((p) => p.id === pid)
      if (!platform) continue
      const base = platform.customPath || platform.defaultPath
      if (!base) { addLog(pid, 'error', '未配置路径'); continue }
      const targetDir = window.services.pathJoin(base.replace(/^~/, window.services.homeDir()), skillDir)
      try {
        window.services.mkdir(targetDir)
        if (installMode.value === 'symlink') { window.services.createSymlink(sourceDir, targetDir); addLog(pid, 'ok', `Symlink: ${targetDir}`) }
        else { window.services.copyFile(sourceDir, targetDir); addLog(pid, 'ok', `Copied: ${targetDir}`) }
        storage.saveInstallRecord({ skillId: skill.id, platformId: pid, mode: installMode.value, scope: distScope.value, targetPath: targetDir, sourceDir: skill.repo || '', installedAt: new Date().toISOString() })
        installedNames.push(platform.name)
      } catch (err: any) { addLog(pid, 'error', err.message) }
    }
    if (installedNames.length) {
      updateItem(queueItem.id, { status: 'success' })
      const detail = installedNames.length === 1 ? installedNames[0] : `${installedNames.length} 个平台：${installedNames.join('、')}`
      showToast(`已将 ${skill.name} 分发到${detail}`, 'success')
    } else {
      updateItem(queueItem.id, { status: 'error', error: '安装失败' })
    }
  }
  installing.value = false
  loadInstallStatus()
  selectedPlatforms.value = []
  selectedProjectsForDist.value = []
  if (installedNames.length) {
    showToast(`已将 ${skill.name} 分发到 ${installedNames.length} 个位置`, 'success')
  }
}

async function uninstall(platformId: string) {
  if (!props.skill) return
  const platform = platforms.value.find((p) => p.id === platformId)
  const record = getInstallRecord(platformId)
  if (record) {
    try { window.services.removeFile(record.targetPath) } catch { }
    storage.removeInstallRecord(props.skill.id, platformId, (record as any).scope)
  }
  loadInstallStatus()
  confirmUninstall.value = null
  showToast(`已从 ${platform?.name || platformId} 卸载 ${props.skill.name}`, 'success')
}

function showUninstallConfirm(platformId: string) {
  const p = platforms.value.find((p) => p.id === platformId)
  confirmUninstall.value = { platformId, platformName: p?.name || platformId }
}
function cancelUninstall() { confirmUninstall.value = null }

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

function goBack() {
  emit('navigate', props.context === 'project' ? 'project-skills' : props.context === 'store' ? 'store' : 'my')
}
</script>

<template>
  <div v-if="!skill" class="empty">未选择技能</div>
  <SkillDetailBase
    v-else
    :skill="skill"
    :context="context"
    :skill-name="skillName"
    :skill-desc="skillDesc"
    :skill-content="skillContent"
    :is-favorited="isFavorited"
    :is-editing="isEditing"
    :edited-content="editedInstructions"
    :copy-status="copyStatus"
    :skill-dir="skillDir"
    v-model:active-tab="activeTab"
    @navigate="emit('navigate', $event)"
    @toggle-favorite="toggleFavorite"
    @copy-content="handleCopy"
    @toggle-edit="toggleEdit"
    @save-content="saveContent"
    @update:edited-content="editedInstructions = $event"
  >
    <template #header-toolbar-start>
      <button
        v-if="isImported && canCheckUpdate"
        class="header-update-btn"
        :class="{ 'update-available': updateAvailable, updating: updateChecking || updateStatus === 'updating' }"
        :disabled="updateChecking || updateStatus === 'updating'"
        @click="updateAvailable ? updateSkill() : checkForUpdate()"
      >
        <svg v-if="updateChecking || updateStatus === 'updating'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>
        {{ updateChecking ? '检查中...' : updateStatus === 'updating' ? '更新中...' : updateAvailable ? '有可用更新，立即更新' : '检查更新' }}
      </button>
    </template>
    <template v-if="isProjectContext" #context-panel>
      <div class="platform-panel">
        <div class="section-heading-row">
          <h3 class="section-heading">项目 Skill</h3>
          <span class="section-badge">SKILL.md</span>
        </div>

        <div class="project-actions">
          <button v-if="!isImported" class="project-action-btn primary" :disabled="projectImporting" @click="projectImportSkill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {{ projectImporting ? '导入中...' : '导入到我的 Skill' }}
          </button>
          <div v-else class="project-action-btn imported-tag">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            已在我的 Skill 中
          </div>
          <button class="project-action-btn" @click="projectOpenFolder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            打开文件夹
          </button>
        </div>

        <div v-if="selectedProject" class="project-info">
          <div class="project-info-row">
            <span class="project-info-label">项目</span>
            <span class="project-info-value">{{ selectedProject.name }}</span>
          </div>
          <div class="project-info-row">
            <span class="project-info-label">路径</span>
            <span class="project-info-value mono">{{ (props.skill as any)?.skillDir || '未知' }}</span>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="platforms.length" #context-panel>
      <div class="platform-panel">
        <div class="section-heading-row">
          <h3 class="section-heading">平台集成</h3>
          <span class="section-badge">SKILL.md</span>
        </div>

        <!-- Scope toggle -->
        <div class="scope-toggle">
          <button :class="{ active: distScope === 'global' }" @click="distScope = 'global'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            全局分发
          </button>
          <button :class="{ active: distScope === 'project' }" @click="distScope = 'project'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            项目分发
          </button>
        </div>
        <p class="mode-desc">{{ distScope === 'global' ? '分发到用户目录下的平台配置目录，所有项目共享。' : '分发到所选项目的指定 Agent 目录下。' }}</p>

        <!-- Mode toggle -->
        <div class="mode-toggle">
          <button :class="{ active: installMode === 'copy' }" @click="installMode = 'copy'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制
          </button>
          <button :class="{ active: installMode === 'symlink' }" @click="installMode = 'symlink'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            软链接
          </button>
        </div>
        <p class="mode-desc">{{ installMode === 'copy' ? '将 SKILL.md 复制到每个平台目录，各平台独立更新。' : '创建指向源文件的软链接，所有平台共享同一文件，编辑即时同步。' }}</p>

        <!-- Project mode -->
        <template v-if="distScope === 'project'">
          <!-- Project multi-select -->
          <div class="project-list-label">选择项目</div>
          <div class="project-list">
            <div class="project-select-all" @click="toggleAllProjects">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><polyline points="9 11 12 14 22 4"/></svg>
              {{ selectedProjectsForDist.length === registeredProjects.length && registeredProjects.length > 0 ? '取消全选' : '全选' }}
              <span v-if="selectedProjectsForDist.length > 0" class="selected-count">已选 {{ selectedProjectsForDist.length }}</span>
            </div>
            <div
              v-for="p in registeredProjects"
              :key="p.id"
              class="project-list-item"
              :class="{ active: selectedProjectsForDist.includes(p.id) }"
              @click="toggleProjectDist(p.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <div class="project-list-info">
                <span class="project-list-name">{{ p.name }}</span>
                <span class="project-list-path">{{ p.rootDir }}</span>
              </div>
              <div class="project-checkbox" :class="{ checked: selectedProjectsForDist.includes(p.id) }">
                <svg v-if="selectedProjectsForDist.includes(p.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
          </div>

          <!-- Save location -->
          <div class="project-list-label" style="margin-top:8px">指定保存位置</div>
          <div class="project-select-all" @click="toggleAllAgentDirs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><polyline points="9 11 12 14 22 4"/></svg>
            {{ selectedAgentDirs.length === agentDirOptions.length && agentDirOptions.length > 0 ? '取消全选' : '全选' }}
            <span v-if="selectedAgentDirs.length > 0" class="selected-count">已选 {{ selectedAgentDirs.length }}</span>
          </div>
          <div class="project-list">
            <div
              v-for="a in agentDirOptions"
              :key="a.id"
              class="project-list-item"
              :class="{ active: selectedAgentDirs.includes(a.path) }"
              @click="toggleAgentDir(a.path)"
            >
              <template v-if="a.type === 'generic'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </template>
              <PlatformIcon v-else :platform-id="a.id" :size="16" />
              <span class="project-list-name">{{ a.name }}</span>
              <span class="project-list-path">/{{ a.path }}</span>
              <div class="project-checkbox" :class="{ checked: selectedAgentDirs.includes(a.path) }">
                <svg v-if="selectedAgentDirs.includes(a.path)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
            <div class="project-path-row" style="margin-top:4px">
              <input v-model="customDirInput" placeholder="+ 自定义目录路径，如 .claude/skills" class="project-path-input" />
            </div>
          </div>

          <!-- Install button for project mode -->
          <div class="install-toolbar">
            <button class="install-all-btn" :disabled="installing || !selectedProjectsForDist.length" @click="install">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              {{ installing ? (installProgressText || '安装中...') : '安装到所选项目' }}
            </button>
          </div>
        </template>

        <!-- Global mode -->
        <template v-if="distScope === 'global'">
          <div v-if="uninstalledPlatforms.length > 0" class="install-toolbar">
            <div class="install-toolbar-left">
              <button class="select-all-btn" @click="toggleAllPlatforms">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><polyline points="9 11 12 14 22 4"/></svg>
                {{ selectedPlatforms.length === totalUninstalled && totalUninstalled > 0 ? '取消全选' : '全选' }} <span v-if="totalUninstalled > 0" class="selected-count">共 {{ totalUninstalled }} 个</span>
              </button>
              <span v-if="selectedPlatforms.length > 0" class="selected-count">已选 {{ selectedPlatforms.length }}</span>
            </div>
            <button class="install-all-btn" :disabled="installing || !selectedPlatforms.length" @click="install">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              {{ installing ? (installProgressText || '安装中...') : '安装所选平台' }}
            </button>
          </div>

          <div class="platform-grid">
            <div v-for="p in platforms" :key="p.id"
              class="platform-card"
              :class="{
                installed: isInstalled(p.id),
                source: sourcePlatformIds.has(p.id),
                existing: physicallyInstalledPlatforms.has(p.id) && !isInstalled(p.id) && !sourcePlatformIds.has(p.id),
                selected: !isInstalled(p.id) && !sourcePlatformIds.has(p.id) && selectedPlatforms.includes(p.id)
              }"
              @click="!isInstalled(p.id) && !sourcePlatformIds.has(p.id) && !installing && togglePlatform(p.id)"
            >
              <div class="platform-card-row">
                <PlatformIcon :platform-id="p.id" :size="22" />
                <div class="platform-card-info">
                  <h4 class="platform-card-name">{{ p.name }}</h4>
                  <span v-if="isInstalled(p.id)" class="platform-status-badge installed">已分发</span>
                  <span v-else-if="sourcePlatformIds.has(p.id)" class="platform-status-badge source">源文件</span>
                  <span v-else-if="physicallyInstalledPlatforms.has(p.id) && selectedPlatforms.includes(p.id)" class="platform-status-badge existing">覆盖</span>
                  <span v-else-if="physicallyInstalledPlatforms.has(p.id)" class="platform-status-badge existing">已存在</span>
                  <span v-else-if="selectedPlatforms.includes(p.id)" class="platform-status-badge selected">待分发</span>
                  <span v-else class="platform-status-badge">点击选择</span>
                </div>
                <template v-if="isInstalled(p.id)">
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <button class="uninstall-link" @click.stop="showUninstallConfirm(p.id)">卸载</button>
                </template>
                <template v-else-if="sourcePlatformIds.has(p.id)">
                  <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </template>
                <div v-else class="platform-checkbox" :class="{ checked: selectedPlatforms.includes(p.id) }">
                  <svg v-if="selectedPlatforms.includes(p.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </SkillDetailBase>

  <!-- Uninstall confirm dialog -->
  <div v-if="confirmUninstall" class="confirm-overlay" @click.self="cancelUninstall">
    <div class="confirm-dialog">
      <div class="confirm-header">确认卸载</div>
      <div class="confirm-body">确定从 <strong>{{ confirmUninstall.platformName }}</strong> 卸载此技能吗？</div>
      <div class="confirm-actions">
        <button class="confirm-cancel" @click="cancelUninstall">取消</button>
        <button class="confirm-ok" @click="uninstall(confirmUninstall.platformId)">确认卸载</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.platform-panel { padding: 16px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 14px; }
.section-heading { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; }
.section-heading-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section-heading-row .section-heading { margin-bottom: 0; }
.section-badge { font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

.mode-toggle { display: flex; gap: 4px; padding: 3px; background: hsl(var(--accent) / 0.4); border-radius: 10px; margin-bottom: 8px; }
.mode-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.mode-toggle button.active { background: hsl(var(--card)); color: hsl(var(--primary)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.08); }
.mode-desc { font-size: 11px; line-height: 1.5; color: hsl(var(--muted-foreground)); margin: 0 0 16px; }

.scope-toggle { display: flex; gap: 4px; padding: 3px; background: hsl(var(--accent) / 0.4); border-radius: 10px; margin-bottom: 8px; }
.scope-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.scope-toggle button.active { background: hsl(var(--card)); color: hsl(var(--primary)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.08); }

.project-list-label { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 8px; }
.project-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.project-select-all { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; color: hsl(var(--muted-foreground)); cursor: pointer; border-radius: 6px; transition: color var(--duration-base) var(--ease-standard); }
.project-select-all:hover { color: hsl(var(--foreground)); background: hsl(var(--accent) / 0.3); }
.project-select-all .selected-count { margin-left: auto; font-size: 11px; }
.project-list-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.project-list-item:hover { background: hsl(var(--accent) / 0.45); border-color: hsl(var(--primary) / 0.3); }
.project-list-item.active { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); }
.project-list-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.project-list-name { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); }
.project-list-path { font-size: 10px; color: hsl(var(--muted-foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-list-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.project-list-radio.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.project-list-radio.checked svg { color: #fff; }
.project-checkbox { width: 18px; height: 18px; border-radius: 5px; border: 2px solid hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.project-checkbox.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.project-checkbox.checked svg { color: #fff; }
.project-path-row { display: flex; align-items: center; gap: 6px; }
.project-path-input { flex: 1; padding: 8px 10px; font-size: 12px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.3); color: hsl(var(--foreground)); outline: none; font-family: inherit; }
.project-path-input::placeholder { color: hsl(var(--muted-foreground)); }
.project-path-input:focus { border-color: hsl(var(--primary) / 0.5); }


.install-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; background: hsl(var(--accent) / 0.3); border: 1px solid hsl(var(--border)); border-radius: 12px; margin-bottom: 12px; }
.install-toolbar-left { display: flex; align-items: center; gap: 8px; }
.select-all-btn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: hsl(var(--muted-foreground)); background: none; border: none; cursor: pointer; padding: 0; transition: color var(--duration-base) var(--ease-standard); }
.select-all-btn:hover { color: hsl(var(--foreground)); }
.selected-count { font-size: 11px; color: hsl(var(--muted-foreground)); }
.install-all-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 12px; font-weight: 600; border-radius: 10px; border: none; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); cursor: pointer; box-shadow: 0 4px 12px hsl(var(--primary) / 0.3); transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; }
.install-all-btn:disabled { background: hsl(var(--muted-foreground) / 0.4); color: hsl(var(--muted-foreground)); box-shadow: none; cursor: default; }
.install-all-btn:not(:disabled):hover { background: hsl(var(--primary) / 0.9); }

.platform-grid { display: flex; flex-direction: column; gap: 6px; }
.platform-card { padding: 10px 12px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.platform-card:not(.installed):not(.source):hover { background: hsl(var(--accent) / 0.45); border-color: hsl(var(--primary) / 0.3); }
.platform-card.installed { border-color: hsl(142 50% 50% / 0.25); background: hsl(var(--primary) / 0.05); cursor: default; }
.platform-card.source { border-color: hsl(var(--primary) / 0.2); background: hsl(var(--primary) / 0.03); cursor: default; }
.platform-card.existing { border-color: hsl(38 80% 50% / 0.2); background: hsl(38 80% 50% / 0.03); }
.platform-card.selected { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); }
.platform-card-row { display: flex; align-items: center; gap: 10px; }
.platform-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.platform-card-name { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); white-space: nowrap; }
.platform-card-status { font-size: 10px; color: hsl(var(--muted-foreground)); }
.platform-status-badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; line-height: 1.6; display: inline-block; }
.platform-status-badge.installed { background: hsl(142 50% 92%); color: hsl(142 50% 35%); border: 1px solid hsl(142 50% 50% / 0.2); }
.platform-status-badge.source { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.2); }
.platform-status-badge.existing { background: hsl(38 80% 92%); color: hsl(38 90% 35%); border: 1px solid hsl(38 80% 50% / 0.2); }
.platform-status-badge.selected { background: hsl(var(--primary) / 0.08); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.15); }
.check-icon { color: hsl(var(--primary)); flex-shrink: 0; }
.platform-checkbox { width: 18px; height: 18px; border-radius: 5px; border: 2px solid hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.platform-checkbox.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.platform-checkbox.checked svg { color: #fff; }
.uninstall-link { font-size: 10px; color: hsl(var(--destructive)); background: none; border: none; cursor: pointer; padding: 0; text-decoration: underline; flex-shrink: 0; }

.header-update-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  white-space: nowrap;
  flex-shrink: 0;
}
.header-update-btn:hover:not(:disabled) { border-color: hsl(var(--primary) / 0.3); color: hsl(var(--foreground)); }
.header-update-btn:disabled { opacity: 0.5; cursor: default; }
.header-update-btn.update-available { color: hsl(142 50% 45%); border-color: hsl(142 50% 45% / 0.3); }
.header-update-btn.update-available:hover:not(:disabled) { background: hsl(142 50% 45% / 0.08); }

.confirm-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.confirm-dialog { width: 360px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 16px; padding: 24px; box-shadow: 0 20px 60px hsl(0 0% 0% / 0.15); }
.confirm-header { font-size: 16px; font-weight: 700; color: hsl(var(--foreground)); margin-bottom: 12px; }
.confirm-body { font-size: 14px; color: hsl(var(--muted-foreground)); line-height: 1.6; margin-bottom: 20px; }
.confirm-body strong { color: hsl(var(--foreground)); }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.confirm-cancel { padding: 8px 16px; font-size: 13px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground)); cursor: pointer; }
.confirm-cancel:hover { background: hsl(var(--muted)); }
.confirm-ok { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); cursor: pointer; }

.empty { text-align: center; padding: 60px; color: hsl(var(--muted-foreground)); }

.project-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; align-items: center; }
.project-action-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; font-size: 13px; font-weight: 600; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.project-action-btn:hover { background: hsl(var(--muted)); }
.project-action-btn:disabled { opacity: 0.5; cursor: default; }
.project-action-btn.imported-tag { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; font-size: 13px; font-weight: 600; border-radius: 10px; border: none; background: rgb(222, 242, 231); color: #166534; cursor: default; }
.project-action-btn.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }
.project-action-btn.primary:hover { opacity: 0.9; }

.project-info { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: hsl(var(--accent) / 0.3); border-radius: 10px; }
.project-info-row { display: flex; align-items: center; gap: 8px; }
.project-info-label { font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.05em; min-width: 32px; }
.project-info-value { font-size: 12px; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-info-value.mono { font-family: 'SF Mono', Consolas, monospace; font-size: 11px; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }
</style>
