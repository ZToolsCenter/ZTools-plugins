<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import { detectPlatforms } from '../data/platforms'
import { storage } from '../utils/storage'
import { normalizePath } from '../utils/path'
import type { Skill, InstallMode, InstallRecord, RegisteredProject } from '../types'
import PlatformIcon from './PlatformIcon.vue'
import ConfirmModal from './ConfirmModal.vue'

const props = defineProps<{
  skill: Skill
  installMode: InstallMode
  installing: boolean
  installProgressText: string
}>()

const emit = defineEmits<{
  'update:installMode': [mode: InstallMode]
  'install-started': []
  'install-finished': []
}>()

const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})
const selectedProject = inject<any>('selectedProject', null)
const registeredProjects = inject<any>('registeredProjects', ref([]))
const selectProject = inject<(project: RegisteredProject) => void>('selectProject', () => {})
const navigateToProjectSkills = inject<() => void>('navigateToProjectSkills', () => {})

const projectList = computed(() => registeredProjects.value || [])
const selectedProjects = ref<RegisteredProject[]>([])
const selectedAgentDirs = ref<string[]>([])
const customDirInput = ref('')

const showStatusBadges = computed(() => selectedProjects.value.length === 1 && selectedAgentDirs.value.length < 2)
const installRecords = ref<InstallRecord[]>([])
const installLog = ref<{ platform: string; status: 'ok' | 'error' | 'pending'; msg: string }[]>([])

const platforms = computed(() => {
  const saved = storage.getPlatformConfigs()
  return detectPlatforms().filter((p) => p.detected && (p.defaultPath || p.projectPath)).map((p) => {
    const cfg = saved.find((s) => s.id === p.id)
    return cfg ? { ...p, customPath: cfg.customPath, customProjectPath: cfg.customProjectPath } : p
  })
})

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

const skillDirName = computed(() => {
  return props.skill.path ? props.skill.path.split('/').pop() || props.skill.name : props.skill.name
})

const primaryProject = computed(() => selectedProjects.value[0] || null)

function getTargetPath(agentPath: string, project?: RegisteredProject): string {
  const p = project || primaryProject.value
  if (!p) return ''
  return window.services.pathJoin(p.rootDir, agentPath, skillDirName.value)
}

function getPhysicallyExistingAgentDirs(project: RegisteredProject): Set<string> {
  const result = new Set<string>()
  for (const a of agentDirOptions.value) {
    const baseDir = window.services.pathJoin(project.rootDir, a.path)
    if (!window.services.pathExists(baseDir)) continue
    const existingSkills = window.services.scanForSkillFiles([baseDir])
    const exists = existingSkills.some(
      (s: any) => s.dir.includes(skillDirName.value) || (s.manifest?.name || s.name).toLowerCase() === props.skill.name.toLowerCase()
    )
    if (exists) result.add(a.path)
  }
  return result
}

const physicallyExistingAgentDirs = computed(() => {
  if (!selectedProjects.value.length || !primaryProject.value) return new Set<string>()
  return getPhysicallyExistingAgentDirs(primaryProject.value)
})

function getSourceAgentDirs(project: RegisteredProject): Set<string> {
  const result = new Set<string>()
  if (props.skill.source !== 'local' || !props.skill.path) return result
  const skillPath = normalizePath(props.skill.path)
  const projectRoot = normalizePath(project.rootDir)
  if (!skillPath.startsWith(projectRoot)) return result
  for (const a of agentDirOptions.value) {
    const agentFull = normalizePath(window.services.pathJoin(projectRoot, a.path))
    if (skillPath.startsWith(agentFull)) {
      result.add(a.path)
    }
  }
  return result
}

const sourceAgentDirs = computed(() => {
  if (!selectedProjects.value.length || !primaryProject.value) return new Set<string>()
  return getSourceAgentDirs(primaryProject.value)
})

function makeRecordKey(agentPath: string, projectId?: string): string {
  const pid = projectId || primaryProject.value?.id || 'unknown'
  return `project:${pid}/${agentPath}`
}

function isInstalled(agentPath: string, projectId?: string): boolean {
  const key = makeRecordKey(agentPath, projectId)
  return installRecords.value.some((r) => r.platformId === key && r.scope === 'project')
}

const uninstalledAgentDirs = computed(() =>
  agentDirOptions.value.filter((a) => !isInstalled(a.path) && !sourceAgentDirs.value.has(a.path))
)
const totalUninstalled = computed(() => uninstalledAgentDirs.value.length)

