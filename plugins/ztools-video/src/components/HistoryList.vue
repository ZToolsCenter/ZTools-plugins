<script setup lang="ts">
import { formatDuration, progressPercent, type HistoryEntry } from '../history'

defineProps<{ entries: HistoryEntry[] }>()
const emit = defineEmits<{ open: [entry: HistoryEntry]; remove: [key: string] }>()

/**
 * 生成记录副标题，例如「第 3 集 · 已看 12:34」。
 * @param entry 播放记录。
 * @returns 用间隔号连接的说明文字。
 */
function detail(entry: HistoryEntry) {
  const parts: string[] = []
  if (entry.kind === 'catalog' && entry.episodeNumber) parts.push(`第 ${entry.episodeNumber} 集`)
  if (entry.position > 0) parts.push(`已看 ${formatDuration(entry.position)}`)
  if (!parts.length) parts.push(entry.kind === 'direct' ? '直链播放' : '尚未开始')
  return parts.join(' · ')
}

/**
 * 生成「继续观看」文案。
 * @param entry 播放记录。
 * @returns 有进度时显示剩余时间，否则提示从头开始。
 */
function actionText(entry: HistoryEntry) {
  if (entry.duration > 0 && entry.position > 0) {
    return `还剩 ${formatDuration(entry.duration - entry.position)}`
  }
  return entry.position > 0 ? '继续观看' : '开始观看'
}
</script>

<template>
  <ul class="history-grid" aria-label="播放记录">
    <li v-for="entry in entries" :key="entry.key">
      <div class="history-item">
        <button type="button" class="history-card" @click="emit('open', entry)">
          <span class="cover">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>
            <img v-if="entry.cover" :src="entry.cover" alt="" loading="lazy" referrerpolicy="no-referrer"
              @error="(event) => (event.target as HTMLImageElement).hidden = true">
            <span v-if="progressPercent(entry) > 0" class="history-bar" aria-hidden="true">
              <span :style="{ width: progressPercent(entry) + '%' }" />
            </span>
          </span>
          <span class="history-copy">
            <span class="history-title">{{ entry.title }}</span>
            <span class="history-detail">{{ detail(entry) }}</span>
            <span class="history-action">{{ actionText(entry) }}</span>
          </span>
        </button>
        <button type="button" class="history-remove" :aria-label="'删除 ' + entry.title + ' 的播放记录'"
          @click="emit('remove', entry.key)">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
    </li>
  </ul>
</template>
