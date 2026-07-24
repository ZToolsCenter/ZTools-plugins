<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import { detectPlatforms } from '../data/platforms'
import { storage } from '../utils/storage'
import { normalizePath } from '../utils/path'
import type { Skill, InstallMode, InstallRecord } from '../types'
import PlatformIcon from './PlatformIcon.vue'
import ConfirmModal from './ConfirmModal.vue'
import { useDownloadQueue } from '../composables/useDownloadQueue'

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
const { addInstall, updateItem } = useDownloadQueue()

const selectedPlatforms = ref<string[]>([])
const installRecords = ref<InstallRecord[]>([])
const installLog = ref<{ platform: string; status: 'ok' | 'error' | 'pending'; msg: string }[]>([])

const platforms = computed(() => {
  const saved = storage.getPlatformConfigs()
  return detectPlatforms().filter((p) => p.detected && (p.defaultPath || p.projectPath)).map((p) => {
    const cfg = saved.find((s) => s.id === p.id)
    return cfg ? { ...p, customPath: cfg.customPath, customProjectPath: cfg.customProjectPath } : p
  })
})

const physicallyInstalledPlatforms = computed(() => {
  const result = new Set<string>()
  const skillDir = props.skill.path ? props.skill.path.split('/').pop() || props.skill.name : props.skill.name
  for (const p of platforms.value) {
    const base = p.customPath || p.defaultPath
    if (!base) continue
    const expandedBase = base.replace(/^~/, window.services.homeDir())
    if (!window.services.pathExists(expandedBase)) continue
    const existingSkills = window.services.scanForSkillFiles([expandedBase])
    const exists = existingSkills.some(
      (s) => s.dir.includes(skillDir) || (s.manifest?.name || s.name).toLowerCase() === props.skill.name.toLowerCase()
    )
    if (exists) result.add(p.id)
  }
  return result
})

