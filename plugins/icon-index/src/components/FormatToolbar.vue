<script setup lang="ts">
import { Palette } from 'lucide-vue-next'
import type { OutputFormat } from '../types/icon'

defineProps<{
  format: OutputFormat
  size: number
  color: string
  colorEnabled: boolean
}>()

const emit = defineEmits<{
  'update:format': [value: OutputFormat]
  'update:size': [value: number]
  'update:color': [value: string]
}>()

const sizes = [24, 32, 48, 64, 96, 128, 256, 512]
</script>

<template>
  <div class="format-toolbar" aria-label="导出选项">
    <div class="segmented-control" aria-label="文件格式">
      <button
        type="button"
        :class="{ active: format === 'svg' }"
        :aria-pressed="format === 'svg'"
        @click="emit('update:format', 'svg')"
      >
        SVG
      </button>
      <button
        type="button"
        :class="{ active: format === 'png' }"
        :aria-pressed="format === 'png'"
        @click="emit('update:format', 'png')"
      >
        PNG
      </button>
    </div>

    <select
      class="size-select"
      :value="size"
      aria-label="PNG 尺寸"
      title="PNG 尺寸"
      @change="emit('update:size', Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="option in sizes" :key="option" :value="option">{{ option }} px</option>
    </select>

    <label class="color-control" :class="{ disabled: !colorEnabled }" title="图标颜色">
      <Palette :size="17" aria-hidden="true" />
      <span class="color-swatch" :style="{ backgroundColor: color }">
        <input
          type="color"
          :value="color"
          :disabled="!colorEnabled"
          aria-label="图标颜色"
          @input="emit('update:color', ($event.target as HTMLInputElement).value)"
        />
      </span>
    </label>
  </div>
</template>