function loadInstallStatus() {
  const allRecords = storage.getInstallRecords()
  const pids = new Set(selectedProjects.value.map((p) => p.id))
  if (primaryProject.value?.id) pids.add(primaryProject.value.id)
  if (!pids.size) { installRecords.value = []; return }
  installRecords.value = allRecords.filter((r) => {
    if (r.scope !== 'project') return false
    for (const pid of pids) {
      if (r.platformId.startsWith(`project:${pid}/`)) return true
    }
    return false
  })
}

const confirmUninstall = ref(false)
const uninstallTarget = ref<{ agentPath: string; projectId: string } | null>(null)

function confirmUninstallItem(agentPath: string) {
  if (!selectedProjects.value.length) return
  const pid = selectedProjects.value[0].id
  uninstallTarget.value = { agentPath, projectId: pid }
  confirmUninstall.value = true
}

function cancelUninstall() {
  confirmUninstall.value = false
  uninstallTarget.value = null
}

async function uninstall() {
  const target = uninstallTarget.value
  if (!target) { cancelUninstall(); return }
  const key = makeRecordKey(target.agentPath, target.projectId)
  const record = installRecords.value.find((r) => r.platformId === key)
  if (!record) { cancelUninstall(); return }

  try {
    if (record.targetPath && window.services.pathExists(record.targetPath)) {
      window.services.removeFile(record.targetPath)
    }
    storage.removeInstallRecord(props.skill.id, key, 'project')
    loadInstallStatus()
    showToast(`已从项目卸载`, 'success')
  } catch (err: any) {
    showToast('卸载失败: ' + (err.message || '未知错误'), 'error')
  }
  cancelUninstall()
}

function toggleProject(p: RegisteredProject) {
  const idx = selectedProjects.value.findIndex((sp) => sp.id === p.id)
  if (idx >= 0) selectedProjects.value.splice(idx, 1)
  else selectedProjects.value.push(p)
}

function isSelectedProject(p: RegisteredProject): boolean {
  return selectedProjects.value.some((sp) => sp.id === p.id)
}

function toggleAllProjects() {
  if (selectedProjects.value.length === projectList.value.length) {
    selectedProjects.value = []
  } else {
    selectedProjects.value = [...projectList.value]
  }
}

function toggleAgentDir(path: string) {
  const idx = selectedAgentDirs.value.indexOf(path)
  if (idx >= 0) selectedAgentDirs.value.splice(idx, 1)
  else selectedAgentDirs.value.push(path)
}

function toggleAllAgentDirs() {
  if (!showStatusBadges.value) {
    const allPaths = agentDirOptions.value.map((a) => a.path)
    selectedAgentDirs.value = selectedAgentDirs.value.length === allPaths.length ? [] : [...allPaths]
  } else {
    const available = uninstalledAgentDirs.value.map((a) => a.path)
    selectedAgentDirs.value = selectedAgentDirs.value.length === available.length ? [] : [...available]
  }
}

function addLog(platform: string, status: 'ok' | 'error' | 'pending', msg: string) {
  installLog.value.push({ platform, status, msg })
}

async function install() {
  const projects = selectedProjects.value
  if (!projects.length) { showToast('请先选择项目', 'error'); return }
  const agentPaths = [...selectedAgentDirs.value]
  if (customDirInput.value && !agentPaths.includes(customDirInput.value)) {
    agentPaths.push(customDirInput.value)
  }
  if (!agentPaths.length) { showToast('请指定保存位置', 'error'); return }

  emit('install-started')
  installLog.value = []
  const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
  const installedNames: string[] = []

  for (const project of projects) {
    for (const agentPath of agentPaths) {
      const targetDir = getTargetPath(agentPath, project)

      if (!showStatusBadges.value) {
        const key = makeRecordKey(agentPath, project.id)
        const alreadyInstalled = storage.getInstallRecords().some(
          (r) => r.skillId === props.skill.id && r.platformId === key && r.scope === 'project'
        )
        if (alreadyInstalled) {
          addLog(`${project.name}/${agentPath}`, 'ok', '已存在，跳过')
          continue
        }
      }

      try {
        window.services.mkdir(targetDir)
        if (props.installMode === 'symlink') {
          window.services.createSymlink(sourceDir, targetDir)
          addLog(`${project.name}/${agentPath}`, 'ok', `Symlink: ${targetDir}`)
        } else {
          window.services.copyFile(sourceDir, targetDir)
          addLog(`${project.name}/${agentPath}`, 'ok', `Copied: ${targetDir}`)
        }
        storage.saveInstallRecord({
          skillId: props.skill.id,
          platformId: makeRecordKey(agentPath, project.id),
          mode: props.installMode,
          scope: 'project',
          targetPath: targetDir,
          sourceDir: props.skill.repo || '',
          installedAt: new Date().toISOString(),
        })
        installedNames.push(`${project.name}/${agentPath}`)
      } catch (err: any) {
        addLog(`${project.name}/${agentPath}`, 'error', err.message)
      }
    }
  }

  if (installedNames.length) {
    const detail = installedNames.length === 1 ? installedNames[0] : `${installedNames.length} 个位置：${installedNames.join('、')}`
    showToast(`已将 ${props.skill.name} 分发到${detail}`, 'success')
  }
  loadInstallStatus()
  selectedAgentDirs.value = []
  customDirInput.value = ''
  emit('install-finished')
}

