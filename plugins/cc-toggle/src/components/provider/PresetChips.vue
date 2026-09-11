<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import { useProviders } from '../../composables/useProviders';
  const { PRESETS, activeTab } = useProviders();
  const emit = defineEmits(['import']);
  const currentPresets = computed(() => PRESETS[activeTab()] || []);
</script>

<template>
  <div class="presets">
    <div class="presets-header">
      <span>快速导入预设</span>
      <div class="presets-line"></div>
    </div>
    <div class="presets-list">
      <button
        v-for="p in currentPresets"
        :key="p.name"
        class="preset-chip"
        @click="emit('import', p)"
      >
        {{ p.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
  .presets {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .presets-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
  }
  .presets-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .presets-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preset-chip {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--bg-card);
    cursor: pointer;
    transition: all 0.15s;
  }
  .preset-chip:hover {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-light);
  }
</style>
