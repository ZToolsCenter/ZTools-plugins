<template>
  <svg
    class="countdown-ring"
    :width="36"
    :height="36"
    viewBox="0 0 36 36"
  >
    <!-- Background circle -->
    <circle
      class="ring-bg"
      cx="18"
      cy="18"
      :r="radius"
      fill="none"
      stroke="var(--border)"
      :stroke-width="strokeWidth"
    />
    <!-- Progress circle -->
    <circle
      class="ring-progress"
      cx="18"
      cy="18"
      :r="radius"
      fill="none"
      :stroke="ringColor"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="dashOffset"
      transform="rotate(-90 18 18)"
    />
    <!-- Remaining seconds text -->
    <text
      x="18"
      y="18"
      text-anchor="middle"
      dominant-baseline="central"
      class="ring-text"
      :fill="ringColor"
    >
      {{ remaining }}
    </text>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  remaining: number
  period?: number
}>(), {
  period: 30,
})

const radius = 15
const strokeWidth = 2.5
const circumference = 2 * Math.PI * radius

const dashOffset = computed(() => {
  const ratio = props.remaining / props.period
  return circumference * (1 - ratio)
})

const ringColor = computed(() => {
  if (props.remaining <= 5) return 'var(--danger)'
  if (props.remaining <= 10) return 'var(--warning)'
  return 'var(--accent)'
})
</script>

<style scoped>
.countdown-ring {
  flex-shrink: 0;
}

.ring-progress {
  transition: stroke-dashoffset 0.5s linear, stroke 0.3s ease;
}

.ring-text {
  font-size: 11px;
  font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>