watch(() => props.skill.id, () => { loadInstallStatus(); selectedAgentDirs.value = []; customDirInput.value = '' })
watch(() => selectedProjects.value.map((p) => p.id), () => { loadInstallStatus(); selectedAgentDirs.value = [] })
loadInstallStatus()
</script>

<template>
  <div class="project-dist-panel">
    <div class="mode-toggle">
      <button :class="{ active: installMode === 'copy' }" @click="emit('update:installMode', 'copy')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        复制
      </button>
      <button :class="{ active: installMode === 'symlink' }" @click="emit('update:installMode', 'symlink')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        软链接
      </button>
    </div>
    <p class="mode-desc">{{ installMode === 'copy' ? '将 SKILL.md 复制到每个平台目录，各平台独立更新。' : '创建指向源文件的软链接，所有平台共享同一文件，编辑即时同步。' }}</p>

    <div class="project-select-section">
      <div class="section-heading-row">
        <h4 class="section-heading">选择项目</h4>
        <div class="section-heading-actions">
          <button v-if="projectList.length > 1" class="select-all-projects-btn" @click="toggleAllProjects">
            {{ selectedProjects.length === projectList.length ? '取消全选' : '全选' }}
          </button>
          <button class="add-project-btn" @click="navigateToProjectSkills">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加项目
          </button>
        </div>
      </div>
      <div v-if="projectList.length > 0" class="project-select-list">
        <div
          v-for="p in projectList"
          :key="p.id"
          class="project-select-item"
          :class="{ active: isSelectedProject(p) }"
          @click="toggleProject(p)"
        >
          <div class="project-select-checkbox" :class="{ checked: isSelectedProject(p) }">
            <svg v-if="isSelectedProject(p)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="project-select-name">{{ p.name }}</span>
        </div>
      </div>
      <div v-else class="no-project-hint">暂无项目，请先添加</div>
      <div class="selected-projects-hint">{{ selectedProjects.length ? `已选 ${selectedProjects.length} 个项目，将同时分发到所有选中项目` : '尚未选择项目' }}</div>
    </div>

    <div v-if="selectedProjects.length" class="install-toolbar">
      <div class="install-toolbar-row">
        <button class="select-all-btn" :class="{ active: selectedAgentDirs.length === totalUninstalled && totalUninstalled > 0 }" @click="toggleAllAgentDirs">
          <svg v-if="selectedAgentDirs.length === totalUninstalled && totalUninstalled > 0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 12l2 2 4-4"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
          {{ selectedAgentDirs.length === totalUninstalled && totalUninstalled > 0 ? '取消全选' : '全选' }}
        </button>
        <button class="install-all-btn" :disabled="installing || !selectedAgentDirs.length || !selectedProjects.length" @click="install">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {{ installing ? (installProgressText || '安装中...') : (selectedProjects.length > 1 ? `安装到 ${selectedProjects.length} 个项目` : '安装所选位置') }}
        </button>
      </div>
      <div class="install-toolbar-stats">
        <span v-if="totalUninstalled > 0" class="selected-count">共 {{ totalUninstalled }} 个</span>
        <span v-if="selectedAgentDirs.length > 0" class="selected-count">已选 {{ selectedAgentDirs.length }}</span>
        <span v-if="selectedProjects.length > 0" class="selected-count">项目 {{ selectedProjects.length }}/{{ projectList.length }}</span>
      </div>
    </div>

    <div v-if="!selectedProjects.length" class="no-project-placeholder">请先选择项目</div>
    <div v-else class="platform-grid">
      <div v-for="a in agentDirOptions" :key="a.id"
        class="platform-card"
        :class="{
          installed: showStatusBadges && isInstalled(a.path),
          source: showStatusBadges && sourceAgentDirs.has(a.path),
          existing: showStatusBadges && physicallyExistingAgentDirs.has(a.path) && !isInstalled(a.path) && !sourceAgentDirs.has(a.path),
          selected: selectedAgentDirs.includes(a.path)
        }"
        @click="!installing && (showStatusBadges ? (!isInstalled(a.path) && !sourceAgentDirs.has(a.path)) : true) && toggleAgentDir(a.path)"
      >
        <div class="platform-card-row">
          <PlatformIcon :platform-id="a.type === 'generic' ? '_generic' : a.id" :size="22" />
          <div class="platform-card-info">
            <h4 class="platform-card-name">{{ a.name }} <span class="platform-dir-path">/{{ a.path }}</span></h4>
            <template v-if="showStatusBadges">
              <span v-if="isInstalled(a.path)" class="platform-status-badge installed">已分发</span>
              <span v-else-if="sourceAgentDirs.has(a.path)" class="platform-status-badge source">源文件</span>
              <span v-else-if="physicallyExistingAgentDirs.has(a.path) && selectedAgentDirs.includes(a.path)" class="platform-status-badge existing">覆盖</span>
              <span v-else-if="physicallyExistingAgentDirs.has(a.path)" class="platform-status-badge existing">已存在</span>
              <span v-else-if="selectedAgentDirs.includes(a.path)" class="platform-status-badge selected">待分发</span>
              <span v-else class="platform-status-badge">点击选择</span>
            </template>
          </div>
          <template v-if="showStatusBadges && isInstalled(a.path)">
            <button class="uninstall-btn" title="卸载" @click.stop="confirmUninstallItem(a.path)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </template>
          <template v-else-if="showStatusBadges && sourceAgentDirs.has(a.path)">
            <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </template>
          <div v-else class="platform-checkbox" :class="{ checked: selectedAgentDirs.includes(a.path) }">
            <svg v-if="selectedAgentDirs.includes(a.path)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      </div>
      <div class="custom-dir-row">
        <input v-model="customDirInput" placeholder="+ 自定义目录路径，如 .claude/skills" class="custom-dir-input" />
      </div>
    </div>
  </div>
  <ConfirmModal v-if="confirmUninstall" title="卸载 Skill" :message="`确定要从项目卸载 <strong>${props.skill.name}</strong> 吗？`" @confirm="uninstall" @cancel="cancelUninstall" />
