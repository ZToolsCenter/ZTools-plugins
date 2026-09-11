<script setup lang="ts">
import { ref } from 'vue'
import { FolderInput, Trash2, Check, ArrowLeft } from 'lucide-vue-next'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { showNotification } from '../utils/platform'
import type { Project, ProjectGroup } from '../types'

const prompt = usePromptStore()
const projectStore = useProjectStore()

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

function createProject() {
  if (!newProjectName.value.trim()) return
  projectStore.addProject(newProjectName.value.trim(), newProjectGroup.value, newProjectDesc.value)
  newProjectName.value = ''; newProjectDesc.value = ''; showNewProject.value = false
  showNotification('✓ 项目已创建')
}

function deleteProject(p: Project) {
  let changed = false
  prompt.rawItems.value.forEach(item => {
    if (item.projectId === p.id) { item.projectId = undefined; item.updatedAt = Date.now(); changed = true }
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

defineExpose({ closeCtxMenu })
</script>

<template>
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
      <slot />
    </div>

    <teleport to="body">
      <div v-if="ctxMenu.visible" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <template v-if="!showMoveGroup">
          <div class="ctx-menu-item" @click="showMoveGroup = true"><FolderInput :size="14" /><span>移动到…</span></div>
          <div class="ctx-menu-divider"></div>
          <div class="ctx-menu-item danger" @click="deleteProject(ctxMenu.project!)"><Trash2 :size="14" /><span>删除项目</span></div>
        </template>
        <template v-else>
          <div class="ctx-menu-title">移动到分组</div>
          <div class="ctx-menu-divider"></div>
          <div v-for="g in projectStore.GROUPS" :key="g" class="ctx-menu-item" :class="{ active: ctxMenu.project?.group === g }" @click="moveProjectGroup(ctxMenu.project!, g)">
            <span class="ctx-check"><Check v-if="ctxMenu.project?.group === g" :size="14" /></span><span>{{ g }}</span>
          </div>
          <div class="ctx-menu-divider"></div>
          <div class="ctx-menu-item" @click="showMoveGroup = false"><ArrowLeft :size="14" /><span>返回</span></div>
        </template>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.project-layout { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.project-panel {
  width: 200px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--pf-border);
  background: var(--pf-bg-elevated);
}
.project-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--pf-border); }
.ph-title { font-size: 15px; font-weight: 700; }
.new-project-form { flex-direction: column; padding: 8px 12px; border-bottom: 1px solid var(--pf-border); display: flex; gap: 8px; }
.np-input { flex: 1; height: 32px; padding: 0 10px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12.5px; }
.np-input:focus { border-color: var(--pf-accent); outline: none; }
.np-select { height: 32px; padding: 0 8px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12px; }
.project-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
.project-content { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.group-label { font-size: 10.5px; font-weight: 700; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 4px 4px; }
.project-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: var(--pf-radius-sm); cursor: pointer; transition: all 0.12s; }
.project-item:hover { background: var(--pf-surface-hover); }
.project-item.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.pi-name { font-size: 13px; }
.pi-count { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.ctx-menu { position: fixed; z-index: 9999; min-width: 160px; padding: 4px 0; background: var(--pf-bg-elevated); border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
.ctx-menu-title { font-size: 11px; font-weight: 700; color: var(--pf-text-faint); padding: 6px 12px 2px; text-transform: uppercase; letter-spacing: 0.04em; }
.ctx-menu-divider { height: 1px; background: var(--pf-border); margin: 4px 0; }
.ctx-menu-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 13px; color: var(--pf-text); cursor: pointer; transition: background 0.1s; }
.ctx-menu-item:hover { background: var(--pf-surface-hover); }
.ctx-menu-item.active { color: var(--pf-accent); font-weight: 600; }
.ctx-check { width: 14px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ctx-menu-item.danger { color: var(--pf-danger, #ef4444); }
.ctx-menu-item.danger:hover { background: rgba(239, 68, 68, 0.08); }
</style>
