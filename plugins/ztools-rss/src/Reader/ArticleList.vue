<script setup lang="ts">
import { computed } from 'vue'
import { store, selectArticle, loadArticles } from './store'
import { formatDate, isToday } from './utils'

const articles = computed(() => store.articles)

function onSelect(id: string) {
  selectArticle(id)
}

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (
    !store.loadingMore &&
    store.articlesContinuation &&
    el.scrollHeight - el.scrollTop - el.clientHeight < 80
  ) {
    void loadArticles(false)
  }
}
</script>

<template>
  <div class="article-list" @scroll.passive="onScroll">
    <div
      v-for="a in articles"
      :key="a.id"
      class="item"
      :class="{ active: store.selectedArticleId === a.id, unread: !a.read }"
      @click="onSelect(a.id)"
    >
      <div class="item-main">
        <div class="item-title">{{ a.title }}</div>
        <div class="item-meta">
          <span v-if="a.feedTitle" class="feed">{{ a.feedTitle }}</span>
          <span class="date">{{ isToday(a.published) ? formatDate(a.published, true) : formatDate(a.published) }}</span>
        </div>
      </div>
      <span v-if="a.starred" class="star">★</span>
    </div>
    <div v-if="store.loadingMore" class="more">加载中…</div>
    <div v-else-if="!articles.length && !store.loading" class="empty">暂无文章</div>
  </div>
</template>

<style scoped>
.article-list {
  height: 100%;
  overflow-y: auto;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--rss-border-soft);
  cursor: pointer;
}
.item:hover {
  background: var(--rss-hover);
}
.item.active {
  background: var(--rss-accent-soft);
}
.item-main {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-size: 13px;
  line-height: 1.4;
  color: var(--rss-text-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.item.unread .item-title {
  color: var(--rss-text);
  font-weight: 600;
}
.item-meta {
  margin-top: 4px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--rss-text-dim);
}
.feed {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.star {
  color: #f5a623;
  font-size: 12px;
  flex-shrink: 0;
}
.more,
.empty {
  padding: 16px;
  text-align: center;
  color: var(--rss-text-dim);
  font-size: 12px;
}
</style>