</template>

<style scoped>
.project-dist-panel { display: flex; flex-direction: column; gap: 12px; }

.mode-toggle { display: flex; gap: 4px; padding: 3px; background: hsl(var(--accent) / 0.4); border-radius: 10px; }
.mode-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.mode-toggle button.active { background: hsl(var(--card)); color: hsl(var(--primary)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.08); }
.mode-desc { font-size: 11px; line-height: 1.5; color: hsl(var(--muted-foreground)); margin: 0; }

.project-select-section { display: flex; flex-direction: column; gap: 8px; }
.section-heading-row { display: flex; align-items: center; justify-content: space-between; }
.section-heading-actions { display: flex; align-items: center; gap: 6px; }
.section-heading { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; margin: 0; }
.select-all-projects-btn { display: flex; align-items: center; gap: 3px; padding: 4px 8px; font-size: 11px; font-weight: 600; border-radius: 5px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.3); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; }
.select-all-projects-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.add-project-btn { display: flex; align-items: center; gap: 3px; padding: 4px 8px; font-size: 11px; font-weight: 600; border-radius: 5px; border: 1px solid hsl(var(--primary) / 0.3); background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; }
.add-project-btn:hover { background: hsl(var(--primary) / 0.2); }
.project-select-list { display: flex; flex-direction: column; gap: 4px; }
.project-select-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.project-select-item:hover { background: hsl(var(--accent) / 0.45); border-color: hsl(var(--primary) / 0.3); }
.project-select-item.active { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); }
.project-select-checkbox { width: 18px; height: 18px; border-radius: 5px; border: 2px solid hsl(var(--border)); background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.project-select-checkbox.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.project-select-checkbox.checked svg { color: #fff; }
.project-select-name { font-size: 12px; font-weight: 600; color: hsl(var(--primary)); flex: 1; }
.project-select-check { color: hsl(var(--primary)); flex-shrink: 0; }
.no-project-hint { padding: 10px 12px; border-radius: 8px; border: 1px dashed hsl(var(--border)); background: hsl(var(--accent) / 0.1); font-size: 12px; color: hsl(var(--muted-foreground)); text-align: center; }
.selected-projects-hint { padding: 8px 12px; border-radius: 8px; background: hsl(var(--primary) / 0.08); border: 1px solid hsl(var(--primary) / 0.15); font-size: 11px; color: hsl(var(--primary)); text-align: center; }

.install-toolbar { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: hsl(var(--accent) / 0.3); border: 1px solid hsl(var(--border)); border-radius: 12px; }
.install-toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.install-toolbar-stats { display: flex; align-items: center; gap: 12px; }
.select-all-btn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: hsl(var(--muted-foreground)); background: none; border: none; cursor: pointer; padding: 0; transition: color var(--duration-base) var(--ease-standard); }
.select-all-btn:hover { color: hsl(var(--foreground)); }
.select-all-btn.active { color: hsl(var(--primary)); }
.selected-count { font-size: 11px; color: hsl(var(--muted-foreground)); }
.install-all-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 12px; font-weight: 600; border-radius: 10px; border: none; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); cursor: pointer; box-shadow: 0 4px 12px hsl(var(--primary) / 0.3); transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; }
.install-all-btn:disabled { background: hsl(var(--muted-foreground) / 0.4); color: hsl(var(--muted-foreground)); box-shadow: none; cursor: default; }
.install-all-btn:not(:disabled):hover { background: hsl(var(--primary) / 0.9); }

