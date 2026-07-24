<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { useAppSettings } from '../stores/app'
import { copyText, showNotification, hideMainWindow } from '../utils/platform'
import { renderVariables } from '../utils/index'
import PromptList from '../components/PromptList.vue'
import FillPanel from '../components/FillPanel.vue'
import type { Project, ProjectGroup } from '../types'

const router = useRouter()
const prompt = usePromptStore()
const projectStore = useProjectStore()
const appSettings = useAppSettings()

const showNewProject = ref(false)
const newProjectName = ref('')
const newProjectGroup = ref<ProjectGroup>('开发')
const newProjectDesc = ref('')

// 项目右键菜单
const ctxMenu = ref<{ visible: boolean; x: number; y: number; project: Project | null }>({
  visible: false, x: 0, y: 0, project: null,
})
const showMoveGroup = ref(false)



function onProjectContextMenu(e: MouseEvent, project: Project) {
  e.preventDefault()
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, project }
  showMoveGroup.value = false
}

function closeCtxMenu() {
  ctxMenu.value.visible = false
  showMoveGroup.value = false
}

function deleteProject(p: Project) {
  // 批量取消项目关联，仅触发一次持久化
  let changed = false
  prompt.rawItems.value.forEach(item => {
    if (item.projectId === p.id) {
      item.projectId = undefined
      item.updatedAt = Date.now()
      changed = true
    }
  })
  if (changed) prompt.persistAll()
  projectStore.removeProject(p.id)
  if (prompt.filterProjectId.value === p.id) prompt.filterProjectId.value = ''
  showNotification(`已删除项目「${p.name}」`)
  closeCtxMenu()
}

function moveProjectGroup(p: Project, group: ProjectGroup) {
  projectStore.updateProject(p.id, { group })
  showNotification(`「${p.name}」已移至「${group}」`)
  closeCtxMenu()
}

function handlePromptDelete(id: string) {
  prompt.softDelete(id)
  showNotification('✓ 已移至回收站')
}

function handleClearHistory() {
  if (confirm('确定清空所有历史记录？')) {
    prompt.clearHistory()
    showNotification('✓ 已清空')
  }
}

function handlePromptEdit(id: string) {
  // 导航到管理视图并选中该项
  router.navigateToManage(id)
}

const emptyState = computed(() => {
  const tab = prompt.spaceTab.value
  if (tab === 'recent') return { title: '暂无使用记录', desc: '使用提示词后会自动记录在这里' }
  if (tab === 'favorite') return { title: '暂无收藏', desc: '点击提示词左侧 ☆ 即可收藏' }
  return { title: '', desc: '' }
})

const sideNav = computed(() => [
  { key: 'all' as const, label: '全部', icon: '📋' },
  { key: 'recent' as const, label: '最近', icon: '🕘' },
  { key: 'favorite' as const, label: '收藏', icon: '⭐' },
  { key: 'history' as const, label: '历史', icon: '📜' },
  { key: 'project' as const, label: '项目', icon: '📁' },
  { key: 'asset' as const, label: '资产', icon: '📦' },
  { key: 'trash' as const, label: '回收站', icon: '🗑' },
])

// 切换 tab 时重置筛选状态
function switchTab(key: typeof prompt.spaceTab.value) {
  prompt.spaceTab.value = key
  prompt.filterTag.value = ''
  prompt.filterProjectId.value = ''
  prompt.query.value = ''
  prompt.keyboardIndex.value = 0
  prompt.phase.value = 'search'
  prompt.selectedPrompt.value = null
}

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

function createProject() {
  if (!newProjectName.value.trim()) return
  projectStore.addProject(newProjectName.value.trim(), newProjectGroup.value, newProjectDesc.value)
  newProjectName.value = ''; newProjectDesc.value = ''; showNewProject.value = false
  showNotification('✓ 项目已创建')
}

/** 获取当前项目上下文 ID（仅在项目 tab 且选中了具体项目时返回） */
function currentProjectId(): string {
  return (prompt.spaceTab.value === 'project' && prompt.filterProjectId.value) ? prompt.filterProjectId.value : ''
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); router.enterWizard(prompt.query.value.trim(), currentProjectId()); return }

  if (prompt.phase.value === 'search') {
    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA'
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
  window.addEventListener('click', closeCtxMenu)
  projectStore.ensureReady()
  if (appSettings.settings.value.autoFocus) {
    setTimeout(() => { const input = document.querySelector('.topbar-search') as HTMLInputElement; input?.focus() }, 100)
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('click', closeCtxMenu)
})
</script>

