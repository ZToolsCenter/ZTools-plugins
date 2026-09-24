<script setup lang="ts">
import IconCard from './IconCard.vue'
import type { IconItem } from '../types/icon'

defineProps<{
  items: IconItem[]
  selectedIndex: number
  color: string
}>()

const emit = defineEmits<{
  select: [index: number]
}>()
</script>

<template>
  <div class="icon-grid" role="listbox" aria-label="图标搜索结果">
    <IconCard
      v-for="(item, index) in items"
      :key="item.id"
      :item="item"
      :index="index"
      :selected="selectedIndex === index"
      :color="color"
      role="option"
      @select="emit('select', $event)"
    />
  </div>
</template>
