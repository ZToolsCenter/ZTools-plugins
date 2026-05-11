<script lang="ts" setup>
import { COLOR_PRESETS } from '../constants/colors'

defineProps<{
  selectedIndex: number
}>()

const emit = defineEmits<{
  'update:selectedIndex': [value: number]
}>()
</script>

<template>
  <div class="color-palette">
    <div
      v-for="(preset, index) in COLOR_PRESETS"
      :key="preset.name"
      class="color-chip"
      :class="{ active: index === selectedIndex }"
      :style="{
        backgroundColor: preset.chipBackground,
        color: preset.foreground,
        border: index === selectedIndex ? '2px solid #3b82f6' : '2px solid transparent'
      }"
      :title="preset.name"
      @click="emit('update:selectedIndex', index)"
    >
      Hi
    </div>
  </div>
</template>

<style scoped>
.color-palette {
  display: flex;
  gap: 6px;
  padding: 0 16px;
  flex-wrap: wrap;
}

.color-chip {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
  user-select: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.color-chip:hover {
  transform: scale(1.1);
}

.color-chip.active {
  transform: scale(1.05);
}
</style>
