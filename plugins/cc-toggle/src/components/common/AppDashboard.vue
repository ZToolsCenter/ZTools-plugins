<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  const props = defineProps({
    stats: { type: Array, required: true },
    unit: { type: String, default: '' }
  });
</script>

<template>
  <div class="dash-grid">
    <div
      v-for="stat in stats"
      :key="stat.app"
      class="dash-card"
      :class="{ 'dash-card--zero': stat.count === 0 }"
    >
      <div class="dash-icon" :class="'dash-icon--' + stat.app">
        <img v-if="stat.icon" :src="stat.icon" :alt="stat.label" class="dash-icon-img" />
      </div>
      <div class="dash-body">
        <span class="dash-agent">{{ stat.label }}</span>
        <span v-if="stat.count" class="dash-num">{{ stat.count }}</span>
        <span v-else class="dash-num dash-num--zero">—</span>
        <span class="dash-unit">{{ unit }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
    padding: 0 20px 8px;
    flex-shrink: 0;
  }

  .dash-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &:hover {
      border-color: var(--primary);
      box-shadow: 0 1px 4px rgba(217, 119, 6, 0.1);
    }

    &--zero {
      opacity: 0.55;

      &:hover {
        border-color: var(--text-muted);
        box-shadow: none;
      }
    }
  }

  .dash-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--bg-hover);

    &--codex {
      background: #fef3c7;
    }
    &--claude {
      background: #ede9fe;
    }
    &--claude-desktop {
      background: #ede9fe;
    }
    &--openclaw {
      background: #d1fae5;
    }
    &--gemini {
      background: #dbeafe;
    }
    &--opencode {
      background: #fce7f3;
    }
  }

  .dash-icon-img {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  .dash-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .dash-agent {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .dash-num {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;

    &--zero {
      color: var(--text-muted);
      font-size: 16px;
    }
  }

  .dash-unit {
    font-size: 10px;
    color: var(--text-muted);
  }
</style>
