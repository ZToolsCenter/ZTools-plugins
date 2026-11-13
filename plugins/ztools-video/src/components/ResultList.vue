<script setup lang="ts">
import type { Result } from '../types'
defineProps<{ results: Result[]; label?: string; posters?: boolean }>()
const emit = defineEmits<{ open: [result: Result] }>()
</script>

<template>
  <ul class="result-list" :class="{ 'poster-list': posters }" :aria-label="label || '搜索结果'">
    <li v-for="result in results" :key="result.v">
      <button type="button" class="result-card" @click="emit('open', result)">
        <span class="cover">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>
          <img v-if="result.cover" :src="result.cover" alt="" loading="lazy" referrerpolicy="no-referrer" @error="(event) => (event.target as HTMLImageElement).hidden = true">
          <span v-if="posters && result.rating" class="poster-rating" :aria-label="'评分 ' + result.rating">{{ result.rating }}</span>
        </span>
        <span class="result-copy">
          <span class="result-title">{{ result.title }}</span>
          <span v-if="result.year || (posters && result.progress)" class="result-year">{{ [result.year, posters && result.progress].filter(Boolean).join(' · ') }}</span>
        </span>
        <svg v-if="!posters" class="card-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </li>
  </ul>
</template>
