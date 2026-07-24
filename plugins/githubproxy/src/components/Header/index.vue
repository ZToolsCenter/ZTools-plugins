<script lang="ts" setup>
import { defineProps, defineEmits } from 'vue'

defineProps<{
  currentView: 'home' | 'settings' | 'about'
}>()

const emit = defineEmits<{
  navigate: [view: 'home' | 'settings' | 'about']
}>()

const handleNavClick = (index: string) => {
  if (index === 'home' || index === 'settings' || index === 'about') {
    emit('navigate', index)
  }
}
</script>

<template>
  <el-header>
    <el-menu
      :default-active="currentView"
      mode="horizontal"
      :ellipsis= false
      @select="handleNavClick"
    >
     <el-menu-item index="0">
      <img
        style="width: 50px; height: 50px"
        src="/logo.png"
        alt="Element logo"
      />
    </el-menu-item>
      <el-menu-item index="home">首页</el-menu-item>
      <el-menu-item index="settings">设置</el-menu-item>
      <el-menu-item index="about">关于</el-menu-item>
    </el-menu>
  </el-header>
</template>

<style scoped>
.el-header {
  padding: 0;
  align-items: center;
}
.el-menu--horizontal > .el-menu-item:nth-child(1) {
  margin-right: auto;
}
</style>