.no-project-placeholder { padding: 32px 12px; border-radius: 10px; border: 1px dashed hsl(var(--border)); background: hsl(var(--accent) / 0.1); text-align: center; font-size: 12px; color: hsl(var(--muted-foreground)); }
.platform-grid { display: flex; flex-direction: column; gap: 6px; }
.platform-card { padding: 10px 12px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; min-height: 44px; box-sizing: border-box; transition: background var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard); }
.platform-card:hover { background: hsl(var(--accent) / 0.45); border-color: hsl(var(--primary) / 0.3); }
.platform-card.installed:hover, .platform-card.source:hover { background: hsl(var(--accent) / 0.15); border-color: hsl(var(--border)); cursor: default; }
.platform-card.installed { border-color: hsl(142 50% 50% / 0.25); background: hsl(var(--primary) / 0.05); cursor: default; }
.platform-card.source { border-color: hsl(var(--primary) / 0.2); background: hsl(var(--primary) / 0.03); cursor: default; }
.platform-card.existing { border-color: hsl(38 80% 50% / 0.2); background: hsl(38 80% 50% / 0.03); }
.platform-card.selected { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); }
.platform-card-row { display: flex; align-items: center; gap: 10px; min-height: 24px; }
.platform-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center; }
.platform-card-name { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); white-space: nowrap; display: flex; align-items: baseline; gap: 6px; }
.platform-card-name .platform-dir-path { font-size: 10px; font-weight: 400; color: hsl(var(--muted-foreground)); }
.platform-status-badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; line-height: 1.6; display: inline-block; min-width: 36px; text-align: center; }
.platform-status-badge.installed { background: hsl(142 50% 92%); color: hsl(142 50% 35%); border: 1px solid hsl(142 50% 50% / 0.2); }
.platform-status-badge.source { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.2); }
.platform-status-badge.existing { background: hsl(38 80% 92%); color: hsl(38 90% 35%); border: 1px solid hsl(38 80% 50% / 0.2); }
.platform-status-badge.selected { background: hsl(var(--primary) / 0.08); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.15); }
.check-icon { color: hsl(var(--primary)); flex-shrink: 0; }
.uninstall-btn { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid hsl(var(--destructive) / 0.2); background: hsl(var(--destructive) / 0.08); color: hsl(var(--destructive)); cursor: pointer; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); padding: 0; }
.uninstall-btn:hover { background: hsl(var(--destructive) / 0.15); border-color: hsl(var(--destructive) / 0.4); }
.platform-checkbox { width: 18px; height: 18px; border-radius: 5px; border: 2px solid hsl(var(--border)); background: transparent; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.platform-checkbox.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.platform-checkbox.checked svg { color: #fff; }

.custom-dir-row { margin-top: 4px; }
.custom-dir-input { width: 100%; padding: 8px 10px; font-size: 12px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.3); color: hsl(var(--foreground)); outline: none; font-family: inherit; box-sizing: border-box; }
.custom-dir-input::placeholder { color: hsl(var(--muted-foreground)); }
.custom-dir-input:focus { border-color: hsl(var(--primary) / 0.5); }
</style>
