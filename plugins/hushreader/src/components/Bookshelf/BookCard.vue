<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Book } from '../../stores/books'

const props = defineProps<{
  book: Book
  listMode?: boolean
  selectionMode?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  click: []
  contextmenu: [e: MouseEvent]
  'cover-error': []
  'toggle-select': []
}>()

const imgError = ref(false)

const displayCover = computed(() => {
  if (imgError.value) return undefined
  return props.book.customCoverImage || props.book.coverImage
})

function onImgError() {
  imgError.value = true
  emit('cover-error')
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function progressText(book: Book): string {
  if (!book.lastReadAt) return ''
  if (book.readingPercent != null) {
    return `${book.readingPercent}%`
  }
  if (book.totalChapters && book.lastChapter != null) {
    const pct = Math.round(((book.lastChapter + 1) / book.totalChapters) * 100)
    return `${pct}%`
  }
  return ''
}
</script>

<template>
  <div class="book-card" :class="{ 'list-mode': listMode, 'selection-mode': selectionMode, selected }"
    @click="selectionMode ? emit('toggle-select') : emit('click')"
    @contextmenu.prevent="!selectionMode && emit('contextmenu', $event)">
    <!-- Selection checkbox -->
    <div v-if="selectionMode" class="select-check" :class="{ checked: selected }">
      <svg v-if="selected" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    <!-- Cover -->
    <div class="book-cover" :style="displayCover ? {} : { background: book.coverColor || '#4a7fa5' }">
      <img v-if="displayCover" :src="displayCover" :alt="book.title" class="cover-img" @error="onImgError" />
      <template v-else>
        <span class="cover-format">{{ book.format.toUpperCase() }}</span>
        <span class="cover-title">{{ book.title }}</span>
      </template>
      <span class="format-badge" :class="book.format">{{ book.format.toUpperCase() }}</span>
      <span v-if="progressText(book)" class="cover-progress">
        <span class="progress-bar" :style="{ width: progressText(book) }"></span>
        <span class="progress-label">{{ progressText(book) }}</span>
      </span>
      <span v-if="book.finishedAt && !selectionMode && !listMode" class="finished-badge">已读完</span>
    </div>

    <!-- Info -->
    <div class="book-info">
      <p class="book-title">{{ book.title }}</p>
      <p class="book-author">{{ book.author || '未知作者' }}</p>
      <p v-if="listMode" class="book-meta">
        <span v-if="book.finishedAt" class="meta-finished">已读完</span>{{ (book.categories || []).join('、') }}{{
          book.categories?.length && book.lastReadAt ? ' · ' : '' }}{{ book.lastReadAt ? formatDate(book.lastReadAt) : ''
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.book-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  border-radius: var(--radius-md);
  padding: 6px;
  transition: background 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.book-card:hover {
  background: var(--c-surface-sunken);
}

.book-card.list-mode {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
}

.book-card.selection-mode {
  cursor: pointer;
  position: relative;
}

.book-card.selection-mode.selected {
  background: var(--c-accent-soft);
}

.select-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--c-border-strong);
  background: var(--c-surface-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transition: all 0.15s var(--ease-out);
}

.select-check.checked {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-ink-inverse);
}

.list-mode .select-check {
  position: static;
  flex-shrink: 0;
}

.book-cover {
  position: relative;
  aspect-ratio: 0.68;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  box-shadow: var(--shadow-sm);
}

.list-mode .book-cover {
  width: 36px;
  height: 50px;
  flex-shrink: 0;
  aspect-ratio: unset;
  border-radius: var(--radius-xs);
}

.cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-format {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--c-cover-text-muted);
  text-transform: uppercase;
}

.cover-title {
  font-size: 11px;
  color: var(--c-cover-text);
  text-align: center;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

.cover-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 20px;
  background: var(--c-progress-bg);
  display: flex;
  align-items: center;
  overflow: hidden;
}

.progress-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--c-progress-bar);
  transition: width 0.3s var(--ease-out);
}

.progress-label {
  position: relative;
  z-index: 1;
  width: 100%;
  text-align: center;
  font-size: 9px;
  color: var(--c-progress-label);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

.book-info {
  min-width: 0;
  flex: 1;
}

.book-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.list-mode .book-title {
  font-size: 13px;
}

.book-author {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-ink-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-ink-tertiary);
}

.meta-finished {
  display: inline-block;
  padding: 0 4px;
  margin-right: 4px;
  border-radius: var(--radius-xs);
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.6;
  vertical-align: middle;
}

.finished-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.02em;
  z-index: 2;
  pointer-events: none;
}

.format-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.5px;
  z-index: 2;
  pointer-events: none;
  line-height: 1.5;
}

.format-badge.epub {
  background: rgba(59, 130, 246, 0.85);
  color: #fff;
}

.format-badge.txt {
  background: rgba(107, 114, 128, 0.85);
  color: #fff;
}

.format-badge.mobi {
  background: rgba(234, 88, 12, 0.85);
  color: #fff;
}

.list-mode .format-badge {
  top: 3px;
  left: 3px;
  padding: 0 3px;
  font-size: 7px;
}
</style>
