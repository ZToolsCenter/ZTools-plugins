<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useAppSettings } from '../stores/app'
import { useTheme } from '../stores/theme'

const router = useRouter()
const promptStore = usePromptStore()
const appSettings = useAppSettings()
const theme = useTheme()
const tab = ref('behavior')

function exportJson() {
  const json = JSON.stringify(promptStore.rawItems.value, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `promptforge-${new Date().toISOString().split('T')[0]}.json`; a.click()
}
function importJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result as string); if (!Array.isArray(data)) { alert('格式不正确'); return }
      await promptStore.ensureReady(); let count = 0
      let changed = false
      for (const item of data) { if (item.id && item.title && item.content && !promptStore.rawItems.value.some(i => i.id === item.id)) { promptStore.rawItems.value.push(item); count++; changed = true } }
      if (changed) await promptStore.persistAll()
      alert(`✓ 导入 ${count} 条`)
    } catch { alert('导入失败') }
  }
  reader.readAsText(file)
}
async function clearAll() {
  if (!confirm('⚠ 确定清空全部？')) return
  await promptStore.ensureReady()
  promptStore.rawItems.value.splice(0, promptStore.rawItems.value.length)
  await promptStore.persistAll(); alert('✓ 已清空')
}
</script>

<template>
  <div class="sv">
    <div class="sv-nav">
      <div class="ns">通用</div>
      <div :class="['ni', { active: tab === 'behavior' }]" @click="tab = 'behavior'">⚙ 行为</div>
      <div :class="['ni', { active: tab === 'theme' }]" @click="tab = 'theme'">🎨 主题</div>
      <div class="ns">数据</div>
      <div :class="['ni', { active: tab === 'import-export' }]" @click="tab = 'import-export'">📦 导入/导出</div>
      <div class="ns">关于</div>
      <div :class="['ni', { active: tab === 'about' }]" @click="tab = 'about'">ℹ 关于</div>
    </div>
    <div class="sv-content">
      <div v-if="tab === 'behavior'">
        <h2>行为设置</h2><p class="sub">复制和保存相关的默认策略。</p>
        <div class="setting-row"><div class="info"><div class="lbl">复制后关闭窗口</div><div class="desc">复制成功后自动隐藏插件窗口</div></div>
          <div class="toggle" :class="{ on: appSettings.settings.value.closeAfterCopy }" @click="appSettings.settings.value.closeAfterCopy = !appSettings.settings.value.closeAfterCopy; appSettings.save()"></div>
        </div>
        <div class="setting-row"><div class="info"><div class="lbl">自动聚焦搜索框</div><div class="desc">打开插件时自动聚焦到搜索输入框</div></div>
          <div class="toggle" :class="{ on: appSettings.settings.value.autoFocus }" @click="appSettings.settings.value.autoFocus = !appSettings.settings.value.autoFocus; appSettings.save()"></div>
        </div>
        <div class="setting-row"><div class="info"><div class="lbl">历史记录上限</div><div class="desc">最多保留的使用历史条数（当前 {{ appSettings.settings.value.maxHistory }}）</div></div>
          <div class="range-group">
            <input type="range" min="50" max="500" step="50" :value="appSettings.settings.value.maxHistory" @input="appSettings.settings.value.maxHistory = +($event.target as HTMLInputElement).value; appSettings.save()" class="range-input" />
          </div>
        </div>
      </div>
      <div v-if="tab === 'theme'">
        <h2>主题设置</h2><p class="sub">选择界面外观。</p>
        <div style="display:flex;gap:16px">
          <div :class="['theme-card', { active: theme.theme.value === 'light' }]" @click="theme.set('light'); theme.persist()"><div class="tp light-tp"></div><span>浅色</span></div>
          <div :class="['theme-card', { active: theme.theme.value === 'dark' }]" @click="theme.set('dark'); theme.persist()"><div class="tp dark-tp"></div><span>深色</span></div>
        </div>
      </div>
      <div v-if="tab === 'import-export'">
        <h2>导入与导出</h2><p class="sub">JSON 格式备份与恢复。</p>
        <div class="setting-row"><div class="info"><div class="lbl">导出词库</div></div><button class="btn primary" @click="exportJson">导出</button></div>
        <div class="setting-row"><div class="info"><div class="lbl">导入词库</div></div><label class="btn">选择文件<input type="file" accept=".json" @change="importJson" style="display:none" /></label></div>
        <div class="setting-row" style="border-bottom:0"><div class="info"><div class="lbl" style="color:var(--pf-danger)">清空全部</div></div><button class="btn danger" @click="clearAll">清空</button></div>
      </div>
      <div v-if="tab === 'about'">
        <h2>关于 PromptForge</h2><p class="sub">AI 工作流增强插件。</p>
        <div class="about-card"><div class="about-logo">PF</div><div><h3>PromptForge</h3><p class="ver">v1.1.0</p><p class="copy">© 2026</p></div></div>
        <p class="privacy">本插件不发起网络请求。数据仅存储在本地。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sv { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-columns: 170px 1fr; background: var(--pf-bg); overflow: hidden; }
.sv-nav { background: var(--pf-bg-elevated); border-right: 1px solid var(--pf-border); padding: 12px 8px; display: flex; flex-direction: column; }
.ns { font-size: 10.5px; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 10px 3px; font-weight: 600; }
.ni { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--pf-radius-sm); color: var(--pf-text-secondary); cursor: pointer; font-size: 13px; transition: all 0.12s; }
.ni:hover { background: var(--pf-surface-hover); }
.ni.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.sv-content { overflow-y: auto; padding: 24px; background: var(--pf-surface); }
.sv-content h2 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.sub { font-size: 13px; color: var(--pf-text-muted); margin: 0 0 20px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--pf-border); }
.info { display: flex; flex-direction: column; gap: 2px; padding-right: 16px; }
.lbl { font-size: 13.5px; font-weight: 600; }
.desc { font-size: 12px; color: var(--pf-text-muted); }
.toggle { width: 36px; height: 20px; background: var(--pf-border); border-radius: 10px; position: relative; cursor: pointer; transition: background 0.2s; flex-shrink: 0; }
.toggle::before { content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.2s; }
.toggle.on { background: var(--pf-accent); }
.toggle.on::before { left: 18px; }
.range-group { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.range-input { width: 120px; accent-color: var(--pf-accent); cursor: pointer; }
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
</style>
