<script setup lang="ts">
import xIcon from '../assets/icons/x.svg'
import SvgIcon from './SvgIcon.vue'

withDefaults(defineProps<{
  open: boolean
  title: string
  subtitle?: string
  ariaLabel: string
  width?: 'settings' | 'detail'
}>(), {
  subtitle: '',
  width: 'settings'
})

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div v-if="open" class="drawer-backdrop" @click="emit('close')"></div>
  <aside class="drawer" :class="[`drawer-${width}`, { open }]" :aria-label="ariaLabel">
    <header class="drawer-header">
      <div>
        <strong>{{ title }}</strong>
        <span v-if="subtitle">{{ subtitle }}</span>
      </div>
      <button class="drawer-close" title="关闭" @click="emit('close')">
        <SvgIcon :src="xIcon" />
      </button>
    </header>
    <slot></slot>
  </aside>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(2px);
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 13;
  display: flex;
  height: 100%;
  flex-direction: column;
  border-left: 1px solid rgba(148, 163, 184, 0.22);
  background: var(--surface);
  box-shadow: -24px 0 60px rgba(15, 23, 42, 0.18);
  transform: translateX(104%);
  transition: transform 0.22s ease;
}

.drawer.open {
  transform: translateX(0);
}

.drawer-settings {
  width: min(320px, calc(100vw - 24px));
}

.drawer-detail {
  width: min(320px, calc(100vw - 24px));
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  user-select: none;
}

.drawer-header div {
  display: grid;
  gap: 4px;
}

.drawer-header strong {
  font-size: 18px;
}

.drawer-header span {
  color: var(--muted);
  font-size: 12px;
}

.drawer-close {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}

.drawer-close:hover {
  background: #e5e7eb;
  color: var(--text);
}

@media (prefers-color-scheme: dark) {
  .drawer-backdrop {
    background: rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(8px);
  }

  .drawer {
    border-left-color: rgba(255, 255, 255, 0.12);
    background: rgba(40, 40, 40, 0.78);
    box-shadow: -28px 0 80px rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(28px) saturate(135%);
  }

  .drawer-header {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .drawer-close:hover {
    background: rgba(255, 255, 255, 0.09);
  }
}
</style>
