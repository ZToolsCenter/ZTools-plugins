<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'navigate', view: 'dashboard' | 'settings' | 'nodes'): void
}>();

const activeIndex = ref('dashboard');

function handleSelect(key: string) {
  activeIndex.value = key;
  emit('navigate', key as any);
}
</script>

<template>
  <el-menu :default-active="activeIndex"
    class="sidebar-menu h-full border-r-0 !bg-white dark:!bg-[#0f172a] transition-colors duration-300"
    :collapse="true" @select="handleSelect">
    <div class="h-4"></div> <!-- Top spacing -->

    <el-menu-item index="dashboard">
      <el-icon>
        <div class="i-mdi-view-dashboard" />
      </el-icon>
    </el-menu-item>

    <el-menu-item index="nodes">
      <el-icon>
        <div class="i-mdi-nodejs" />
      </el-icon>
    </el-menu-item>

    <div class="flex-1"></div> <!-- Spacer -->

    <el-menu-item index="settings">
      <el-icon>
        <div class="i-mdi-cog" />
      </el-icon>
    </el-menu-item>

    <div class="h-4"></div> <!-- Bottom spacing -->
  </el-menu>
</template>

<style scoped>
.sidebar-menu {
  --item-hover-bg: #f1f5f9;
  --item-hover-text: #0f172a;
}

:global(html.dark) .sidebar-menu {
  --item-hover-bg: rgba(30, 41, 59, 0.6);
  --item-hover-text: #f1f5f9;
}

:deep(.el-menu-item) {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
  margin: 6px 10px;
  border-radius: 10px;
  transition: all 0.2s ease-out;
  color: #94a3b8;
}

:global(html.dark) :deep(.el-menu-item) {
  color: #64748b;
}

:deep(.el-menu-item:hover) {
  background-color: var(--item-hover-bg) !important;
  color: var(--item-hover-text) !important;
}

:deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.06)) !important;
  color: #2563eb !important;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
  font-weight: 600;
}

:global(html.dark) :deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.08)) !important;
  color: #60a5fa !important;
  box-shadow: 0 0 16px rgba(59, 130, 246, 0.1);
}

:deep(.el-icon) {
  font-size: 22px !important;
}
</style>
