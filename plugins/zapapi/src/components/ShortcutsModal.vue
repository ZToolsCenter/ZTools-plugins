<template>
  <UiModal :title="t('shortcuts.title')" size="md" @close="$emit('close')">
    <div class="shortcuts-modal" data-tour-id="shortcuts-modal">
      <div class="shortcuts-intro">{{ t('shortcuts.intro') }}</div>

      <section v-for="group in groups" :key="group.title" class="shortcuts-group">
        <h4 class="shortcuts-group__title">{{ group.title }}</h4>
        <div class="shortcuts-list">
          <div v-for="item in group.items" :key="item.label" class="shortcut-item">
            <span class="shortcut-item__label">{{ item.label }}</span>
            <span class="shortcut-item__keys">{{ item.keys }}</span>
          </div>
        </div>
      </section>
    </div>
  </UiModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UiModal from './ui/UiModal.vue'

const { t } = useI18n()

defineEmits<{
  close: []
}>()

const groups = computed(() => [
  {
    title: t('shortcuts.groups.global'),
    items: [
      { label: t('shortcuts.items.openHelp'), keys: t('shortcuts.keys.help') },
      { label: t('shortcuts.items.openSettings'), keys: t('shortcuts.keys.openSettings') },
      { label: t('shortcuts.items.replayGuide'), keys: t('shortcuts.keys.replayGuide') }
    ]
  },
  {
    title: t('shortcuts.groups.tabs'),
    items: [
      { label: t('shortcuts.items.newTab'), keys: t('shortcuts.keys.newTab') },
      { label: t('shortcuts.items.closeTab'), keys: t('shortcuts.keys.closeTab') },
      { label: t('shortcuts.items.duplicateTab'), keys: t('shortcuts.keys.duplicateTab') },
      { label: t('shortcuts.items.nextTab'), keys: t('shortcuts.keys.nextTab') },
      { label: t('shortcuts.items.prevTab'), keys: t('shortcuts.keys.prevTab') }
    ]
  },
  {
    title: t('shortcuts.groups.request'),
    items: [
      { label: t('shortcuts.items.sendRequest'), keys: t('shortcuts.keys.sendRequest') },
      { label: t('shortcuts.items.saveRequest'), keys: t('shortcuts.keys.saveRequest') },
      { label: t('shortcuts.items.cancelRequest'), keys: t('shortcuts.keys.cancelRequest') }
    ]
  },
  {
    title: t('shortcuts.groups.layout'),
    items: [
      { label: t('shortcuts.items.toggleSidebar'), keys: t('shortcuts.keys.toggleSidebar') },
      { label: t('shortcuts.items.focusUrl'), keys: t('shortcuts.keys.focusUrl') },
      { label: t('shortcuts.items.toggleResponse'), keys: t('shortcuts.keys.toggleResponse') }
    ]
  }
])
</script>

<style scoped>
.shortcuts-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.shortcuts-intro {
  font-size: 12px;
  color: var(--text-secondary);
}

.shortcuts-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcuts-group__title {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.shortcuts-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.shortcut-item:last-child {
  border-bottom: none;
}

.shortcut-item__label {
  font-size: 12px;
  color: var(--text-primary);
}

.shortcut-item__keys {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .shortcut-item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
