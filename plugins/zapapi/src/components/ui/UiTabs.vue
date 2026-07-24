<template>
  <div class="ui-tabs">
    <div class="ui-tabs__list">
      <div v-for="tab in tabs" :key="tab.key" class="ui-tabs__tab"
        :class="{ 'ui-tabs__tab--active': modelValue === tab.key }" @click="$emit('update:modelValue', tab.key)">
        {{ tab.label }}
        <span v-if="tab.badge !== undefined && tab.badge > 0" class="ui-tabs__badge">
          {{ tab.badge }}
        </span>
      </div>
    </div>
    <div class="ui-tabs__content">
      <slot :active-tab="modelValue" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Tab {
  key: string
  label: string
  badge?: number
}

defineProps<{
  modelValue: string
  tabs: Tab[]
}>()

defineEmits<{
  'update:modelValue': [key: string]
}>()
</script>

<style scoped>
.ui-tabs {
  display: flex;
  flex-direction: column;
}

.ui-tabs__list {
  display: flex;
  gap: 16px;
  padding: 0 16px;
  background: transparent;
  border-bottom: 1px solid var(--border-color);
}

.ui-tabs__tab {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 10px 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--transition-fast);
  user-select: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.ui-tabs__tab:hover {
  color: var(--text-primary);
}

.ui-tabs__tab--active {
  color: var(--text-primary);
  border-bottom: 2px solid var(--accent-primary);
}

.ui-tabs__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
}

.ui-tabs__tab--active .ui-tabs__badge {
  background: var(--accent-primary);
  color: #ffffff;
}

.ui-tabs__content {
  padding-top: var(--space-md);
}
</style>
