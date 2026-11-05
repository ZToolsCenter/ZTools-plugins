<script setup lang="ts">
import { computed } from 'vue'
import { formatRelativeTime } from '../v2ex/presentation'
import type { ReplyThread as ReplyThreadNode } from '../v2ex/reply-threads'
import RichContent from './RichContent.vue'

const props = defineProps<{
  thread: ReplyThreadNode
  topicAuthor: string
  avatarUrl: (url: string) => string | undefined
}>()

const isTopicAuthor = computed(() => props.thread.reply.member.username.toLowerCase() === props.topicAuthor.toLowerCase())
</script>

<template>
  <article class="reply" :data-floor="thread.floor" :aria-label="`第 ${thread.floor} 楼 ${thread.reply.member.username} 的回复`">
    <div class="reply-row">
      <img class="avatar reply-avatar" :src="avatarUrl(thread.reply.member.avatar_normal)" alt="" />
      <div class="reply-main">
        <div class="reply-meta">
          <strong>{{ thread.reply.member.username }}</strong>
          <span v-if="isTopicAuthor" class="reply-op" aria-label="楼主">OP</span>
          <time :datetime="new Date(thread.reply.created * 1_000).toISOString()">{{ formatRelativeTime(thread.reply.created) }}</time>
          <span class="reply-floor" :aria-label="`第 ${thread.floor} 楼`">#{{ thread.floor }}</span>
        </div>
        <RichContent :content-rendered="thread.reply.content_rendered" :content="thread.content" empty-text="（无文字内容）" />
      </div>
    </div>
    <div v-if="thread.children.length" class="reply-children" role="group" :aria-label="`第 ${thread.floor} 楼的子回复`">
      <ReplyThread v-for="child in thread.children" :key="child.reply.id" :thread="child" :topic-author="topicAuthor" :avatar-url="avatarUrl" />
    </div>
  </article>
</template>
