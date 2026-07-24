<script lang="ts" setup>
import { defineProps, defineEmits } from 'vue'
import { Setting, Clock } from '@element-plus/icons-vue'

defineProps<{
  currentView: 'home' | 'about' | 'settings' | 'history'
}>()

const emit = defineEmits<{
  navigate: [view: 'home' | 'about' | 'settings' | 'history']
}>()

const handleNavClick = (index: string) => {
  if (index === 'home' || index === 'about' || index === 'settings' || index === 'history') {
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
      <el-menu-item index="history">
        <template #icon>
          <Clock />
        </template>
        历史
      </el-menu-item>
      <el-menu-item index="settings">
        <template #icon>
          <Setting />
        </template>
        设置
      </el-menu-item>
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