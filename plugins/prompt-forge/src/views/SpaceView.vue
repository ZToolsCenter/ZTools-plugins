<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { useAppSettings } from '../stores/app'
import { copyText, showNotification, hideMainWindow } from '../utils/platform'
import { renderVariables } from '../utils/index'
import PromptList from '../components/PromptList.vue'
import FillPanel from '../components/FillPanel.vue'
import ShortcutPanel from '../components/ShortcutPanel.vue'
import SpaceSidebar from '../components/SpaceSidebar.vue'
import ProjectPanel from '../components/ProjectPanel.vue'
import HistoryPanel from '../components/HistoryPanel.vue'
import TrashPanel from '../components/TrashPanel.vue'
import StatisticsPanel from '../components/StatisticsPanel.vue'

const router = useRouter()
const prompt = usePromptStore()
const projectStore = useProjectStore()
const appSettings = useAppSettings()

const showShortcuts = ref(false)

function handlePromptDelete(id: string) {
  prompt.softDelete(id)
  showNotification('✓ 已移至回收站')
}

function handlePromptEdit(id: string) {
  router.navigateToManage(id)
}

const emptyState = computed(() => {
  const tab = prompt.spaceTab.value
  if (tab === 'recent') return { title: '暂无使用记录', desc: '使用提示词后会自动记录在这里' }
  if (tab === 'favorite') return { title: '暂无收藏', desc: '点击提示词左侧 ☆ 即可收藏' }
  return { title: '', desc: '' }
})

async function handleCopy() {
  const unit = prompt.selectedPrompt.value
  if (!unit) return
  try {
    let text: string
    if (unit.variables && unit.variables.length > 0) {
      const missing = unit.variables.filter(v => v.required).filter(v => !prompt.variableValues.value[v.name]?.trim())
      if (missing.length > 0) { showNotification(`请填写: ${missing.map(v => v.name).join(', ')}`); return }
      text = renderVariables(unit.content, prompt.variableValues.value)
    } else {
      text = unit.content
    }
    await copyText(text)
    showNotification('✓ 已复制')
    await prompt.recordUsage(unit.id)
    await prompt.addHistory({
      promptId: unit.id,
      promptTitle: unit.title,
      copiedContent: text,
      variableValues: unit.variables?.length
        ? unit.variables.reduce((acc, v) => {
            if (prompt.variableValues.value[v.name] !== undefined) {
              acc[v.name] = prompt.variableValues.value[v.name]
            }
            return acc
          }, {} as Record<string, string>)
        : undefined,
    })
    if (appSettings.settings.value.closeAfterCopy) hideMainWindow()
    prompt.resetSelection()
  } catch (e: any) { showNotification(`复制失败: ${e.message}`) }
}

/** 获取当前项目上下文 ID */
function currentProjectId(): string {
  return (prompt.spaceTab.value === 'project' && prompt.filterProjectId.value) ? prompt.filterProjectId.value : ''
}

