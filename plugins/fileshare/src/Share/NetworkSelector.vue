<script setup lang="ts">
import type { NetworkInterface } from './types'

const props = defineProps<{
  interfaces: NetworkInterface[]
  selected: NetworkInterface | null
}>()

const emit = defineEmits<{
  change: [nic: NetworkInterface]
}>()

function handleChange(e: Event) {
  const target = e.target as HTMLSelectElement
  const idx = parseInt(target.value)
  if (idx >= 0 && idx < props.interfaces.length) {
    emit('change', props.interfaces[idx])
  }
}
</script>

<template>
  <div class="nic-selector">
    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" class="nic-icon">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <path d="M6 12h.01M10 12h.01"/>
    </svg>
    <select
      class="nic-select"
      :value="selected ? interfaces.indexOf(selected) : -1"
      @change="handleChange"
    >
      <option value="-1" disabled>选择网卡</option>
      <option
        v-for="(nic, idx) in interfaces"
        :key="nic.ip"
        :value="idx"
      >
        {{ nic.name }} — {{ nic.ip }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.nic-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 220px;
}

.nic-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.nic-select {
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  width: 100%;
  min-width: 0;
  max-width: none;
  text-overflow: ellipsis;
}

.nic-select option {
  background: var(--bg);
  color: var(--text);
}
</style>
