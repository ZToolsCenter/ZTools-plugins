<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import Settings from './Settings/index.vue'
import Stats from './Stats/index.vue'
import Tutorial from './Tutorial/index.vue'
import { Config, DEFAULT_CONFIG, STORAGE_KEYS } from './types'

// 内部导航状态（用于页面内切换）
const currentTab = ref('stats')
const route = ref('')
const enterAction = ref<any>({})
const config = ref<Config>(DEFAULT_CONFIG)

// 深色模式
const isDark = ref(false)

// 导航标签页列表
const tabs = [
  { key: 'stats', label: '统计', icon: '📊' },
  { key: 'settings', label: '设置', icon: '⚙' },
  { key: 'tutorial', label: '教程', icon: '📖' }
]

// 加载配置
const loadConfig = async () => {
  const savedConfig = window.services.getItem(STORAGE_KEYS.config)
  if (savedConfig) {
    config.value = { ...DEFAULT_CONFIG, ...savedConfig }
  }
}

onMounted(async () => {
  await loadConfig()

  // 检测深色模式
  const checkDarkMode = () => {
    if (window.ztools && window.ztools.isDarkColors) {
      isDark.value = window.ztools.isDarkColors()
    } else {
      isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    }

    if (isDark.value) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  checkDarkMode()

  // 监听插件进入
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
    checkDarkMode()
  })

  // 监听插件退出
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})

onUnmounted(() => {
  // 清理工作在这里
})
</script>

<template>
  <div class="app-container">
    <!-- 顶部导航 -->
    <div class="nav-tabs">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        :class="['nav-tab', { active: currentTab === tab.key }]"
        @click="currentTab = tab.key"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
      </div>
    </div>

    <!-- 页面内容 -->
    <div class="page-content">
      <Settings v-if="currentTab === 'settings'" :enter-action="enterAction" :config="config" @update:config="config = $event" />
      <Stats v-if="currentTab === 'stats'" :enter-action="enterAction" :config="config" @update:config="config = $event" />
      <Tutorial v-if="currentTab === 'tutorial'" :enter-action="enterAction" />
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--el-bg-color);
}

.nav-tabs {
  display: flex;
  padding: 12px 20px 0;
  background-color: var(--el-bg-color-page);
  border-bottom: 1px solid var(--el-border-color-light);
}

.nav-tab {
  padding: 8px 16px;
  margin-right: 8px;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.3s;
  color: var(--el-text-color-regular);
  background-color: transparent;
  border: 1px solid transparent;
  border-bottom: none;
}

.nav-tab:hover {
  color: var(--el-color-primary);
  background-color: var(--el-fill-color-light);
}

.nav-tab.active {
  color: var(--el-color-primary);
  background-color: var(--el-bg-color);
  border-color: var(--el-border-color-light);
  border-bottom: 1px solid var(--el-bg-color);
  margin-bottom: -1px;
  font-weight: 500;
}

.tab-icon {
  font-size: 16px;
}

.tab-label {
  font-size: 14px;
}

.page-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--el-bg-color);
}
</style>