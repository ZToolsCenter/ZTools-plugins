<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { detectPlatforms } from '../data/platforms'
import { storage } from '../utils/storage'
import type { Skill, InstallMode } from '../types'
import PlatformIcon from './PlatformIcon.vue'
import { getAvatarColor } from '../utils/color'

const props = defineProps<{
  skills: Skill[]
}>()

const emit = defineEmits(['close', 'deployed'])
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})

const installMode = ref<InstallMode>(storage.getSettings().defaultInstallMode)
const selectedPlatforms = ref<Set<string>>(new Set())
const deploying = ref(false)
const deployProgress = ref<{ current: number; total: number; skill: string; platform: string } | null>(null)
const deployResults = ref<{ skill: string; platform: string; status: 'ok' | 'error'; msg: string }[]>([])

const platforms = computed(() => {
  const saved = storage.getPlatformConfigs()
  return detectPlatforms().filter((p) => p.detected && (p.defaultPath || p.projectPath)).map((p) => {
    const cfg = saved.find((s) => s.id === p.id)
    return cfg ? { ...p, customPath: cfg.customPath, customProjectPath: cfg.customProjectPath } : p
  })
})

const selectedCount = computed(() => selectedPlatforms.value.size)

function togglePlatform(id: string) {
  const next = new Set(selectedPlatforms.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedPlatforms.value = next
}

function toggleAll() {
  if (selectedPlatforms.value.size === platforms.value.length) {
    selectedPlatforms.value = new Set()
  } else {
    selectedPlatforms.value = new Set(platforms.value.map((p) => p.id))
  }
}

async function deploy() {
  if (!selectedPlatforms.value.size || deploying.value) return
  deploying.value = true
  deployResults.value = []

  const pids = Array.from(selectedPlatforms.value)
  const totalOps = props.skills.length * pids.length
  let done = 0

  for (const skill of props.skills) {
    const sourceDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skill.id)

    for (const pid of pids) {
      const platform = platforms.value.find((p) => p.id === pid)
      if (!platform) { done++; continue }
      deployProgress.value = { current: done, total: totalOps, skill: skill.name, platform: platform.name }

      const base = platform.customPath || platform.defaultPath
      if (!base) {
        deployResults.value.push({ skill: skill.name, platform: platform.name, status: 'error', msg: '未配置路径' })
        done++
        continue
      }

      const skillDir = (skill.path && skill.path !== '.') ? skill.path.split('/').pop() || skill.name : skill.name
      const targetDir = window.services.pathJoin(base.replace(/^~/, window.services.homeDir()), skillDir)

      try {
        window.services.mkdir(targetDir)
        if (installMode.value === 'symlink') {
          window.services.createSymlink(sourceDir, targetDir)
        } else {
          window.services.copyFile(sourceDir, targetDir)
        }
        storage.saveInstallRecord({
          skillId: skill.id,
          platformId: pid,
          mode: installMode.value,
          scope: 'global',
          targetPath: targetDir,
          sourceDir: skill.repo || '',
          installedAt: new Date().toISOString(),
        })
        deployResults.value.push({ skill: skill.name, platform: platform.name, status: 'ok', msg: installMode.value === 'symlink' ? '已链接' : '已复制' })
      } catch (err: any) {
        deployResults.value.push({ skill: skill.name, platform: platform.name, status: 'error', msg: err.message })
      }
      done++
    }
  }

  deployProgress.value = null
  deploying.value = false

  const okCount = deployResults.value.filter((r) => r.status === 'ok').length
  const errCount = deployResults.value.filter((r) => r.status === 'error').length
  if (okCount > 0) showToast(`已将 ${props.skills.length} 个技能分发到 ${selectedPlatforms.value.size} 个平台`, 'success')
  if (errCount > 0) showToast(`${errCount} 个平台分发失败`, 'error')
  emit('deployed')
}


</script>

