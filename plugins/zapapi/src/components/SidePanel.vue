<template>
  <div class="side-panel" :class="{ 'side-panel--collapsed': collapsed }" data-tour-id="sidebar-root">
    <div v-show="!collapsed" class="side-panel__header">
      <span class="side-panel__title">{{ panelTitle }}</span>
      <div class="side-panel__header-actions">
        <slot name="header-actions" />
      </div>
    </div>
    <div v-show="!collapsed" class="side-panel__content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PanelId } from './ActivityBar.vue'

const { t } = useI18n()

const props = defineProps<{
  activePanel: PanelId | null
  collapsed: boolean
}>()

const panelTitle = computed(() => {
  switch (props.activePanel) {
    case 'collections': return t('sidebar.collections')
    case 'history': return t('sidebar.history')
    case 'environments': return t('env.title')
    case 'cookies': return t('app.cookies')
    default: return ''
  }
})
</script>

<style scoped>
.side-panel {
  width: 210px;
  min-width: 210px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.side-panel--collapsed {
  width: 0;
  min-width: 0;
  border-right: none;
}

.side-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}

.side-panel__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-panel__header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.side-panel__content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
