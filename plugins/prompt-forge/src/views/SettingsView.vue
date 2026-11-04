<script setup lang="ts">
import { ref } from 'vue'
import { Settings, Palette, Download, Info } from 'lucide-vue-next'
import packageInfo from '../../package.json'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { useAppSettings } from '../stores/app'
import { useTheme } from '../stores/theme'
import { buildBackup, parseBackup, mergeBackup } from '../utils/backup'
import { replaceStorageSnapshot } from '../utils/storage'
import { useModal } from '../composables/useModal'

const promptStore = usePromptStore()
const projectStore = useProjectStore()
const appSettings = useAppSettings()
const theme = useTheme()
const modal = useModal()
const tab = ref<'behavior' | 'theme' | 'import-export' | 'about'>('behavior')
const fileInput = ref<HTMLInputElement | null>(null)
const appVersion = packageInfo.version

async function toggleBehaviorSetting(key: 'closeAfterCopy' | 'autoFocus') {
  const previous = appSettings.settings.value[key]
  appSettings.settings.value[key] = !previous
  try {
    await appSettings.save()
  } catch (error) {
    appSettings.settings.value[key] = previous
    await modal.alert(`设置保存失败：${error instanceof Error ? error.message : '本地存储不可用'}`)
  }
}

async function updateHistoryLimit(event: Event) {
  const previous = appSettings.settings.value.maxHistory
  appSettings.settings.value.maxHistory = +(event.target as HTMLInputElement).value
  try {
    await appSettings.save()
  } catch (error) {
    appSettings.settings.value.maxHistory = previous
    await modal.alert(`设置保存失败：${error instanceof Error ? error.message : '本地存储不可用'}`)
  }
}

async function selectTheme(next: 'light' | 'dark') {
  const previous = theme.theme.value
  theme.set(next)
  try {
    await theme.persist()
  } catch (error) {
    theme.set(previous)
    await modal.alert(`主题保存失败：${error instanceof Error ? error.message : '本地存储不可用'}`)
  }
}

/** 将已持久化的设置同步到内存 store。 */
function applyImportedSettings(settings: Record<string, any>) {
  if (typeof settings.closeAfterCopy === 'boolean') appSettings.settings.value.closeAfterCopy = settings.closeAfterCopy
  if (typeof settings.autoFocus === 'boolean') appSettings.settings.value.autoFocus = settings.autoFocus
  if (typeof settings.maxHistory === 'number' && settings.maxHistory > 0) appSettings.settings.value.maxHistory = settings.maxHistory
  if (settings.theme === 'dark' || settings.theme === 'light') theme.set(settings.theme)
}

function exportJson() {
  const pkg = buildBackup({
    prompts: promptStore.rawItems.value,
    projects: projectStore.items.value,
    settings: { ...appSettings.settings.value, theme: theme.theme.value },
    history: promptStore.historyItems.value,
  })
  const json = JSON.stringify(pkg, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `promptforge-backup-${new Date().toISOString().split('T')[0]}.json`; a.click()
}
function importJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const pkg = parseBackup(JSON.parse(reader.result as string))
      if (!pkg) { await modal.alert('格式不正确：不是有效的 PromptForge 备份文件'); return }
      await promptStore.ensureReady()
      await projectStore.ensureReady()
      const merged = mergeBackup(pkg, {
        prompts: promptStore.rawItems.value,
        projects: projectStore.items.value,
        settings: { ...appSettings.settings.value, theme: theme.theme.value },
        history: promptStore.historyItems.value,
      })
      // 先落盘当前 debounce 队列，防止旧定时器在导入后覆盖新数据。
      await promptStore.persistAll()
      await replaceStorageSnapshot(merged)
      promptStore.rawItems.value = merged.prompts
      projectStore.items.value = merged.projects
      promptStore.historyItems.value = merged.history
      applyImportedSettings(merged.settings)
      const c = merged.counts
      const skipped = Object.values(pkg.skipped).reduce((sum, count) => sum + count, 0)
      const skippedText = skipped > 0 ? `；已忽略 ${skipped} 项无效数据` : ''
      await modal.alert(`✓ 导入完成：提示词 ${c.prompts} 条、项目 ${c.projects} 个、历史 ${c.history} 条${skippedText}`)
    } catch { await modal.alert('导入失败') }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}