<template>
  <div class="space-view">
    <aside class="space-sidebar">
      <div v-for="nav in sideNav" :key="nav.key"
        :class="['side-btn', { active: prompt.spaceTab.value === nav.key }]"
        @click="switchTab(nav.key)"
      >
        <span class="side-icon">{{ nav.icon }}</span>
        <span class="side-label">{{ nav.label }}</span>
        <span v-if="nav.key === 'all'" class="side-count">{{ prompt.liveItems.value.length }}</span>
        <span v-if="nav.key === 'history'" class="side-count">{{ prompt.historyItems.value.length }}</span>
        <span v-if="nav.key === 'trash'" class="side-count">{{ prompt.trashItems.value.length }}</span>
      </div>
      <!-- 标签管理 -->
      <div v-if="prompt.spaceTab.value !== 'trash' && prompt.spaceTab.value !== 'history' && prompt.allTags.value.length" class="side-tags">
        <div class="side-tags-title">标签</div>
        <div
          v-for="tag in prompt.allTags.value.slice(0, 20)"
          :key="tag"
          :class="['side-tag', { active: prompt.filterTag.value === tag }]"
          @click="prompt.filterTag.value = prompt.filterTag.value === tag ? '' : tag"
        >
          <span class="side-tag-dot">#</span>
          <span class="side-tag-name">{{ tag }}</span>
        </div>
      </div>
    </aside>

    <div class="space-main">
      <!-- 顶栏：搜索 + 新建 + 设置 -->
      <div class="space-topbar">
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

      <!-- 项目 tab：左列项目列表 + 右列提示词 -->
      <template v-if="prompt.spaceTab.value === 'project'">
        <div class="project-layout">
          <div class="project-panel">
            <div class="project-header">
              <span class="ph-title">项目</span>
              <button class="btn" @click="showNewProject = !showNewProject">+ 新建</button>
            </div>
            <div v-if="showNewProject" class="new-project-form">
              <input v-model="newProjectName" placeholder="项目名称" class="np-input" />
              <select v-model="newProjectGroup" class="np-select"><option v-for="g in projectStore.GROUPS" :key="g">{{ g }}</option></select>
              <button class="btn primary" @click="createProject">创建</button>
            </div>
            <div class="project-list">
              <div v-for="group in projectStore.GROUPS" :key="group">
                <template v-if="projectStore.groupedProjects.value[group]?.length">
                  <div class="group-label">{{ group }}</div>
                  <div v-for="p in projectStore.groupedProjects.value[group]" :key="p.id"
                    :class="['project-item', { active: prompt.filterProjectId.value === p.id }]"
                    @click="prompt.filterProjectId.value = p.id; prompt.keyboardIndex.value = 0"
                    @contextmenu="onProjectContextMenu($event, p)">
                    <span class="pi-name">{{ p.name }}</span>
                    <span class="pi-count">{{ prompt.liveItems.value.filter(i => i.projectId === p.id).length }}</span>
                  </div>
                </template>
              </div>
              <div
                :class="['project-item', { active: !prompt.filterProjectId.value }]"
                @click="prompt.filterProjectId.value = ''; prompt.keyboardIndex.value = 0">
                <span class="pi-name">全部项目提示词</span>
                <span class="pi-count">{{ prompt.liveItems.value.filter(i => i.projectId).length }}</span>
              </div>
            </div>
          </div>
          <div class="project-content">
            <template v-if="prompt.phase.value === 'search'">
              <PromptList
                :items="prompt.filteredCallItems.value"
                :active-index="prompt.keyboardIndex.value"
                :selected-id="prompt.selectedPrompt.value?.id"
                :empty-title="emptyState.title"
                :empty-desc="emptyState.desc"
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
          </div>
        </div>
      </template>

      <!-- 历史 tab -->
      <template v-else-if="prompt.spaceTab.value === 'history'">
        <div class="history-view">
          <div class="history-header">
            <span class="history-title">使用历史</span>
            <div class="history-actions">
              <button
                :class="['sort-btn', { active: true }]"
                @click="prompt.historySortDir.value = prompt.historySortDir.value === 'desc' ? 'asc' : 'desc'"
              >{{ prompt.historySortDir.value === 'desc' ? '最新优先' : '最早优先' }}</button>
              <button v-if="prompt.historyItems.value.length" class="btn danger" @click="handleClearHistory">清空</button>
            </div>
          </div>
          <div v-if="!prompt.sortedHistoryItems.value.length" class="empty-hint">暂无使用历史</div>
          <div v-else class="history-list">
            <div v-for="h in prompt.sortedHistoryItems.value" :key="h.id" class="history-item">
              <div class="history-info">
                <div class="history-prompt-title">{{ h.promptTitle }}</div>
                <div class="history-content-preview">{{ h.copiedContent.slice(0, 120) }}{{ h.copiedContent.length > 120 ? '…' : '' }}</div>
                <div class="history-meta">
                  <span class="history-time">{{ new Date(h.usedAt).toLocaleString('zh-CN') }}</span>
                  <span v-if="h.variableValues" class="history-vars">{{ Object.keys(h.variableValues).length }} 变量</span>
                </div>
              </div>
              <div class="history-item-actions">
                <button class="btn" :disabled="!prompt.liveItems.value.some(i => i.id === h.promptId)" @click="router.navigateToManage(h.promptId)" title="查看原始提示词">查看</button>
                <button class="btn" @click="copyText(h.copiedContent); showNotification('✓ 已复制')">复制</button>
                <button class="btn icon-btn" title="删除" @click="prompt.deleteHistoryEntry(h.id)">✕</button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 回收站 tab -->
      <template v-else-if="prompt.spaceTab.value === 'trash'">
        <div class="trash-list">
          <div v-if="!prompt.trashItems.value.length" class="empty-hint">回收站为空</div>
          <div v-for="item in prompt.trashItems.value" :key="item.id" class="trash-item">
            <div class="trash-info">
              <div class="trash-title">{{ item.title }}</div>
              <div class="trash-meta">{{ item.type }} · {{ item.tags.slice(0, 3).map(t => '#' + t).join(' ') }}</div>
            </div>
            <div class="trash-actions">
              <button class="btn" @click="prompt.restore(item.id); showNotification('✓ 已恢复')">恢复</button>
              <button class="btn danger" @click="prompt.hardDelete(item.id); showNotification('已永久删除')">永久删除</button>
            </div>
          </div>
        </div>
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

    <!-- 项目右键菜单 -->
    <teleport to="body">
      <div v-if="ctxMenu.visible" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <template v-if="!showMoveGroup">
          <div class="ctx-menu-item" @click="showMoveGroup = true">
            <span>📂</span><span>移动到…</span>
          </div>
          <div class="ctx-menu-divider"></div>
          <div class="ctx-menu-item danger" @click="deleteProject(ctxMenu.project!)">
            <span>🗑</span><span>删除项目</span>
          </div>
        </template>
        <template v-else>
          <div class="ctx-menu-title">移动到分组</div>
          <div class="ctx-menu-divider"></div>
          <div
            v-for="g in projectStore.GROUPS"
            :key="g"
            class="ctx-menu-item"
            :class="{ active: ctxMenu.project?.group === g }"
            @click="moveProjectGroup(ctxMenu.project!, g)"
          >
            <span>{{ ctxMenu.project?.group === g ? '✓' : '' }}</span><span>{{ g }}</span>
          </div>
          <div class="ctx-menu-divider"></div>
          <div class="ctx-menu-item" @click="showMoveGroup = false">
            <span>←</span><span>返回</span>
          </div>
        </template>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.space-view { width: 100%; flex: 1; min-height: 0; display: flex; background: var(--pf-bg); user-select: none; overflow: hidden; }