const sourcePlatformIds = computed(() => {
  const result = new Set<string>()
  if (props.skill.source !== 'local' || !props.skill.path) return result
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

function isInstalled(platformId: string): boolean {
  return installRecords.value.some((r) => r.platformId === platformId && (!(r as any).scope || (r as any).scope === 'global'))
}

const uninstalledPlatforms = computed(() => platforms.value.filter((p) => !isInstalled(p.id) && !sourcePlatformIds.value.has(p.id)))
const totalUninstalled = computed(() => uninstalledPlatforms.value.length)

function loadInstallStatus() {
  installRecords.value = storage.getInstalledForSkill(props.skill.id)
}

const confirmUninstall = ref(false)
const uninstallPlatformId = ref('')

function confirmUninstallPlatform(id: string) {
  uninstallPlatformId.value = id
  confirmUninstall.value = true
}

function cancelUninstall() {
  confirmUninstall.value = false
  uninstallPlatformId.value = ''
}

async function uninstall() {
  const pid = uninstallPlatformId.value
  const record = installRecords.value.find((r) => r.platformId === pid)
  if (!record) { cancelUninstall(); return }

  try {
    if (record.targetPath && window.services.pathExists(record.targetPath)) {
      window.services.removeFile(record.targetPath)
    }
    storage.removeInstallRecord(props.skill.id, pid, 'global')
    loadInstallStatus()
    showToast(`已从 ${pid} 卸载`, 'success')
  } catch (err: any) {
    showToast('卸载失败: ' + (err.message || '未知错误'), 'error')
  }
  cancelUninstall()
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

function addLog(platform: string, status: 'ok' | 'error' | 'pending', msg: string) {
  installLog.value.push({ platform, status, msg })
}

async function install() {
  if (!selectedPlatforms.value.length) { showToast('请先选择平台', 'error'); return }
  emit('install-started')
  installLog.value = []
  const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
  const skillDir = props.skill.path ? props.skill.path.split('/').pop()! : props.skill.name
  const installedNames: string[] = []

  const platformNames = selectedPlatforms.value.map(pid => {
    const p = platforms.value.find(p => p.id === pid)
    return p?.name || pid
  })
  const queueItem = addInstall(props.skill.id, props.skill.name, platformNames)

  for (const pid of selectedPlatforms.value) {
    const platform = platforms.value.find((p) => p.id === pid)
    if (!platform) continue
    const base = platform.customPath || platform.defaultPath
    if (!base) { addLog(pid, 'error', '未配置路径'); continue }
    const targetDir = window.services.pathJoin(base.replace(/^~/, window.services.homeDir()), skillDir)
    try {
      window.services.mkdir(targetDir)
      if (props.installMode === 'symlink') { window.services.createSymlink(sourceDir, targetDir); addLog(pid, 'ok', `Symlink: ${targetDir}`) }
      else { window.services.copyFile(sourceDir, targetDir); addLog(pid, 'ok', `Copied: ${targetDir}`) }
      storage.saveInstallRecord({ skillId: props.skill.id, platformId: pid, mode: props.installMode, scope: 'global', targetPath: targetDir, sourceDir: props.skill.repo || '', installedAt: new Date().toISOString() })
      installedNames.push(platform.name)
    } catch (err: any) { addLog(pid, 'error', err.message) }
  }

  if (installedNames.length) {
    updateItem(queueItem.id, { status: 'success' })
    const detail = installedNames.length === 1 ? installedNames[0] : `${installedNames.length} 个平台：${installedNames.join('、')}`
    showToast(`已将 ${props.skill.name} 分发到${detail}`, 'success')
  } else {
    updateItem(queueItem.id, { status: 'error', error: '安装失败' })
  }

  loadInstallStatus()
  selectedPlatforms.value = []
  emit('install-finished')
}

watch(() => props.skill.id, () => { loadInstallStatus(); selectedPlatforms.value = [] })
loadInstallStatus()
</script>

<template>
  <div class="global-dist-panel">
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

    <div v-if="uninstalledPlatforms.length > 0" class="install-toolbar">
      <div class="install-toolbar-row">
        <button class="select-all-btn" :class="{ active: selectedPlatforms.length === totalUninstalled && totalUninstalled > 0 }" @click="toggleAllPlatforms">
          <svg v-if="selectedPlatforms.length === totalUninstalled && totalUninstalled > 0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 12l2 2 4-4"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
          {{ selectedPlatforms.length === totalUninstalled && totalUninstalled > 0 ? '取消全选' : '全选' }}
        </button>
        <button class="install-all-btn" :disabled="installing || !selectedPlatforms.length" @click="install">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {{ installing ? (installProgressText || '安装中...') : '安装所选平台' }}
        </button>
      </div>
      <div class="install-toolbar-stats">
        <span v-if="totalUninstalled > 0" class="selected-count">共 {{ totalUninstalled }} 个</span>
        <span v-if="selectedPlatforms.length > 0" class="selected-count">已选 {{ selectedPlatforms.length }}</span>
      </div>
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
            <button class="uninstall-btn" title="卸载" @click.stop="confirmUninstallPlatform(p.id)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
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
  </div>
  <ConfirmModal v-if="confirmUninstall" title="卸载 Skill" :message="`确定要从该平台卸载 <strong>${props.skill.name}</strong> 吗？`" @confirm="uninstall" @cancel="cancelUninstall" />
</template>

<style scoped>
.global-dist-panel { display: flex; flex-direction: column; gap: 12px; }

.mode-toggle { display: flex; gap: 4px; padding: 3px; background: hsl(var(--accent) / 0.4); border-radius: 10px; }
.mode-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.mode-toggle button.active { background: hsl(var(--card)); color: hsl(var(--primary)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.08); }
.mode-desc { font-size: 11px; line-height: 1.5; color: hsl(var(--muted-foreground)); margin: 0; }

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

.platform-grid { display: flex; flex-direction: column; gap: 6px; }
.platform-card { padding: 10px 12px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.15); cursor: pointer; min-height: 44px; box-sizing: border-box; transition: background var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard); }
.platform-card:not(.installed):not(.source):hover { background: hsl(var(--accent) / 0.45); border-color: hsl(var(--primary) / 0.3); }
.platform-card.installed { border-color: hsl(142 50% 50% / 0.25); background: hsl(var(--primary) / 0.05); cursor: default; }
.platform-card.source { border-color: hsl(var(--primary) / 0.2); background: hsl(var(--primary) / 0.03); cursor: default; }
.platform-card.existing { border-color: hsl(38 80% 50% / 0.2); background: hsl(38 80% 50% / 0.03); }
.platform-card.selected { border-color: hsl(var(--primary) / 0.45); background: hsl(var(--primary) / 0.08); }
.platform-card-row { display: flex; align-items: center; gap: 10px; min-height: 24px; }
.platform-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center; }
.platform-card-name { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); white-space: nowrap; }
.platform-status-badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; line-height: 1.6; display: inline-block; min-width: 36px; text-align: center; border: 1px solid transparent; }
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
</style>
