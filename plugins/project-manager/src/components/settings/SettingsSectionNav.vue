<script setup lang="ts">
type SettingsSectionItem = {
  id: string;
  label: string;
  icon: string;
};

const props = defineProps<{
  title: string;
  items: readonly SettingsSectionItem[];
  activeId: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();
</script>

<template>
  <nav class="settings-section-nav" :aria-label="props.title">
    <div class="settings-section-nav-title">{{ props.title }}</div>
    <div class="settings-section-nav-list">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="settings-section-nav-item"
        :class="{ 'is-active': props.activeId === item.id }"
        :aria-current="props.activeId === item.id ? 'location' : undefined"
        @click="emit('select', item.id)"
      >
        <span class="settings-section-nav-icon" :class="item.icon" aria-hidden="true" />
        <span class="settings-section-nav-label">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.settings-section-nav {
  z-index: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 12px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  background: color-mix(in srgb, var(--app-surface) 94%, transparent);
  box-shadow: var(--app-shadow-sm);
  backdrop-filter: blur(10px);
}

.settings-section-nav-title {
  padding: 2px 10px 10px;
  color: var(--app-text-muted);
  font-size: var(--app-font-meta);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.settings-section-nav-list {
  display: grid;
  gap: 3px;
}

.settings-section-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--app-duration-fast) var(--app-ease),
    color var(--app-duration-fast) var(--app-ease);
}

.settings-section-nav-item:hover {
  background: var(--app-primary-soft);
  color: var(--app-text);
}

.settings-section-nav-item:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

.settings-section-nav-item.is-active {
  background: var(--app-primary-soft);
  color: var(--app-primary);
  font-weight: 650;
}

.settings-section-nav-icon {
  flex: 0 0 auto;
  width: 18px;
  font-size: var(--app-font-section-title);
}

.settings-section-nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .settings-section-nav-item {
    transition: none;
  }
}

@media (max-width: 900px) {
  .settings-section-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: auto;
    max-height: none;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 6px;
    scrollbar-width: thin;
  }

  .settings-section-nav-title {
    flex: 0 0 auto;
    padding: 0 4px 0 6px;
  }

  .settings-section-nav-list {
    display: flex;
    gap: 4px;
    min-width: max-content;
  }

  .settings-section-nav-item {
    width: auto;
    min-height: 36px;
    padding: 7px 9px;
  }
}
</style>
