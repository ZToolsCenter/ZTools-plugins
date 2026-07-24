<template>
  <div class="activity-bar" data-tour-id="activity-bar">
    <div class="activity-bar__top">
      <UiTooltip
        v-for="item in topItems"
        :key="item.id"
        :content="item.label"
        placement="right"
      >
        <button
          class="activity-bar__item"
          :class="{ 'activity-bar__item--active': isActive(item.id) }"
          @click="onItemClick(item.id)"
        >
          <component :is="getIconComponent(item.id)" />
          <span
            v-if="item.id === 'environments' && activeEnvName"
            class="activity-bar__badge"
          >{{ getEnvBadgeText(activeEnvName) }}</span>
        </button>
      </UiTooltip>
    </div>
    <div class="activity-bar__bottom">
      <UiTooltip :content="t('shortcuts.title')" placement="right">
        <button class="activity-bar__item" data-tour-id="shortcuts-entry" @click="emitOpenShortcuts">
          <ShortcutsIcon />
        </button>
      </UiTooltip>
      <UiTooltip :content="t('common.settings')" placement="right">
        <button class="activity-bar__item" data-tour-id="settings-entry" @click="emitOpenSettings">
          <SettingsIcon />
        </button>
      </UiTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, h } from 'vue'
import { useI18n } from 'vue-i18n'
import UiTooltip from './ui/UiTooltip.vue'

export type PanelId = 'collections' | 'history' | 'environments' | 'cookies'

interface PanelItem {
  id: PanelId
  label: string
}

const { t } = useI18n()

const props = defineProps<{
  activePanel: PanelId | null
  collapsed: boolean
  activeEnvName: string | null
}>()

const emit = defineEmits<{
  'select-panel': [panel: PanelId]
  'open-settings': []
  'open-shortcuts': []
}>()

const topItems = computed<PanelItem[]>(() => [
  { id: 'collections', label: t('sidebar.collections') },
  { id: 'history', label: t('sidebar.history') },
  { id: 'environments', label: t('env.title') },
  { id: 'cookies', label: t('app.cookies') }
])

function isActive(panelId: PanelId): boolean {
  return props.activePanel === panelId && !props.collapsed
}

function onItemClick(panelId: PanelId) {
  emit('select-panel', panelId)
}

function emitOpenSettings() {
  emit('open-settings')
}

function emitOpenShortcuts() {
  emit('open-shortcuts')
}

function getEnvBadgeText(name: string): string {
  return name.charAt(0)
}

function getIconComponent(panelId: PanelId) {
  const iconProps = { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }
  
  const icons: Record<PanelId, any> = {
    collections: markRaw(() => h('svg', iconProps, h('path', { d: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z' }))),
    history: markRaw(() => h('svg', iconProps, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('polyline', { points: '12 6 12 12 16 14' })
    ])),
    environments: markRaw(() => h('svg', { ...iconProps, 'data-tour-id': 'env-selector' }, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('line', { x1: '2', y1: '12', x2: '22', y2: '12' }),
      h('path', { d: 'M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z' })
    ])),
    cookies: markRaw(() => h('svg', iconProps, [
      h('path', { d: 'M12 3a9 9 0 1 0 9 9c0-.4 0-.8-.1-1.2A3.8 3.8 0 0 1 17 7a4 4 0 0 1-3.9-3.4C12.7 3.2 12.3 3 12 3z' }),
      h('circle', { cx: '8.5', cy: '11', r: '1' }),
      h('circle', { cx: '12', cy: '14', r: '1' }),
      h('circle', { cx: '15.5', cy: '10', r: '1' })
    ]))
  }
  
  return icons[panelId]
}

const ShortcutsIcon = markRaw(() => {
  const props = { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }
  return h('svg', props, [
    h('circle', { cx: '12', cy: '12', r: '10' }),
    h('path', { d: 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3' }),
    h('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' })
  ])
})

const SettingsIcon = markRaw(() => {
  const props = { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }
  return h('svg', props, [
    h('path', { d: 'M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z' }),
    h('circle', { cx: '12', cy: '12', r: '3' })
  ])
})
</script>

<style scoped>
.activity-bar {
  width: 44px;
  min-width: 44px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-color);
  flex-shrink: 0;
}

.activity-bar__top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  flex: 1;
}

.activity-bar__bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  border-top: 1px solid var(--border-color);
}

.activity-bar__item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.activity-bar__item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.activity-bar__item--active {
  color: var(--accent-primary);
  background: var(--accent-glow);
}

.activity-bar__item--active::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 0 2px 2px 0;
  background: var(--accent-primary);
}

.activity-bar__badge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 14px;
  height: 14px;
  font-size: 8px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #fff;
  pointer-events: none;
}
</style>
