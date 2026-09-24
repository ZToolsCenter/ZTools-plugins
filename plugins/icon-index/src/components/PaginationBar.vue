<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

defineProps<{
  page: number
  count: number
  loadedCount: number
  hasPrevious: boolean
  hasNext: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  previous: []
  next: []
}>()
</script>

<template>
  <footer class="pagination-bar">
    <span class="result-count">第 {{ page }} 页 · {{ count }} 项</span>
    <span class="loaded-count">已载入 {{ loadedCount }}</span>
    <div class="page-controls">
      <button
        type="button"
        class="icon-button"
        :disabled="!hasPrevious || loading"
        title="上一页"
        aria-label="上一页"
        @click="emit('previous')"
      >
        <ChevronLeft :size="19" aria-hidden="true" />
      </button>
      <span>{{ page }}</span>
      <button
        type="button"
        class="icon-button"
        :disabled="!hasNext || loading"
        title="下一页"
        aria-label="下一页"
        @click="emit('next')"
      >
        <ChevronRight :size="19" aria-hidden="true" />
      </button>
    </div>
  </footer>
</template>
