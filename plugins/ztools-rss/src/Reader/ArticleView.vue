<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { store, toggleStar, refreshCurrent } from './store'
import { sanitizeHtml } from './api'
import { formatDate } from './utils'

const article = computed(() => {
  const a = store.articles.find((x) => x.id === store.selectedArticleId) || null
  return a
})

const scrollRef = ref<HTMLElement | null>(null)
watch(
  () => store.selectedArticleId,
  () => {
    nextTick(() => {
      if (scrollRef.value) scrollRef.value.scrollTop = 0
    })
  }
)

const safeHtml = computed(() => {
  if (!article.value) return ''
  return sanitizeHtml(article.value.content)
})

function openLink(url: string) {
  if (url) window.ztools.shellOpenExternal(url)
}

function onContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const a = target.closest('a')
  if (a && a.href) {
    e.preventDefault()
    window.ztools.shellOpenExternal(a.href)
  }
}

function refererHint(): string {
  const link = article.value?.link
  try {
    if (link) return new URL(link).origin + '/'
  } catch (_) {
    /* ignore */
  }
  return ''
}

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  if (!img || img.tagName !== 'IMG' || img.dataset.proxied) return
  const src = img.currentSrc || img.src
  if (!src || !/^https?:/i.test(src)) return
  img.dataset.proxied = '1'
  window.services
    .fetchImageAsDataUrl(src, refererHint())
    .then((dataUrl) => {
      img.src = dataUrl
    })
    .catch(() => {
      img.classList.add('img-failed')
    })
}

function handleStar() {
  if (article.value) void toggleStar(article.value)
}
function handleRefresh() {
  void refreshCurrent()
}
</script>

<template>
  <div ref="scrollRef" class="article-view">
    <template v-if="article">
      <div class="article-head">
        <h1 class="title">{{ article.title }}</h1>
        <div class="meta">
          <span v-if="article.feedTitle" class="feed">{{ article.feedTitle }}</span>
          <span class="date">{{ formatDate(article.published, true) }}</span>
          <span v-if="article.author" class="author">{{ article.author }}</span>
          <div class="actions">
            <button class="tool-btn" :class="{ on: article.starred }" @click="handleStar">
              {{ article.starred ? '★' : '☆' }}
            </button>
            <button class="tool-btn" @click="openLink(article.link || '')">原文</button>
            <button class="tool-btn" @click="handleRefresh">⟳</button>
          </div>
        </div>
      </div>
      <div class="article-content" @click="onContentClick" @error.capture="onImgError" v-html="safeHtml"></div>
    </template>
    <div v-else class="placeholder">
      <div class="ph-icon">📰</div>
      <div class="ph-text">选择一篇文章开始阅读</div>
    </div>
  </div>
</template>

<style scoped>
.article-view {
  height: 100%;
  overflow-y: auto;
  background: var(--rss-panel);
}
.article-head {
  padding: 22px 32px 14px;
  border-bottom: 1px solid var(--rss-border-soft);
}
.title {
  margin: 0 0 10px;
  font-size: 22px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--rss-text);
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--rss-text-dim);
}
.feed {
  color: var(--rss-accent);
  font-weight: 600;
}
.actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.tool-btn {
  background: var(--rss-hover);
  color: var(--rss-text-soft);
  border: 1px solid var(--rss-border);
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.6;
}
.tool-btn:hover {
  border-color: var(--rss-accent);
}
.tool-btn.on {
  color: #f5a623;
  border-color: #f5a623;
}
.article-content {
  padding: 22px 32px 60px;
  font-size: 15px;
  line-height: 1.75;
  color: var(--rss-text);
  word-break: break-word;
}
.article-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
.article-content :deep(img.img-failed) {
  display: inline-block;
  min-height: 40px;
  padding: 8px 14px;
  border: 1px dashed var(--rss-border);
  border-radius: 6px;
  background: var(--rss-hover);
  color: var(--rss-text-dim);
  font-size: 12px;
}
.article-content :deep(img.img-failed)::after {
  content: '图片加载失败';
}
.article-content :deep(pre) {
  background: var(--rss-code-bg);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
}
.article-content :deep(code) {
  font-family: Consolas, Monaco, monospace;
}
.article-content :deep(blockquote) {
  margin: 0;
  padding: 4px 16px;
  border-left: 3px solid var(--rss-accent);
  color: var(--rss-text-soft);
}
.article-content :deep(a) {
  color: var(--rss-accent);
  text-decoration: none;
  cursor: pointer;
}
.article-content :deep(a:hover) {
  text-decoration: underline;
}
.article-content :deep(table) {
  border-collapse: collapse;
}
.article-content :deep(th),
.article-content :deep(td) {
  border: 1px solid var(--rss-border);
  padding: 6px 10px;
}
.article-content :deep(h1),
.article-content :deep(h2),
.article-content :deep(h3) {
  line-height: 1.4;
  margin: 1.4em 0 0.6em;
}
.placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--rss-text-dim);
}
.ph-icon {
  font-size: 48px;
  margin-bottom: 10px;
  opacity: 0.6;
}
.ph-text {
  font-size: 14px;
}
</style>