<template>
  <div class="deploy-overlay" @click.self="emit('close')">
    <div class="deploy-modal">
      <!-- Header -->
      <div class="deploy-header">
        <div class="deploy-header-info">
          <h3 class="deploy-title">批量分发</h3>
          <span class="deploy-subtitle">{{ skills.length }} 个技能</span>
        </div>
        <button class="deploy-close" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Skill list -->
      <div class="deploy-skill-list">
        <div v-for="skill in skills" :key="skill.id" class="deploy-skill-item">
          <div class="deploy-skill-avatar" :style="{ background: getAvatarColor(skill.name) }">
            {{ skill.name.charAt(0).toUpperCase() }}
          </div>
          <div class="deploy-skill-info">
            <span class="deploy-skill-name">{{ skill.name }}</span>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="deploy-content">
        <!-- Install mode -->
        <div class="deploy-section">
          <h4 class="deploy-section-title">分发方式</h4>
          <div class="mode-toggle">
            <button :class="{ active: installMode === 'copy' }" @click="installMode = 'copy'" :disabled="deploying">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              复制
            </button>
            <button :class="{ active: installMode === 'symlink' }" @click="installMode = 'symlink'" :disabled="deploying">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              软链接
            </button>
          </div>
          <p class="mode-hint">{{ installMode === 'copy' ? '将 SKILL.md 复制到每个平台目录，各平台独立更新。' : '创建指向源文件的软链接，所有平台共享同一文件。' }}</p>
        </div>

        <!-- Platform selection -->
        <div class="deploy-section">
          <div class="deploy-section-header">
            <h4 class="deploy-section-title">选择平台</h4>
            <span class="deploy-section-badge">{{ selectedCount }} / {{ platforms.length }}</span>
            <button class="deploy-select-all" @click="toggleAll" :disabled="deploying">
              {{ selectedCount === platforms.length ? '取消全选' : '全选' }}
            </button>
          </div>

          <div v-if="!platforms.length" class="deploy-empty">
            <p>未检测到已安装的 AI 平台</p>
          </div>
          <div v-else class="deploy-platform-grid">
            <button
              v-for="p in platforms"
              :key="p.id"
              class="deploy-platform-card"
              :class="{
                selected: selectedPlatforms.has(p.id),
                disabled: deploying
              }"
              @click="!deploying && togglePlatform(p.id)"
            >
              <div class="deploy-platform-icon">
                <PlatformIcon :platform-id="p.id" :size="28" />
              </div>
              <div class="deploy-platform-info">
                <span class="deploy-platform-name">{{ p.name }}</span>
                <span v-if="selectedPlatforms.has(p.id)" class="deploy-platform-status selected">待分发</span>
                <span v-else class="deploy-platform-status">点击选择</span>
              </div>
              <div class="deploy-platform-check" :class="{ checked: selectedPlatforms.has(p.id) }">
                <svg v-if="selectedPlatforms.has(p.id)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </button>
          </div>
        </div>

        <!-- Progress -->
        <div v-if="deployProgress" class="deploy-progress">
          <div class="deploy-progress-text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            正在分发 {{ deployProgress.skill }} 到 {{ deployProgress.platform }}... ({{ deployProgress.current }}/{{ deployProgress.total }})
          </div>
          <div class="deploy-progress-bar">
            <div class="deploy-progress-fill" :style="{ width: `${(deployProgress.current / deployProgress.total) * 100}%` }"></div>
          </div>
        </div>

        <!-- Results -->
        <div v-if="deployResults.length && !deploying" class="deploy-results">
          <div v-for="r in deployResults" :key="`${r.skill}-${r.platform}`" class="deploy-result" :class="r.status">
            <svg v-if="r.status === 'ok'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span class="deploy-result-name">{{ r.skill }} → {{ r.platform }}</span>
            <span class="deploy-result-msg">{{ r.msg }}</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="deploy-footer">
        <button class="deploy-btn cancel" @click="emit('close')" :disabled="deploying">取消</button>
        <button class="deploy-btn confirm" :disabled="!selectedCount || deploying" @click="deploy">
          <svg v-if="deploying" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {{ deploying ? (deployProgress ? `${deployProgress.current}/${deployProgress.total}` : '分发中...') : `分发到 ${selectedCount} 个平台` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deploy-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.deploy-modal { width: 560px; max-width: 90vw; max-height: 85vh; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); }

/* Header */
.deploy-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid hsl(var(--border)); }
.deploy-header-info { display: flex; align-items: baseline; gap: 10px; }
.deploy-title { font-size: 16px; font-weight: 700; color: hsl(var(--foreground)); margin: 0; }
.deploy-subtitle { font-size: 12px; color: hsl(var(--muted-foreground)); }
.deploy-close { width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.deploy-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }

/* Skill list */
.deploy-skill-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 24px; border-bottom: 1px solid hsl(var(--border)); max-height: 80px; overflow-y: auto; }
.deploy-skill-item { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 4px; border-radius: 6px; background: hsl(var(--accent)); }
.deploy-skill-avatar { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0; }
.deploy-skill-name { font-size: 11px; font-weight: 500; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }

/* Content */
.deploy-content { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; }

/* Sections */
.deploy-section { display: flex; flex-direction: column; gap: 10px; }
.deploy-section-header { display: flex; align-items: center; gap: 8px; }
.deploy-section-title { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.1em; margin: 0; }
.deploy-section-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); }
.deploy-select-all { margin-left: auto; font-size: 11px; font-weight: 600; color: hsl(var(--primary)); background: none; border: none; cursor: pointer; padding: 0; transition: opacity var(--duration-base) var(--ease-standard); }
.deploy-select-all:hover { opacity: 0.7; }
.deploy-select-all:disabled { opacity: 0.4; cursor: default; }

/* Mode toggle */
.mode-toggle { display: flex; gap: 4px; padding: 3px; background: hsl(var(--accent) / 0.4); border-radius: 10px; }
.mode-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.mode-toggle button.active { background: hsl(var(--card)); color: hsl(var(--primary)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.08); }
.mode-toggle button:disabled { opacity: 0.5; cursor: default; }
.mode-hint { font-size: 11px; line-height: 1.5; color: hsl(var(--muted-foreground)); margin: 0; }

/* Platform grid */
.deploy-platform-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.deploy-platform-card { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 12px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); text-align: left; }
.deploy-platform-card:hover:not(.disabled) { border-color: hsl(var(--primary) / 0.3); background: hsl(var(--primary) / 0.03); }
.deploy-platform-card.selected { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.06); }
.deploy-platform-card.disabled { opacity: 0.6; cursor: default; }
.deploy-platform-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: hsl(var(--muted)); flex-shrink: 0; overflow: hidden; }
.deploy-platform-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.deploy-platform-name { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deploy-platform-status { font-size: 10px; color: hsl(var(--muted-foreground)); }
.deploy-platform-status.selected { color: hsl(var(--primary)); }
.deploy-platform-check { width: 20px; height: 20px; border-radius: 6px; border: 2px solid hsl(var(--border)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--duration-base) var(--ease-standard); }
.deploy-platform-check.checked { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: #fff; }

.deploy-empty { display: flex; align-items: center; justify-content: center; padding: 32px; color: hsl(var(--muted-foreground)); font-size: 13px; }

/* Progress */
.deploy-progress { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 10px; background: hsl(var(--primary) / 0.05); border: 1px solid hsl(var(--primary) / 0.15); }
.deploy-progress-text { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: hsl(var(--primary)); }
.deploy-progress-bar { height: 4px; border-radius: 2px; background: hsl(var(--primary) / 0.15); overflow: hidden; }
.deploy-progress-fill { height: 100%; border-radius: 2px; background: hsl(var(--primary)); transition: width var(--duration-smooth) var(--ease-standard); }

/* Results */
.deploy-results { display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
.deploy-result { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.deploy-result.ok { background: hsl(142 50% 50% / 0.06); color: hsl(142 50% 35%); }
.deploy-result.error { background: hsl(var(--destructive) / 0.06); color: hsl(var(--destructive)); }
.deploy-result-name { font-weight: 600; }
.deploy-result-msg { color: hsl(var(--muted-foreground)); }

/* Footer */
.deploy-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid hsl(var(--border)); }
.deploy-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 20px; font-size: 13px; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.deploy-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.deploy-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.deploy-btn.confirm { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.deploy-btn.confirm:hover { opacity: 0.9; }
.deploy-btn.confirm:disabled { opacity: 0.5; cursor: default; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }
</style>
