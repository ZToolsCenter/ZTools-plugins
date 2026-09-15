<script setup lang="ts">
import { computed } from 'vue'
import { ICONS } from '../icons'

const props = defineProps<{ name?: string; paths?: string[]; size?: number | string }>()
const list = computed(() => props.paths || ICONS[props.name || ''] || [])
</script>

<template>
  <svg
    v-if="list.length"
    class="icon"
    viewBox="0 0 24 24"
    :style="size ? { fontSize: typeof size === 'number' ? size + 'px' : size } : undefined"
    focusable="false"
    aria-hidden="true"
  >
    <path v-for="(d, i) in list" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  width: 1em;
  height: 1em;
  fill: currentColor;
  flex-shrink: 0;
  user-select: none;
}
</style>
