<template>
  <n-config-provider :theme="theme" :theme-overrides="overrides" class="provider">
    <n-message-provider>
      <div class="app">
        <aside v-show="!sidebarHidden" class="sidebar">
          <div class="brand">
            <img :src="logoUrl" alt="" class="brand-logo" />
            <span class="brand-name">任务看板</span>
            <button class="sidebar-collapse" title="收起项目列" @click="toggleSidebar">«</button>
          </div>
          <ProjectSidebar />
        </aside>
        <div v-if="sidebarHidden" class="sidebar-restore" title="展开项目列" @click="toggleSidebar">
          <span class="restore-icon">»</span>
          <span class="restore-text">项目</span>
        </div>
        <main class="main">
          <header v-if="project" class="topbar">
            <h1 class="proj-title">{{ project.name }}</h1>
            <div class="stats">
              <n-progress
                type="line"
                :percentage="stats.percent"
                :show-indicator="false"
                style="width: 120px"
              />
              <span class="stats-text">{{ stats.done }}/{{ stats.total }} 已完成</span>
            </div>
          </header>
          <KanbanBoard @edit-task="openEdit" />
        </main>
        <TaskModal v-model:show="modalShow" :task="editingTask" :dark="isDark" />
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NProgress,
  darkTheme,
  type GlobalThemeOverrides
} from 'naive-ui'
import ProjectSidebar from './components/ProjectSidebar.vue'
import KanbanBoard from './components/KanbanBoard.vue'
import TaskModal from './components/TaskModal.vue'
import { init, stats, currentProject as project, sidebarHidden, toggleSidebar } from './store'
import { filterText } from './store'
import type { TaskDoc } from './types'
import logoUrl from './assets/logo.png'

const modalShow = ref(false)
const editingTask = ref<TaskDoc | null>(null)

function openEdit(task: TaskDoc) {
  editingTask.value = task
  modalShow.value = true
}

function zt(): any {
  return (window as any).ztools
}

const isDark = ref(false)
let subInputAttached = false

onMounted(async () => {
  const z = zt()
  isDark.value = !!z?.isDarkColors?.()
  await init()

  if (z?.setSubInput) {
    try {
      // 兼容 string 与 { text } 两种回调载荷
      z.setSubInput((payload: any) => {
        const text = typeof payload === 'string' ? payload : (payload?.text ?? '')
        filterText.value = text || ''
      }, '搜索任务标题…', false)
      subInputAttached = true
    } catch {
      /* ignore */
    }
  }
})

onUnmounted(() => {
  if (subInputAttached) {
    try {
      zt()?.removeSubInput?.()
    } catch {
      /* ignore */
    }
  }
})

const theme = computed(() => (isDark.value ? darkTheme : null))

const overrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: '#18a058',
    primaryColorHover: '#36ad6a',
    primaryColorPressed: '#0c7a43'
  }
}))
</script>

<style scoped>
.provider {
  height: 100vh;
}
.app {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.sidebar {
  width: 208px;
  flex-shrink: 0;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  gap: 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
}
.brand-logo {
  width: 22px;
  height: 22px;
}
.brand-name {
  font-weight: 600;
  font-size: 15px;
}
.sidebar-collapse {
  margin-left: auto;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  border-radius: 4px;
  opacity: 0.5;
  line-height: 1;
}
.sidebar-collapse:hover {
  background: rgba(128, 128, 128, 0.18);
  opacity: 1;
}
.sidebar-restore {
  flex-shrink: 0;
  width: 28px;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.sidebar-restore:hover .restore-icon,
.sidebar-restore:hover .restore-text {
  color: #18a058;
}
.restore-icon {
  font-size: 16px;
  color: rgba(128, 128, 128, 0.8);
}
.restore-text {
  writing-mode: vertical-rl;
  font-size: 12px;
  color: rgba(128, 128, 128, 0.8);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px 8px;
}
.proj-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.stats-text {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
</style>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.n-config-provider {
  height: 100%;
}
</style>
