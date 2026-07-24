<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from './stores/router'
import { usePromptStore } from './stores/prompt'
import { useProjectStore } from './stores/project'
import { useAppSettings } from './stores/app'
import { useTheme } from './stores/theme'
import { readClipboardText, showNotification } from './utils/platform'
import CommandBar from './components/CommandBar.vue'
import SpaceView from './views/SpaceView.vue'
import WizardView from './views/WizardView.vue'
import ManageView from './views/ManageView.vue'
import QuickSaveView from './views/QuickSaveView.vue'
import ComposeView from './views/ComposeView.vue'
import SettingsView from './views/SettingsView.vue'

const router = useRouter()
const promptStore = usePromptStore()
const projectStore = useProjectStore()
const appSettings = useAppSettings()
const themeStore = useTheme()
const ready = ref(false)

onMounted(async () => {
  await promptStore.ensureReady()
  await projectStore.ensureReady()
  await appSettings.load()
  await themeStore.init()
  ready.value = true

  const ztools = (window as any).ztools
  if (ztools) {
    ztools.onPluginEnter(async (param: any) => {
      if (param.code === 'promptforge_call') {
        router.navigateTo('space')
      } else if (param.code === 'promptforge_quick_save') {
        let content = ''
        let source = 'selected'
        if (param.type === 'over') {
          content = String(param.payload ?? '')
          source = 'selected'
        } else if (param.type === 'regex' && param.payload) {
          // 正则匹配：payload 就是匹配到的文本
          content = String(param.payload)
          source = 'clipboard'
        } else {
          // text 类型命令（pfs 等）：从剪贴板读取
          const ztools = (window as any).ztools
          try {
            if (ztools?.clipboard?.getHistory) {
              const result = await ztools.clipboard.getHistory(1, 1)
              console.log('[PromptForge] clipboard history:', result)
              const records = result?.list || result?.data || result || []
              const first = Array.isArray(records) ? records[0] : null
              if (first?.content) content = String(first.content)
              else if (first?.text) content = String(first.text)
              else if (first?.value) content = String(first.value)
            }
          } catch (e) { console.error('[PromptForge] clipboard error:', e) }
          if (!content && navigator.clipboard?.readText) {
            try { content = await navigator.clipboard.readText() } catch {}
          }
          source = 'clipboard'
        }
        console.log('[PromptForge] quick save:', { source, contentLen: content.trim().length, type: param.type, payload: param.payload })
        if (content.trim().length >= 20) {
          const ctxProjectId = promptStore.filterProjectId.value || ''
          router.enterQuickSave(content.trim(), source, ctxProjectId)
        } else {
          showNotification('内容过短（至少20字符），当前: ' + content.trim().length + '字符')
        }
      }
    })
  }
})

const viewMap: Record<string, any> = {
  space: SpaceView,
  wizard: WizardView,
  compose: ComposeView,
  manage: ManageView,
  'quick-save': QuickSaveView,
  settings: SettingsView,
}
const activeComponent = computed(() => viewMap[router.currentView.value] || SpaceView)
</script>

<template>
  <div class="app-shell">
    <template v-if="ready">
      <CommandBar />
      <div class="view-container">
        <component :is="activeComponent" />
      </div>
    </template>
    <div v-else class="loading">
      <div class="loading-spinner"></div>
      <span>PromptForge</span>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  width: 100%; height: 100%;
  background: var(--pf-bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.view-container {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column;
}
.loading {
  flex: 1; display: flex;
  flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
  color: var(--pf-text-muted);
  font-size: 14px; font-weight: 600;
}
.loading-spinner {
  width: 24px; height: 24px;
  border: 2.5px solid var(--pf-border);
  border-top-color: var(--pf-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
