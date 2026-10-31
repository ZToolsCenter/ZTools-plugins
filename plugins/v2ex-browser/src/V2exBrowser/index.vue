<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { fetchReplies, fetchTopic, fetchTopics } from '../v2ex/client'
import { filterTopics, formatRelativeTime } from '../v2ex/presentation'
import { createAvatarStore } from '../v2ex/avatar'
import { FeedCache } from '../v2ex/feed-cache'
import { buildReplyThreads } from '../v2ex/reply-threads'
import { normalizeContentUrl, openExternalUrl } from '../v2ex/rich-content'
import RichContent from './RichContent.vue'
import ReplyThread from './ReplyThread.vue'
import type { FeedKind, TopicDetail, TopicReply, TopicSummary } from '../v2ex/types'

defineProps<{ enterAction: Record<string, unknown> }>()

const feed = ref<FeedKind>('hot')
const topics = ref<TopicSummary[]>([])
const keyword = ref('')
const feedLoading = ref(false)
const feedError = ref('')
const view = ref<'list' | 'detail'>('list')
const topic = ref<TopicDetail | null>(null)
const replies = ref<TopicReply[]>([])
const detailLoading = ref(false)
const detailError = ref('')
const repliesLoading = ref(false)
const repliesError = ref('')
const avatarVersion = ref(0)
const feedScrollPositions: Record<FeedKind, number> = { hot: 0, latest: 0 }
let feedRequestVersion = 0
let detailRequestVersion = 0

const visibleTopics = computed(() => filterTopics(topics.value, keyword.value))
const replyThreads = computed(() => buildReplyThreads(replies.value))
const selectedTopic = computed(() => topic.value)
const feedTitle = computed(() => (feed.value === 'hot' ? '最热帖子' : '最新帖子'))
const feeds = new FeedCache(fetchTopics)
const avatars = createAvatarStore(
  (url) => window.services.getV2exAvatar(normalizeAvatarUrl(url)),
  () => { avatarVersion.value += 1 }
)

async function loadFeed(forceRefresh = false) {
  const requestVersion = ++feedRequestVersion
  feedLoading.value = true
  feedError.value = ''
  try {
    const result = await feeds.load(feed.value, forceRefresh)
    if (requestVersion === feedRequestVersion) topics.value = result
  } catch (error) {
    if (requestVersion === feedRequestVersion) {
      feedError.value = error instanceof Error ? error.message : '帖子列表加载失败，请稍后重试。'
    }
  } finally {
    if (requestVersion === feedRequestVersion) feedLoading.value = false
  }
}

async function changeFeed(nextFeed: FeedKind) {
  if (feed.value === nextFeed && topics.value.length) return
  feedScrollPositions[feed.value] = window.scrollY
  feed.value = nextFeed
  keyword.value = ''
  await loadFeed()
  // 等待目标列表渲染完成，避免较短的旧列表限制可恢复的滚动距离。
  await nextTick()
  if (view.value === 'list' && feed.value === nextFeed) {
    window.scrollTo({ top: feedScrollPositions[nextFeed], behavior: 'auto' })
  }
}

async function openTopic(topicId: number, preserveScroll = false) {
  const scrollPosition = preserveScroll ? window.scrollY : null
  const requestVersion = ++detailRequestVersion
  view.value = 'detail'
  detailLoading.value = true
  repliesLoading.value = true
  detailError.value = ''
  repliesError.value = ''
  if (!preserveScroll) {
    topic.value = null
    replies.value = []
  }
  const topicRequest = fetchTopic(topicId)
    .then((result) => {
      if (requestVersion === detailRequestVersion) topic.value = result
    })
    .catch((error) => {
      if (requestVersion === detailRequestVersion) {
        detailError.value = error instanceof Error ? error.message : '帖子详情加载失败，请稍后重试。'
      }
    })
    .finally(() => {
      if (requestVersion === detailRequestVersion) detailLoading.value = false
    })
  const repliesRequest = fetchReplies(topicId)
    .then((result) => {
      if (requestVersion === detailRequestVersion) replies.value = result
    })
    .catch((error) => {
      if (requestVersion === detailRequestVersion) {
        repliesError.value = error instanceof Error ? error.message : '回复加载失败，请稍后重试。'
      }
    })
    .finally(() => {
      if (requestVersion === detailRequestVersion) repliesLoading.value = false
    })

  await Promise.all([topicRequest, repliesRequest])
  if (scrollPosition !== null) {
    // 正文和回复都更新并渲染后再恢复，避免较晚返回的内容改变页面高度。
    await nextTick()
    if (requestVersion === detailRequestVersion && view.value === 'detail') {
      window.scrollTo({ top: scrollPosition, behavior: 'auto' })
    }
  }
}

function returnToList() {
  detailRequestVersion += 1
  view.value = 'list'
}

function refreshDetail() {
  if (selectedTopic.value) void openTopic(selectedTopic.value.id, true)
}

function openInBrowser() {
  if (!selectedTopic.value) return
  openExternalUrl(normalizeContentUrl(selectedTopic.value.url))
}

function normalizeAvatarUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

function avatarUrl(url: string): string | undefined {
  avatarVersion.value
  const normalized = normalizeAvatarUrl(url)
  void avatars.load(normalized)
  return avatars.get(normalized)
}

watch(
  () => true,
  () => {
    feed.value = 'hot'
    view.value = 'list'
    void loadFeed()
  },
  { immediate: true }
)

onMounted(() => {
  if (!topics.value.length && !feedLoading.value) void loadFeed()
})
</script>

<template>
  <main class="v2ex-browser">
    <section v-if="view === 'list'" class="feed-view" aria-label="V2EX 帖子列表">
      <header class="toolbar">
        <div class="brand"><span class="brand-mark">V2</span><strong>V2EX</strong></div>
        <div class="segmented" aria-label="帖子类型">
          <button :class="{ active: feed === 'hot' }" :disabled="feedLoading" @click="changeFeed('hot')">
            热门
          </button>
          <button :class="{ active: feed === 'latest' }" :disabled="feedLoading" @click="changeFeed('latest')">
            最新
          </button>
        </div>
        <label class="search"><span class="search-icon" aria-hidden="true">⌕</span><input v-model="keyword" type="search" placeholder="搜索标题、节点或作者" /></label>
        <button class="icon-button" title="刷新" aria-label="刷新" :disabled="feedLoading" @click="() => loadFeed(true)">↻</button>
      </header>

      <div class="feed-heading">
        <div><p class="eyebrow">V2EX COMMUNITY</p><h1>{{ feedTitle }}</h1></div>
        <span v-if="topics.length" class="count">{{ visibleTopics.length }} 篇</span>
      </div>

      <div v-if="feedError" class="notice error"><strong>加载失败</strong><span>{{ feedError }}</span><button @click="() => loadFeed(true)">重试</button></div>
      <div v-else-if="feedLoading && !topics.length" class="notice loading">正在从 V2EX 获取帖子...</div>
      <div v-else-if="!visibleTopics.length" class="notice empty">没有匹配的帖子，换个关键词试试。</div>

      <div v-else class="topic-list">
        <button v-for="topic in visibleTopics" :key="topic.id" class="topic-row" @click="openTopic(topic.id)">
          <img class="avatar" :src="avatarUrl(topic.member.avatar_normal)" alt="" />
          <span class="topic-main">
            <span class="topic-title">{{ topic.title }}</span>
            <span class="topic-meta"><b>{{ topic.node.title }}</b><span>{{ topic.member.username }}</span><span>{{ formatRelativeTime(topic.created) }}</span></span>
          </span>
          <span class="replies" :aria-label="`${topic.replies} 条回复`">{{ topic.replies }}</span>
        </button>
      </div>
    </section>

    <section v-else class="detail-view" aria-label="V2EX 帖子详情">
      <header class="toolbar detail-toolbar">
        <button class="back-button" @click="returnToList">← <span>返回列表</span></button>
        <div class="detail-actions">
          <button class="icon-button" title="刷新详情" aria-label="刷新详情" :disabled="detailLoading || repliesLoading" @click="refreshDetail">↻</button>
          <button class="open-button" :disabled="!selectedTopic" @click="openInBrowser">在浏览器打开 ↗</button>
        </div>
      </header>

      <div v-if="detailLoading && !selectedTopic" class="notice loading">正在加载帖子详情...</div>
      <div v-else-if="detailError && !selectedTopic" class="notice error"><strong>详情加载失败</strong><span>{{ detailError }}</span><button @click="returnToList">返回列表</button></div>
      <template v-else-if="selectedTopic">
        <article class="topic-detail">
          <p class="eyebrow">{{ selectedTopic.node.title }} / {{ selectedTopic.member.username }}</p>
          <h1>{{ selectedTopic.title }}</h1>
          <div class="author-line"><img class="avatar" :src="avatarUrl(selectedTopic.member.avatar_normal)" alt="" /><span>{{ selectedTopic.member.username }}</span><span>{{ formatRelativeTime(selectedTopic.created) }}</span><span>{{ selectedTopic.replies }} 条回复</span></div>
          <RichContent :content-rendered="selectedTopic.content_rendered" :content="selectedTopic.content" empty-text="这篇帖子没有正文。" />
          <div v-if="detailError" class="notice error" role="alert"><strong>帖子刷新失败，当前显示上次加载的内容</strong><span>{{ detailError }}</span></div>
        </article>

        <section class="replies-section">
          <h2>回复 <span>{{ replies.length }}</span></h2>
          <div v-if="repliesLoading && !replies.length" class="notice loading">正在加载回复...</div>
          <div v-else-if="repliesError" class="notice error"><span>{{ repliesError }}</span><button @click="refreshDetail">重试</button></div>
          <div v-else-if="!replies.length" class="notice empty">暂时还没有回复。</div>
          <ReplyThread v-for="thread in replyThreads" :key="thread.reply.id" :thread="thread" :topic-author="selectedTopic.member.username" :avatar-url="avatarUrl" />
        </section>
      </template>
    </section>
  </main>
</template>