async function clearAll() {
  if (!await modal.confirm('⚠ 确定清空全部？此操作不可恢复。', { title: '清空数据' })) return
  try {
    await promptStore.ensureReady()
    await projectStore.ensureReady()
    await promptStore.persistAll()
    await replaceStorageSnapshot({ prompts: [], projects: [], settings: {}, history: [] })
    promptStore.rawItems.value = []
    promptStore.historyItems.value = []
    projectStore.items.value = []
    appSettings.reset()
    theme.reset()
    await modal.alert('✓ 已清空全部本地数据')
  } catch (error) {
    await modal.alert(`清空失败：${error instanceof Error ? error.message : '本地存储不可用'}`)
  }
}
</script>

<template>
  <div class="sv">
    <nav class="sv-nav" aria-label="设置分类">
      <div class="ns">通用</div>
      <button type="button" :class="['ni', { active: tab === 'behavior' }]" :aria-current="tab === 'behavior' ? 'page' : undefined" @click="tab = 'behavior'"><Settings :size="15" />行为</button>
      <button type="button" :class="['ni', { active: tab === 'theme' }]" :aria-current="tab === 'theme' ? 'page' : undefined" @click="tab = 'theme'"><Palette :size="15" />主题</button>
      <div class="ns">数据</div>
      <button type="button" :class="['ni', { active: tab === 'import-export' }]" :aria-current="tab === 'import-export' ? 'page' : undefined" @click="tab = 'import-export'"><Download :size="15" />导入/导出</button>
      <div class="ns">关于</div>
      <button type="button" :class="['ni', { active: tab === 'about' }]" :aria-current="tab === 'about' ? 'page' : undefined" @click="tab = 'about'"><Info :size="15" />关于</button>
    </nav>
    <div class="sv-content">
      <div v-if="tab === 'behavior'">
        <h2>行为设置</h2><p class="sub">复制和保存相关的默认策略。</p>
        <div class="setting-row"><div class="info"><div class="lbl">复制后关闭窗口</div><div class="desc">复制成功后自动隐藏插件窗口</div></div>
          <button type="button" role="switch" aria-label="复制后关闭窗口" :aria-checked="appSettings.settings.value.closeAfterCopy" class="toggle" :class="{ on: appSettings.settings.value.closeAfterCopy }" @click="toggleBehaviorSetting('closeAfterCopy')"></button>
        </div>
        <div class="setting-row"><div class="info"><div class="lbl">自动聚焦搜索框</div><div class="desc">打开插件时自动聚焦到搜索输入框</div></div>
          <button type="button" role="switch" aria-label="自动聚焦搜索框" :aria-checked="appSettings.settings.value.autoFocus" class="toggle" :class="{ on: appSettings.settings.value.autoFocus }" @click="toggleBehaviorSetting('autoFocus')"></button>
        </div>
        <div class="setting-row"><div class="info"><div class="lbl">历史记录上限</div><div class="desc">最多保留的使用历史条数（当前 {{ appSettings.settings.value.maxHistory }}）</div></div>
          <div class="range-group">
            <input type="range" min="50" max="500" step="50" aria-label="历史记录上限" :value="appSettings.settings.value.maxHistory" @change="updateHistoryLimit" class="range-input" />
          </div>
        </div>
      </div>
      <div v-if="tab === 'theme'">
        <h2>主题设置</h2><p class="sub">选择界面外观。</p>
        <div class="theme-options" role="group" aria-label="主题选择">
          <button type="button" :class="['theme-card', { active: theme.theme.value === 'light' }]" :aria-pressed="theme.theme.value === 'light'" @click="selectTheme('light')"><div class="tp light-tp"></div><span>浅色</span></button>
          <button type="button" :class="['theme-card', { active: theme.theme.value === 'dark' }]" :aria-pressed="theme.theme.value === 'dark'" @click="selectTheme('dark')"><div class="tp dark-tp"></div><span>深色</span></button>
        </div>
      </div>
      <div v-if="tab === 'import-export'">
        <h2>导入与导出</h2><p class="sub">JSON 格式备份与恢复。</p>
        <div class="setting-row"><div class="info"><div class="lbl">导出词库</div></div><button class="btn primary" @click="exportJson">导出</button></div>
        <div class="setting-row"><div class="info"><div class="lbl">导入词库</div></div><button type="button" class="btn file-button" @click="fileInput?.click()">选择文件</button><input ref="fileInput" type="file" accept=".json" class="visually-hidden" tabindex="-1" aria-hidden="true" @change="importJson" /></div>
        <div class="setting-row" style="border-bottom:0"><div class="info"><div class="lbl" style="color:var(--pf-danger)">清空全部</div></div><button class="btn danger" @click="clearAll">清空</button></div>
      </div>
      <div v-if="tab === 'about'">
        <h2>关于 PromptForge</h2><p class="sub">AI 工作流增强插件。</p>
        <div class="about-card"><div class="about-logo">PF</div><div><h3>PromptForge</h3><p class="ver">v{{ appVersion }}</p><p class="copy">© 2026</p></div></div>
        <p class="privacy">本插件不发起网络请求。数据仅存储在本地。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sv { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-columns: 170px 1fr; background: var(--pf-bg); overflow: hidden; }