/* 左侧边栏 */
.space-sidebar {
  width: 150px; flex-shrink: 0;
  background: var(--pf-bg-elevated);
  border-right: 1px solid var(--pf-border);
  display: flex; flex-direction: column;
  padding: 8px 0; overflow-y: auto;
}
.side-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; margin: 0 8px; border-radius: var(--pf-radius-sm);
  font-size: 13px; color: var(--pf-text-muted);
  cursor: pointer; transition: all 0.12s;
}
.side-btn:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
.side-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.side-icon { font-size: 15px; width: 20px; text-align: center; }
.side-label { flex: 1; }
.side-count { font-size: 11px; font-weight: 600; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }

/* 侧栏标签 */
.side-tags {
  margin-top: 4px; padding: 0 8px;
  border-top: 1px solid var(--pf-border);
}
.side-tags-title {
  font-size: 10px; font-weight: 700; color: var(--pf-text-faint);
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 10px 8px 4px;
}
.side-tag {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: var(--pf-radius-sm);
  font-size: 12px; color: var(--pf-text-muted);
  cursor: pointer; transition: all 0.12s;
}
.side-tag:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
.side-tag.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.side-tag-dot { font-size: 11px; opacity: 0.5; }
.side-tag-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.topbar-icon { flex-shrink: 0; height: 28px; width: 28px; padding: 0; font-size: 15px; color: var(--pf-text-muted); display: flex; align-items: center; justify-content: center; border-radius: var(--pf-radius-sm); }
.topbar-icon:hover { background: var(--pf-surface-hover); color: var(--pf-text); }

/* 项目 */
.project-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--pf-border); }
.ph-title { font-size: 15px; font-weight: 700; }
.new-project-form { display: flex; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--pf-border); }
.np-input { flex: 1; height: 32px; padding: 0 10px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12.5px; }
.np-input:focus { border-color: var(--pf-accent); outline: none; }
.np-select { height: 32px; padding: 0 8px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12px; }