function handleKeyDown(e: KeyboardEvent) {
  // 快捷键面板
  if (e.key === '?' && !(e.ctrlKey || e.metaKey)) {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault()
      showShortcuts.value = !showShortcuts.value
      return
    }
  }
  if (showShortcuts.value && e.key === 'Escape') { e.preventDefault(); showShortcuts.value = false; return }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); router.enterWizard(prompt.query.value.trim(), currentProjectId()); return }

  if (prompt.phase.value === 'search') {
    const tag = (e.target as HTMLElement)?.tagName
    if (e.key === 'Enter' && prompt.filteredCallItems.value.length === 0 && prompt.query.value.trim()) {
      e.preventDefault(); router.enterWizard(prompt.query.value.trim(), currentProjectId()); return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); prompt.moveSelection('down') }
    else if (e.key === 'ArrowUp') { e.preventDefault(); prompt.moveSelection('up') }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const item = prompt.activeItem.value
      if (!item) return
      if (item.variables && item.variables.length > 0) prompt.selectActive()
      else {
        copyText(item.content).then(async () => {
          showNotification('✓ 已复制')
          await prompt.recordUsage(item.id)
          await prompt.addHistory({
            promptId: item.id,
            promptTitle: item.title,
            copiedContent: item.content,
          })
          if (appSettings.settings.value.closeAfterCopy) hideMainWindow()
        })
      }
    }
  } else if (prompt.phase.value === 'fill') {
    if (e.key === 'Escape') { e.preventDefault(); prompt.phase.value = 'search'; prompt.selectedPrompt.value = null }
    else if (e.key === 'Enter') { e.preventDefault(); handleCopy() }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  projectStore.ensureReady()
  if (appSettings.settings.value.autoFocus) {
    setTimeout(() => { const input = document.querySelector('.topbar-search') as HTMLInputElement; input?.focus() }, 100)
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="space-view">
    <SpaceSidebar />

    <div class="space-main">
      <!-- 顶栏（统计 tab 隐藏） -->
      <div v-if="prompt.spaceTab.value !== 'stats'" class="space-topbar">
        <input
          v-model="prompt.query.value"
          type="text"
          placeholder="搜索提示词…"
          class="topbar-search"
        />
        <button class="btn primary topbar-btn" @click="router.enterWizard(prompt.query.value.trim(), currentProjectId())">
          <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round">
            <line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" />
          </svg>
          新建
        </button>
      </div>

      <!-- 项目 tab -->
      <template v-if="prompt.spaceTab.value === 'project'">
        <ProjectPanel>
          <template v-if="prompt.phase.value === 'search'">
            <PromptList
              :items="prompt.filteredCallItems.value"
              :active-index="prompt.keyboardIndex.value"
              :selected-id="prompt.selectedPrompt.value?.id"
              :empty-title="emptyState.title"
              :empty-desc="emptyState.desc"
              :query="prompt.query.value"
              @select="(i: number) => { prompt.keyboardIndex.value = i }"
              @activate="prompt.selectActive()"
              @enter-wizard="router.enterWizard(prompt.query.value.trim(), currentProjectId())"
              @toggle-favorite="(id: string) => prompt.toggleFavorite(id)"
              @delete="handlePromptDelete"
              @edit="handlePromptEdit"
            />
          </template>
          <template v-else>
            <FillPanel
              :unit="prompt.selectedPrompt.value"
              :values="prompt.variableValues.value"
              @update:values="(v: Record<string, string>) => prompt.variableValues.value = v"
              @submit="handleCopy"
              @cancel="prompt.phase.value = 'search'; prompt.selectedPrompt.value = null"
            />
          </template>
        </ProjectPanel>
      </template>

      <!-- 历史 tab -->
      <template v-else-if="prompt.spaceTab.value === 'history'">
        <HistoryPanel />
      </template>

      <!-- 回收站 tab -->
      <template v-else-if="prompt.spaceTab.value === 'trash'">
        <TrashPanel />
      </template>

      <!-- 统计 tab -->
      <template v-else-if="prompt.spaceTab.value === 'stats'">
        <StatisticsPanel />
      </template>

      <!-- 其他 tab：列表 + 填写 -->
      <template v-else>
        <template v-if="prompt.phase.value === 'search'">
          <PromptList
            :items="prompt.filteredCallItems.value"
            :active-index="prompt.keyboardIndex.value"
            :selected-id="prompt.selectedPrompt.value?.id"
            :empty-title="emptyState.title"
            :empty-desc="emptyState.desc"
            :query="prompt.query.value"
            @select="(i: number) => { prompt.keyboardIndex.value = i }"
            @activate="prompt.selectActive()"
            @enter-wizard="router.enterWizard(prompt.query.value.trim(), currentProjectId())"
            @toggle-favorite="(id: string) => prompt.toggleFavorite(id)"
            @delete="handlePromptDelete"
            @edit="handlePromptEdit"
          />
        </template>
        <template v-else>
          <FillPanel
            :unit="prompt.selectedPrompt.value"
            :values="prompt.variableValues.value"
            @update:values="(v: Record<string, string>) => prompt.variableValues.value = v"
            @submit="handleCopy"
            @cancel="prompt.phase.value = 'search'; prompt.selectedPrompt.value = null"
          />
        </template>
      </template>
    </div>

    <ShortcutPanel :visible="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<style scoped>
.space-view { width: 100%; flex: 1; min-height: 0; display: flex; background: var(--pf-bg); user-select: none; overflow: hidden; }

/* 主区域 */
.space-main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

/* 顶栏 */
.space-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; flex-shrink: 0;
  border-bottom: 1px solid var(--pf-border);
  background: var(--pf-bg-elevated);
  height: 48px;
}
.topbar-search {
  flex: 1; height: 32px;
  background: var(--pf-surface); border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-pill);
  padding: 0 14px; font-size: 13px; color: var(--pf-text);
}
.topbar-search:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.topbar-search::placeholder { color: var(--pf-text-faint); }
.topbar-btn { flex-shrink: 0; height: 28px; padding: 0 10px; font-size: 12px; }
</style>