.sv-nav { background: var(--pf-bg-elevated); border-right: 1px solid var(--pf-border); padding: 12px 8px; display: flex; flex-direction: column; }
.ns { font-size: 10.5px; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 10px 3px; font-weight: 600; }
.ni { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--pf-radius-sm); color: var(--pf-text-secondary); cursor: pointer; font-size: 13px; transition: all 0.12s; text-align: left; }
.ni:hover { background: var(--pf-surface-hover); }
.ni.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.sv-content { overflow-y: auto; padding: 24px; background: var(--pf-surface); }
.sv-content h2 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.sub { font-size: 13px; color: var(--pf-text-muted); margin: 0 0 20px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--pf-border); }
.info { display: flex; flex-direction: column; gap: 2px; padding-right: 16px; }
.lbl { font-size: 13.5px; font-weight: 600; }
.desc { font-size: 12px; color: var(--pf-text-muted); }
.toggle { width: 42px; height: 24px; background: var(--pf-border); border-radius: 12px; position: relative; cursor: pointer; transition: background 0.2s; flex-shrink: 0; }
.toggle::before { content: ''; position: absolute; left: 2px; top: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.2s; }
.toggle.on { background: var(--pf-accent); }
.toggle.on::before { left: 20px; }
.range-group { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.range-input { width: 120px; accent-color: var(--pf-accent); cursor: pointer; }
.theme-options { display: flex; gap: 16px; flex-wrap: wrap; }
.theme-card { padding: 16px; border: 2px solid var(--pf-border); border-radius: var(--pf-radius-md); cursor: pointer; text-align: center; transition: all 0.15s; }
.theme-card.active { border-color: var(--pf-accent); background: var(--pf-accent-soft); }
.theme-card span { font-size: 13px; font-weight: 600; margin-top: 8px; display: block; }
.tp { width: 120px; height: 80px; border-radius: 6px; }
.light-tp { background: #F8F9FA; }
.dark-tp { background: #1A1B1E; }
.about-card { display: flex; align-items: center; gap: 16px; background: var(--pf-bg-elevated); border: 1px solid var(--pf-border); border-radius: var(--pf-radius); padding: 20px; margin: 12px 0 20px; }
.about-logo { width: 48px; height: 48px; background: var(--pf-gradient); color: #fff; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; }
.about-card h3 { margin: 0 0 2px; font-size: 16px; }
.ver { font-size: 13px; color: var(--pf-accent); font-weight: 600; margin: 0; }
.copy { font-size: 12px; color: var(--pf-text-faint); margin: 0; }
.privacy { font-size: 13px; color: var(--pf-text-secondary); line-height: 1.6; }
.file-button { cursor: pointer; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 720px) {
  .sv { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .sv-nav {
    flex-direction: row; gap: 4px; overflow-x: auto;
    padding: 6px 8px; border-right: 0; border-bottom: 1px solid var(--pf-border);
  }
  .ns { display: none; }
  .ni { width: auto; min-height: 36px; flex: 0 0 auto; padding: 7px 9px; }
  .sv-content { padding: 16px; }
  .theme-options { gap: 10px; }
  .theme-card { flex: 1; min-width: 130px; padding: 12px; }
  .tp { width: 100%; max-width: 120px; }
}
</style>
