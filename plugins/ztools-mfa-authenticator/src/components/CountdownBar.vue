<template>
  <div class="countdown-bar-wrapper">
    <div class="countdown-bar">
      <div
        class="bar-fill"
        :style="{ width: percentage + '%', background: barColor }"
      />
    </div>
    <span class="bar-text" :style="{ color: barColor }">{{ remaining }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  remaining: number
  period?: number
}>(), {
  period: 30,
})

const percentage = computed(() => (props.remaining / props.period) * 100)

const barColor = computed(() => {
  if (props.remaining <= 5) return 'var(--danger)'
  if (props.remaining <= 10) return 'var(--warning)'
  return 'var(--accent)'
})
</script>

<style scoped>
.countdown-bar-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 60px;
  flex-shrink: 0;
}

.countdown-bar {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s linear, background 0.3s ease;
}

.bar-text {
  font-size: 11px;
  font-weight: 600;
  min-width: 16px;
  text-align: right;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>
