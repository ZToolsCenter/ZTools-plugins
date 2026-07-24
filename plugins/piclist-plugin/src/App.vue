<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Home from './Home/index.vue'
import About from './About/index.vue'
import Settings from './Settings/index.vue'
import History from './History/index.vue'
import { ElButton } from 'element-plus'
import { Moon, Sunny } from '@element-plus/icons-vue'

type ViewType = 'home' | 'about' | 'settings' | 'history'

const currentView = ref<ViewType>('home')
const launchParam = ref<{ code?: string; payload?: string } | null>(null)
const isDark = ref(false)

const navigateTo = (view: ViewType) => {
  currentView.value = view
}

const handlePluginEnter = (param: { code?: string; payload?: string }) => {
  launchParam.value = param
  
  if (param.code === 'piclistImg' || param.code === 'copygitclone') {
    currentView.value = 'home'
  }
}

const updateTheme = (dark: boolean) => {
  isDark.value = dark
  const root = document.documentElement
  if (dark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

const toggleTheme = () => {
  updateTheme(!isDark.value)
}

onMounted(() => {
  window.ztools.onPluginEnter?.(handlePluginEnter)
  
  updateTheme(window.ztools.isDarkColors?.() ?? false)  
})
</script>

<template>
  <div class="app-container">
    <div class="theme-toggle">
      <ElButton :icon="isDark ? Sunny : Moon" circle @click="toggleTheme" />
    </div>
    
    <div class="main-content">
      <Home 
        v-if="currentView === 'home'" 
        @navigate="navigateTo" 
        :launch-param="launchParam"
      />
      <History v-else-if="currentView === 'history'" @navigate="navigateTo" />
      <Settings v-else-if="currentView === 'settings'" @navigate="navigateTo" />
      <About v-else-if="currentView === 'about'" @navigate="navigateTo" />
    </div>
  </div>
</template>

<style>
.app-container {
  width: 100%;
  min-height: 100vh;
  position: relative;
}

.main-content {
  width: 100%;
  min-height: 100vh;
}

.theme-toggle {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
}

.theme-toggle .el-button {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
</style>