<script setup lang="ts">
import { useI18n } from 'vue-i18n';

type View = 'dashboard' | 'settings' | 'nodes' | 'ports' | 'commitCalendar';

const props = withDefaults(defineProps<{
  active?: View;
}>(), {
  active: 'dashboard',
});

const emit = defineEmits<{
  (e: 'navigate', view: View): void
}>();

const { t } = useI18n();

function handleSelect(key: string) {
  emit('navigate', key as View);
}
</script>

<template>
  <el-menu
    :default-active="props.active"
    class="sidebar-menu app-sidebar-nav h-full border-r-0 transition-colors duration-300"
    :collapse="true"
    @select="handleSelect"
  >
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

    <el-menu-item index="ports" :title="t('sidebar.ports')">
      <el-icon>
        <div class="i-mdi-lan-connect" />
      </el-icon>
    </el-menu-item>

    <el-menu-item index="commitCalendar" :title="t('sidebar.commitCalendar')">
      <el-icon>
        <div class="i-mdi-calendar-month" />
      </el-icon>
    </el-menu-item>

    <div class="flex-1"></div> <!-- Spacer -->

    <el-menu-item index="settings" :title="t('sidebar.settings')">
      <el-icon>
        <div class="i-mdi-cog" />
      </el-icon>
    </el-menu-item>

    <div class="h-4"></div> <!-- Bottom spacing -->
  </el-menu>
</template>

<style scoped>
.sidebar-menu {
  --el-menu-bg-color: var(--app-surface);
  --el-menu-hover-bg-color: var(--app-primary-soft);
  --el-menu-active-color: var(--app-primary);
  --el-menu-text-color: var(--app-text-muted);
  width: 64px;
  background: var(--app-surface) !important;
  box-shadow: inset -1px 0 0 var(--app-border);
}

:deep(.el-menu-item) {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
  margin: 6px 10px;
  border-radius: var(--app-radius-md);
  color: var(--app-text-muted);
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    box-shadow var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
}

:deep(.el-menu-item:hover) {
  background-color: var(--app-primary-soft) !important;
  color: var(--app-text) !important;
}

:deep(.el-menu-item.is-active) {
  background: var(--app-primary-soft) !important;
  color: var(--app-primary) !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-primary) 28%, transparent);
  font-weight: 600;
}

:deep(.el-icon) {
  font-size: 22px !important;
}
</style>
