<script setup lang="ts">
import type { OutlineItem } from '../outline'

defineProps<{ items: OutlineItem[] }>()

const emit = defineEmits<{
  close: []
  select: [headingIndex: number]
}>()
</script>

<template>
  <aside class="outline-panel" aria-label="当前笔记大纲">
    <header class="outline-header">
      <h2>大纲</h2>
      <button type="button" aria-label="关闭大纲" @click="emit('close')">×</button>
    </header>
    <nav v-if="items.length" class="outline-list">
      <button
        v-for="item in items"
        :key="item.headingIndex"
        type="button"
        :style="{ paddingLeft: `${12 + (item.level - 1) * 14}px` }"
        :title="item.text"
        @click="emit('select', item.headingIndex)"
      >
        {{ item.text }}
      </button>
    </nav>
    <p v-else class="outline-empty">当前笔记没有标题</p>
  </aside>
</template>
