<script setup lang="ts">
import { ref, shallowRef, onMounted } from 'vue'
import Home from './Home/index.vue'
import Settings from './Settings/index.vue'
import About from './About/index.vue'
import { ElButton } from 'element-plus'
import { Moon, Sunny } from '@element-plus/icons-vue'

const currentView = shallowRef(Home)
const launchParam = ref<{ code?: string; payload?: string } | null>(null)
const isDark = ref(false)

const navigateTo = (view: 'home' | 'settings' | 'about') => {
  switch (view) {
    case 'home':
      currentView.value = Home
      break
    case 'settings':
      currentView.value = Settings
      break
    case 'about':
      currentView.value = About
      break
  }
}

const handlePluginEnter = (param: { code?: string; payload?: string }) => {
  launchParam.value = param
  
  if (param.code === 'download' || param.code === 'copygitclone') {
    currentView.value = Home
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
  window.ztools.onPluginEnter(handlePluginEnter)
  
  console.log('当前主题:', window.ztools.isDarkColors())
  
  updateTheme(window.ztools.isDarkColors())  
})
</script>

<template>
  <div class="app-container">
    <div class="theme-toggle">
      <ElButton :icon="isDark ? Sunny : Moon" circle @click="toggleTheme" />
    </div>
    
    <div class="main-content">
      <Home 
        v-if="currentView === Home" 
        @navigate="navigateTo" 
        :launch-param="launchParam"
      />
      <Settings v-else-if="currentView === Settings" @navigate="navigateTo" />
      <About v-else-if="currentView === About" @navigate="navigateTo" />
    </div>
  </div>
</template>

<style>
.app-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.main-content {
  width: 100%;
  height: 100%;
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