/* 项目 tab 双栏布局 */
.project-layout { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.project-panel {
  width: 200px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--pf-border);
  background: var(--pf-bg-elevated);
}
.project-panel .project-header { padding: 8px 12px; }
.project-panel .new-project-form { flex-direction: column; padding: 8px 12px; }
.project-panel .project-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
.project-content { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

.group-label { font-size: 10.5px; font-weight: 700; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 4px 4px; }
.project-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; border-radius: var(--pf-radius-sm);
  cursor: pointer; transition: all 0.12s;
}
.project-item:hover { background: var(--pf-surface-hover); }
.project-item.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.pi-name { font-size: 13px; }
.pi-count { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }

/* 历史 */
.history-view { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.history-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--pf-border);
  background: var(--pf-bg-elevated); flex-shrink: 0;
}
.history-title { font-size: 15px; font-weight: 700; }
.history-actions { display: flex; gap: 6px; align-items: center; }
.history-actions .sort-btn {
  border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs);
  background: var(--pf-surface); font-size: 11px; color: var(--pf-text-muted);
  padding: 3px 8px; cursor: pointer; transition: all 0.12s;
}
.history-actions .sort-btn:hover { border-color: var(--pf-accent); color: var(--pf-accent); }
.history-actions .sort-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); border-color: var(--pf-accent); font-weight: 600; }
.history-actions .btn.danger { height: 26px; padding: 0 10px; font-size: 11px; color: var(--pf-danger, #ef4444); }
.history-actions .btn.danger:hover { background: rgba(239, 68, 68, 0.08); }
.history-list { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.history-item {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-radius: var(--pf-radius-md);
  border: 1px solid var(--pf-border); background: var(--pf-surface);
  transition: all 0.12s;
}
.history-item:hover { border-color: var(--pf-border-hover); background: var(--pf-surface-hover); }
.history-info { flex: 1; min-width: 0; }
.history-prompt-title { font-size: 13px; font-weight: 600; color: var(--pf-text); margin-bottom: 4px; }
.history-content-preview {
  font-size: 12px; color: var(--pf-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-bottom: 4px; max-width: 500px;
}
.history-meta { display: flex; gap: 8px; align-items: center; }
.history-time { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.history-vars { font-size: 11px; color: var(--pf-accent); font-weight: 500; }
.history-item-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
.history-item-actions .btn { height: 26px; padding: 0 10px; font-size: 11px; }
.history-item-actions .icon-btn {
  width: 24px; height: 24px; padding: 0; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--pf-radius-sm); color: var(--pf-text-faint);
  background: none; border: none; cursor: pointer; transition: all 0.12s;
}
.history-item-actions .icon-btn:hover { background: var(--pf-surface-raised); color: var(--pf-danger, #ef4444); }

/* 回收站 */
.trash-list { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.trash-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-radius: var(--pf-radius-md);
  border: 1px solid var(--pf-border); background: var(--pf-surface);
}
.trash-info { flex: 1; min-width: 0; }
.trash-title { font-size: 13px; font-weight: 600; color: var(--pf-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trash-meta { font-size: 11px; color: var(--pf-text-faint); margin-top: 2px; }
.trash-actions { display: flex; gap: 6px; flex-shrink: 0; }
.trash-actions .btn { height: 26px; padding: 0 10px; font-size: 11px; }
.trash-actions .btn.danger { color: var(--pf-danger, #ef4444); }
.trash-actions .btn.danger:hover { background: rgba(239, 68, 68, 0.08); }
.empty-hint { text-align: center; color: var(--pf-text-faint); font-size: 13px; padding: 40px 0; }

/* 右键菜单 */
.ctx-menu {
  position: fixed; z-index: 9999;
  min-width: 160px; padding: 4px 0;
  background: var(--pf-bg-elevated);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-md);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.ctx-menu-title { font-size: 11px; font-weight: 700; color: var(--pf-text-faint); padding: 6px 12px 2px; text-transform: uppercase; letter-spacing: 0.04em; }
.ctx-menu-divider { height: 1px; background: var(--pf-border); margin: 4px 0; }
.ctx-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; font-size: 13px; color: var(--pf-text);
  cursor: pointer; transition: background 0.1s;
}
.ctx-menu-item:hover { background: var(--pf-surface-hover); }
.ctx-menu-item.active { color: var(--pf-accent); font-weight: 600; }
.ctx-menu-item.danger { color: var(--pf-danger, #ef4444); }
.ctx-menu-item.danger:hover { background: rgba(239, 68, 68, 0.08); }
</style>
